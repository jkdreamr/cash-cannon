// Real-world banknote physics in SI units.
//
// Camera space: +x right, +y down, +z away from the lens. Everything is meters,
// seconds, kilograms. A bill is modelled as a rigid flat plate with an
// orientation frame, so drag depends on how it meets the air: edge-on it knifes
// through, broadside it brakes hard. That asymmetry plus an aligning torque is
// what produces real fluttering and tumbling, rather than any scripted wobble.

import { sub, scale, dot, cross, len, normalize, rotateAxis, perpendicular, clamp } from './vec3.js';
import { project, viewExtent } from './camera3d.js';

const G = 9.81;      // m/s^2
const RHO = 1.225;   // kg/m^3, air at sea level

export const BILL_LONG = 0.156;  // m, a US note
export const BILL_SHORT = 0.066; // m
const AREA = BILL_LONG * BILL_SHORT;
const EDGE_AREA = BILL_LONG * 0.00012; // paper thickness
const MASS = 0.001;  // kg, about one gram
const CD_FACE = 1.28; // flat plate normal to the flow
const CD_EDGE = 0.06;
const CL = 0.9;       // peak lift coefficient of a flat plate
const INERTIA = 1.0e-6;                              // kg m^2, thin plate
const TORQUE_K = 0.5 * RHO * CL * AREA * (BILL_LONG * 0.25); // pressure centre offset
const ANG_DAMP = 1.2; // 1/s, leaves the flutter lively but bounded

// Bills rest on a person when they arrive within this depth slab of the body.
// A torso is roughly this deep front to back, so notes arriving anywhere in
// that band can come down on a shoulder, arm or head.
const BODY_SLAB = 0.28; // m
const NEAR_CLIP = 0.09; // m, past the lens
const FAR_CLIP = 12;    // m

export const MAX_PARTICLES = 240;

export function createSystem() {
  return { particles: [] };
}

function billFrame(normal, rng) {
  let n = normalize(normal);
  // Guard a degenerate draw: a note always has some definite orientation.
  if (len(n) < 0.5) n = { x: 0, y: 0, z: -1 };
  const t = rotateAxis(perpendicular(n), n, rng() * Math.PI * 2);
  return { n, t };
}

// Angular kick with a guaranteed non-zero magnitude. Perfectly edge-on flight
// is an unstable equilibrium with no aerodynamic torque, so a real note needs
// its slight asymmetry to start tumbling; without this a note could fall
// forever perfectly on edge, which never happens in the real world.
function spin(rng, amp) {
  const v = (rng() * 2 - 1) * amp;
  return v + (v >= 0 ? 1.4 : -1.4);
}

function makeBill(p, v, n, t, rng) {
  return {
    kind: 'bill',
    p, v, n, t,
    w: { x: spin(rng, 3), y: spin(rng, 3), z: spin(rng, 3) },
    // A small constant torque so some notes tumble continuously, as real ones do.
    bias: { x: spin(rng, 4), y: spin(rng, 4), z: spin(rng, 4) },
    face: rng() < 0.5 ? 0 : 1,
    stuck: false,
    stickTried: false,
    life: 30,
  };
}

// Money gun: notes leave the muzzle edge-on (like a real bill feeder), so they
// fly before air resistance catches them and turns them broadside.
export function spawnBurst(sys, { origin, dir, count = 2, speed = 6.2, rng = Math.random }) {
  const d = normalize(dir);
  if (len(d) < 0.5) return;
  for (let i = 0; i < count; i++) {
    const spread = 0.16;
    const jitter = normalize({
      x: d.x + (rng() - 0.5) * spread,
      y: d.y + (rng() - 0.5) * spread - 0.06, // slight upward bias, the muzzle rises
      z: d.z + (rng() - 0.5) * spread,
    });
    const s = speed * (0.75 + rng() * 0.5);
    // Edge-on: the face normal starts perpendicular to travel.
    const { n, t } = billFrame(perpendicular(jitter), rng);
    sys.particles.push(
      makeBill(
        { x: origin.x, y: origin.y, z: origin.z },
        scale(jitter, s),
        n,
        t,
        rng
      )
    );
  }
  enforceCap(sys);
}

// Ambient rain: notes drift down from above the frame across a range of depths,
// so some pass in front of the person and some behind.
export function spawnRain(sys, { cam, count = 1, minZ = 0.5, maxZ = 4.2, rng = Math.random }) {
  for (let i = 0; i < count; i++) {
    const z = minZ + rng() * (maxZ - minZ);
    const ext = viewExtent(cam, z);
    const p = {
      x: (rng() * 2 - 1) * ext.halfW * 1.25,
      y: -ext.halfH - 0.1 - rng() * 0.5,
      z,
    };
    const v = { x: (rng() - 0.5) * 0.5, y: 0.2 + rng() * 0.4, z: (rng() - 0.5) * 0.3 };
    const { n, t } = billFrame(
      { x: rng() - 0.5, y: rng() - 0.5, z: rng() - 0.5 },
      rng
    );
    sys.particles.push(makeBill(p, v, n, t, rng));
  }
  enforceCap(sys);
}

