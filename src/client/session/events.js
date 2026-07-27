/**
 * xAI realtime server events → the session's own vocabulary.
 *
 * Only the handful that change what the boulder is doing. xAI's event stream is
 * OpenAI-compatible with documented divergences, and the ones that matter here
 * are the transcription events: xAI sends `.updated` carrying the *cumulative*
 * text where OpenAI sends `.delta` carrying an increment. Appending a
 * cumulative event gives you "hello hello there hello there rock", so the two
 * shapes are handled apart — `.delta` appends, `.updated` replaces.
 *
 * This module owns the two pieces of state only the event stream can advance:
 * whether a response is in flight, and the transcript accumulating for the turn.
 */

import { decodePCM } from './codec.js';

/* Server-side tools (web_search, x_search, mcp) run inside xAI, and their
   event names aren't in the docs. Rather than guess at exact strings, anything
   carrying a tool's name is read as "that tool is working" — a label for the
   HUD. Wrong guesses cost nothing; the tool still ran. */
const TOOL_HINTS = [
  [/web_search/, 'searching the web'],
  [/x_search/, 'reading X'],
  [/file_search/, 'searching files'],
  [/\bmcp\b/, 'using a tool'],
];

function toolLabel(type) {
  for (const [re, label] of TOOL_HINTS) if (re.test(type)) return label;
  return null;
}

export function createEventHandler({ setState, emit, fail, play, flushAudio, playing, messages }) {
  let responding = false;
  let transcript = '';
  /* The id of the response whose audio we are willing to play. Anything from an
     earlier one is a chunk that was already in flight when the turn was cut
     short, and playing it would put half a sentence after the interruption. */
  let current = null;

  function flush() {
    if (transcript.trim()) messages.push({ role: 'assistant', content: transcript.trim() });
    transcript = '';
  }

  // A response can begin and end inside one 'thinking', so 'state' won't carry this.
  function setResponding(next) {
    if (responding === next) return;
    responding = next;
    emit('busy', next);
  }

  /** Stop talking, drop what's queued, and start listening. */
  function interrupt() {
    flushAudio();
    current = null;
    flush();
    setState('listening');
  }

  function handle(event) {
    const { type } = event;

    switch (type) {
      /* --- our own proxy ---------------------------------------------------- */
      case 'proxy.ready':
        emit('ready', { model: event.model, voice: event.voice });
        return;

      /* --- turn taking ------------------------------------------------------ */
      case 'input_audio_buffer.speech_started':
        // Barge-in. The server stops generating; we stop playing what it
        // already sent. Rock does not enjoy being cut off — see main.js.
        if (playing()) emit('interrupted');
        interrupt();
        return;

      case 'input_audio_buffer.speech_stopped':
      case 'input_audio_buffer.committed':
        setState('thinking');
        return;

      case 'response.created':
        setResponding(true);
        current = event.response?.id ?? null;
        // A response starting while audio is still queued means the last turn
        // was cut off without us being told. Drop the remainder.
        if (playing()) flushAudio();
        emit('pulse', 0.32);
        setState('thinking');
        return;

      /* --- Rock talking ----------------------------------------------------- */
      case 'response.output_audio.delta':
      case 'response.audio.delta': {
        if (current && event.response_id && event.response_id !== current) return;
        const samples = decodePCM(event.delta);
        if (!samples) return;
        play(samples);
        setState('speaking');
        return;
      }

      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
      case 'response.output_text.delta':
      case 'response.text.delta':
        transcript += event.delta ?? '';
        emit('caption', transcript);
        return;

      // The cumulative shape of the same thing.
      case 'response.output_audio_transcript.updated':
      case 'response.output_text.updated':
        transcript = event.transcript ?? event.text ?? transcript;
        emit('caption', transcript);
        return;

      /* --- what the person said --------------------------------------------- */
      case 'conversation.item.input_audio_transcription.updated':
      case 'input_audio_transcription.updated':
        // Cumulative: the whole turn so far, every time.
        if (event.transcript) emit('user', event.transcript);
        return;

      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript?.trim()) {
          messages.push({ role: 'user', content: event.transcript.trim() });
          emit('user', event.transcript.trim());
          emit('pulse', 0.22);
        }
        return;

      /* --- end of turn ------------------------------------------------------- */
      case 'response.done': {
        setResponding(false);
        const response = event.response ?? {};
        flush();
        if (response.status === 'failed') {
          fail(response.status_details?.error?.message ?? 'the response failed');
        }
        emit('done', { usage: response.usage });
        // If Rock said nothing there is no audio to wait on, so the turn ends
        // here. Otherwise the session ends it when the queue drains.
        if (!playing()) setState('listening');
        return;
      }

      case 'error':
        fail(event.error?.message ?? 'realtime error');
        return;
    }

    /* --- tools, best-effort ------------------------------------------------- */
    const label = toolLabel(type);
    if (label) {
      // Only the start of a tool's work is worth showing; its `.done` would
      // clear the label a frame before the answer arrives anyway.
      if (!/\.(done|completed|failed)$/.test(type)) emit('tool', label);
      else emit('tool', null);
    }
  }

  return {
    handle,
    interrupt,
    get responding() {
      return responding;
    },
    reset() {
      setResponding(false);
      transcript = '';
      current = null;
    },
  };
}
