import { describe, expect, test } from 'vitest';
import { isInverted, makeSampler, maskCentroid } from '../src/mask.js';

const W = 40;
const H = 30;

// A person blob on the right half of the (unmirrored) frame.
function frame({ invert = false } = {}) {
  const d = new Uint8Array(W * H);
  for (let y = 8; y < H; y++) {
    for (let x = 22; x < 34; x++) d[y * W + x] = 1;
  }
  if (invert) for (let i = 0; i < d.length; i++) d[i] = d[i] ? 0 : 1;
  return d;
}

describe('mask polarity', () => {
  test('normal polarity is not flagged as inverted', () => {
    expect(isInverted(frame(), W, H)).toBe(false);
  });

  test('an inverted mask is detected from its border', () => {
    expect(isInverted(frame({ invert: true }), W, H)).toBe(true);
  });
});

describe('sampling', () => {
  test('mirroring maps the person to the opposite side of the screen', () => {
    const on = makeSampler(frame(), W, H, { mirrored: true });
    // Person sits on the right in video space, so they appear on the left on screen.
    expect(on(0.3, 0.7)).toBe(true);
    expect(on(0.7, 0.7)).toBe(false);
  });

  test('without mirroring the sides are unchanged', () => {
    const on = makeSampler(frame(), W, H, { mirrored: false });
    expect(on(0.7, 0.7)).toBe(true);
    expect(on(0.3, 0.7)).toBe(false);
  });

  test('an inverted mask reads correctly once flipped', () => {
    const on = makeSampler(frame({ invert: true }), W, H, { mirrored: true, inverted: true });
    expect(on(0.3, 0.7)).toBe(true);
  });

  test('points outside the frame are never the person', () => {
    const on = makeSampler(frame(), W, H, { mirrored: true });
    expect(on(-0.2, 0.5)).toBe(false);
    expect(on(0.5, 1.4)).toBe(false);
  });

  test('above the head is background, which is how a top surface is found', () => {
    const on = makeSampler(frame(), W, H, { mirrored: true });
    expect(on(0.3, 0.05)).toBe(false); // above the shoulders
    expect(on(0.3, 0.5)).toBe(true);
  });
});

describe('centroid', () => {
  test('reports the person centre in mirrored screen space', () => {
    const c = maskCentroid(frame(), W, H, { mirrored: true, step: 1 });
    expect(c).toBeTruthy();
    // Person sits right in video space, so mirrored they are left of centre,
    // matching where the sampler reports them.
    expect(c.u).toBeLessThan(0.5);
    expect(c.v).toBeGreaterThan(0.4);
    expect(c.coverage).toBeGreaterThan(0.05);
    expect(c.coverage).toBeLessThan(0.5);
  });

  test('an empty frame has no centroid', () => {
    expect(maskCentroid(new Uint8Array(W * H), W, H, { step: 1 })).toBe(null);
  });
});