// A brief muzzle cue at the fingertip.
export function spawnFlash(sys, origin) {
  sys.particles.push({
    kind: 'flash',
    p: { x: origin.x, y: origin.y, z: origin.z },
    v: { x: 0, y: 0, z: 0 },
    r: 0.05,
    life: 0.07,
    maxLife: 0.07,
  });
}

function enforceCap(sys) {
  const over = sys.particles.length - MAX_PARTICLES;
  if (over <= 0) return;
  let drop = over;
  // Retire the oldest free-flying notes first; never evict ones resting on the
  // person, since those are the ones the user is interacting with.
  sys.particles = sys.particles.filter((p) => {
    if (drop > 0 && p.kind === 'bill' && !p.stuck) {
      drop -= 1;
      return false;
    }
    return true;
  });
}

function windAt(time, p) {
  // Cheap smooth turbulence so notes never fall in lockstep.
  const a = Math.sin(time * 0.7 + p.y * 1.7) * Math.cos(time * 0.31 + p.z * 1.1);
  const b = Math.sin(time * 0.53 + p.x * 1.3 + 2.1);
  return { x: a * 0.22, y: b * 0.05, z: b * 0.14 };
}

function stepBill(p, h, env) {
  const wind = env.wind ? windAt(env.time, p.p) : { x: 0, y: 0, z: 0 };
  const u = { x: wind.x - p.v.x, y: wind.y - p.v.y, z: wind.z - p.v.z };
  const speed = len(u);

  let fx = 0;
  let fy = MASS * G;
  let fz = 0;

  if (speed > 1e-4) {
    const uh = scale(u, 1 / speed);
    const c = clamp(dot(p.n, uh), -1, 1);
    const ac = Math.abs(c);                       // 1 = broadside, 0 = edge-on
    const sn = Math.sqrt(Math.max(0, 1 - c * c));
    const q = 0.5 * RHO * speed * speed;

    // Drag, with the area and coefficient blended by orientation.
    const fd = q * (CD_FACE * ac + CD_EDGE * sn) * (AREA * ac + EDGE_AREA * sn);
    fx += uh.x * fd;
    fy += uh.y * fd;
    fz += uh.z * fd;

    // Lift from the plate at an angle of attack, peaking near 45 degrees.
    // This is what makes notes swoop sideways instead of dropping straight.
    const perp = { x: p.n.x - uh.x * c, y: p.n.y - uh.y * c, z: p.n.z - uh.z * c };
    const pl = len(perp);
    if (pl > 1e-5) {
      const fl = q * CL * AREA * 2 * ac * sn * (c >= 0 ? -1 : 1);
      fx += (perp.x / pl) * fl;
      fy += (perp.y / pl) * fl;
      fz += (perp.z / pl) * fl;
    }

    // Aerodynamic torque rotates the note toward broadside. Light damping lets
    // it overshoot, which is exactly the flutter real banknotes show.
    const target = c >= 0 ? uh : scale(uh, -1);
    const ax = cross(p.n, target);
    const al = len(ax);
    if (al > 1e-6) {
      const tq = (TORQUE_K * speed * speed * al * ac) / INERTIA;
      p.w.x += (ax.x / al) * tq * h;
      p.w.y += (ax.y / al) * tq * h;
      p.w.z += (ax.z / al) * tq * h;
    }
  }

  p.w.x += p.bias.x * h;
  p.w.y += p.bias.y * h;
  p.w.z += p.bias.z * h;
  const damp = Math.exp(-ANG_DAMP * h);
  p.w.x *= damp;
  p.w.y *= damp;
  p.w.z *= damp;

  p.v.x += (fx / MASS) * h;
  p.v.y += (fy / MASS) * h;
  p.v.z += (fz / MASS) * h;
  p.p.x += p.v.x * h;
  p.p.y += p.v.y * h;
  p.p.z += p.v.z * h;

  const wl = len(p.w);
  if (wl > 1e-6) {
    const axis = scale(p.w, 1 / wl);
    const ang = wl * h;
    p.n = rotateAxis(p.n, axis, ang);
    p.t = rotateAxis(p.t, axis, ang);
    // Keep the frame orthonormal against drift.
    p.n = normalize(p.n);
    p.t = normalize(sub(p.t, scale(p.n, dot(p.n, p.t))));
  }
}

