import { describe, expect, test } from 'vitest';
import { classifyHand, jointAngleDeg } from '../src/gesture.js';

// 21 MediaPipe landmarks carrying x, y and z (world-style). The classifier uses
// z for the finger-shape angles, and x/y for aim + tip position.
function gunHand({ forward = false } = {}) {
  const lm = new Array(21);
  lm[0] = { x: 0.50, y: 0.90, z: 0 };   // wrist
  lm[1] = { x: 0.42, y: 0.82, z: 0 };   // thumb (ignored by the classifier)
  lm[2] = { x: 0.40, y: 0.74, z: 0 };
  lm[3] = { x: 0.36, y: 0.70, z: 0 };
  lm[4] = { x: 0.30, y: 0.66, z: 0 };
  if (forward) {
    // Index points toward the camera: barely moves in x/y (foreshortened) but
    // travels in z, so it is straight in 3D and bent-looking in 2D.
    lm[5] = { x: 0.50, y: 0.60, z: 0.00 };
    lm[6] = { x: 0.50, y: 0.62, z: -0.06 };
    lm[7] = { x: 0.50, y: 0.64, z: -0.12 };
    lm[8] = { x: 0.50, y: 0.66, z: -0.18 };
  } else {
    // Index points up in the image plane.
    lm[5] = { x: 0.50, y: 0.62, z: 0 };
    lm[6] = { x: 0.50, y: 0.50, z: 0 };
    lm[7] = { x: 0.50, y: 0.40, z: 0 };
    lm[8] = { x: 0.50, y: 0.30, z: 0 };
  }
  // Middle, ring, pinky folded down.
  lm[9] = { x: 0.56, y: 0.62, z: 0 };
  lm[10] = { x: 0.56, y: 0.58, z: 0 };
  lm[11] = { x: 0.55, y: 0.63, z: 0 };
  lm[12] = { x: 0.55, y: 0.66, z: 0 };
  lm[13] = { x: 0.60, y: 0.63, z: 0 };
  lm[14] = { x: 0.60, y: 0.59, z: 0 };
  lm[15] = { x: 0.59, y: 0.64, z: 0 };
  lm[16] = { x: 0.59, y: 0.67, z: 0 };
  lm[17] = { x: 0.64, y: 0.64, z: 0 };
  lm[18] = { x: 0.64, y: 0.60, z: 0 };
  lm[19] = { x: 0.63, y: 0.65, z: 0 };
  lm[20] = { x: 0.63, y: 0.68, z: 0 };
  return lm;
}

function openHand() {
  const lm = gunHand();
  lm[10] = { x: 0.56, y: 0.50, z: 0 }; lm[12] = { x: 0.56, y: 0.30, z: 0 };
  lm[14] = { x: 0.60, y: 0.50, z: 0 }; lm[16] = { x: 0.60, y: 0.30, z: 0 };
  lm[18] = { x: 0.64, y: 0.52, z: 0 }; lm[20] = { x: 0.64, y: 0.34, z: 0 };
  return lm;
}

describe('jointAngleDeg', () => {
  test('straight is ~180, right angle is ~90', () => {
    expect(jointAngleDeg([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], 0, 1, 2)).toBeCloseTo(180, 0);
    expect(jointAngleDeg([{ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }], 0, 1, 2)).toBeCloseTo(90, 0);
  });
});

describe('classifyHand', () => {
  test('detects a gun (index out, other fingers folded)', () => {
    const h = classifyHand(gunHand());
    expect(h.isGunShape).toBe(true);
    expect(h.fingers.indexExtended).toBe(true);
    expect(h.fingers.middleExtended).toBe(false);
  });

  test('open hand is not a gun', () => {
    expect(classifyHand(openHand()).isGunShape).toBe(false);
  });

  test('aim points along the index finger (up here)', () => {
    const h = classifyHand(gunHand());
    expect(h.aim.y).toBeLessThan(-0.9);
    expect(Math.abs(h.aim.x)).toBeLessThan(0.1);
  });

  test('detects a gun pointing toward the camera, where 2D distance fails', () => {
    const h = classifyHand(gunHand({ forward: true }));
    expect(h.isGunShape).toBe(true);    // 3D joint angle still sees a straight barrel
    expect(h.aimMag).toBeLessThan(0.1); // foreshortened: 2D aim direction is ambiguous
  });
});
