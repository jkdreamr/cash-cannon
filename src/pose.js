// Body tracking.
//
// Two jobs. First, supply a frame built from the shoulder line so money resting
// on someone follows them when they move, lean or turn. Second, decide where a
// note can physically come to rest: only surfaces tilted less than the friction
// angle hold paper, which on a standing person means the shoulder shelf, the
// top of the head, and a forearm held level. A cheek or a chest is near
// vertical and holds nothing.
//
// Everything degrades gracefully: with no model the app falls back to the
// silhouette heuristic.

const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

// MediaPipe pose landmark indices.
export const PL = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
};

const MIN_VISIBILITY = 0.5;

export async function createPoseLandmarker(PoseLandmarker, fileset) {
  const opts = {
    baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  };
  try {
    return await PoseLandmarker.createFromOptions(fileset, opts);
  } catch (e) {
    opts.baseOptions.delegate = 'CPU';
    return await PoseLandmarker.createFromOptions(fileset, opts);
  }
}

function visible(p) {
  if (!p) return false;
  if (p.visibility != null && p.visibility < MIN_VISIBILITY) return false;
  return true;
}

export function createBodyTracker() {
  let joints = null;   // mirrored, normalised screen coordinates
  let basis = null;
  let present = false;

  // Distance from a point to a segment, plus how far along it fell.
  function segDist(px, py, ax, ay, bx, by) {
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy;
    if (len2 < 1e-9) return { d: Math.hypot(px - ax, py - ay), t: 0 };
    let t = ((px - ax) * vx + (py - ay) * vy) / len2;
    t = Math.max(0, Math.min(1, t));
    return { d: Math.hypot(px - (ax + vx * t), py - (ay + vy * t)), t };
  }

  return {
    get present() { return present; },
    get basis() { return basis; },
    get joints() { return joints; },

    update(landmarks) {
      const lm = landmarks && landmarks[0];
      if (!lm) {
        present = false;
        return;
      }
      const ls = lm[PL.L_SHOULDER];
      const rs = lm[PL.R_SHOULDER];
      if (!visible(ls) || !visible(rs)) {
        present = false;
        return;
      }

      // Mirror x to match the selfie view the whole app draws in.
      const m = (p) => (p ? { x: 1 - p.x, y: p.y, v: p.visibility } : null);
      const j = {
        nose: m(lm[PL.NOSE]),
        // Mirroring swaps which shoulder appears on which side of the screen.
        shoulderA: m(rs),
        shoulderB: m(ls),
        elbowA: m(lm[PL.R_ELBOW]),
        elbowB: m(lm[PL.L_ELBOW]),
        wristA: m(lm[PL.R_WRIST]),
        wristB: m(lm[PL.L_WRIST]),
      };

      const dx = j.shoulderB.x - j.shoulderA.x;
      const dy = j.shoulderB.y - j.shoulderA.y;
      const width = Math.hypot(dx, dy);
      // Too narrow means the person has turned side-on and the frame is
      // degenerate; keep the previous one rather than swinging the money about.
      if (!(width > 0.04)) {
        present = false;
        return;
      }

      joints = j;
      basis = {
        ox: (j.shoulderA.x + j.shoulderB.x) / 2,
        oy: (j.shoulderA.y + j.shoulderB.y) / 2,
        ex: { x: dx, y: dy },          // along the shoulders
        ey: { x: -dy, y: dx },         // down the torso, same scale
        rot: Math.atan2(dy, dx),
        width,
      };
      present = true;
    },

    clear() {
      present = false;
    },

    // Can a note rest at this point, and how well does it hold? Returns null
    // where the surface is steeper than the friction angle.
    stickTest(u, v) {
      if (!present || !joints) return null;
      const w = basis.width;
      const j = joints;

      // Shoulder shelf: the best site on a body by a wide margin. The band
      // under about 22 degrees of tilt is only a few centimetres across, so
      // keep the catch radius tight and centred on the joint.
      for (const s of [j.shoulderA, j.shoulderB]) {
        if (Math.hypot(u - s.x, v - s.y) < w * 0.3 && v < s.y + w * 0.16) {
          return { kind: 'shoulder', hold: 1 };
        }
      }

      // The crown only. Shoulder breadth is about 1.77 head heights, and the
      // nose sits roughly 55% down the face, which puts the top of the head
      // about 0.31 shoulder-widths above it. Money rests on that crown and on
      // nothing below it: a forehead is already too steep, and a face holds
      // nothing at all. Allowing the whole head is what pasted notes across
      // the middle of a face.
      if (j.nose && visible(j.nose)) {
        const headTop = j.nose.y - w * 0.31;
        const onCrown = v > headTop - w * 0.11 && v < headTop + w * 0.12;
        if (onCrown && Math.abs(u - j.nose.x) < w * 0.26) {
          return { kind: 'head', hold: 0.95 };
        }
      }

      // A forearm only catches money while it is held roughly level.
      const arms = [
        [j.elbowA, j.wristA],
        [j.elbowB, j.wristB],
      ];
      for (const [e, wr] of arms) {
        if (!visible(e) || !visible(wr)) continue;
        const adx = wr.x - e.x;
        const ady = wr.y - e.y;
        const alen = Math.hypot(adx, ady);
        if (alen < 1e-4) continue;
        const tilt = Math.abs(Math.atan2(ady, adx)); // 0 or pi is level
        const level = Math.min(tilt, Math.PI - tilt); // radians away from level
        if (level > 0.45) continue; // steeper than ~26 degrees, it slides off
        const { d } = segDist(u, v, e.x, e.y, wr.x, wr.y);
        if (d < w * 0.13) {
          return { kind: 'forearm', hold: 0.85 * (1 - level / 0.45) };
        }
      }

      return null;
    },
  };
}