// Does this note come to rest on the person this frame?
function tryStick(p, env, rng) {
  const { cam, personZ, sampleMask } = env;
  if (!sampleMask || personZ == null) return;
  if (Math.abs(p.p.z - personZ) > BODY_SLAB) return;

  const s = project(cam, p.p);
  const u = s.x / cam.width;
  const v = s.y / cam.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return;
  if (!sampleMask(u, v)) return;

  if (p.stickTried) return;
  p.stickTried = true;

  // Slow notes settle; fast ones glance off. Upward-facing surfaces (shoulders,
  // head, forearms) hold money, near-vertical ones let it slide away.
  const speed = len(p.v);
  const onTopSurface = !sampleMask(u, v - 0.035);
  let chance = clamp(1.05 - speed / 4, 0.06, 0.92);
  if (!onTopSurface) chance *= 0.32; // a chest is steep, but not frictionless
  if (rng() > chance) return;

  p.stuck = true;
  p.u = u;
  p.v2 = v;
  p.restZ = personZ;
  p.v = { x: 0, y: 0, z: 0 };
  p.w = { x: 0, y: 0, z: 0 };
  p.bias = { x: 0, y: 0, z: 0 };
  // Lie roughly flat against the body, facing the camera.
  p.n = normalize({ x: (rng() - 0.5) * 0.5, y: -0.35 - rng() * 0.3, z: -0.8 });
  p.t = normalize(sub(p.t, scale(p.n, dot(p.n, p.t))));
}

export function step(sys, dt, env = {}) {
  const rng = env.rng || Math.random;
  const h = Math.min(dt, 0.05);
  const sub2 = h > 0.024 ? 2 : 1;
  const hs = h / sub2;

  for (const p of sys.particles) {
    if (p.kind === 'flash') {
      p.life -= h;
      continue;
    }
    if (p.stuck) continue;
    for (let s = 0; s < sub2; s++) stepBill(p, hs, env);
    p.life -= h;
    tryStick(p, env, rng);
  }

  cull(sys, env);
}

function cull(sys, env) {
  const cam = env.cam;
  sys.particles = sys.particles.filter((p) => {
    if (p.life <= 0) return false;
    if (p.stuck) return true;
    if (p.p.z < NEAR_CLIP || p.p.z > FAR_CLIP) return false;
    if (cam) {
      const ext = viewExtent(cam, p.p.z);
      // Gone below the frame, or far outside it sideways.
      if (p.p.y > ext.halfH + 0.6) return false;
      if (Math.abs(p.p.x) > ext.halfW * 2.2) return false;
    }
    return true;
  });
}

// Move notes resting on the person as the person moves (normalised screen units).
export function carryStuck(sys, du, dv) {
  for (const p of sys.particles) {
    if (!p.stuck) continue;
    p.u += du;
    p.v2 += dv;
  }
}

// Shaking your body throws the money off. `speed` is body motion in screen
// widths per second. Ordinary movement leaves the money where it is; it takes
// a deliberate shake to shed it, and even then it comes off over a moment
// rather than all at once.
export function shakeStuck(sys, { speed, dirX = 0, dirY = 0, dt, rng = Math.random }) {
  const excess = speed - 0.35;
  if (excess <= 0) return 0;
  let freed = 0;
  for (const p of sys.particles) {
    if (!p.stuck) continue;
    if (rng() < clamp(excess * 1.1, 0, 0.6) * dt * 6) {
      release(p, { x: dirX * 1.6, y: dirY * 1.6 + 0.4, z: 0 }, rng);
      freed += 1;
    }
  }
  return freed;
}

// A hand sweeping across the body brushes notes off.
export function knockStuck(sys, { u, v, radius = 0.09, speed = 0, rng = Math.random }) {
  if (speed < 0.25) return 0;
  let freed = 0;
  for (const p of sys.particles) {
    if (!p.stuck) continue;
    if (Math.hypot(p.u - u, p.v2 - v) > radius) continue;
    release(p, { x: (rng() - 0.5) * 1.2, y: 0.5 + rng() * 0.5, z: -0.3 }, rng);
    freed += 1;
  }
  return freed;
}

function release(p, vel, rng) {
  p.stuck = false;
  p.stickTried = true; // do not immediately re-stick to the same spot
  p.v = vel;
  p.w = { x: (rng() - 0.5) * 8, y: (rng() - 0.5) * 8, z: (rng() - 0.5) * 8 };
  p.bias = { x: (rng() - 0.5) * 6, y: (rng() - 0.5) * 6, z: (rng() - 0.5) * 6 };
  p.life = Math.max(p.life, 8);
  // Nudge it just clear of the body so it falls in front rather than inside.
  p.p.z = (p.restZ || p.p.z) - BODY_SLAB * 0.7;
}

// Screen position of a note resting on the person, in world space.
export function stuckWorld(p, cam) {
  const z = p.restZ || 1.4;
  return {
    x: ((p.u * cam.width - cam.cx) * z) / cam.f,
    y: ((p.v2 * cam.height - cam.cy) * z) / cam.f,
    z,
  };
}

export function countStuck(sys) {
  let n = 0;
  for (const p of sys.particles) if (p.stuck) n += 1;
  return n;
}
