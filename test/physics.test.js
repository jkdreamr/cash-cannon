import { describe, expect, test } from 'vitest';
import {
  createSystem, spawnBurst, spawnRain, spawnFlash, step,
  carryStuck, shakeStuck, knockStuck, countStuck, MAX_PARTICLES,
} from '../src/physics.js';
import { createCamera } from '../src/camera3d.js';
import { len } from '../src/vec3.js';

const cam = createCamera(1280, 720);
const env = { cam, wind: false, time: 0 };
// No camera means no frame-bounds culling, so a note can be observed for a long
// fall without leaving the visible frustum.
const envNoCull = { wind: false, time: 0 };
const fixedRng = () => 0.5;

// Deterministic pseudo-random source for tests that need variation.
function lcg(seed = 1) {
  let s = seed;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

function run(sys, seconds, e = env) {
  for (let i = 0; i < Math.round(seconds * 120); i++) step(sys, 1 / 120, e);
}

describe('banknote aerodynamics', () => {
  test('a dropped note reaches the real terminal velocity of about 1.1 m/s', () => {
    const sys = createSystem();
    spawnRain(sys, { cam, count: 1, minZ: 2, maxZ: 2, rng: lcg(3) });
    run(sys, 6, envNoCull);
    const bill = sys.particles.find((p) => p.kind === 'bill');
    expect(bill).toBeTruthy();
    // Real banknotes flutter down at roughly 1 to 1.3 m/s, never free-fall.
    expect(len(bill.v)).toBeGreaterThan(0.5);
    expect(len(bill.v)).toBeLessThan(2.0);
  });

  test('gravity alone would be far faster, so drag is really doing the work', () => {
    const sys = createSystem();
    spawnRain(sys, { cam, count: 1, minZ: 2, maxZ: 2, rng: lcg(5) });
    run(sys, 3, envNoCull);
    const bill = sys.particles.find((p) => p.kind === 'bill');
    expect(bill.v.y).toBeLessThan(9.81 * 3 * 0.25); // nowhere near free fall
  });

  test('a note fired edge-on carries much further than one fired broadside', () => {
    const shoot = (normalAlongTravel) => {
      const sys = createSystem();
      const origin = { x: 0, y: 0, z: 1.5 };
      spawnBurst(sys, { origin, dir: { x: 1, y: 0, z: 0 }, count: 1, rng: fixedRng });
      const bill = sys.particles.find((p) => p.kind === 'bill');
      if (normalAlongTravel) bill.n = { x: 1, y: 0, z: 0 }; // broadside to travel
      bill.bias = { x: 0, y: 0, z: 0 };
      bill.w = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < 24; i++) step(sys, 1 / 240, { cam, wind: false, time: 0 });
      return sys.particles[0] ? sys.particles[0].p.x - origin.x : 0;
    };
    expect(shoot(false)).toBeGreaterThan(shoot(true) * 3);
  });

  test('notes tumble: orientation changes as they fall', () => {
    const sys = createSystem();
    spawnRain(sys, { cam, count: 1, minZ: 2, maxZ: 2, rng: lcg(11) });
    const bill = sys.particles[0];
    const n0 = { ...bill.n };
    run(sys, 1, envNoCull);
    const moved = Math.abs(bill.n.x - n0.x) + Math.abs(bill.n.y - n0.y) + Math.abs(bill.n.z - n0.z);
    expect(moved).toBeGreaterThan(0.05);
  });

  test('even a perfectly edge-on note starts tumbling, as a real one would', () => {
    const sys = createSystem();
    spawnRain(sys, { cam, count: 1, minZ: 2, maxZ: 2, rng: fixedRng });
    const bill = sys.particles[0];
    bill.v = { x: 0, y: 0.4, z: 0 };
    bill.n = { x: 0, y: 0, z: -1 }; // exactly edge-on to the airflow
    bill.w = { x: 0, y: 0, z: 0 };
    const n0 = { ...bill.n };
    run(sys, 1.5, envNoCull);
    const moved = Math.abs(bill.n.x - n0.x) + Math.abs(bill.n.y - n0.y) + Math.abs(bill.n.z - n0.z);
    expect(moved).toBeGreaterThan(0.05);
  });

  test('the orientation frame stays orthonormal over a long fall', () => {
    const sys = createSystem();
    spawnRain(sys, { cam, count: 1, minZ: 3, maxZ: 3, rng: lcg(17) });
    run(sys, 4, envNoCull);
    const bill = sys.particles.find((p) => p.kind === 'bill');
    expect(bill).toBeTruthy();
    expect(len(bill.n)).toBeCloseTo(1, 3);
    expect(len(bill.t)).toBeCloseTo(1, 3);
    expect(Math.abs(bill.n.x * bill.t.x + bill.n.y * bill.t.y + bill.n.z * bill.t.z)).toBeLessThan(0.01);
  });
});

