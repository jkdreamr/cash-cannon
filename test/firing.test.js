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
    const s = createHandFiringState();
    let now = 0;
    let shots = 0;
    for (let i = 0; i < 20; i++) {
      if (updateFiring(s, GUN, (now += 16)).didFire) shots++;
    }
    // ~320ms at a 70ms cadence: first shot immediate, then ~one per 70ms.
    expect(shots).toBeGreaterThanOrEqual(4);
    expect(shots).toBeLessThanOrEqual(6);
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
