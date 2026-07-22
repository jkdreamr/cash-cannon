import { sub, normalize, dist, angleBetweenDeg } from './vec.js';

// MediaPipe hand landmark indices.
export const LM = {
  WRIST: 0,
  THUMB_MCP: 2,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_TIP: 8,
  MIDDLE_PIP: 10,
  MIDDLE_TIP: 12,
  RING_PIP: 14,
  RING_TIP: 16,
  PINKY_PIP: 18,
  PINKY_TIP: 20,
};

// A finger is extended when its tip is farther from the wrist than its PIP joint.
export function fingerExtended(lm, tipIdx, pipIdx, wristIdx = LM.WRIST) {
  return dist(lm[tipIdx], lm[wristIdx]) > dist(lm[pipIdx], lm[wristIdx]);
}

export function classifyHand(lm) {
  const indexExtended = fingerExtended(lm, LM.INDEX_TIP, LM.INDEX_PIP);
  const middleExtended = fingerExtended(lm, LM.MIDDLE_TIP, LM.MIDDLE_PIP);
  const ringExtended = fingerExtended(lm, LM.RING_TIP, LM.RING_PIP);
  const pinkyExtended = fingerExtended(lm, LM.PINKY_TIP, LM.PINKY_PIP);

  const isGunShape = indexExtended && !middleExtended && !ringExtended && !pinkyExtended;

  const aim = normalize(sub(lm[LM.INDEX_TIP], lm[LM.INDEX_MCP]));
  const thumbVec = sub(lm[LM.THUMB_TIP], lm[LM.THUMB_MCP]);
  const indexProx = sub(lm[LM.INDEX_PIP], lm[LM.INDEX_MCP]);
  const thumbAngle = angleBetweenDeg(thumbVec, indexProx);

  return {
    isGunShape,
    tip: { x: lm[LM.INDEX_TIP].x, y: lm[LM.INDEX_TIP].y },
    aim,
    thumbAngle,
    fingers: { indexExtended, middleExtended, ringExtended, pinkyExtended },
  };
}
