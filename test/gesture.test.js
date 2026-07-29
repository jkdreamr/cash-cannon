import { describe, expect, test } from 'vitest';
import { classifyHand, jointAngleDeg } from '../src/gesture.js';

// 21 MediaPipe landmarks carrying x, y and z (world-style). The classifier uses
// z for the finger-shape angles, and x/y for aim + tip position.
function gunHand({ forward = false, thumb = 'up' } = {}) {
  const lm = new Array(21);
  lm[0] = { x: 0.50, y: 0.90, z: 0 };   // wrist
  lm[1] = { x: 0.44, y: 0.82, z: 0 };   // thumb CMC
  lm[2] = { x: 0.42, y: 0.74, z: 0 };   // thumb MCP
  if (thumb === 'up') {
    // Straight and cocked out to the side, clear of the barrel.
    lm[3] = { x: 0.34, y: 0.70, z: 0 };
    lm[4] = { x: 0.26, y: 0.66, z: 0 };
  } else {
    // Laid back against the index finger, the way a hammer rests down.
    lm[3] = { x: 0.45, y: 0.60, z: 0 };
    lm[4] = { x: 0.47, y: 0.545, z: 0 };
  }
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

  test('the pose is forgiving to hold, without accepting the wrong hand', () => {
    // Two opposite questions of one measurement, so two thresholds: the barrel
    // may be bent up to 60 degrees and still count, while the other fingers
    // need only be bent 30 degrees to count as folded. Nobody holds a finger
    // gun to ruler tolerances, and a single threshold made it fussy.
    const build = ({ barrelBend = 0, othersStraight = false, middleStraight = false }) => {
      const lm = new Array(21);
      const P = (x, y, z = 0) => ({ x, y, z });
      lm[0] = P(0.01, -0.09); lm[1] = P(-0.018, -0.07); lm[2] = P(-0.035, -0.045);
      lm[3] = P(-0.058, -0.018); lm[4] = P(-0.075, 0.01);
      const a = (barrelBend * Math.PI) / 180;
      lm[5] = P(0, 0); lm[6] = P(0.002, 0.035);
      lm[7] = P(0.002 + 0.023 * Math.sin(a), 0.035 + 0.023 * Math.cos(a));
      lm[8] = P(0.002 + 0.043 * Math.sin(a), 0.035 + 0.043 * Math.cos(a));
      const put = (base, x, i, straight) => {
        lm[base] = P(x, -0.002 - i * 0.004);
        lm[base + 1] = P(x + 0.002, 0.03, straight ? 0 : 0.006);
        lm[base + 2] = straight ? P(x + 0.004, 0.055) : P(x - 0.003, 0.02, 0.026);
        lm[base + 3] = straight ? P(x + 0.005, 0.074) : P(x - 0.008, 0.002, 0.03);
      };
      put(9, 0.027, 0, othersStraight || middleStraight);
      put(13, 0.054, 1, othersStraight);
      put(17, 0.08, 2, othersStraight);
      return lm;
    };

    // A lazily held gun still counts.
    expect(classifyHand(build({ barrelBend: 0 })).isGunShape).toBe(true);
    expect(classifyHand(build({ barrelBend: 40 })).isGunShape).toBe(true);
    expect(classifyHand(build({ barrelBend: 60 })).isGunShape).toBe(true);
    // Curled right over is not a barrel at all.
    expect(classifyHand(build({ barrelBend: 80 })).isGunShape).toBe(false);
    // And hands that are not finger guns are still refused.
    expect(classifyHand(build({ othersStraight: true })).isGunShape).toBe(false);
    expect(classifyHand(build({ middleStraight: true })).isGunShape).toBe(false);
  });

  test('reads the thumb as the hammer: up is clear of the barrel, down is not', () => {
    const up = classifyHand(gunHand({ thumb: 'up' }));
    const down = classifyHand(gunHand({ thumb: 'down' }));

    // The barrel is unchanged either way; only the hammer differs.
    expect(up.isGunShape).toBe(true);
    expect(down.isGunShape).toBe(true);

    // Measured in knuckle spans, so it does not depend on hand size or how far
    // away the hand is.
    expect(up.thumbGap).toBeGreaterThan(0.7);
    expect(down.thumbGap).toBeLessThan(0.48);
  });

  test('the hammer reading is independent of hand size and distance', () => {
    // The same pose, scaled and shifted as if the hand were nearer the lens.
    const base = gunHand({ thumb: 'up' });
    const moved = base.map((p) => ({ x: p.x * 2.4 + 0.3, y: p.y * 2.4 - 0.5, z: p.z * 2.4 }));
    expect(classifyHand(moved).thumbGap).toBeCloseTo(classifyHand(base).thumbGap, 6);
  });

  test('detects a gun pointing toward the camera, where 2D distance fails', () => {
    const h = classifyHand(gunHand({ forward: true }));
    expect(h.isGunShape).toBe(true);    // 3D joint angle still sees a straight barrel
    expect(h.aimMag).toBeLessThan(0.1); // foreshortened: 2D aim direction is ambiguous
  });
});
