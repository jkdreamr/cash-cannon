import { describe, expect, test } from 'vitest';
import { createHandFiringState, updateFiring } from '../src/firing.js';

const GUN = (thumbAngle) => ({ isGunShape: true, tip: { x: 1, y: 2 }, aim: { x: 0, y: -1 }, thumbAngle });
const UP = 50;   // clearly above thumbUpDeg
const DOWN = 5;  // clearly below thumbDownDeg

describe('updateFiring', () => {
  test('forming a gun with thumb already down does NOT fire', () => {
    const s = createHandFiringState();
    let now = 0;
    for (let i = 0; i < 10; i++) {
      const r = updateFiring(s, GUN(DOWN), (now += 16));
      expect(r.didFire).toBe(false);
    }
    expect(s.phase).toBe('GUN_IDLE');
  });

  test('cock then drop fires exactly once', () => {
    const s = createHandFiringState();
    let now = 0;
    updateFiring(s, GUN(UP), (now += 16));   // cock
    expect(s.phase).toBe('COCKED');
    const fire = updateFiring(s, GUN(DOWN), (now += 200)); // drop
    expect(fire.didFire).toBe(true);
    expect(fire.tip).toEqual({ x: 1, y: 2 });
    // holding down does not refire
    const again = updateFiring(s, GUN(DOWN), (now += 200));
    expect(again.didFire).toBe(false);
  });

  test('must re-cock (thumb up) before firing again', () => {
    const s = createHandFiringState();
    let now = 0;
    updateFiring(s, GUN(UP), (now += 16));
    expect(updateFiring(s, GUN(DOWN), (now += 200)).didFire).toBe(true);
    updateFiring(s, GUN(UP), (now += 200));   // re-cock
    expect(updateFiring(s, GUN(DOWN), (now += 200)).didFire).toBe(true);
  });

  test('cooldown blocks a too-fast second shot', () => {
    const s = createHandFiringState();
    let now = 1000;
    updateFiring(s, GUN(UP), now);
    expect(updateFiring(s, GUN(DOWN), (now += 200)).didFire).toBe(true);
    updateFiring(s, GUN(UP), (now += 10));    // re-cock fast
    expect(updateFiring(s, GUN(DOWN), (now += 10)).didFire).toBe(false); // within 120ms
  });

  test('losing the gun beyond grace resets to NO_GUN', () => {
    const s = createHandFiringState();
    let now = 0;
    updateFiring(s, GUN(UP), (now += 16)); // COCKED
    for (let i = 0; i < 6; i++) updateFiring(s, null, (now += 16)); // within grace
    expect(s.phase).toBe('COCKED');
    updateFiring(s, null, (now += 16)); // 7th absent frame > grace
    expect(s.phase).toBe('NO_GUN');
  });
});
