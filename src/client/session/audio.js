/**
 * The audio pipeline, which WebRTC would have done for us.
 *
 * xAI's realtime API is a WebSocket carrying base64 PCM, so both ends of the
 * conversation are this file's problem: the mic has to become 24 kHz PCM16
 * frames going up, and the chunks coming down have to be stitched back into a
 * gapless stream going out the speakers.
 *
 * One AudioContext for both directions, so the capture clock and the playback
 * clock are the same clock and the two can't drift apart over a long call.
 */

import { AUDIO_RATE } from './constants.js';

/* The worklet lives in public/ and is referenced by path rather than imported.
   Importing it with `?url` works in dev and quietly breaks in production: Vite
   inlines anything under the asset limit as a `data:text/javascript` URL, and
   `addModule()` rejects those on Safari and under any CSP that doesn't allow
   `data:`. public/ is copied verbatim, so the path is the same in both. */
const WORKLET_URL = `${import.meta.env?.BASE_URL ?? '/'}pcm-worklet.js`;

/* How far ahead of `currentTime` the first chunk of a turn is scheduled. Enough
   that a slow frame doesn't underrun into a click, small enough to stay off the
   perceptible end of a reply. Every later chunk butts against the one before,
   so this is the only latency the queue adds. */
const LEAD = 0.08;

/**
 * Rock's voice: a queue of chunks scheduled back to back on one timeline.
 *
 * Chunks arrive faster than real time — the model can produce ten seconds of
 * speech in two — so playback can't be "play each as it lands". Each is booked
 * against a cursor that runs ahead of the clock, which is also what makes
 * `flush()` possible: interrupting means dropping everything booked but not yet
 * heard, and that is most of the answer.
 */
export function createPlayer(ctx, destination) {
  let cursor = 0;
  let sources = new Set();

  return {
    enqueue(samples) {
      if (!samples?.length) return;

      const buffer = ctx.createBuffer(1, samples.length, AUDIO_RATE);
      const channel = buffer.getChannelData(0);
      // Asymmetric on purpose: int16 runs to -32768 but only +32767.
      for (let i = 0; i < samples.length; i++) {
        channel[i] = samples[i] / (samples[i] < 0 ? 32768 : 32767);
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(destination);

      // Behind the clock means the queue ran dry — restart ahead of it rather
      // than scheduling into the past, which plays instantly and overlaps.
      const at = Math.max(cursor, ctx.currentTime + LEAD);
      source.start(at);
      cursor = at + buffer.duration;

      sources.add(source);
      source.onended = () => sources.delete(source);
    },

    /** Barge-in: everything queued but unheard is dropped. */
    flush() {
      for (const source of sources) {
        source.onended = null;
        try {
          source.stop();
        } catch {
          /* already finished between the last frame and this one */
        }
      }
      sources = new Set();
      cursor = 0;
    },

    /** True while there is still audio booked ahead of the clock. */
    get playing() {
      return cursor > ctx.currentTime;
    },
  };
}

/**
 * The mic, as 20 ms PCM16 frames.
 *
 * @param {AudioContext} ctx
 * @param {MediaStream} stream
 * @param {(samples: Int16Array) => void} onFrame
 */
export async function createCapture(ctx, stream, onFrame) {
  await ctx.audioWorklet.addModule(WORKLET_URL);

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pcm-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    // The mic is mono and the API wants mono; mixing down here means a stereo
    // interface doesn't send us one channel of a two-channel room.
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  });

  node.port.onmessage = (e) => onFrame(new Int16Array(e.data));
  source.connect(node);

  return {
    node,
    close() {
      node.port.onmessage = null;
      node.port.postMessage('stop');
      source.disconnect();
      node.disconnect();
    },
  };
}

/**
 * The context both halves share, plus the output chain Rock's voice runs
 * through: gain for muting, analyser so the boulder can move to its own voice.
 */
export async function createAudio() {
  // A hint, not a guarantee — the worklet resamples whatever we actually get.
  const ctx = new AudioContext({ sampleRate: AUDIO_RATE, latencyHint: 'interactive' });
  // Autoplay policy: a context created outside a gesture starts suspended, and
  // the mic click is the gesture, so this is the one place it can be resumed.
  if (ctx.state === 'suspended') await ctx.resume();

  const gain = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.4;
  analyser.buffer = new Float32Array(analyser.fftSize);

  gain.connect(analyser);
  analyser.connect(ctx.destination);

  return { ctx, output: gain, outAnalyser: analyser };
}
