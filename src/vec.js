export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function len(v) {
  return Math.hypot(v.x, v.y);
}

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function normalize(v) {
  const l = Math.hypot(v.x, v.y);
  if (l === 0) return { x: 0, y: 0 };
  return { x: v.x / l, y: v.y / l };
}

export function angleBetweenDeg(a, b) {
  const la = Math.hypot(a.x, a.y);
  const lb = Math.hypot(b.x, b.y);
  if (la === 0 || lb === 0) return 0;
  let c = (a.x * b.x + a.y * b.y) / (la * lb);
  c = Math.max(-1, Math.min(1, c));
  return (Math.acos(c) * 180) / Math.PI;
}

export function rotate(v, deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}
