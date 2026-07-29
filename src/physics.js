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
// Thin plate about its centre: I = m(a^2 + b^2)/12 = 2.391e-6 kg m^2. With the
// true value the aligning torque gives a 1.68 Hz flutter at terminal velocity,
// which is exactly the rate real banknotes flutter at.
const INERTIA = (MASS * (BILL_LONG * BILL_LONG + BILL_SHORT * BILL_SHORT)) / 12;
const TORQUE_K = 0.5 * RHO * CL * AREA * (BILL_LONG * 0.25); // pressure centre offset
// The aligning torque is a spring. Too little damping and it is a numerically
// undamped oscillator that explicit integration cannot resolve, which makes
// notes snap between orientations instead of fluttering. This gives zeta ~0.14
// at terminal velocity: sustained flutter, bounded amplitude.
const ANG_DAMP = 3.0;
// Real notes leaving a money gun tumble at 2 to 10 rev/s. Nothing should ever
// spin faster than this, whatever the integrator does.
const MAX_SPIN = 70; // rad/s

// Bills rest on a person when they arrive within this depth slab of the body.
// A torso is roughly this deep front to back, so notes arriving anywhere in
// that band can come down on a shoulder, arm or head.
const BODY_SLAB = 0.28; // m
const NEAR_CLIP = 0.09; // m, past the lens
const FAR_CLIP = 12;    // m

// Notes cannot pile into the same spot on a body, and only so many will perch
// before the rest slide off. Both keep the money looking scattered rather than
// stacked in a clump.
// Tuned so notes may touch and overlap like real scattered money, but the
// closest pair still sits about half a note apart rather than stacking.
const STUCK_SEPARATION = 0.04; // normalised screen units
// How far above a point to look for open air when deciding whether the surface
// faces upward. Big enough to ride over a ragged mask edge, small enough that a
// forehead never qualifies.
const TOP_PROBE = 0.035;
const MAX_STUCK = 18;

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
    variant: Math.floor(rng() * 6), // which printed note this is, so no clones
    tone: rng(), // slight per-note paper variation, no two notes look identical
    stuck: false,
    stickTried: false,
    life: 30,
  };
}

// Money gun. A real one drives a rubber roller against the face of the top note
// and shears it off the stack, so notes leave one at a time, short edge first
// (knife-on to the airflow), and because the drive friction acts off the note's
// mid-plane every note leaves tumbling end over end about its short axis.
// Notes leave from the fingertip itself. muzzleOffset is a world-space distance
// and close to the lens even a small one is a lot of pixels: 0.10 m at a hand
// 0.7 m away puts the note 214 px clear of the finger before it is ever drawn,
// which reads as money appearing from thin air. At zero the note straddles the
// fingertip as it leaves, which is what emerging from the barrel looks like.
export function spawnBurst(sys, {
  origin, dir, count = 1, speed = 1.8, muzzleOffset = 0, preAdvance = 0,
  rng = Math.random,
}) {
  const d = normalize(dir);
  if (len(d) < 0.5) return;
  for (let i = 0; i < count; i++) {
    const spread = 0.14;
    const jitter = normalize({
      x: d.x + (rng() - 0.5) * spread,
      y: d.y + (rng() - 0.5) * spread - 0.05, // vendors tell you to aim up
      z: d.z + (rng() - 0.5) * spread,
    });
    const s = speed * (0.8 + rng() * 0.4);

    // Leave the muzzle knife-on: the face normal is perpendicular to travel.
    const { n, t } = billFrame(perpendicular(jitter), rng);
    const bill = makeBill(
      {
        x: origin.x + d.x * muzzleOffset,
        y: origin.y + d.y * muzzleOffset,
        z: origin.z + d.z * muzzleOffset,
      },
      scale(jitter, s),
      n,
      t,
      rng
    );

    // End-over-end about the short (transverse) axis, 2 to 10 rev/s.
    const axis = cross(n, t);
    const rate = (2 + rng() * 8) * Math.PI * 2 * (rng() < 0.5 ? -1 : 1);
    bill.w = { x: axis.x * rate, y: axis.y * rate, z: axis.z * rate };
    bill.bias = { x: bill.bias.x * 0.3, y: bill.bias.y * 0.3, z: bill.bias.z * 0.3 };

    // Notes leave continuously, not in lockstep with the render frames. Nudging
    // each one along its own path by a fraction of a frame spreads the stream
    // out instead of stamping it at frame boundaries.
    if (preAdvance > 0) {
      bill.p.x += bill.v.x * preAdvance;
      bill.p.y += bill.v.y * preAdvance;
      bill.p.z += bill.v.z * preAdvance;
    }

    sys.particles.push(bill);
  }
  enforceCap(sys);
}

