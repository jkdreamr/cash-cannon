import { describe, expect, test } from 'vitest';
import { createHandFiringState, updateFiring } from '../src/firing.js';

const GUN = { isGunShape: true, tip: { x: 1, y: 2 }, aim: { x: 0, y: -1 }, aimMag: 0.3 };
const NOGUN = { isGunShape: false };

describe('updateFiring (continuous)', () => {
  test('fires immediately when the gun appears', () => {
    const s = createHandFiringState();
    const r = updateFiring(s, GUN, 1000);
    expect(r.didFire).toBe(true);
    expect(r.tip).toEqual({ x: 1, y: 2 });
    expect(r.firing).toBe(true);
  });

  test('fires repeatedly at the cadence while held', () => {
    // Derived from the interval rather than hardcoded, so tuning the rate does
    // not silently invalidate the test.
    const fireIntervalMs = 50;
    const frames = 40;
    const stepMs = 8;
    const s = createHandFiringState();
    let now = 0;
    let shots = 0;
    for (let i = 0; i < frames; i++) {
      if (updateFiring(s, GUN, (now += stepMs), { fireIntervalMs }).didFire) shots++;
    }
    // One immediately, then one per interval over the elapsed window.
    const expected = 1 + Math.floor((frames * stepMs) / fireIntervalMs);
    expect(shots).toBeGreaterThanOrEqual(expected - 1);
    expect(shots).toBeLessThanOrEqual(expected + 1);
  });

  test('the shipped cadence sits inside a real money gun rate of 10 to 20 a second', () => {
    const s = createHandFiringState();
    let now = 0;
    let shots = 0;
    for (let i = 0; i < 125; i++) {
      if (updateFiring(s, GUN, (now += 8)).didFire) shots++;
    }
    const perSecond = shots / ((125 * 8) / 1000);
    expect(perSecond).toBeGreaterThanOrEqual(10);
    expect(perSecond).toBeLessThanOrEqual(21);
  });

  test('does not fire without a gun', () => {
    const s = createHandFiringState();
    let now = 0;
    for (let i = 0; i < 10; i++) {
      expect(updateFiring(s, NOGUN, (now += 16)).didFire).toBe(false);
    }
    expect(s.firing).toBe(false);
  });

  test('respects the cadence (no double-fire within one interval)', () => {
    const s = createHandFiringState();
    updateFiring(s, GUN, 1000); // immediate shot
    expect(updateFiring(s, GUN, 1030).didFire).toBe(false); // +30ms, < 70ms
    expect(updateFiring(s, GUN, 1075).didFire).toBe(true); //  +75ms, >= 70ms
  });

  test('brief dropouts within grace keep firing; beyond grace it stops', () => {
    const s = createHandFiringState();
    updateFiring(s, GUN, 0);
    for (let i = 0; i < 5; i++) updateFiring(s, null, 100 + i); // 5 absent frames (grace)
    expect(s.firing).toBe(true);
    updateFiring(s, null, 200); // 6th absent frame > grace
    expect(s.firing).toBe(false);
  });
});
