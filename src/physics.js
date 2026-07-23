import { rotate } from './vec.js';

const GRAVITY = 2000;        // px/s^2
const DRAG = 0.55;           // fraction of velocity retained per second
export const MAX_PARTICLES = 400;

export function createSystem() {
  return { particles: [] };
}

export function spawnBurst(sys, { tip, aim, nowMs = 0, rng = Math.random, bills, shell = true }) {
  // Muzzle flash.
  sys.particles.push({
    kind: 'flash', x: tip.x, y: tip.y, vx: 0, vy: 0, rot: 0, vrot: 0,
    r: 60, life: 0.09, maxLife: 0.09,
  });

  // Smoke puff (drifts along aim, rises, expands).
  sys.particles.push({
    kind: 'smoke', x: tip.x, y: tip.y, vx: aim.x * 40, vy: aim.y * 40 - 30,
    rot: 0, vrot: 0, r: 22, life: 0.5, maxLife: 0.5,
  });

  // Bills - burst with upward recoil bias + cone spread. Continuous fire passes
  // a small `bills` count per tick for a steady stream; a single shot omits it.
  const billCount = bills == null ? 3 + Math.floor(rng() * 4) : bills;
  for (let i = 0; i < billCount; i++) {
    const spreadDeg = (rng() - 0.5) * 24;   // +/- 12 deg cone
    const recoilDeg = -8 - rng() * 6;       // recoil kick biases the shot upward (screen -y)
    const dir = rotate(aim, spreadDeg + recoilDeg);
    const speed = 900 + rng() * 500;         // 900..1400 px/s
    sys.particles.push({
      kind: 'bill', x: tip.x, y: tip.y,
      vx: dir.x * speed, vy: dir.y * speed,
      rot: rng() * Math.PI * 2, vrot: (rng() - 0.5) * 16,
      flip: rng() * Math.PI * 2, vflip: 6 + rng() * 8,
      life: 2.6, maxLife: 2.6,
    });
  }

  // Shell casing - ejected roughly perpendicular to aim, with a little pop up.
  if (shell) {
    const shellDir = rotate(aim, 80 + rng() * 20);
    const shellSpeed = 300 + rng() * 200;
    sys.particles.push({
      kind: 'shell', x: tip.x, y: tip.y,
      vx: shellDir.x * shellSpeed, vy: shellDir.y * shellSpeed - 120,
      rot: 0, vrot: (rng() - 0.5) * 30, life: 1.4, maxLife: 1.4,
    });
  }

  enforceCap(sys);
}

function enforceCap(sys) {
  if (sys.particles.length <= MAX_PARTICLES) return;
  let overflow = sys.particles.length - MAX_PARTICLES;
  sys.particles = sys.particles.filter((p) => {
    if (overflow > 0 && p.kind === 'bill') {
      overflow -= 1;
      return false; // drop oldest bills first
    }
    return true;
  });
}

export function step(sys, dt, bounds) {
  const dragFactor = Math.pow(DRAG, dt);
  for (const p of sys.particles) {
    if (p.kind === 'bill' || p.kind === 'shell') {
      p.vy += GRAVITY * dt;
      p.vx *= dragFactor;
      p.vy *= dragFactor;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vrot * dt;
    if (p.kind === 'bill') p.flip += p.vflip * dt;
    if (p.kind === 'smoke') p.r += 40 * dt;
    p.life -= dt;
  }
  const maxY = bounds.height + 80;
  sys.particles = sys.particles.filter((p) => p.life > 0 && p.y < maxY);
}
