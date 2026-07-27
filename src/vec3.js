// Minimal 3D vector math for the physics sim. Pure, no allocations beyond the
// returned object. Camera space: +x right, +y down, +z away from the lens.

export function v3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function len(a) {
  return Math.hypot(a.x, a.y, a.z);
}

export function normalize(a) {
  const l = Math.hypot(a.x, a.y, a.z);
  if (l < 1e-9) return { x: 0, y: 0, z: 0 };
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

// Rodrigues rotation of `a` about a unit `axis` by `ang` radians.
export function rotateAxis(a, axis, ang) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const d = dot(axis, a);
  const cr = cross(axis, a);
  return {
    x: a.x * c + cr.x * s + axis.x * d * (1 - c),
    y: a.y * c + cr.y * s + axis.y * d * (1 - c),
    z: a.z * c + cr.z * s + axis.z * d * (1 - c),
  };
}

// Any unit vector perpendicular to `a`, chosen stably.
export function perpendicular(a) {
  const ref = Math.abs(a.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  return normalize(cross(a, ref));
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
