import { describe, expect, test } from 'vitest';
import { classifyHand } from '../src/gesture.js';

// 21 MediaPipe landmarks in normalized space (origin top-left, y down).
function gunHand(thumb) {
  const lm = [
    { x: 0.50, y: 0.90 }, // 0 wrist
    { x: 0.42, y: 0.82 }, // 1 thumb cmc
    { x: 0.40, y: 0.74 }, // 2 thumb mcp
    { x: 0.33, y: 0.70 }, // 3 thumb ip
    thumb === 'up' ? { x: 0.26, y: 0.66 } : { x: 0.42, y: 0.58 }, // 4 thumb tip
    { x: 0.50, y: 0.62 }, // 5 index mcp
    { x: 0.50, y: 0.50 }, // 6 index pip
    { x: 0.50, y: 0.40 }, // 7 index dip
    { x: 0.50, y: 0.30 }, // 8 index tip
    { x: 0.56, y: 0.62 }, // 9 middle mcp
    { x: 0.56, y: 0.58 }, // 10 middle pip
    { x: 0.55, y: 0.63 }, // 11 middle dip
    { x: 0.55, y: 0.66 }, // 12 middle tip (curled)
    { x: 0.60, y: 0.63 }, // 13 ring mcp
    { x: 0.60, y: 0.59 }, // 14 ring pip
    { x: 0.59, y: 0.64 }, // 15 ring dip
    { x: 0.59, y: 0.67 }, // 16 ring tip (curled)
    { x: 0.64, y: 0.64 }, // 17 pinky mcp
    { x: 0.64, y: 0.60 }, // 18 pinky pip
    { x: 0.63, y: 0.65 }, // 19 pinky dip
    { x: 0.63, y: 0.68 }, // 20 pinky tip (curled)
  ];
  return lm;
}

function openHand() {
  const lm = gunHand('up').slice();
  // extend middle, ring, pinky (tips far above wrist)
  lm[12] = { x: 0.56, y: 0.28 };
  lm[16] = { x: 0.62, y: 0.30 };
  lm[20] = { x: 0.68, y: 0.34 };
  return lm;
}

describe('classifyHand', () => {
  test('detects gun shape (index only)', () => {
    const h = classifyHand(gunHand('up'));
    expect(h.isGunShape).toBe(true);
    expect(h.fingers.indexExtended).toBe(true);
    expect(h.fingers.middleExtended).toBe(false);
  });

  test('open hand is not a gun', () => {
    expect(classifyHand(openHand()).isGunShape).toBe(false);
  });

  test('aim points along the index finger (up = -y here)', () => {
    const h = classifyHand(gunHand('up'));
    expect(h.aim.y).toBeLessThan(-0.9); // near (0,-1)
    expect(Math.abs(h.aim.x)).toBeLessThan(0.1);
  });

  test('thumb up gives a larger angle than thumb down', () => {
    const up = classifyHand(gunHand('up')).thumbAngle;
    const down = classifyHand(gunHand('down')).thumbAngle;
    expect(up).toBeGreaterThan(35);
    expect(down).toBeLessThan(18);
    expect(up).toBeGreaterThan(down);
  });
});
