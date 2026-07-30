import { describe, expect, test } from 'vitest';
import {
  createCamera, project, unproject, depthFromSpan, viewExtent,
  muzzleDepth, MIN_MUZZLE_Z, MUZZLE_CLEARANCE,
} from '../src/camera3d.js';

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

describe('where the muzzle sits', () => {
  test('a hand raised in front of your face still fires in front of you', () => {
    // The reported bug: hold the finger gun out beside your head and money
    // appears, raise it in front of your face and nothing does.
    //
    // Nothing was wrong with the gesture. In a close selfie your shoulders fill
    // the frame, which puts you about 0.45 m from the lens, while a fixed 0.7 m
    // floor on the muzzle put the money a quarter of a metre BEHIND you. Notes
    // spawned back there are painted over by the person cut-out on the very
    // frame they appear, so the gun fires, the sound plays, and nothing is ever
    // seen. Beside your head the same notes clear the silhouette and show up
    // fine, which is exactly the difference the report describes.
    const personZ = 0.45;
    const z = muzzleDepth(0.35, personZ, 4);
    expect(z).toBeLessThan(personZ);
    // And clear of it by a real margin, not by a rounding error.
    expect(personZ - z).toBeGreaterThanOrEqual(MUZZLE_CLEARANCE - 1e-9);
  });

  test('a bad depth reading cannot push the muzzle behind you either', () => {
    // The knuckle span is noisiest at close range, which is precisely where
    // this matters, so the rule has to hold for a reading that is simply wrong.
    for (const raw of [0.9, 2.5, 4, 0, -1, NaN, Infinity]) {
      const z = muzzleDepth(raw, 0.5, 4);
      expect(z).toBeLessThan(0.5);
      expect(z).toBeGreaterThanOrEqual(MIN_MUZZLE_Z);
    }
  });

  test('standing back, the muzzle is left where the hand actually is', () => {
    // At a normal distance the hand reading is good and must not be dragged
    // toward the body: money has to leave the fingertip, not the chest.
    expect(muzzleDepth(1.1, 1.6, 4)).toBeCloseTo(1.1, 6);
    expect(muzzleDepth(0.8, 2.4, 4)).toBeCloseTo(0.8, 6);
  });

  test('with no body tracked the hand reading is trusted as it stands', () => {
    expect(muzzleDepth(0.35, null, 4)).toBeCloseTo(0.35, 6);
    expect(muzzleDepth(9, null, 4)).toBeCloseTo(4, 6);
  });

  test('the muzzle never ends up inside the lens', () => {
    // Someone leaning right into the camera would otherwise drive it negative,
    // where the note is behind the viewer and is culled.
    expect(muzzleDepth(0.1, 0.2, 4)).toBeGreaterThanOrEqual(MIN_MUZZLE_Z);
    expect(muzzleDepth(0.25, 0.05, 4)).toBeGreaterThanOrEqual(MIN_MUZZLE_Z);
  });
});
