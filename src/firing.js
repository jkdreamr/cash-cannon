const DEFAULTS = { thumbUpDeg: 32, thumbDownDeg: 18, graceFrames: 6, cooldownMs: 120 };

export function createHandFiringState() {
  return { phase: 'NO_GUN', thumb: 'down', lostFrames: 0, lastFireMs: -Infinity };
}

// hand: { isGunShape, tip, aim, thumbAngle } | null
export function updateFiring(state, hand, nowMs, cfg = {}) {
  const c = { ...DEFAULTS, ...cfg };
  if (!hand || !hand.isGunShape) {
    state.lostFrames += 1;
    if (state.lostFrames > c.graceFrames) {
      state.phase = 'NO_GUN';
      state.thumb = 'down';
    }
    return { didFire: false };
  }
  state.lostFrames = 0;

  // Debounced thumb position (hysteresis) + edge detection.
  let thumbEvent = null;
  if (state.thumb === 'down' && hand.thumbAngle >= c.thumbUpDeg) {
    state.thumb = 'up';
    thumbEvent = 'toUp';
  } else if (state.thumb === 'up' && hand.thumbAngle <= c.thumbDownDeg) {
    state.thumb = 'down';
    thumbEvent = 'toDown';
  }

  let didFire = false;
  switch (state.phase) {
    case 'NO_GUN':
      state.phase = state.thumb === 'up' ? 'COCKED' : 'GUN_IDLE';
      break;
    case 'GUN_IDLE':
      if (state.thumb === 'up') state.phase = 'COCKED';
      break;
    case 'COCKED':
      if (thumbEvent === 'toDown') {
        if (nowMs - state.lastFireMs >= c.cooldownMs) {
          didFire = true;
          state.lastFireMs = nowMs;
        }
        state.phase = 'FIRED';
      }
      break;
    case 'FIRED':
      if (thumbEvent === 'toUp') state.phase = 'COCKED';
      break;
  }

  return { didFire, tip: hand.tip, aim: hand.aim };
}
