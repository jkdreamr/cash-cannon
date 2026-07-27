import { describe, expect, test } from 'vitest';
import { createBodyTracker, PL } from '../src/pose.js';
import { createSystem, toBody, fromBody, bindStuckToBody, applyBodyBasis } from '../src/physics.js';

// The tracker mirrors x for the selfie view, so tests describe where things
// should appear ON SCREEN and this un-mirrors them on the way in.
function pose({ shoulderY = 0.5, left = 0.35, right = 0.65, noseY = 0.28, arms = null } = {}) {
  const lm = [];
  for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, visibility: 0.0 });
  const put = (i, screenX, y, vis = 0.99) => { lm[i] = { x: 1 - screenX, y, visibility: vis }; };
  // Screen-left shoulder comes from the RIGHT landmark once mirrored.
  put(PL.R_SHOULDER, left, shoulderY);
  put(PL.L_SHOULDER, right, shoulderY);
  put(PL.NOSE, (left + right) / 2, noseY);
  if (arms) {
    put(PL.R_ELBOW, arms.ex, arms.ey);
    put(PL.R_WRIST, arms.wx, arms.wy);
  }
  return [lm];
}

describe('body frame', () => {
  test('builds a shoulder frame and reports presence', () => {
    const b = createBodyTracker();
    b.update(pose());
    expect(b.present).toBe(true);
    expect(b.basis.ox).toBeCloseTo(0.5, 6);
    expect(b.basis.oy).toBeCloseTo(0.5, 6);
    expect(b.basis.width).toBeCloseTo(0.3, 6);
    expect(b.basis.rot).toBeCloseTo(0, 6);
  });

  test('a person turned side-on gives no frame rather than a degenerate one', () => {
    const b = createBodyTracker();
    b.update(pose({ left: 0.5, right: 0.51 })); // shoulders collapsed together
    expect(b.present).toBe(false);
  });

  test('missing landmarks give no frame', () => {
    const b = createBodyTracker();
    b.update(null);
    expect(b.present).toBe(false);
    b.update([]);
    expect(b.present).toBe(false);
  });
});

describe('where money can physically rest', () => {
  const b = createBodyTracker();
  b.update(pose());

  test('a shoulder holds money', () => {
    const s = b.stickTest(0.35, 0.5);
    expect(s).toBeTruthy();
    expect(s.kind).toBe('shoulder');
    expect(s.hold).toBeGreaterThan(0.8);
  });

  test('the top of the head holds money', () => {
    const s = b.stickTest(0.5, 0.2);
    expect(s).toBeTruthy();
    expect(s.kind).toBe('head');
  });

  test('a cheek does not hold money', () => {
    // A face is near vertical, far steeper than the friction angle.
    expect(b.stickTest(0.44, 0.35)).toBe(null);
  });

  test('a chest does not hold money', () => {
    expect(b.stickTest(0.5, 0.78)).toBe(null);
  });

  test('a level forearm catches money, a raised one does not', () => {
    const level = createBodyTracker();
    level.update(pose({ arms: { ex: 0.2, ey: 0.62, wx: 0.44, wy: 0.63 } }));
    const onArm = level.stickTest(0.32, 0.625);
    expect(onArm).toBeTruthy();
    expect(onArm.kind).toBe('forearm');

    const raised = createBodyTracker();
    // Same forearm swung up near vertical: nothing stays on it.
    raised.update(pose({ arms: { ex: 0.2, ey: 0.75, wx: 0.24, wy: 0.4 } }));
    expect(raised.stickTest(0.22, 0.58)).toBe(null);
  });

  test('with no body tracked nothing is offered a resting place', () => {
    const none = createBodyTracker();
    expect(none.stickTest(0.5, 0.5)).toBe(null);
  });
});

describe('resting money follows the body', () => {
  const basisAt = (opts) => {
    const b = createBodyTracker();
    b.update(pose(opts));
    return b.basis;
  };

  test('body coordinates round-trip', () => {
    const basis = basisAt({});
    const local = toBody(basis, 0.42, 0.46);
    const back = fromBody(basis, local.a, local.b);
    expect(back.u).toBeCloseTo(0.42, 9);
    expect(back.v).toBeCloseTo(0.46, 9);
  });

  test('a degenerate frame refuses to place anything', () => {
    expect(toBody({ ox: 0, oy: 0, ex: { x: 0, y: 0 }, ey: { x: 0, y: 0 }, rot: 0 }, 0.5, 0.5)).toBe(null);
  });

  function restingNote(u, v) {
    const sys = createSystem();
    sys.particles.push({
      kind: 'bill', stuck: true, u, v2: v, restZ: 1.4,
      n: { x: 0, y: 0, z: -1 }, t: { x: 1, y: 0, z: 0 },
      p: { x: 0, y: 0, z: 1.4 }, v: { x: 0, y: 0, z: 0 }, life: 10,
    });
    return sys;
  }

  test('money moves with you when you step sideways', () => {
    const sys = restingNote(0.35, 0.5);
    bindStuckToBody(sys, basisAt({}));
    applyBodyBasis(sys, basisAt({ left: 0.55, right: 0.85 })); // moved right by 0.2
    expect(sys.particles[0].u).toBeCloseTo(0.55, 6);
    expect(sys.particles[0].v2).toBeCloseTo(0.5, 6);
  });

  test('money follows you as you come closer and the body grows', () => {
    const sys = restingNote(0.35, 0.5);
    bindStuckToBody(sys, basisAt({}));
    // Shoulders twice as far apart: the same body point is now further out.
    applyBodyBasis(sys, basisAt({ left: 0.2, right: 0.8 }));
    expect(sys.particles[0].u).toBeCloseTo(0.2, 6);
  });

  test('money rides round when you lean', () => {
    const sys = restingNote(0.35, 0.5);
    bindStuckToBody(sys, basisAt({}));
    // Tilt the shoulder line: the note on the low shoulder must drop with it.
    applyBodyBasis(sys, basisAt({ left: 0.35, right: 0.65, shoulderY: 0.5 }));
    const flat = sys.particles[0].v2;
    const tilted = createBodyTracker();
    tilted.update((() => {
      const p = pose();
      // Raise the screen-left shoulder, lower the screen-right one.
      p[0][PL.R_SHOULDER] = { x: 1 - 0.35, y: 0.42, visibility: 0.99 };
      p[0][PL.L_SHOULDER] = { x: 1 - 0.65, y: 0.58, visibility: 0.99 };
      return p;
    })());
    applyBodyBasis(sys, tilted.basis);
    expect(sys.particles[0].v2).toBeLessThan(flat); // followed the shoulder up
  });

  test('an unbound note is left alone', () => {
    const sys = restingNote(0.35, 0.5);
    applyBodyBasis(sys, basisAt({ left: 0.55, right: 0.85 }));
    expect(sys.particles[0].u).toBeCloseTo(0.35, 6); // never bound, never moved
  });
});
