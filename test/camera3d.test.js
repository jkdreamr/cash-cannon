import { describe, expect, test } from 'vitest';
import { createCamera, project, unproject, depthFromSpan, viewExtent } from '../src/camera3d.js';

const cam = createCamera(1280, 720);

describe('pinhole camera', () => {
  test('a point on the axis projects to the centre of the frame', () => {
    const s = project(cam, { x: 0, y: 0, z: 2 });
    expect(s.x).toBeCloseTo(640, 6);
    expect(s.y).toBeCloseTo(360, 6);
  });

  test('objects shrink with distance', () => {
    const near = project(cam, { x: 0.1, y: 0, z: 1 });
    const far = project(cam, { x: 0.1, y: 0, z: 4 });
    expect(near.scale).toBeGreaterThan(far.scale);
    expect(Math.abs(near.x - 640)).toBeGreaterThan(Math.abs(far.x - 640));
  });

  test('project and unproject round-trip', () => {
    const p = { x: 0.35, y: -0.2, z: 1.8 };
    const s = project(cam, p);
    const back = unproject(cam, s.x, s.y, p.z);
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
    expect(back.z).toBeCloseTo(p.z, 6);
  });

  test('depth from apparent size: a smaller image means further away', () => {
    const palm = 0.09; // metres across the knuckles
    const near = depthFromSpan(cam, palm, 200);
    const far = depthFromSpan(cam, palm, 50);
    expect(far).toBeGreaterThan(near);
    // Halving the apparent size doubles the distance.
    expect(depthFromSpan(cam, palm, 100) / depthFromSpan(cam, palm, 200)).toBeCloseTo(2, 6);
  });

  test('depth is consistent with projection', () => {
    // A 0.09 m object at 1.5 m should measure back to 1.5 m from its pixel span.
    const z = 1.5;
    const a = project(cam, { x: -0.045, y: 0, z });
    const b = project(cam, { x: 0.045, y: 0, z });
    expect(depthFromSpan(cam, 0.09, b.x - a.x)).toBeCloseTo(z, 6);
  });

  test('a degenerate span gives no depth rather than infinity', () => {
    expect(depthFromSpan(cam, 0.09, 0)).toBe(null);
    expect(depthFromSpan(cam, 0, 100)).toBe(null);
  });

  test('the view is wider further away', () => {
    expect(viewExtent(cam, 4).halfW).toBeGreaterThan(viewExtent(cam, 1).halfW);
  });
});
