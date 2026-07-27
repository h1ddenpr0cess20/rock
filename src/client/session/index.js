/**
 * Conversation transport — the voice pipeline.
 *
 * A session owns the call and emits a small, transport-agnostic event
 * vocabulary. The page wires those events to the boulder once; the boulder
 * never learns what a WebSocket is.
 *
 *   'state'        'listening' | 'thinking' | 'speaking' | 'idle'
 *   'caption'      the assistant transcript for this turn, in full
 *   'user'         what the person said, in full
 *   'level'        0..1 sustained amplitude — mic while listening, Rock while speaking
 *   'pulse'        0..1 transient — a discrete event worth a jolt
 *   'interrupted'  the person talked over Rock
 *   'tool'         a label while a server-side tool works, or null
 *   'busy'         whether a response is in flight
 *   'ready'        { model, voice } the proxy actually used
 *   'done'         { usage }
 *   'error'        { message }
 *
 * Swapping providers means writing a different module with this surface. The
 * page's wiring block and the boulder do not change.
 */

import { createAudio, createCapture, createPlayer, encodePCM } from './audio.js';
import { createEmitter } from './emitter.js';
import { createEventHandler } from './events.js';
import { amplitude, createAnalyser, follow } from './metering.js';
import { connect } from './socket.js';

const MIC_CONSTRAINTS = {
  audio: {
    // Rock's voice comes out of the speakers and straight back into the mic.
    // Cancellation runs against the render stream, which includes anything Web
    // Audio sends to `destination` — so this covers our own playback.
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
};

export function createVoiceSession({ model, voice } = {}) {
  const { on, emit } = createEmitter();
  const messages = [];

  let currentModel = model;
  let currentVoice = voice;

  let call = null;
  let audio = null; // { ctx, output, outAnalyser }
  let capture = null;
  let player = null;
  let micStream = null;
  let micAnalyser = null;

  let state = 'idle';
  let connecting = false;
  // stop() can land mid-dial. Bumping this retires the dial in flight.
  let generation = 0;
  // Bumped by the setters, snapshotted at connect: unequal means a picker moved
  // after the socket opened, and the live call is on settings nobody asked for.
  let picked = 0;
  let dialledPick = 0;

  let frame = 0;
  let level = 0;

  function setState(next) {
    if (state === next) return;
    state = next;
    emit('state', next);
  }

  function fail(message) {
    emit('error', { message });
  }

  const events = createEventHandler({
    setState,
    emit,
    fail,
    messages,
    play: (samples) => player?.enqueue(samples),
    flushAudio: () => player?.flush(),
    playing: () => player?.playing ?? false,
  });

  /* One loop for both jobs that have to happen every frame: metering, and
     noticing that the playback queue has run dry. The queue is the only thing
     that knows when Rock has actually stopped talking — `response.done` fires
     while seconds of audio are still booked. */
  function tick() {
    frame = requestAnimationFrame(tick);

    if (state === 'speaking' && !player.playing) setState('listening');

    const analyser = state === 'speaking' ? audio.outAnalyser : state === 'listening' ? micAnalyser : null;
    level = follow(level, analyser ? amplitude(analyser) : 0);
    emit('level', level);
  }

  /* --- lifecycle ----------------------------------------------------------- */

  async function start() {
    if (call || connecting) return;
    connecting = true;
    const mine = ++generation;
    const abandoned = () => mine !== generation;

    try {
      // Prompted first, so a denied mic costs nothing else.
      micStream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      if (abandoned()) return stop();

      audio = await createAudio();
      if (abandoned()) return stop();

      micAnalyser = createAnalyser(audio.ctx, audio.ctx.createMediaStreamSource(micStream));
      player = createPlayer(audio.ctx, audio.output);

      dialledPick = picked;
      call = await connect({
        voice: currentVoice,
        model: currentModel,
        onEvent: events.handle,
        onClose: (reason) => {
          if (!call) return; // our own stop() closing the socket
          if (reason) fail(reason);
          stop();
        },
      });
      if (abandoned()) return stop();

      // Last, so no frame is captured before there is a socket to put it on.
      capture = await createCapture(audio.ctx, micStream, (samples) => {
        call?.send({ type: 'input_audio_buffer.append', audio: encodePCM(samples) });
      });
      if (abandoned()) return stop();

      frame = requestAnimationFrame(tick);
      setState('listening');
    } catch (err) {
      fail(err?.message ?? String(err));
      stop();
    } finally {
      connecting = false;
    }
  }

  function stop() {
    generation++; // retires any dial still in flight
    const closing = call;
    call = null; // before close(), so onClose knows this teardown is ours

    cancelAnimationFrame(frame);
    frame = 0;
    level = 0;
    emit('level', 0);

    player?.flush();
    capture?.close();
    closing?.close();
    micStream?.getTracks().forEach((track) => track.stop());
    audio?.ctx.close();

    call = capture = player = micStream = audio = micAnalyser = null;
    events.reset();
    setState('idle');
  }

  /** Typed input, for when speaking out loud isn't an option. Same conversation,
   *  same voice coming back. */
  function send(text) {
    const content = text.trim();
    if (!content || !call?.open) return;
    messages.push({ role: 'user', content });
    call.send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: content }] },
    });
    call.send({ type: 'response.create' });
    setState('thinking');
  }

  return {
    on,
    start,
    stop,
    send,
    get messages() {
      return messages;
    },
    get connected() {
      return call?.open ?? false;
    },
    get busy() {
      return events.responding;
    },
    get state() {
      return state;
    },
    /** Both are pinned when the proxy opens its socket, so changing either only
     *  takes effect on the next call — the page redials. */
    get model() {
      return currentModel;
    },
    set model(next) {
      currentModel = next;
      picked++;
    },
    get voice() {
      return currentVoice;
    },
    set voice(next) {
      currentVoice = next;
      picked++;
    },
    /** The live call was dialled before the current pick — it is on the wrong
     *  model or voice, and only another dial can fix that. */
    get stale() {
      return !!call && picked !== dialledPick;
    },
    /** Manual barge-in, for the typed path — the server's VAD covers the spoken
     *  case on its own. Both the upstream generation and the local queue have to
     *  stop; cancelling one without the other leaves Rock talking into a turn
     *  that has already ended. */
    cancel() {
      if (!call?.open) return;
      if (events.responding) call.send({ type: 'response.cancel' });
      events.interrupt();
    },
  };
}
