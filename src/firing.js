const DEFAULTS = { fireIntervalMs: 70, graceFrames: 5 };

export function createHandFiringState() {
  return { firing: false, lostFrames: 0, lastFireMs: -Infinity };
}

// Continuous fire: while the gun shape is held, emit a shot every fireIntervalMs.
// hand: { isGunShape, tip, aim, aimMag } | null
export function updateFiring(state, hand, nowMs, cfg = {}) {
  const c = { ...DEFAULTS, ...cfg };

  if (!hand || !hand.isGunShape) {
    state.lostFrames += 1;
    if (state.lostFrames > c.graceFrames) state.firing = false;
    return { didFire: false, firing: state.firing };
  }

  state.lostFrames = 0;
  if (!state.firing) {
    // First frame the gun appears: fire at once, then settle into the cadence.
    state.firing = true;
    state.lastFireMs = -Infinity;
  }

  let didFire = false;
  if (nowMs - state.lastFireMs >= c.fireIntervalMs) {
    didFire = true;
    state.lastFireMs = nowMs;
  }

  return { didFire, firing: true, tip: hand.tip, aim: hand.aim, aimMag: hand.aimMag };
}
