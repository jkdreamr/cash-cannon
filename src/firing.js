// A real money gun quotes 10 to 20 notes per second. This sits at the top of
// that range, which is also what keeps the stream visually continuous from the
// fingertip rather than arriving as separate pops.
//
// The thumb is the hammer: money only leaves the barrel while it is raised.
// Thresholds are split so a thumb hovering near the boundary cannot chatter the
// stream on and off frame to frame.
const DEFAULTS = {
  fireIntervalMs: 50,
  graceFrames: 5,
  thumbUpDeg: 50,   // cocked clear of the barrel
  thumbDownDeg: 35, // laid back alongside it
};

export function createHandFiringState() {
  return { firing: false, thumb: 'down', lostFrames: 0, lastFireMs: -Infinity };
}

// Continuous fire while a true finger gun is held: index barrel out, other
// fingers folded, thumb up. Drop the thumb and the gun stops firing without
// losing the pose.
// hand: { isGunShape, thumbAngle, thumbStraight, tip, aim, aimMag } | null
export function updateFiring(state, hand, nowMs, cfg = {}) {
  const c = { ...DEFAULTS, ...cfg };

  if (!hand || !hand.isGunShape) {
    state.lostFrames += 1;
    if (state.lostFrames > c.graceFrames) {
      state.firing = false;
      state.thumb = 'down';
    }
    return { didFire: false, firing: state.firing, thumbUp: state.thumb === 'up' };
  }

  state.lostFrames = 0;

  // Debounced hammer position. A hand reported without thumb information is
  // treated as cocked, so callers that only care about the barrel still work.
  const straight = hand.thumbStraight !== false;
  const angle = hand.thumbAngle == null ? 90 : hand.thumbAngle;
  if (state.thumb === 'down') {
    if (straight && angle >= c.thumbUpDeg) state.thumb = 'up';
  } else if (!straight || angle <= c.thumbDownDeg) {
    state.thumb = 'down';
  }

  const common = { tip: hand.tip, aim: hand.aim, aimMag: hand.aimMag };

  if (state.thumb !== 'up') {
    // Hammer down: the pose is still held, but nothing is being fired.
    state.firing = false;
    return { didFire: false, firing: false, thumbUp: false, ...common };
  }

  if (!state.firing) {
    // First frame the hammer comes up: fire at once, then settle into cadence.
    state.firing = true;
    state.lastFireMs = -Infinity;
  }

  let didFire = false;
  if (nowMs - state.lastFireMs >= c.fireIntervalMs) {
    didFire = true;
    state.lastFireMs = nowMs;
  }

  return { didFire, firing: true, thumbUp: true, ...common };
}
