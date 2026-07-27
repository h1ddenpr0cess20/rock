/**
 * What the boulder is doing per conversational state.
 *
 * `jitter`    tremor amplitude — how badly it is holding still
 * `lean`      fore/aft tilt; negative leans in, positive leans back
 * `rock`      how far it sways side to side
 * `rockSpeed` how fast
 * `roll`      0 stays put, >0 tips over its own facets; 1 is a full pace
 */
export const MOODS = {
  // Bored. Ten thousand years of this.
  idle: { jitter: 0.10, lean: 0.0, rock: 0.055, rockSpeed: 1.05, roll: 0 },
  // Leaning in, holding still, waiting for you to get to the point.
  listening: { jitter: 0.04, lean: -0.14, rock: 0.115, rockSpeed: 1.6, roll: 0 },
  // Pacing.
  thinking: { jitter: 0.15, lean: 0.10, rock: 0.02, rockSpeed: 1.0, roll: 1 },
  // Talking at you, rolling forward as it does.
  speaking: { jitter: 0.20, lean: 0.05, rock: 0.04, rockSpeed: 1.5, roll: 0.45 },
  // Not a conversational state — reached by being interrupted. See index.js.
  angry: { jitter: 1.00, lean: 0.20, rock: 0.05, rockSpeed: 2.6, roll: 0 },
};

/** How far a full-energy voice pushes each channel past its state baseline. */
export const ENERGY_GAIN = { jitter: 0.55, rock: 0.05, rockSpeed: 0.9 };
