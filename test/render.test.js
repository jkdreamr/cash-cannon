import { describe, expect, test } from 'vitest';
import { createRenderer } from '../src/render.js';
import { createCamera } from '../src/camera3d.js';

const cam = createCamera(1280, 720);

function fakeCtx() {
  const calls = { clearRect: 0, fill: 0, drawImage: 0, stroke: 0, fillText: 0, transform: 0 };
  const transforms = [];
  const alphas = [];
  const images = [];
  const grad = { addColorStop() {} };
  return {
    calls,
    transforms,
    alphas,
    images,
    setTransform() {},
    transform(a, b, c, d, e, f) { calls.transform++; transforms.push([a, b, c, d, e, f]); },
    clearRect() { calls.clearRect++; },
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, ellipse() {},
    fillRect() {}, strokeRect() {},
    stroke() { calls.stroke++; },
    fill() { calls.fill++; },
    drawImage(src) { calls.drawImage++; images.push(src); },
    fillText() { calls.fillText++; },
    createLinearGradient() { return grad; },
    createRadialGradient() { return grad; },
    set fillStyle(_) {}, set strokeStyle(_) {}, set lineWidth(_) {},
    set globalAlpha(a) { alphas.push(a); }, set font(_) {}, set textAlign(_) {}, set textBaseline(_) {},
    set globalCompositeOperation(_) {}, set imageSmoothingEnabled(_) {},
  };
}

function fakeCanvas() {
  const ctx = fakeCtx();
  return { ctx, width: 0, height: 0, getContext: () => ctx };
}

// The note artwork is pre-rendered from real canvases at startup. These tests
// exercise the geometry, so a stub sheet stands in for the printed textures.
const fakeArt = {
  front: [{ width: 512, height: 218 }],
  back: [{ width: 512, height: 218 }],
  width: 512,
  height: 218,
  variants: 1,
};

const renderer = (canvas) => createRenderer(canvas, { createCanvas: fakeCanvas, art: fakeArt });

const video = { readyState: 4 };

function bill(pos, extra = {}) {
  return {
    kind: 'bill',
    p: pos,
    n: { x: 0, y: 0, z: -1 },
    t: { x: 1, y: 0, z: 0 },
    life: 10,
    ...extra,
  };
}

