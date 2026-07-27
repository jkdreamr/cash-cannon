import { describe, expect, test } from 'vitest';
import { createSystem, spawnBurst, spawnRain, step, MAX_PARTICLES } from '../src/physics.js';

const TIP = { x: 100, y: 100 };
const AIM = { x: 1, y: 0 };
const BOUNDS = { width: 1000, height: 1000 };
const count = (sys, kind) => sys.particles.filter((p) => p.kind === kind).length;

describe('physics', () => {
  test('spawnBurst adds flash, smoke, shell and 3..6 bills', () => {
    const sys = createSystem();
    spawnBurst(sys, { tip: TIP, aim: AIM, rng: () => 0 }); // min bills
    expect(count(sys, 'flash')).toBe(1);
    expect(count(sys, 'smoke')).toBe(1);
    expect(count(sys, 'shell')).toBe(1);
    expect(count(sys, 'bill')).toBe(3);

    const sys2 = createSystem();
    spawnBurst(sys2, { tip: TIP, aim: AIM, rng: () => 0.999 }); // max bills
    expect(count(sys2, 'bill')).toBe(6);
  });

  test('continuous mode: explicit bill count and no shell', () => {
    const sys = createSystem();
    spawnBurst(sys, { tip: TIP, aim: AIM, rng: () => 0.5, bills: 2, shell: false });
    expect(count(sys, 'bill')).toBe(2);
    expect(count(sys, 'shell')).toBe(0);
    expect(count(sys, 'flash')).toBe(1); // flash still fires each shot
  });

  test('spawnRain drops bills from above the top that fall at a capped speed', () => {
    const sys = createSystem();
    spawnRain(sys, { width: 1000, count: 3, rng: () => 0.5 });
    const rainBills = sys.particles.filter((p) => p.kind === 'bill' && p.rain);
    expect(rainBills.length).toBe(3);
    expect(rainBills[0].y).toBeLessThan(0); // starts above the top edge

    for (let i = 0; i < 120; i++) step(sys, 1 / 60, { width: 1000, height: 800 });
    const p = sys.particles.find((x) => x.rain);
    if (p) {
      expect(p.vy).toBeLessThanOrEqual(341); // gentle terminal fall, not gun-fire ballistics
      expect(p.y).toBeGreaterThan(0);         // has fallen into view
    }
  });

  test('gravity accelerates a particle downward', () => {
    const sys = createSystem();
    sys.particles.push({ kind: 'bill', x: 0, y: 0, vx: 0, vy: 0, rot: 0, vrot: 0, flip: 0, vflip: 0, life: 5, maxLife: 5 });
    const bill = sys.particles[0];
    step(sys, 0.1, BOUNDS);
    expect(bill.vy).toBeGreaterThan(0); // gained downward velocity from gravity
    expect(bill.y).toBeGreaterThan(0);  // moved downward
  });

  test('bills launch with an upward recoil bias (muzzle climb)', () => {
    const sys = createSystem();
    spawnBurst(sys, { tip: TIP, aim: { x: 1, y: 0 }, rng: () => 0.5 });
    const bill = sys.particles.find((p) => p.kind === 'bill');
    expect(bill.vy).toBeLessThan(0); // recoil kicks the shot toward screen-up (-y)
  });

  test('drag reduces horizontal speed magnitude', () => {
    const sys = createSystem();
    sys.particles.push({ kind: 'bill', x: 0, y: 0, vx: 1000, vy: 0, rot: 0, vrot: 0, flip: 0, vflip: 0, life: 5, maxLife: 5 });
    step(sys, 0.1, BOUNDS);
    expect(Math.abs(sys.particles[0].vx)).toBeLessThan(1000);
  });

  test('off-screen and dead particles are culled', () => {
    const sys = createSystem();
    sys.particles.push({ kind: 'bill', x: 0, y: 5000, vx: 0, vy: 0, rot: 0, vrot: 0, flip: 0, vflip: 0, life: 5, maxLife: 5 });
    sys.particles.push({ kind: 'flash', x: 0, y: 0, vx: 0, vy: 0, rot: 0, vrot: 0, r: 10, life: 0.02, maxLife: 0.09 });
    step(sys, 0.1, BOUNDS);
    expect(sys.particles.length).toBe(0);
  });

  test('particle cap is enforced by spawnBurst', () => {
    const sys = createSystem();
    for (let i = 0; i < MAX_PARTICLES + 100; i++) {
      sys.particles.push({ kind: 'bill', x: 0, y: 0, vx: 0, vy: 0, rot: 0, vrot: 0, flip: 0, vflip: 0, life: 5, maxLife: 5 });
    }
    spawnBurst(sys, { tip: TIP, aim: AIM, rng: () => 0.5 });
    expect(sys.particles.length).toBeLessThanOrEqual(MAX_PARTICLES);
  });
});
