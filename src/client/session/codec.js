/**
 * PCM16 ↔ base64, which is how audio travels on this API in both directions.
 *
 * Kept apart from audio.js so it can be tested without a Web Audio
 * implementation — these are pure functions over bytes, and they are the part
 * most worth having tests for.
 */

/** PCM16 → the base64 `input_audio_buffer.append` wants. */
export function encodePCM(samples) {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  // In chunks: apply() with a few hundred thousand arguments overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** base64 → PCM16. Returns null for anything that isn't whole samples. */
export function decodePCM(base64) {
  if (typeof base64 !== 'string' || !base64) return null;

  let binary;
  try {
    binary = atob(base64);
  } catch {
    return null; // not base64, so not audio
  }
  if (binary.length % 2) return null; // not PCM16, so not ours to play

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // Copied through its own buffer: a subarray view would inherit any offset.
  return new Int16Array(bytes.buffer);
}
