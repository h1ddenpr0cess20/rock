import { decodePCM } from './codec.js';

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
  let current = null;

  function flush() {
    if (transcript.trim()) record({ role: 'assistant', content: transcript.trim() });
    transcript = '';
  }

  function record(message) {
    messages.push(message);
    emit('message', message);
  }

  function setResponding(next) {
    if (responding === next) return;
    responding = next;
    emit('busy', next);
  }

  function interrupt() {
    flushAudio();
    current = null;
    flush();
    setState('listening');
  }

  function handle(event) {
    const { type } = event;

    switch (type) {
      case 'proxy.ready':
        emit('ready', { model: event.model, voice: event.voice });
        return;

      case 'input_audio_buffer.speech_started':
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
        if (playing()) flushAudio();
        emit('pulse', 0.32);
        setState('thinking');
        return;

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

      case 'response.output_audio_transcript.updated':
      case 'response.output_text.updated':
        transcript = event.transcript ?? event.text ?? transcript;
        emit('caption', transcript);
        return;

      case 'conversation.item.input_audio_transcription.updated':
      case 'input_audio_transcription.updated':
        if (event.transcript) emit('user', event.transcript);
        return;

      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript?.trim()) {
          record({ role: 'user', content: event.transcript.trim() });
          emit('user', event.transcript.trim());
          emit('pulse', 0.22);
        }
        return;

      case 'response.done': {
        setResponding(false);
        const response = event.response ?? {};
        flush();
        if (response.status === 'failed') {
          fail(response.status_details?.error?.message ?? 'the response failed');
        }
        emit('done', { usage: response.usage });
        if (!playing()) setState('listening');
        return;
      }

      case 'error':
        fail(event.error?.message ?? 'realtime error');
        return;
    }

    const label = toolLabel(type);
    if (label) {
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
