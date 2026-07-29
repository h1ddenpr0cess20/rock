import { buildEnvironment } from './environment.js';
import { createRock } from './geometry.js';
import { ENERGY_GAIN, MOODS } from './moods.js';

function spring(s, k, c, dt, to = 0) {
  s.v += (to - s.p) * k * dt - s.v * c * dt;
  s.p += s.v * dt;
}

const STEP = Math.PI / 3;
const RADIUS = 0.95;
const HALF = 1.1;

const TRAVEL_MIN = 0.85;
const TRAVEL_MAX = 1.45;

export function createBoulder({ stage, THREE }) {
  buildEnvironment({ stage, THREE });

  const boulder = new THREE.Group();
  boulder.name = 'boulder_character';

  const body = new THREE.Group();
  body.name = 'body';
  boulder.add(body);

  const rock = createRock(THREE);
  body.add(rock.mesh);

  let state = 'idle';
  let target = { ...MOODS.idle };
  const m = { ...MOODS.idle };

  let sustain = 0;
  let impulse = 0;
  let energy = 0;
  let lastEnergy = 0;

  let rage = 0;

  const clock = new THREE.Clock();
  let t = 0;

  const sq = { p: 0, v: 0 };
  const tz = { p: 0, v: 0 };
  const tx = { p: 0, v: 0 };
  const ty = { p: 0, v: 0 };

  let y = 0, yV = 0, airborne = false;
  let ang = 0, x = 0, dir = 1, stepT = -1, angFrom = 0, xFrom = 0, steps = 0, rest = 0, wind = 0;
  let evtT = 2.2, stompT = 0.2;

  let stepAng = STEP, stepDur = 0.3, stepEase = 2.1, stepLift = 0.075, run = 2;
  let travel = TRAVEL_MAX;

  const beginStep = () => {
    const wide = 0.72 + Math.random() * 0.62;
    let reach = STEP * wide * RADIUS;

    let room = travel - dir * x;
    if (reach > room) { dir = -dir; room = travel - dir * x; }
    if (reach > room) reach = room;
    stepAng = reach / RADIUS;

    stepDur = (0.2 + Math.random() * 0.1) * (0.65 + wide * 0.5);
    stepEase = 1.7 + Math.random() * 0.9;
    stepLift = 0.05 * wide + Math.random() * 0.035;
    angFrom = ang; xFrom = x; stepT = 0; wind = 0;
  };

  const land = (force) => {
    sq.v += force;
    tz.v += (Math.random() - 0.5) * force * 0.8;
    tx.v += (Math.random() - 0.5) * force * 0.5;
  };

  rock.mesh.onBeforeRender = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    t += dt;

    impulse = Math.max(0, impulse - impulse * Math.min(1, dt * 3.4) - dt * 0.05);
    lastEnergy = energy;
    energy += (Math.min(1, sustain + impulse) - energy) * Math.min(1, dt * 6);
    rage = Math.max(0, rage - dt * 0.55);

    const mood = MOODS[state] ?? MOODS.idle;
    for (const k in target) {
      const to = mood[k] + (MOODS.angry[k] - mood[k]) * rage;
      target[k] = to;
      m[k] += (to - m[k]) * Math.min(1, dt * 3.4);
    }

    const loud = ENERGY_GAIN;
    const jitter = m.jitter + energy * loud.jitter;
    const rockAmt = Math.sin(t * (m.rockSpeed + energy * loud.rockSpeed) * 2.0) * (m.rock + energy * loud.rock);
    const rolling = m.roll > 0.05;
    const raging = rage > 0.35;

    let lift = 0;
    if (rolling) {
      if (stepT < 0) {
        if (rest > 0) { rest -= dt; wind = Math.min(1, wind + dt * 4); }
        else beginStep();
      }
      if (stepT >= 0) {
        stepT += dt;
        const u = Math.min(1, stepT / stepDur);
        const e = Math.pow(u, stepEase);
        ang = angFrom + dir * stepAng * e;
        x = xFrom + dir * stepAng * RADIUS * e;
        lift = Math.sin(Math.PI * u) * stepLift;
        if (u >= 1) {
          stepT = -1;
          land(3.2 + (stepAng / STEP) * 1.5 + Math.random() * 0.8);
          const paced = m.roll >= 1;
          if (++steps >= run) {
            steps = 0;
            run = 1 + Math.floor(Math.random() * (paced ? 5 : 3));
            rest = (paced ? 0.3 : 1.1) + Math.random() * (paced ? 0.75 : 1.4);
            if (Math.random() < 0.72) dir *= -1;
          }
        }
      }
    } else {
      x += (0 - x) * Math.min(1, dt * 1.6);
      stepT = -1; steps = 0; rest = 0; wind = 0;
    }

    if (raging) {
      stompT -= dt;
      if (stompT <= 0 && !airborne) {
        yV = 2.1 + Math.random() * 0.7;
        airborne = true;
        sq.v -= 3.0;
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

    if (!rolling && !raging) {
      evtT -= dt;
      if (evtT <= 0) {
        const r = Math.random();
        if (r < 0.4) sq.v += 2.4;
        else if (r < 0.72) ty.v += (Math.random() < 0.5 ? -1 : 1) * 2.6;
        else { tz.v += (Math.random() - 0.5) * 5; tx.v += 1.6; }
        evtT = 2.4 + Math.random() * 4;
      }
    }

    if (state === 'speaking') {
      const onset = Math.max(0, energy - lastEnergy);
      if (onset > 0.008) {
        sq.v += onset * 26;
        tz.v += (Math.random() - 0.5) * onset * 20;
      }
    }

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

    body.rotation.z = -ang;
    body.rotation.x = Math.sin(ang * 0.5) * 0.06;

    const s = sq.p * 0.09 + breathe;
    body.scale.set(1 + s * 0.55, 1 - s, 1 + s * 0.55);
  };

  stage.setObject(boulder);

  const frame = () => {
    const camera = stage._camera;
    const w = stage.clientWidth || 1;
    const h = stage.clientHeight || 1;
    const aspect = w / h;

    travel = Math.min(TRAVEL_MAX, Math.max(TRAVEL_MIN, TRAVEL_MIN + (aspect - 0.5) * 1.2));

    const halfW = HALF + travel + 0.1;
    const halfH = HALF + 0.5;
    const dist = Math.max(halfH, halfW / aspect) / Math.tan((camera.fov * Math.PI) / 360);

    const target = stage._controls.target;
    const dir3 = camera.position.clone().sub(target);
    if (dir3.lengthSq() === 0) dir3.set(1, 0.55, 1.25);
    camera.position.copy(target).addScaledVector(dir3.normalize(), dist);
    camera.near = Math.max(dist / 100, 0.01);
    camera.far = dist * 100;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    stage._controls.update();
  };

  frame();
  new ResizeObserver(frame).observe(stage);

  stage._ground.visible = false;
  stage._key.castShadow = false;
  boulder.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = false;
  });

  return {
    get state() {
      return state;
    },

    setState(next) {
      if (!Object.hasOwn(MOODS, next) || next === state) return;
      state = next;
      if (next === 'idle' || next === 'thinking') sustain = 0;
    },

    setLevel(level) {
      sustain = Math.min(1, Math.max(0, level));
    },

    pulse(weight = 0.3) {
      impulse = Math.min(1, impulse + Math.min(1, Math.max(0, weight)));
    },

    anger(weight = 1) {
      rage = Math.min(1, rage + weight);
      sq.v += 3.5;
    },
  };
}
