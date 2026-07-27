/**
 * The composer: mic, text field, send, and the two pickers.
 *
 * Knows how the controls look and when they're enabled; knows nothing about
 * calls. It reports intent through the callbacks it's handed and asks
 * `getStatus()` whenever it needs to redraw — main.js owns what those mean.
 */

export function createControls({
  root = document,
  getStatus,
  onMicToggle,
  onSubmit,
  onModelChange,
  onVoiceChange,
  onCancel,
}) {
  const composerEl = root.querySelector('#composer');
  const promptEl = root.querySelector('#prompt');
  const modelEl = root.querySelector('#model');
  const voiceEl = root.querySelector('#voice');
  const sendEl = root.querySelector('#send');
  const micEl = root.querySelector('#mic');

  function sync() {
    const { connected, busy } = getStatus();
    micEl.setAttribute('aria-pressed', String(connected));
    micEl.setAttribute('aria-label', connected ? 'Stop talking' : 'Start talking');
    promptEl.disabled = !connected;
    promptEl.placeholder = connected ? 'Or type. Slower, but quieter.' : 'Tap the mic. Make it quick.';
    sendEl.disabled = !connected || busy;
  }

  /** Dialling takes a round trip and a permission prompt; the mic locks for it. */
  async function toggleMic() {
    if ('busy' in micEl.dataset) return;
    micEl.dataset.busy = '';
    try {
      await onMicToggle();
    } finally {
      delete micEl.dataset.busy;
      sync();
    }
  }

  // The click is also the gesture that lets audio play and the mic prompt fire.
  micEl.addEventListener('click', toggleMic);

  composerEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = promptEl.value;
    if (!text.trim()) return;
    promptEl.value = '';
    onSubmit(text);
  });

  modelEl.addEventListener('change', () => onModelChange(modelEl.value));
  voiceEl.addEventListener('change', () => onVoiceChange(voiceEl.value));

  // Escape is barge-in for the typed path; talking over Rock is handled by the
  // server's VAD, which stops him generating.
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') onCancel();
  });

  return {
    sync,
    toggleMic,
    focus: () => micEl.focus(),

    /** @returns {{ model: string, voice: string }} what the pickers settled on. */
    setCatalog({ models, model, voices, voice }) {
      modelEl.replaceChildren(...models.map((id) => new Option(id, id)));
      modelEl.value = models.includes(model) ? model : models[0];

      voiceEl.replaceChildren(...voices.map((v) => new Option(v, v)));
      voiceEl.value = voices.includes(voice) ? voice : voices[0];

      return { model: modelEl.value, voice: voiceEl.value };
    },

    /** `disabled`, not the dial-in-flight flag: toggleMic() clears that in its finally. */
    unavailable() {
      modelEl.replaceChildren(new Option('unavailable', ''));
      voiceEl.replaceChildren(new Option('—', ''));
      micEl.disabled = true;
    },
  };
}