describe('renderer', () => {
  test('draws a frame of notes without throwing', () => {
    const canvas = fakeCanvas();
    const r = renderer(canvas);
    r.draw({
      video,
      cam,
      particles: [
        bill({ x: 0, y: 0, z: 1.5 }),
        bill({ x: 0.3, y: -0.2, z: 3 }),
      ],
      shake: { x: 0, y: 0 },
    });
    expect(canvas.ctx.calls.clearRect).toBe(1);
    // The camera feed plus one blit of printed artwork per note.
    expect(canvas.ctx.calls.drawImage).toBe(3);
    expect(canvas.ctx.calls.transform).toBe(2);
  });

  test('a note edge-on is drawn as a hairline rather than vanishing', () => {
    const canvas = fakeCanvas();
    const r = renderer(canvas);
    // Short axis pointing down the view axis, far enough away that the face
    // collapses to under a pixel: what you see is the paper edge.
    r.draw({
      video,
      cam,
      particles: [bill({ x: 0, y: 0, z: 6 }, { n: { x: 0, y: 1, z: 0 }, t: { x: 1, y: 0, z: 0 } })],
      shake: { x: 0, y: 0 },
    });
    expect(canvas.ctx.calls.stroke).toBeGreaterThan(0);
    expect(canvas.ctx.calls.transform).toBe(0); // no face to blit
  });

  test('a note turned side-on still shows its edge instead of disappearing', () => {
    // The mirror image of the case above: the LONG axis points at the lens.
    const canvas = fakeCanvas();
    const r = renderer(canvas);
    r.draw({
      video,
      cam,
      particles: [bill({ x: 0, y: 0, z: 6 }, { n: { x: 0, y: 1, z: 0 }, t: { x: 0, y: 0, z: 1 } })],
      shake: { x: 0, y: 0 },
    });
    expect(canvas.ctx.calls.stroke).toBeGreaterThan(0);
  });

  test('a note fades out as it turns edge-on, the way real paper does', () => {
    // Banknote stock is 0.11 mm thick, a quarter of a pixel even at arm's
    // length, so a note square-on to the lens is invisible rather than a crisp
    // line. The closer to edge-on, the fainter it must be drawn.
    const faintest = (nz) => {
      const canvas = fakeCanvas();
      const r = renderer(canvas);
      // Tilt the face progressively toward edge-on with the viewer.
      const n = { x: 0, y: Math.sqrt(1 - nz * nz), z: nz };
      r.draw({ video, cam, particles: [bill({ x: 0, y: 0, z: 4 }, { n, t: { x: 1, y: 0, z: 0 } })], shake: { x: 0, y: 0 } });
      return Math.min(...canvas.ctx.alphas);
    };
    const nearlyEdge = faintest(0.02); // almost perfectly edge-on
    const partlyOpen = faintest(0.20);
    expect(nearlyEdge).toBeLessThan(partlyOpen);
    expect(nearlyEdge).toBeLessThan(0.2);
  });

  test('with a person stencil the cut-out is composited for occlusion', () => {
    const canvas = fakeCanvas();
    const r = renderer(canvas);
    const before = canvas.ctx.calls.drawImage;
    r.draw({
      video,
      cam,
      particles: [
        bill({ x: 0, y: 0, z: 3.0 }),  // behind the person
        bill({ x: 0, y: 0, z: 0.8 }),  // in front of the person
      ],
      personStencil: { width: 16, height: 16 },
      personZ: 1.5,
      shake: { x: 0, y: 0 },
    });
    // Feed, plus the composited person cut-out.
    expect(canvas.ctx.calls.drawImage).toBeGreaterThan(before + 1);
  });

  test('notes behind the camera are skipped', () => {
    const canvas = fakeCanvas();
    const r = renderer(canvas);
    r.draw({ video, cam, particles: [bill({ x: 0, y: 0, z: -1 })], shake: { x: 0, y: 0 } });
    expect(canvas.ctx.calls.transform).toBe(0); // nothing drawn in note space
  });

  test('note artwork is never drawn mirrored, whichever side faces the camera', () => {
    // A left-handed screen basis makes the canvas flip everything drawn into
    // it, which renders the denomination back to front. Every note must be
    // laid out with a positive determinant regardless of its orientation.
    const orientations = [
      { n: { x: 0, y: 0, z: -1 }, t: { x: 1, y: 0, z: 0 } },  // facing the lens
      { n: { x: 0, y: 0, z: 1 }, t: { x: 1, y: 0, z: 0 } },   // facing away
      { n: { x: 0, y: 0, z: -1 }, t: { x: 0, y: 1, z: 0 } },  // rolled 90 degrees
      { n: { x: 0.4, y: -0.5, z: -0.77 }, t: { x: 0.9, y: 0.44, z: 0 } }, // tilted
    ];
    for (const o of orientations) {
      const canvas = fakeCanvas();
      const r = renderer(canvas);
      r.draw({ video, cam, particles: [bill({ x: 0, y: 0, z: 1.2 }, o)], shake: { x: 0, y: 0 } });
      expect(canvas.ctx.transforms.length).toBeGreaterThan(0);
      for (const m of canvas.ctx.transforms) {
        const det = m[0] * m[3] - m[1] * m[2];
        expect(det).toBeGreaterThan(0);
      }
    }
  });

  test('money resting on you is never hidden behind you', () => {
    // A resting note stores the body depth it landed at, and that estimate
    // drifts as you move. Sorting purely on depth therefore sank resting notes
    // into the body. Money lying on your surface faces the lens by definition.
    const canvas = fakeCanvas();
    const r = renderer(canvas);
    const stencil = { width: 16, height: 16 };
    r.draw({
      video,
      cam,
      // Landed when the body read further away than it does now.
      particles: [bill({ x: 0, y: 0, z: 0 }, { stuck: true, u: 0.5, v2: 0.4, restZ: 2.4 })],
      personStencil: stencil,
      personZ: 1.2,
      shake: { x: 0, y: 0 },
    });
    const imgs = canvas.ctx.images;
    // The cut-out of the person is the only drawn image that is a canvas.
    const cutIndex = imgs.findIndex((i) => i && typeof i.getContext === 'function');
    const noteIndex = imgs.findIndex((i) => i === fakeArt.front[0]);
    expect(cutIndex).toBeGreaterThanOrEqual(0);
    expect(noteIndex).toBeGreaterThan(cutIndex); // drawn over the person
  });

  test('a resting note is draped over the surface, not drawn as one flat plate', () => {
    const canvas = fakeCanvas();
    const r = renderer(canvas);
    r.draw({
      video,
      cam,
      particles: [bill({ x: 0, y: 0, z: 0 }, { stuck: true, u: 0.5, v2: 0.45, restZ: 1.2 })],
      shake: { x: 0, y: 0 },
    });
    // One transform per strip of the bend, rather than a single rigid quad.
    expect(canvas.ctx.calls.transform).toBeGreaterThan(3);
    expect(canvas.ctx.calls.stroke).toBeGreaterThan(0); // its contact shadow
  });

  test('a note resting on the person is placed from its screen anchor', () => {
    const canvas = fakeCanvas();
    const r = renderer(canvas);
    r.draw({
      video,
      cam,
      particles: [bill({ x: 0, y: 0, z: 0 }, { stuck: true, u: 0.5, v2: 0.5, restZ: 1.4 })],
      shake: { x: 0, y: 0 },
    });
    expect(canvas.ctx.calls.transform).toBeGreaterThan(0);
  });
});
