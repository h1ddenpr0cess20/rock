import './styles.css';
import './vendor/three-d-stage.js';

import { fetchConfig } from './api.js';
import { createBoulder } from './boulder/index.js';
import { createHistory } from './history.js';
import { createMemory } from './memory.js';
import { createVoiceSession } from './session/index.js';
import { createControls } from './ui/controls.js';
import { createHistoryPanel } from './ui/history.js';
import { createMemoryPanel } from './ui/memory.js';
import { createHud } from './ui/hud.js';
import { stripStageChrome } from './ui/stage.js';
import { trackKeyboardInset } from './ui/viewport.js';

const stage = stripStageChrome(document.querySelector('three-d-stage'));

const { THREE } = await stage.ready;

const boulder = createBoulder({ stage, THREE });
const memory = createMemory();
const session = createVoiceSession({ memory });
const hud = createHud();
const history = createHistory();
const historyPanel = createHistoryPanel({ history, onNew: startFresh, onResume: pickUp });
const memoryPanel = createMemoryPanel({ memory, onChange: () => session.syncMemory() });

trackKeyboardInset();

const controls = createControls({
  getStatus: () => ({ connected: session.connected, busy: session.busy, muted: session.muted }),

  async onMicToggle() {
    if (session.connected) {
      session.muted = !session.muted;
      hud.setState(chipState());
      armIdleMute();
      return;
    }
    hud.setState('connecting');
    hud.clearCaption();
    /** A conversation picked up in the log is already open: this joins it. */
    if (!history.live) history.begin({ model: session.model, voice: session.voice });
    await session.start();
    if (session.stale) setTimeout(redial, 0);
  },

  /** Held down rather than tapped: end the call instead of muting it. */
  onHangUp() {
    session.stop();
  },

  onSubmit(text) {
    if (!session.connected) return;
    hud.showUser(text);
    hud.clearCaption();
    session.send(text);
  },

  onModelChange(model) {
    session.model = model;
    redial();
  },

  onVoiceChange(voice) {
    session.voice = voice;
    redial();
  },

  onCancel() {
    if (memoryPanel.isOpen) return memoryPanel.close();
    if (historyPanel.isOpen) return historyPanel.close();
    session.cancel();
  },
});

const IDLE_MUTE_MS = 60_000;
let idle = 0;

function armIdleMute() {
  clearTimeout(idle);
  idle = 0;
  if (!session.connected || session.muted) return;
  if (session.busy || session.state === 'thinking' || session.state === 'speaking') return;
  idle = setTimeout(() => {
    if (!session.connected || session.muted) return;
    session.muted = true;
    hud.setState(chipState());
    controls.sync();
  }, IDLE_MUTE_MS);
}

function startFresh() {
  history.end();
  session.context = [];
  if (session.connected) redial();
}

/**
 * Carries on an old conversation. Whatever call is up ends first — this is a
 * different conversation, and the model is handed the stored turns as it dials
 * — and from here what is said lands back in that same entry in the log.
 */
async function pickUp(id) {
  if (session.connected) session.stop();
  const earlier = history.resume(id);
  if (!earlier) return;
  session.context = earlier.messages;
  await controls.toggleMic();
}

function chipState() {
  if (!session.connected || !session.muted) return boulder.state;
  return boulder.state === 'listening' || boulder.state === 'idle' ? 'muted' : boulder.state;
}

/**
 * A new call for the same conversation, after a pick or a stale one. Where the
 * conversation was picked up out of the log it stays picked up, turns and all,
 * including the ones from the call being replaced — a voice is worth changing
 * mid-sentence, and losing the thread over it is not.
 */
function redial() {
  if (!session.connected) return;
  const thread = session.context.length ? history.live : null;
  session.stop();
  if (thread) session.context = history.resume(thread)?.messages ?? [];
  controls.toggleMic();
}

session.on('state', (state) => {
  if (state === 'thinking') hud.clearCaption();
  if (state === 'idle') {
    history.end();
    hud.hideUser();
  }
  if (state === 'listening' || state === 'idle') hud.setTool(null);
  boulder.setState(state);
  hud.setState(chipState());
  armIdleMute();
  controls.sync();
});

session.on('busy', () => {
  armIdleMute();
  controls.sync();
});

session.on('level', (level) => boulder.setLevel(level));
session.on('pulse', (weight) => boulder.pulse(weight));
session.on('caption', (text) => {
  hud.setCaption(text);
  armIdleMute();
});
session.on('user', (text) => {
  hud.showUser(text);
  armIdleMute();
});
session.on('tool', (label) => hud.setTool(label));

session.on('message', (message) => history.append(message));

session.on('interrupted', () => boulder.anger(0.9));

session.on('error', ({ message }) => {
  hud.showError(message);
  hud.setState(chipState());
  controls.sync();
});

try {
  const config = await fetchConfig();
  const chosen = controls.setCatalog(config);
  session.model = chosen.model;
  session.voice = chosen.voice;
  hud.showTools(config.tools);
  if (!config.ready) throw new Error('XAI_API_KEY is not set — nothing to dial with.');
} catch (err) {
  controls.unavailable();
  hud.showError(`${err.message} — is the proxy running? (npm run dev)`);
}

window.addEventListener('pagehide', () => session.stop());

controls.sync();

if (window.matchMedia('(pointer: fine)').matches) controls.focus();
