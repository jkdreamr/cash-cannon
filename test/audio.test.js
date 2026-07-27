import { describe, expect, test } from 'vitest';
import { createAudio } from '../src/audio.js';

function fakeCtx() {
  const calls = { osc: 0, buf: 0 };
  const node = { connect: (dest) => dest, start() {}, stop() {} };
  return {
    calls,
    currentTime: 0,
    sampleRate: 44100,
    state: 'running',
    destination: {},
    resume() {},
    createOscillator() {
      calls.osc++;
      return { type: '', frequency: { setValueAtTime() {} }, ...node };
    },
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, ...node };
    },
    createBiquadFilter() {
      return { type: '', frequency: { setValueAtTime() {} }, ...node };
    },
    createBuffer(_ch, n) {
      return { getChannelData: () => new Float32Array(n) };
    },
    createBufferSource() {
      calls.buf++;
      return { buffer: null, ...node };
    },
  };
}

describe('createAudio', () => {
  test('fire() builds oscillators + a noise buffer when enabled', () => {
    const ctx = fakeCtx();
    const audio = createAudio(() => ctx);
    audio.fire();
    expect(ctx.calls.osc).toBeGreaterThanOrEqual(1); // cash register bells
    expect(ctx.calls.buf).toBeGreaterThanOrEqual(1); // layered paper riffle
  });

  test('muting prevents sound generation', () => {
    const ctx = fakeCtx();
    const audio = createAudio(() => ctx);
    audio.setEnabled(false);
    audio.fire();
    audio.cock();
    expect(ctx.calls.osc).toBe(0);
    expect(ctx.calls.buf).toBe(0);
  });
});
