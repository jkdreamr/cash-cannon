import { sub, normalize } from './vec.js';

// MediaPipe hand landmark indices.
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

// Finger is "extended" when its PIP joint angle is >= this (near-straight).
const EXTENDED_ANGLE = 135;

// 3D angle in degrees at vertex `b`, between b->a and b->c. 180 = straight.
// Works on landmarks carrying a z component; z defaults to 0 for pure-2D input.
export function jointAngleDeg(lm, a, b, c) {
  const p = lm[a];
  const q = lm[b];
  const r = lm[c];
  const ba = { x: p.x - q.x, y: p.y - q.y, z: (p.z || 0) - (q.z || 0) };
  const bc = { x: r.x - q.x, y: r.y - q.y, z: (r.z || 0) - (q.z || 0) };
  const la = Math.hypot(ba.x, ba.y, ba.z);
  const lc = Math.hypot(bc.x, bc.y, bc.z);
  if (la === 0 || lc === 0) return 180;
  let cos = (ba.x * bc.x + ba.y * bc.y + ba.z * bc.z) / (la * lc);
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

// A finger counts as extended when the angle at its PIP joint (mcp->pip->tip)
// is near-straight. This uses 3D joint geometry, so it stays correct when the
// finger points toward or away from the camera (where 2D distance collapses).
export function fingerExtended(lm, mcp, pip, tip) {
  return jointAngleDeg(lm, mcp, pip, tip) >= EXTENDED_ANGLE;
}

// Vector between two landmarks, in 3D when the source has depth.
function between(lm, a, b) {
  const p = lm[a];
  const q = lm[b];
  return { x: q.x - p.x, y: q.y - p.y, z: (q.z || 0) - (p.z || 0) };
}

function angleDeg(a, b) {
  const la = Math.hypot(a.x, a.y, a.z);
  const lb = Math.hypot(b.x, b.y, b.z);
  if (la < 1e-9 || lb < 1e-9) return 0;
  let c = (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb);
  c = Math.max(-1, Math.min(1, c));
  return (Math.acos(c) * 180) / Math.PI;
}

// screenLm: 2D landmarks in a consistent space, used for tip position + aim.
// shapeLm : 3D landmarks (MediaPipe worldLandmarks) used for the finger-shape
//           test; defaults to screenLm so callers/tests can pass one array.
export function classifyHand(screenLm, shapeLm = screenLm) {
  const indexExtended = fingerExtended(shapeLm, LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_TIP);
  const middleExtended = fingerExtended(shapeLm, LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_TIP);
  const ringExtended = fingerExtended(shapeLm, LM.RING_MCP, LM.RING_PIP, LM.RING_TIP);
  const pinkyExtended = fingerExtended(shapeLm, LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_TIP);

  // The barrel: index out, the other three folded.
  const isGunShape = indexExtended && !middleExtended && !ringExtended && !pinkyExtended;

  // The hammer. A raised thumb is straight at its own joint AND cocked away
  // from the barrel; laid alongside the index it is neither. Both parts are
  // needed, since a bent thumb tucked into the palm can still happen to point
  // away from the finger.
  const thumbStraight =
    jointAngleDeg(shapeLm, LM.THUMB_MCP, LM.THUMB_IP, LM.THUMB_TIP) >= 125;
  const thumbAngle = angleDeg(
    between(shapeLm, LM.THUMB_MCP, LM.THUMB_TIP),
    between(shapeLm, LM.INDEX_MCP, LM.INDEX_TIP)
  );

  const aimVec = sub(screenLm[LM.INDEX_TIP], screenLm[LM.INDEX_MCP]);
  const aimMag = Math.hypot(aimVec.x, aimVec.y);

  return {
    isGunShape,
    thumbStraight,
    thumbAngle, // degrees away from the barrel; large when the thumb is up
    tip: { x: screenLm[LM.INDEX_TIP].x, y: screenLm[LM.INDEX_TIP].y },
    aim: normalize(aimVec),
    aimMag, // small when the finger points at/away from the camera
    fingers: { indexExtended, middleExtended, ringExtended, pinkyExtended },
  };
}
