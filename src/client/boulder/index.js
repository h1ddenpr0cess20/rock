/**
 * The boulder, as a controller.
 *
 * Everything visual lives under this directory; nothing in it knows where its
 * input comes from. The controller surface is deliberately audio-shaped so a
 * voice pipeline drops in without touching the geometry:
 *
 *   boulder.setState('speaking')  idle | listening | thinking | speaking
 *   boulder.setLevel(0.62)        sustained amplitude 0..1, sampled per frame
 *   boulder.pulse(0.4)            transient impulse 0..1, one per discrete event
 *   boulder.anger(0.8)            it has been interrupted and it is not pleased
 *
 * Nothing here is a sine wave dressed up as motion. Every visible movement is a
 * spring reacting to an impulse: the rock lands, and the landing shoves it. That
 * is why it reads as several tons rather than a bouncing ball — the springs are
 * stiff and heavily damped, so it recovers in one abrupt move instead of
 * oscillating.
 */

import { buildEnvironment } from './environment.js';
import { createRock } from './geometry.js';
import { ENERGY_GAIN, MOODS } from './moods.js';

/** One step of a damped spring toward `to`. */
function spring(s, k, c, dt, to = 0) {
  s.v += (to - s.p) * k * dt - s.v * c * dt;
  s.p += s.v * dt;
}

const STEP = Math.PI / 3; // it clunks facet to facet, not smoothly
const RADIUS = 0.95;

