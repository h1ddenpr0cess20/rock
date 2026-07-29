export const MOODS = {
  idle: { jitter: 0.10, lean: 0.0, rock: 0.055, rockSpeed: 1.05, roll: 0 },
  listening: { jitter: 0.04, lean: -0.14, rock: 0.115, rockSpeed: 1.6, roll: 0 },
  thinking: { jitter: 0.15, lean: 0.10, rock: 0.02, rockSpeed: 1.0, roll: 1 },
  speaking: { jitter: 0.20, lean: 0.05, rock: 0.04, rockSpeed: 1.5, roll: 0.45 },
  angry: { jitter: 1.00, lean: 0.20, rock: 0.05, rockSpeed: 2.6, roll: 0 },
};

export const ENERGY_GAIN = { jitter: 0.55, rock: 0.05, rockSpeed: 0.9 };
