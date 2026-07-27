/**
 * Mic → 24 kHz mono PCM16, on the audio thread.
 *
 * Loaded by URL, not imported: this runs inside an AudioWorkletGlobalScope,
 * where `sampleRate` and `AudioWorkletProcessor` are ambient and nothing from
 * the page is in scope. It lives in public/ so the bundler copies it verbatim
 * instead of inlining it as a data: URL — see the note in audio.js.
 *
 * TARGET_RATE is the wire format, and it is duplicated rather than imported for
 * the same reason: nothing can be imported in here. It must match AUDIO_RATE in
 * src/client/session/constants.js and src/server/persona.js.
 *
 * Why resample here rather than ask for a 24 kHz AudioContext and be done: the
 * `sampleRate` option is a hint. Most browsers honour it, some quietly hand
 * back the device rate, and a session that declares 24 kHz while sending 48
 * sounds like a chipmunk that has been drinking. Doing the conversion means the
 * wire format is 24 kHz whatever the hardware felt like.
 */

const TARGET_RATE = 24000;

/* 20 ms per message. Small enough that a barge-in doesn't wait on a buffer,
   large enough that we aren't posting 375 messages a second at 128 frames. */
const FRAME = TARGET_RATE / 50;

class PCMCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    /* Input samples carried over from the last block. Resampling needs the
       sample *after* the one it lands on, so the tail of every block — the part
       whose right-hand neighbour hasn't arrived yet — waits here. */
    this.carry = new Float32Array(0);
    this.pos = 0; // fractional read cursor into carry+input, in input samples
    this.out = new Int16Array(FRAME);
    this.n = 0;
    this.running = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this.running = false;
    };
  }

  process(inputs) {
    if (!this.running) return false;

    const input = inputs[0]?.[0];
    // A disconnected or still-warming source: keep the node alive, send nothing.
    if (!input || !input.length) return true;

    let buf = input;
    if (this.carry.length) {
      buf = new Float32Array(this.carry.length + input.length);
      buf.set(this.carry, 0);
      buf.set(input, this.carry.length);
    }

    // Linear interpolation. `pos + 1 < buf.length` guarantees both taps exist,
    // so the seam between blocks interpolates as if the stream were continuous.
    while (this.pos + 1 < buf.length) {
      const i = this.pos | 0;
      const frac = this.pos - i;
      const s = buf[i] + (buf[i + 1] - buf[i]) * frac;
      // Clamp before scaling: a sample over 1.0 would wrap to full-scale
      // negative and put a click in the middle of a loud word.
      const clamped = s > 1 ? 1 : s < -1 ? -1 : s;
      this.out[this.n++] = clamped * 32767;

      if (this.n === FRAME) {
        // Transferred, not copied — the page gets the buffer and this side
        // allocates a fresh one.
        this.port.postMessage(this.out.buffer, [this.out.buffer]);
        this.out = new Int16Array(FRAME);
        this.n = 0;
      }
      this.pos += this.ratio;
    }

    const consumed = this.pos | 0;
    this.carry = buf.slice(consumed);
    this.pos -= consumed;
    return true;
  }
}

registerProcessor('pcm-capture', PCMCapture);
