import { describe, expect, test } from 'vitest';
import { createRenderer } from '../src/render.js';

function fakeCtx() {
  const calls = { clearRect: 0, fill: 0, drawImage: 0 };
  const grad = { addColorStop() {} };
  return {
    calls,
    setTransform() {},
    clearRect() { calls.clearRect++; },
    save() {}, restore() {},
    translate() {}, scale() {}, rotate() {},
    beginPath() {}, closePath() {}, moveTo() {}, arc() {}, arcTo() {},
    fillRect() {}, strokeRect() {}, stroke() {},
    fill() { calls.fill++; },
    drawImage() { calls.drawImage++; },
    fillText() {},
    createLinearGradient() { return grad; },
    createRadialGradient() { return grad; },
    set fillStyle(_) {}, set strokeStyle(_) {}, set lineWidth(_) {},
    set globalAlpha(_) {}, set font(_) {}, set textAlign(_) {}, set textBaseline(_) {},
  };
}

function fakeCanvas() {
  const ctx = fakeCtx();
  return { ctx, getContext: () => ctx };
}

describe('createRenderer', () => {
  test('draws a frame with one of each particle kind without throwing', () => {
    const canvas = fakeCanvas();
    const r = createRenderer(canvas);
    const particles = [
      { kind: 'flash', x: 10, y: 10, r: 40, rot: 0, life: 0.05, maxLife: 0.09 },
      { kind: 'smoke', x: 10, y: 10, r: 20, rot: 0, life: 0.3, maxLife: 0.5 },
      { kind: 'shell', x: 10, y: 10, rot: 1, life: 1, maxLife: 1.4 },
      { kind: 'bill', x: 10, y: 10, rot: 0.3, flip: 0.5, life: 2, maxLife: 2.6 },
    ];
    r.draw({
      video: null,
      particles,
      bounds: { width: 200, height: 200 },
      shake: { x: 0, y: 0 },
      status: [{ cocked: true }, { cocked: false }],
    });
    expect(canvas.ctx.calls.clearRect).toBe(1);
    expect(canvas.ctx.calls.fill).toBeGreaterThan(0);
  });
});
