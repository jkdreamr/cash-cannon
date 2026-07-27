import { describe, expect, test } from 'vitest';
import {
  createSystem, spawnBurst, spawnRain, step,
  carryStuck, shakeStuck, knockStuck, countStuck, stuckWorld, MAX_PARTICLES,
} from '../src/physics.js';
import { createCamera, project } from '../src/camera3d.js';
import { createBodyTracker, PL } from '../src/pose.js';
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
      spawnBurst(sys, { origin, dir: { x: 1, y: 0, z: 0 }, count: 1, speed: 6, rng: fixedRng });
      const bill = sys.particles.find((p) => p.kind === 'bill');
      const start = bill.p.x;
      if (normalAlongTravel) bill.n = { x: 1, y: 0, z: 0 }; // broadside to travel
      // Hold the orientation still so this isolates drag anisotropy.
      bill.bias = { x: 0, y: 0, z: 0 };
      bill.w = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < 24; i++) step(sys, 1 / 240, { cam, wind: false, time: 0 });
      return sys.particles[0] ? sys.particles[0].p.x - start : 0;
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

  test('rain can be focused around the person while still passing front and behind', () => {
    const sys = createSystem();
    spawnRain(sys, { cam, count: 300, focusZ: 1.5, rng: lcg(23) });
    const z = sys.particles.map((p) => p.p.z);
    const near = z.filter((d) => Math.abs(d - 1.5) < 0.28).length / z.length;
    // Concentrated on the person, so a decent share can actually land on them.
    expect(near).toBeGreaterThan(0.12);
    // But still genuinely three-dimensional: some in front, some behind.
    expect(z.some((d) => d < 1.2)).toBe(true);
    expect(z.some((d) => d > 1.8)).toBe(true);
    expect(Math.min(...z)).toBeGreaterThanOrEqual(0.9);
    expect(Math.max(...z)).toBeLessThanOrEqual(5);
  });

  test('the stream stays attached to the fingertip it is fired from', () => {
    // The muzzle offset is a world distance, and close to the lens a small one
    // is a lot of pixels: 0.10 m at a hand 0.7 m away is a 214 px hole between
    // the finger and the first note, which reads as money appearing from
    // nowhere. Some note must always be touching the fingertip.
    const z = 0.7;
    const tip = { x: 0.05, y: 0.1, z };
    const tipPx = project(cam, tip);
    const noteWidth = (cam.f * 0.156) / z;
    const sys = createSystem();
    const rng = lcg(31);
    let t = 0;
    let sinceShot = 0;
    const gaps = [];

    for (let f = 0; f < 120; f++) {
      const dt = 1 / 60;
      t += dt;
      sinceShot += dt * 1000;
      if (sinceShot > 50) {
        sinceShot = 0;
        spawnBurst(sys, {
          origin: tip, dir: { x: 0.5, y: -0.8, z: -0.2 },
          count: 1, preAdvance: rng() * dt, rng,
        });
      }
      step(sys, dt, { cam, time: t, wind: true });

      if (f > 20) {
        let nearest = Infinity;
        for (const q of sys.particles) {
          if (q.p.z < 0.1) continue;
          const s = project(cam, q.p);
          const half = (cam.f * 0.156) / q.p.z / 2;
          nearest = Math.min(nearest, Math.max(0, Math.hypot(s.x - tipPx.x, s.y - tipPx.y) - half));
        }
        gaps.push(nearest);
      }
    }

    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    const worst = gaps[gaps.length - 1];
    // Typically touching the fingertip, and never more than a note of clear
    // air even at the widest moment between shots.
    expect(median).toBeLessThan(noteWidth * 0.25);
    expect(worst).toBeLessThan(noteWidth);
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
    bill.p = { x: 0, y: -0.32, z: 1.4 }; // just above the person, centred
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
    sys.particles[0].p = { x: 0, y: -0.32, z: 1.4 };
    run(sys, 3, personEnv(false));
    expect(countStuck(sys)).toBe(0);
  });

  test('notes do not pile into the same spot, so money never lands as a clump', () => {
    const sys = createSystem();
    // Twenty notes all aimed at exactly the same point on the body.
    for (let i = 0; i < 20; i++) {
      spawnRain(sys, { cam, count: 1, minZ: 1.4, maxZ: 1.4, rng: () => 0.5 });
      sys.particles[sys.particles.length - 1].p = { x: 0, y: -0.32, z: 1.4 };
    }
    run(sys, 3, personEnv());
    // Only one can occupy that spot; the rest slide off and keep falling.
    expect(countStuck(sys)).toBe(1);
  });

  test('a note resting on a top surface lies flatter than one caught on the front', () => {
    const stickAt = (v) => {
      const sys = createSystem();
      spawnRain(sys, { cam, count: 1, minZ: 1.4, maxZ: 1.4, rng: () => 0.5 });
      sys.particles[0].p = { x: 0, y: v, z: 1.4 };
      run(sys, 3, personEnv());
      return sys.particles.find((p) => p.stuck);
    };
    // Start above the head so the note first meets the body at its top edge.
    const onTop = stickAt(-0.36);
    expect(onTop).toBeTruthy();
    expect(onTop.top).toBe(true);
    // Lying on a surface means the face points almost straight up, so from a
    // camera in front of you the note is strongly foreshortened. Tilting it
    // toward the lens is what made resting money look like a floating sticker.
    expect(Math.abs(onTop.n.y)).toBeGreaterThan(0.85);
    expect(Math.abs(onTop.n.y)).toBeGreaterThan(Math.abs(onTop.n.z) * 2);
  });

  test('with no body tracking, money still never rests on a face', () => {
    // A tight head-and-shoulders framing puts the shoulders out of shot, so the
    // pose model has nothing to build a frame from and the silhouette is all we
    // have. Only its upper boundary is a surface money can sit on; everything
    // inside that outline is a face or a chest, which holds nothing. Allowing
    // the interior even a small chance is what put notes across a face.
    const faceTop = 0.1;
    const env = {
      cam, wind: true, time: 0, personZ: 1.5,
      sampleMask: (u, v) => Math.abs(u - 0.45) < 0.26 && v > faceTop && v < 0.95,
      stickTest: null, // no pose available
    };

    // Notes reach a face when their depth only enters the body slab once they
    // are already down at eye or chest level, so put them there directly rather
    // than dropping them from above, where they would meet the outline first.
    const sys = createSystem();
    const rng = lcg(53);
    const atHeight = (v) => ((v * cam.height - cam.cy) * 1.5) / cam.f;
    for (let i = 0; i < 60; i++) {
      spawnRain(sys, { cam, count: 1, minZ: 1.5, maxZ: 1.5, rng });
      const note = sys.particles[sys.particles.length - 1];
      note.p = { x: 0, y: atHeight(0.3 + (i % 5) * 0.12), z: 1.5 }; // face and chest
    }
    for (let f = 0; f < 60; f++) step(sys, 1 / 60, { ...env, time: f / 60 });

    // Not one of them may come to rest on a face or a chest.
    for (const p of sys.particles.filter((q) => q.stuck)) {
      expect(env.sampleMask(p.u, p.v2 - 0.035)).toBe(false);
    }
    expect(sys.particles.filter((q) => q.stuck).length).toBe(0);

    // The top of the outline still catches money, so the fallback is not simply
    // switched off.
    const top = createSystem();
    spawnRain(top, { cam, count: 1, minZ: 1.5, maxZ: 1.5, rng });
    top.particles[0].p = { x: 0, y: atHeight(faceTop - 0.02), z: 1.5 };
    for (let f = 0; f < 120; f++) step(top, 1 / 60, { ...env, time: f / 60, rng: () => 0.01 });
    expect(countStuck(top)).toBe(1);
  });

  test('money comes to rest on the head and shoulders, and never on the face', () => {
    // Drive the real body tracker from synthetic pose landmarks, so this
    // covers where pose.js actually allows money to settle.
    const noseX = 0.48;
    const noseY = 0.4;
    const shoulderY = 0.66;
    const lm = [];
    for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, visibility: 0 });
    const put = (i, screenX, y) => { lm[i] = { x: 1 - screenX, y, visibility: 0.99 }; };
    put(PL.R_SHOULDER, 0.33, shoulderY);
    put(PL.L_SHOULDER, 0.63, shoulderY);
    put(PL.NOSE, noseX, noseY);

    const body = createBodyTracker();
    body.update([lm]);
    expect(body.present).toBe(true);

    const bw = body.basis.width;
    const headTop = noseY - bw * 0.31;
    const env = {
      cam, wind: true, time: 0, personZ: 1.5,
      // Head and torso silhouette, so nothing settles beside the body.
      sampleMask: (u, v) =>
        (Math.abs(u - noseX) < bw * 0.3 && v > headTop - bw * 0.05 && v < shoulderY)
        || (u > 0.27 && u < 0.69 && v >= shoulderY),
      stickTest: (u, v) => body.stickTest(u, v),
    };

    const sys = createSystem();
    const rng = lcg(41);
    let t = 0;
    let rainClock = 0;
    for (let f = 0; f < 60 * 20; f++) {
      const dt = 1 / 60;
      t += dt;
      rainClock += dt;
      env.time = t;
      if (rainClock > 0.07) {
        rainClock = 0;
        spawnRain(sys, { cam, count: 2, focusZ: 1.5, rng });
      }
      step(sys, dt, env);
    }

    const resting = sys.particles.filter((p) => p.stuck);
    expect(resting.length).toBeGreaterThan(0);
    for (const p of resting) {
      expect(['shoulder', 'head']).toContain(p.site);
      // Every resting note must still be somewhere the body can actually hold
      // it. Anything settling where the test says null is on a surface too
      // steep to hold paper, which is how notes ended up across a face.
      expect(env.stickTest(p.u, p.v2)).not.toBe(null);
    }

    // Falling money reaches the head first, and hair holds paper better than
    // anything else on a person, so the crown must be a real resting place.
    const sites = new Set(resting.map((p) => p.site));
    expect(sites.has('head')).toBe(true);
    expect(sites.has('shoulder')).toBe(true);

    // And the middle of the face, which holds nothing in reality, holds
    // nothing here either.
    expect(env.stickTest(noseX, 0.5)).toBe(null);
    expect(env.stickTest(noseX, 0.58)).toBe(null);
  });

  test('resting notes ride along when the person moves', () => {
    const sys = createSystem();
    spawnRain(sys, { cam, count: 1, minZ: 1.4, maxZ: 1.4, rng: () => 0.5 });
    sys.particles[0].p = { x: 0, y: -0.32, z: 1.4 };
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
      sys.particles[0].p = { x: 0, y: -0.32, z: 1.4 };
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
    sys.particles[0].p = { x: 0, y: -0.32, z: 1.4 };
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
      sys.particles[0].p = { x: 0, y: -0.32, z: 1.4 };
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

  test('money knocked off stays where it was, instead of teleporting back', () => {
    const sys = createSystem();
    spawnRain(sys, { cam, count: 1, minZ: 1.4, maxZ: 1.4, rng: () => 0.5 });
    sys.particles[0].p = { x: 0, y: -0.32, z: 1.4 };
    run(sys, 3, personEnv());
    const bill = sys.particles.find((p) => p.stuck);
    expect(bill).toBeTruthy();

    // The person walks a quarter of the frame to the right, carrying it along.
    for (let i = 0; i < 50; i++) carryStuck(sys, 0.005, -0.001);
    const restingAt = project(cam, stuckWorld(bill, cam));

    knockStuck(sys, { u: bill.u, v: bill.v2, speed: 2.0, cam });
    expect(bill.stuck).toBe(false);

    // It must resume flight from where it was resting, not from where it
    // originally landed. Without this it jumps hundreds of pixels.
    const freeAt = project(cam, bill.p);
    expect(Math.abs(freeAt.x - restingAt.x)).toBeLessThan(2);
    expect(Math.abs(freeAt.y - restingAt.y)).toBeLessThan(2);
  });

  test('a released note falls in front of the body, not inside it', () => {
    const sys = createSystem();
    spawnRain(sys, { cam, count: 1, minZ: 1.4, maxZ: 1.4, rng: () => 0.5 });
    sys.particles[0].p = { x: 0, y: -0.32, z: 1.4 };
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
    sys.particles[0].p = { x: 0, y: -0.32, z: 1.4 };
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

});