describe('depth behaviour', () => {
  test('rain spreads across a range of depths, so some falls in front and some behind', () => {
    const sys = createSystem();
    let seed = 0;
    const rng = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    spawnRain(sys, { cam, count: 60, minZ: 0.5, maxZ: 4, rng });
    const depths = sys.particles.map((p) => p.p.z);
    const personZ = 1.4;
    expect(depths.some((z) => z < personZ)).toBe(true); // in front of the person
    expect(depths.some((z) => z > personZ)).toBe(true); // behind the person
  });

  test('notes that fly past the lens are removed', () => {
    const sys = createSystem();
    spawnBurst(sys, { origin: { x: 0, y: 0, z: 1.2 }, dir: { x: 0, y: 0, z: -1 }, count: 2, rng: fixedRng });
    run(sys, 2);
    expect(sys.particles.filter((p) => p.kind === 'bill').length).toBe(0);
  });
});

describe('landing on the person', () => {
  const personEnv = (maskOn = true) => ({
    cam, wind: false, time: 0, personZ: 1.4,
    rng: () => 0.01, // always pass the stick roll
    // Person occupies the middle of the frame, with the top edge at v = 0.25.
    sampleMask: (u, v) => maskOn && u > 0.3 && u < 0.7 && v > 0.25,
  });

  test('a note falling onto the person sticks and stays put', () => {
    const sys = createSystem();
    spawnRain(sys, { cam, count: 1, minZ: 1.4, maxZ: 1.4, rng: () => 0.5 });
    const bill = sys.particles[0];
    bill.p = { x: 0, y: -0.2, z: 1.4 }; // just above the person, centred
    run(sys, 3, personEnv());
    const stuck = sys.particles.filter((p) => p.stuck);
    expect(stuck.length).toBe(1);
    const before = { u: stuck[0].u, v: stuck[0].v2 };
    run(sys, 2, personEnv());
    expect(stuck[0].u).toBe(before.u); // resting, not drifting
    expect(stuck[0].v2).toBe(before.v);
  });

  test('with no person in frame nothing sticks', () => {
    const sys = createSystem();
    spawnRain(sys, { cam, count: 1, minZ: 1.4, maxZ: 1.4, rng: () => 0.5 });
    sys.particles[0].p = { x: 0, y: -0.2, z: 1.4 };
    run(sys, 3, personEnv(false));
    expect(countStuck(sys)).toBe(0);
  });

  test('resting notes ride along when the person moves', () => {
    const sys = createSystem();
    spawnRain(sys, { cam, count: 1, minZ: 1.4, maxZ: 1.4, rng: () => 0.5 });
    sys.particles[0].p = { x: 0, y: -0.2, z: 1.4 };
    run(sys, 3, personEnv());
    const bill = sys.particles.find((p) => p.stuck);
    const u0 = bill.u;
    carryStuck(sys, 0.05, -0.02);
    expect(bill.u).toBeCloseTo(u0 + 0.05, 6);
  });

  test('shaking hard throws money off, gentle motion does not', () => {
    const build = () => {
      const sys = createSystem();
      spawnRain(sys, { cam, count: 1, minZ: 1.4, maxZ: 1.4, rng: () => 0.5 });
      sys.particles[0].p = { x: 0, y: -0.2, z: 1.4 };
      run(sys, 3, personEnv());
      return sys;
    };

    const calm = build();
    expect(countStuck(calm)).toBe(1);
    shakeStuck(calm, { speed: 0.05, dirX: 1, dirY: 0, dt: 1 / 60, rng: () => 0.01 });
    expect(countStuck(calm)).toBe(1); // below the threshold, stays on

    const shaken = build();
    for (let i = 0; i < 30; i++) {
      shakeStuck(shaken, { speed: 0.9, dirX: 1, dirY: 0, dt: 1 / 60, rng: () => 0.01 });
    }
    expect(countStuck(shaken)).toBe(0); // vigorous shaking clears it
  });

  test('ordinary body movement does not dump the money', () => {
    const sys = createSystem();
    spawnRain(sys, { cam, count: 1, minZ: 1.4, maxZ: 1.4, rng: () => 0.5 });
    sys.particles[0].p = { x: 0, y: -0.2, z: 1.4 };
    run(sys, 3, personEnv());
    expect(countStuck(sys)).toBe(1);
    // Two seconds of normal shifting about, with the most generous dice roll.
    for (let i = 0; i < 120; i++) {
      shakeStuck(sys, { speed: 0.3, dirX: 1, dirY: 0, dt: 1 / 60, rng: () => 0 });
    }
    expect(countStuck(sys)).toBe(1);
  });

  test('a fast hand sweeping over a note brushes it off, a slow one does not', () => {
    const build = () => {
      const sys = createSystem();
      spawnRain(sys, { cam, count: 1, minZ: 1.4, maxZ: 1.4, rng: () => 0.5 });
      sys.particles[0].p = { x: 0, y: -0.2, z: 1.4 };
      run(sys, 3, personEnv());
      return sys;
    };
    const sys = build();
    const bill = sys.particles.find((p) => p.stuck);
    knockStuck(sys, { u: bill.u, v: bill.v2, speed: 0.05 }); // slow pass
    expect(countStuck(sys)).toBe(1);
    knockStuck(sys, { u: bill.u, v: bill.v2, speed: 2.0 }); // quick swipe
    expect(countStuck(sys)).toBe(0);
  });

  test('a released note falls in front of the body, not inside it', () => {
    const sys = createSystem();
    spawnRain(sys, { cam, count: 1, minZ: 1.4, maxZ: 1.4, rng: () => 0.5 });
    sys.particles[0].p = { x: 0, y: -0.2, z: 1.4 };
    run(sys, 3, personEnv());
    const bill = sys.particles.find((p) => p.stuck);
    knockStuck(sys, { u: bill.u, v: bill.v2, speed: 2.0 });
    expect(bill.p.z).toBeLessThan(1.4);
  });
});

describe('housekeeping', () => {
  test('the particle cap holds and never evicts money resting on the person', () => {
    const sys = createSystem();
    spawnRain(sys, { cam, count: 1, minZ: 1.4, maxZ: 1.4, rng: () => 0.5 });
    sys.particles[0].p = { x: 0, y: -0.2, z: 1.4 };
    run(sys, 3, {
      cam, wind: false, time: 0, personZ: 1.4, rng: () => 0.01,
      sampleMask: (u, v) => u > 0.3 && u < 0.7 && v > 0.25,
    });
    expect(countStuck(sys)).toBe(1);

    let seed = 7;
    const rng = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    spawnRain(sys, { cam, count: MAX_PARTICLES + 80, rng });
    expect(sys.particles.length).toBeLessThanOrEqual(MAX_PARTICLES);
    expect(countStuck(sys)).toBe(1); // the resting note survived the cull
  });

  test('the muzzle flash expires quickly', () => {
    const sys = createSystem();
    spawnFlash(sys, { x: 0, y: 0, z: 1 });
    expect(sys.particles.length).toBe(1);
    run(sys, 0.4);
    expect(sys.particles.length).toBe(0);
  });
});
