import { describe, expect, test } from 'vitest';
import { createSystem, spawnBurst, step, MAX_PARTICLES } from '../src/physics.js';

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

  test('gravity increases downward velocity and y', () => {
    const sys = createSystem();
    spawnBurst(sys, { tip: TIP, aim: AIM, rng: () => 0.5 });
    const bill = sys.particles.find((p) => p.kind === 'bill');
    const y0 = bill.y;
    const vy0 = bill.vy;
    step(sys, 0.1, BOUNDS);
    expect(bill.vy).toBeGreaterThan(vy0);
    expect(bill.y).toBeGreaterThan(y0);
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
