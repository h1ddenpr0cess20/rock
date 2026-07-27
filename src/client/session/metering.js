/**
 * Turning a live audio node into one 0..1 number per frame.
 *
 * The session reads whichever side of the call is making sound and hands the
 * result to the boulder. Attack is faster than release, which is what makes the
 * rock feel like it's tracking a voice rather than chasing it.
 */

/** RMS of one analyser frame, mapped to the avatar's 0..1 energy. Speech sits
 *  around 0.05–0.2 RMS, so the gain lifts a normal speaking voice to most of
 *  the range without pinning it. */
export function amplitude(analyser) {
  analyser.getFloatTimeDomainData(analyser.buffer);
  let sum = 0;
  for (const v of analyser.buffer) sum += v * v;
  return Math.min(1, Math.sqrt(sum / analyser.buffer.length) * 7);
}

export function createAnalyser(ctx, source) {
  const node = ctx.createAnalyser();
  node.fftSize = 1024;
  node.smoothingTimeConstant = 0.4;
  // Parked on the node so the meter loop doesn't reallocate 60 times a second.
  node.buffer = new Float32Array(node.fftSize);
  source.connect(node);
  return node;
}

export const ATTACK = 0.45;
export const RELEASE = 0.12;

/** One step of the envelope follower. */
export function follow(level, target) {
  return level + (target - level) * (target > level ? ATTACK : RELEASE);
}
