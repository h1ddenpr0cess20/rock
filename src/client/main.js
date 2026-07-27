/**
 * The wiring, and only the wiring.
 *
 * Four pieces that don't know about each other: the boulder (geometry), the
 * session (transport), the HUD (what you read) and the controls (what you
 * press). This file is the one place that knows a `level` event should become a
 * wobble, and that being interrupted should make the rock angry.
 */

import './styles.css';
import './vendor/three-d-stage.js';

import { fetchConfig } from './api.js';
import { createBoulder } from './boulder/index.js';
import { createVoiceSession } from './session/index.js';
import { createControls } from './ui/controls.js';
import { createHud } from './ui/hud.js';
import { stripStageChrome } from './ui/stage.js';
import { trackKeyboardInset } from './ui/viewport.js';

// Before the await, not after — see ui/stage.js. The element is already
// upgraded by the import above, and its toolbar would otherwise be on screen
// for as long as three.js takes to load.
const stage = stripStageChrome(document.querySelector('three-d-stage'));

const { THREE } = await stage.ready;

const boulder = createBoulder({ stage, THREE });
const session = createVoiceSession();
const hud = createHud();

trackKeyboardInset();

/* --- controls → session --------------------------------------------------- */

const controls = createControls({
  getStatus: () => ({ connected: session.connected, busy: session.busy }),

  async onMicToggle() {
    if (session.connected) {
      session.stop();
      hud.hideUser();
      hud.setTool(null);
      return;
    }
    hud.setState('connecting');
    hud.clearCaption();
    await session.start();
    // A pick that landed while this was in the air found no live call to hang
    // up, so redial() dropped it. Deferred past toggleMic's own lock.
    if (session.stale) setTimeout(redial, 0);
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
    session.cancel();
  },
});

/* Model and voice are both pinned when the proxy opens its socket upstream, so
   changing either mid-call means hanging up and dialling again. The
   conversation doesn't survive that — which is the honest behaviour, since the
   new voice has no memory of what the old one said. */
function redial() {
  if (!session.connected) return;
  session.stop();
  controls.toggleMic();
}

/* --- session → boulder + HUD ----------------------------------------------
   The only wiring between transport and animation. 'pulse' arrives when a turn
   changes hands, 'level' per frame from whichever side of the call is making
   sound; the boulder folds both into the same energy. */

session.on('state', (state) => {
  // A new turn starts here: the last answer clears as the boulder thinks.
  if (state === 'thinking') hud.clearCaption();
  if (state === 'listening' || state === 'idle') hud.setTool(null);
  boulder.setState(state);
  hud.setState(boulder.state);
  controls.sync();
});

// A response can start and finish inside one 'thinking', so 'state' won't carry it.
session.on('busy', () => controls.sync());

session.on('level', (level) => boulder.setLevel(level));
session.on('pulse', (weight) => boulder.pulse(weight));
session.on('caption', (text) => hud.setCaption(text));
session.on('user', (text) => hud.showUser(text));
session.on('tool', (label) => hud.setTool(label));

// Talk over a boulder and it stomps. The persona is meant to be visible in the
// geometry too, not only in what comes out of the speakers.
session.on('interrupted', () => boulder.anger(0.9));

session.on('error', ({ message }) => {
  hud.showError(message);
  hud.setState(boulder.state); // a failed dial never leaves 'idle', so no 'state' clears the chip
  controls.sync();
});

/* --- what this build can reach, from the proxy ---------------------------- */

try {
  // The proxy names the defaults for both pickers; it owns that choice, and the
  // env vars that override it.
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

// Leaving the tab mid-call would otherwise keep the mic hot and the meter spinning.
window.addEventListener('pagehide', () => session.stop());

controls.sync();

// Focusing the mic saves a keyboard user a tab stop. On a phone it just leaves
// a focus ring on the control everyone was going to tap anyway.
if (window.matchMedia('(pointer: fine)').matches) controls.focus();