// Ambient rain: notes drift down from above the frame across a range of depths,
// so some pass in front of the person and some behind.
export function spawnRain(sys, { cam, count = 1, minZ = 1.15, maxZ = 5, focusZ = null, rng = Math.random }) {
  for (let i = 0; i < count; i++) {
    let z;
    if (focusZ != null) {
      // Money thrown over someone falls around them, not spread evenly through
      // the whole room. Two samples give a triangular distribution centred on
      // the person, so plenty passes close enough to actually land on them
      // while some still falls well in front and well behind.
      const spread = 1.5;
      z = focusZ + (rng() + rng() - 1) * spread;
      z = Math.min(Math.max(z, minZ), maxZ);
    } else {
      z = minZ + rng() * (maxZ - minZ);
    }
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

  // Hard ceiling on spin. No physical note tumbles faster than this, and it
  // stops any numerical excursion from becoming a visible spasm.
  const spinMag = len(p.w);
  if (spinMag > MAX_SPIN) {
    const k = MAX_SPIN / spinMag;
    p.w.x *= k;
    p.w.y *= k;
    p.w.z *= k;
  }

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
function tryStick(sys, p, env, rng) {
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

  // A note cannot land where one already lies, and a body only holds so many
  // before the rest slide off. Without this the money stacks into a clump.
  let nearby = 0;
  let resting = 0;
  for (const q of sys.particles) {
    if (!q.stuck) continue;
    resting += 1;
    if (Math.hypot(q.u - u, q.v2 - v) < STUCK_SEPARATION) nearby += 1;
  }
  if (nearby > 0 || resting >= MAX_STUCK) return;

  // A note stays only where the local surface tilt is below the friction angle
  // arctan(mu). That is mass-free and scale-free: it slides whenever
  // tan(tilt) > mu, whatever the note weighs. Paper on skin is mu ~0.45 and on
  // cloth ~0.35, so anything steeper than roughly 20 to 25 degrees sheds it.
  //
  // The silhouette answers that directly and without guesswork: if the point is
  // on the person and just above it is open air, this is the upper boundary of
  // the body and therefore an upward-facing surface. That is true across the
  // top of hair, along a shoulder, and on the upper edge of a raised forearm,
  // and false all the way down a face or a chest.
  //
  // Deriving the same thing from anatomy instead was wrong: a note gets one
  // attempt, taken the moment it meets the body, and for a head that moment is
  // at the top of the HAIR. A crown band computed from the nose and shoulder
  // width sits below the hair, so every note landing on a head failed its one
  // attempt and nothing ever settled there.
  if (sampleMask(u, v - TOP_PROBE)) return;

  // Body tracking cannot gate this, only describe it: which part of you the
  // note came to rest on, and how well that part holds paper.
  const site = env.stickTest ? env.stickTest(u, v) : null;
  const hold = site ? site.hold : 0.8;

  // Slow notes settle; fast ones glance off. The floor here must stay below
  // `hold`, or a surface that holds nothing would still catch the occasional
  // note.
  const speed = len(p.v);
  const chance = clamp((1.05 - speed / 4) * hold, 0, 0.94);
  if (chance <= 0 || rng() > chance) return;

  const onTopSurface = true; // gated on the silhouette's upper boundary above
  p.stuck = true;
  p.top = onTopSurface;
  p.site = site ? site.kind : 'silhouette';
  p.u = u;
  p.v2 = v;
  p.restZ = personZ;
  p.v = { x: 0, y: 0, z: 0 };
  p.w = { x: 0, y: 0, z: 0 };
  p.bias = { x: 0, y: 0, z: 0 };

  // Orientation follows the surface it came to rest on. A note draped over the
  // top of a head or shoulder lies mostly flat, so from a camera in front of
  // you it is strongly foreshortened. One caught against your chest faces the
  // lens. Both get a random roll so no two sit at the same angle.
  // A note lying on a shoulder or a crown has its face pointing almost
  // straight up, so from a camera in front of you it is strongly foreshortened.
  // Tilting it toward the lens is what made resting money look like a sticker
  // hovering in front of the body rather than lying on it.
  const jitterX = (rng() - 0.5) * 0.4;
  p.n = onTopSurface
    ? normalize({ x: jitterX, y: -0.93, z: -0.22 - rng() * 0.18 })
    : normalize({ x: jitterX, y: -0.28 - rng() * 0.3, z: -0.9 });
  p.t = rotateAxis(perpendicular(p.n), p.n, rng() * Math.PI * 2);
}

export function step(sys, dt, env = {}) {
  const rng = env.rng || Math.random;
  const h = Math.min(dt, 0.05);

  for (const p of sys.particles) {
    if (p.stuck) continue;

    // The aligning torque behaves as a spring whose stiffness grows with the
    // square of airspeed, so a fast note oscillates far quicker than a drifting
    // one. Explicit integration is only stable while the step stays well inside
    // that period, so each note gets the substeps its own speed demands. A
    // single fixed step makes fast notes snap between orientations, and at low
    // frame rates it diverges outright.
    const speed = len(p.v);
    const omega = Math.sqrt((TORQUE_K * speed * speed) / INERTIA);
    const sub = Math.max(1, Math.min(8, Math.ceil((h * omega) / 0.35)));
    const hs = h / sub;
    for (let s = 0; s < sub; s++) stepBill(p, hs, env);

    p.life -= h;
    tryStick(sys, p, env, rng);
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

// ---------------------------------------------------------------------------
// Body-frame binding.
//
// A note resting on someone must move with the part of them it is lying on, not
// with the average of their whole silhouette. Each resting note is stored in
// coordinates of a frame built from the shoulder line, so when the person
// walks, leans, turns or moves closer the note follows by construction:
// translation, rotation and scale all come free from the change of basis.

// Screen point to body-local coordinates.
export function toBody(basis, u, v) {
  const dx = u - basis.ox;
  const dy = v - basis.oy;
  const det = basis.ex.x * basis.ey.y - basis.ex.y * basis.ey.x;
  // Turning side-on collapses the shoulder line and the basis degenerates.
  if (Math.abs(det) < 1e-6) return null;
  return {
    a: (dx * basis.ey.y - dy * basis.ey.x) / det,
    b: (basis.ex.x * dy - basis.ex.y * dx) / det,
  };
}

export function fromBody(basis, a, b) {
  return {
    u: basis.ox + a * basis.ex.x + b * basis.ey.x,
    v: basis.oy + a * basis.ex.y + b * basis.ey.y,
  };
}

// Record where each newly rested note sits relative to the body.
export function bindStuckToBody(sys, basis) {
  if (!basis) return;
  for (const p of sys.particles) {
    if (!p.stuck || p.bound) continue;
    const local = toBody(basis, p.u, p.v2);
    if (!local) continue;
    p.ba = local.a;
    p.bb = local.b;
    p.brot = basis.rot;
    p.bound = true;
  }
}

// Move every bound note to where its body point is now.
export function applyBodyBasis(sys, basis) {
  if (!basis) return;
  for (const p of sys.particles) {
    if (!p.stuck || !p.bound) continue;
    const s = fromBody(basis, p.ba, p.bb);
    if (!isFinite(s.u) || !isFinite(s.v)) continue;
    p.u = s.u;
    p.v2 = s.v;
    // Roll the note with the body, so money on a shoulder tips as you lean.
    const dr = basis.rot - p.brot;
    if (Math.abs(dr) > 1e-4) {
      p.t = rotateAxis(p.t, p.n, dr);
      p.brot = basis.rot;
    }
  }
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
export function shakeStuck(sys, { speed, dirX = 0, dirY = 0, dt, cam = null, rng = Math.random }) {
  const excess = speed - 0.35;
  if (excess <= 0) return 0;
  let freed = 0;
  for (const p of sys.particles) {
    if (!p.stuck) continue;
    if (rng() < clamp(excess * 1.1, 0, 0.6) * dt * 6) {
      release(p, { x: dirX * 1.6, y: dirY * 1.6 + 0.4, z: 0 }, rng, cam);
      freed += 1;
    }
  }
  return freed;
}

// A hand sweeping across the body brushes notes off.
export function knockStuck(sys, { u, v, radius = 0.09, speed = 0, cam = null, rng = Math.random }) {
  if (speed < 0.25) return 0;
  let freed = 0;
  for (const p of sys.particles) {
    if (!p.stuck) continue;
    if (Math.hypot(p.u - u, p.v2 - v) > radius) continue;
    release(p, { x: (rng() - 0.5) * 1.2, y: 0.5 + rng() * 0.5, z: -0.3 }, rng, cam);
    freed += 1;
  }
  return freed;
}

function release(p, vel, rng, cam) {
  p.stuck = false;
  p.stickTried = true; // do not immediately re-stick to the same spot

  // Resume free flight from where the note is NOW, not from wherever it first
  // landed. While resting, a note is tracked by its screen anchor and follows
  // the body, but p.p stays frozen. Without rebuilding it here, shaking money
  // off after moving would make it vanish and reappear at the old spot.
  const z = (p.restZ || p.p.z) - BODY_SLAB * 0.7;
  if (cam && p.u != null && p.v2 != null) {
    p.p.x = ((p.u * cam.width - cam.cx) * z) / cam.f;
    p.p.y = ((p.v2 * cam.height - cam.cy) * z) / cam.f;
  }
  p.p.z = z;

  p.bound = false;
  p.v = vel;
  p.w = { x: (rng() - 0.5) * 8, y: (rng() - 0.5) * 8, z: (rng() - 0.5) * 8 };
  p.bias = { x: (rng() - 0.5) * 6, y: (rng() - 0.5) * 6, z: (rng() - 0.5) * 6 };
  p.life = Math.max(p.life, 8);
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
