import { describe, expect, test } from 'vitest';
import { sub, len, dist, normalize, angleBetweenDeg, rotate } from '../src/vec.js';

describe('vec', () => {
  test('sub and len', () => {
    expect(sub({ x: 3, y: 5 }, { x: 1, y: 2 })).toEqual({ x: 2, y: 3 });
    expect(len({ x: 3, y: 4 })).toBe(5);
  });
  test('dist', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
  test('normalize returns unit vector, guards zero', () => {
    const n = normalize({ x: 0, y: 8 });
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBeCloseTo(1);
    expect(normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
  test('angleBetweenDeg', () => {
    expect(angleBetweenDeg({ x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
    expect(angleBetweenDeg({ x: 1, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0);
  });
  test('rotate 90deg', () => {
    const r = rotate({ x: 1, y: 0 }, 90);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(1);
  });
});