export function createBoulder({ stage, THREE }) {
  buildEnvironment({ stage, THREE });

  const boulder = new THREE.Group();
  boulder.name = 'boulder_character';

  /* Two nested groups: the body carries the rolling rotation, the outer group
     carries tilt and position. Keeping them apart means a tilt doesn't get
     wound into whatever facet it happens to be standing on. */
  const body = new THREE.Group();
  body.name = 'body';
  boulder.add(body);

  const rock = createRock(THREE);
  body.add(rock.mesh);

  let state = 'idle';
  let target = { ...MOODS.idle };
  const m = { ...MOODS.idle };

  /* `energy` is what the surface reads. `sustain` is where it settles (the live
     audio level); `impulse` decays on top of it (discrete events). */
  let sustain = 0;
  let impulse = 0;
  let energy = 0;
  let lastEnergy = 0;

  /* 0..1, decaying. Blends the whole mood toward `angry` and starts the
     stomping, so being cut off is a state the boulder comes down from rather
     than a mode it is switched into. */
  let rage = 0;

  const clock = new THREE.Clock();
  let t = 0;

  /* Springs: squash/stretch, side tilt, fore/aft tilt, grinding twist. */
  const sq = { p: 0, v: 0 };
  const tz = { p: 0, v: 0 };
  const tx = { p: 0, v: 0 };
  const ty = { p: 0, v: 0 };

  let y = 0, yV = 0, airborne = false;
  let ang = 0, x = 0, dir = 1, stepT = -1, angFrom = 0, xFrom = 0, steps = 0, rest = 0, wind = 0;
  let evtT = 2.2, stompT = 0.2;

  /* Per-step, rerolled every time it tips: how far over it goes, how long that
     takes, and how it gets there. Rolling used to be one fixed 60° tip on a
     fixed 0.3s curve, which reads as a metronome — the shape of the step is
     what makes it look like a decision rather than a mechanism. */
  let stepAng = STEP, stepDur = 0.3, stepEase = 2.1, stepLift = 0.075, run = 2;

  const beginStep = () => {
    // Facets aren't all the same width, so neither are the tips over them.
    const wide = 0.72 + Math.random() * 0.62;
    stepAng = STEP * wide;
    // A wider tip is a longer fall; the curve it falls on varies too, so some
    // steps hang on the edge and others go straight over.
    stepDur = (0.2 + Math.random() * 0.1) * (0.65 + wide * 0.5);
    stepEase = 1.7 + Math.random() * 0.9;
    stepLift = 0.05 * wide + Math.random() * 0.035;
    angFrom = ang; xFrom = x; stepT = 0; wind = 0;
  };

  /** A landing shoves the whole thing: squash down, and skew a little at random
   *  so no two landings look alike. */
  const land = (force) => {
    sq.v += force;
    tz.v += (Math.random() - 0.5) * force * 0.8;
    tx.v += (Math.random() - 0.5) * force * 0.5;
  };

  rock.mesh.onBeforeRender = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    t += dt;

    /* --- energy ----------------------------------------------------------- */
    impulse = Math.max(0, impulse - impulse * Math.min(1, dt * 3.4) - dt * 0.05);
    lastEnergy = energy;
    energy += (Math.min(1, sustain + impulse) - energy) * Math.min(1, dt * 6);
    rage = Math.max(0, rage - dt * 0.55);

    /* --- mood ------------------------------------------------------------- */
    const mood = MOODS[state] ?? MOODS.idle;
    for (const k in target) {
      // Blended toward angry by however much rage is left, then eased into —
      // two lags, so nothing ever snaps between moods.
      const to = mood[k] + (MOODS.angry[k] - mood[k]) * rage;
      target[k] = to;
      m[k] += (to - m[k]) * Math.min(1, dt * 3.4);
    }

    const loud = ENERGY_GAIN;
    const jitter = m.jitter + energy * loud.jitter;
    const rockAmt = Math.sin(t * (m.rockSpeed + energy * loud.rockSpeed) * 2.0) * (m.rock + energy * loud.rock);
    const rolling = m.roll > 0.05;
    const raging = rage > 0.35;

    /* --- rolling: tip over a corner, fall onto the next facet, repeat ------ */
    let lift = 0;
    if (rolling) {
      if (stepT < 0) {
        if (rest > 0) { rest -= dt; wind = Math.min(1, wind + dt * 4); }
        else beginStep();
      }
      if (stepT >= 0) {
        stepT += dt;
        const u = Math.min(1, stepT / stepDur);
        const e = Math.pow(u, stepEase); // slow to tip, quick to drop
        ang = angFrom + dir * stepAng * e;
        x = xFrom + dir * stepAng * RADIUS * e;
        lift = Math.sin(Math.PI * u) * stepLift; // rides up over the edge
        if (u >= 1) {
          stepT = -1;
          // Landing force follows the drop: a wide tip hits harder.
          land(3.2 + (stepAng / STEP) * 1.5 + Math.random() * 0.8);
          const paced = m.roll >= 1;
          const wall = Math.abs(x) > 1.45;
          if (++steps >= run || wall) {
            steps = 0;
            run = 1 + Math.floor(Math.random() * (paced ? 5 : 3));
            rest = (paced ? 0.3 : 1.1) + Math.random() * (paced ? 0.75 : 1.4);
            // Turning around is the usual thing to do after a run, but not the
            // only one — out in the middle it sometimes just carries on.
            if (wall || Math.random() < 0.72) dir *= -1;
          }
        }
      }
    } else {
      // Settle back to centre, still turned to whatever facet it stopped on.
      x += (0 - x) * Math.min(1, dt * 1.6);
      stepT = -1; steps = 0; rest = 0; wind = 0;
    }

    /* --- rage: stomping, with real gravity and hard landings --------------- */
    if (raging) {
      stompT -= dt;
      if (stompT <= 0 && !airborne) {
        yV = 2.1 + Math.random() * 0.7;
        airborne = true;
        sq.v -= 3.0; // stretches on the way up
        stompT = 0.5 + Math.random() * 0.25;
      }
    }
    if (airborne) {
      yV -= 13 * dt;
      y += yV * dt;
      if (y <= 0) {
        y = 0;
        airborne = false;
        land(7.5 + Math.abs(yV));
        ty.v += (Math.random() - 0.5) * 5;
      }
    } else {
      y += (0 - y) * Math.min(1, dt * 8);
    }

    /* --- idle: a bored rock shifts its weight and huffs -------------------- */
    if (!rolling && !raging) {
      evtT -= dt;
      if (evtT <= 0) {
        const r = Math.random();
        if (r < 0.4) sq.v += 2.4;                                          // huff
        else if (r < 0.72) ty.v += (Math.random() < 0.5 ? -1 : 1) * 2.6;   // grinds round
        else { tz.v += (Math.random() - 0.5) * 5; tx.v += 1.6; }           // irritable shudder
        evtT = 2.4 + Math.random() * 4;
      }
    }

    /* --- speaking: one shove per syllable, taken from the audio ------------
       The original guessed at syllables on a timer. This reads them off the
       waveform instead: a rising edge in the envelope is an onset, and its
       steepness is how hard the rock gets shoved. Consonants land harder than
       vowels, which is what makes it look like it is forming words. */
    if (state === 'speaking') {
      const onset = Math.max(0, energy - lastEnergy);
      if (onset > 0.008) {
        sq.v += onset * 26;
        tz.v += (Math.random() - 0.5) * onset * 20;
      }
    }

    /* --- integrate --------------------------------------------------------- */
    spring(sq, 190, 11, dt);
    spring(tz, 70, 6.5, dt, rolling && stepT >= 0 ? dir * 0.07 - wind * dir * 0.16 : rockAmt);
    spring(tx, 70, 6.5, dt, m.lean * 0.22);
    spring(ty, 40, 5, dt, 0);

    const tremor = jitter * 0.016;
    const breathe = Math.sin(t * 1.25) * 0.008;

    boulder.position.set(
      x + (Math.random() - 0.5) * tremor,
      y + lift + breathe * 0.6 + Math.abs(rockAmt) * 0.42,
      (Math.random() - 0.5) * tremor,
    );
    boulder.rotation.set(
      tx.p + (Math.random() - 0.5) * tremor,
      ty.p,
      tz.p + (Math.random() - 0.5) * tremor * 1.4,
    );

    // Facet rotation lives on the body so the tilts stay independent of it.
    body.rotation.z = -ang;
    body.rotation.x = Math.sin(ang * 0.5) * 0.06;

    const s = sq.p * 0.09 + breathe;
    body.scale.set(1 + s * 0.55, 1 - s, 1 + s * 0.55);
  };

  stage.setObject(boulder);

  // setObject() turns shadows on for everything it traverses. There is no
  // ground here — the boulder hangs in the void — so nothing has anything to
  // cast onto, and the shadow pass is wasted work.
  stage._ground.visible = false;
  stage._key.castShadow = false;
  boulder.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = false;
  });

  return {
    get state() {
      return state;
    },

    /** idle | listening | thinking | speaking. Unknown names are ignored —
     *  hasOwn, not a truth test: `MOODS.constructor` is truthy and NaNs every
     *  channel it touches. */
    setState(next) {
      if (!Object.hasOwn(MOODS, next) || next === state) return;
      state = next;
      if (next === 'idle' || next === 'thinking') sustain = 0;
    },

    /** Sustained amplitude, 0..1. Call per frame. */
    setLevel(level) {
      sustain = Math.min(1, Math.max(0, level));
    },

    /** Transient impulse, 0..1. Call once per discrete event. */
    pulse(weight = 0.3) {
      impulse = Math.min(1, impulse + Math.min(1, Math.max(0, weight)));
    },

    /** Cut it off mid-sentence and it stomps. Decays back on its own. */
    anger(weight = 1) {
      rage = Math.min(1, rage + weight);
      sq.v += 3.5; // it reacts on the frame you interrupt, not a beat later
    },
  };
}
