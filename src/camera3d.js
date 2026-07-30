// Pinhole camera model shared by the physics and the renderer.
// World units are meters. Camera sits at the origin looking down +z.

const DEFAULT_HFOV_DEG = 62; // typical laptop webcam horizontal field of view

export function createCamera(width, height, hfovDeg = DEFAULT_HFOV_DEG) {
  const f = width / 2 / Math.tan((hfovDeg * Math.PI) / 360);
  return { width, height, f, cx: width / 2, cy: height / 2 };
}

// World point (meters) to screen pixels. `scale` is pixels per meter at that
// depth, which the renderer uses to size bills with correct perspective.
export function project(cam, p) {
  const z = Math.max(p.z, 0.02);
  const s = cam.f / z;
  return { x: cam.cx + p.x * s, y: cam.cy + p.y * s, scale: s };
}

// Screen pixel plus a known depth back to a world point.
export function unproject(cam, sx, sy, z) {
  return { x: ((sx - cam.cx) * z) / cam.f, y: ((sy - cam.cy) * z) / cam.f, z };
}

// Depth of an object whose real size is known and whose apparent size is
// measured in pixels. This is how we place the hand in real space.
export function depthFromSpan(cam, meters, pixels) {
  if (!(pixels > 0.5) || !(meters > 0)) return null;
  return (cam.f * meters) / pixels;
}

// Half-extents of the view frustum (meters) at a given depth.
export function viewExtent(cam, z) {
  return { halfW: (cam.width / 2 / cam.f) * z, halfH: (cam.height / 2 / cam.f) * z };
}

// A hand held up is in front of the body holding it, because the arm is. The
// depth read off the knuckle span is noisy and the near end of its range is
// where it is worst, so this is the rule that keeps the muzzle where it must
// physically be.
//
// Getting it wrong is not a small error. A note spawned behind the body is
// composited out by the person cut-out on the very frame it appears, so the gun
// fires, the sound plays, and nothing is ever seen. Held out beside your head
// the money shows up fine; raise the same hand in front of your face and it
// vanishes, because that is exactly where the silhouette covers the muzzle.
export const MUZZLE_CLEARANCE = 0.12; // m, the least a hand is in front of you
export const MIN_MUZZLE_Z = 0.18;     // m, nearer than this and it is in the lens

export function muzzleDepth(raw, personZ, maxZ) {
  let z = raw;
  if (!(z > 0) || !isFinite(z)) z = MIN_MUZZLE_Z;
  if (maxZ) z = Math.min(z, maxZ);
  if (personZ && isFinite(personZ)) z = Math.min(z, personZ - MUZZLE_CLEARANCE);
  return Math.max(z, MIN_MUZZLE_Z);
}
