export function createAudio(makeCtx) {
  const Native =
    typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  const factory = makeCtx || (Native ? () => new Native() : null);

  let ctx = null;
  let enabled = true;

  function ensure() {
    if (!factory) return null;
    if (!ctx) ctx = factory();
    return ctx;
  }

  function unlock() {
    const c = ensure();
    if (c && c.state === 'suspended' && c.resume) c.resume();
  }

  function tone(c, type, freq, t0, dur, gain) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noiseBurst(c, t0, dur, gain) {
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource();
    src.buffer = buf;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1900, t0);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    src.connect(lp).connect(g).connect(c.destination);
    src.start(t0);
  }

  function fire() {
    if (!enabled) return;
    const c = ensure();
    if (!c) return;
    const t = c.currentTime;
    noiseBurst(c, t, 0.12, 0.5);            // gunshot crack
    tone(c, 'sine', 90, t, 0.14, 0.5);      // low thump
    tone(c, 'square', 1200, t + 0.02, 0.12, 0.18); // "cha"
    tone(c, 'square', 1750, t + 0.10, 0.18, 0.18); // "ching"
  }

  function cock() {
    if (!enabled) return;
    const c = ensure();
    if (!c) return;
    tone(c, 'square', 520, c.currentTime, 0.04, 0.12); // hammer click
  }

  return {
    unlock,
    setEnabled: (v) => {
      enabled = !!v;
    },
    isEnabled: () => enabled,
    fire,
    cock,
  };
}
