import { describe, expect, test } from 'vitest';
import { createRenderer } from '../src/render.js';
import { createCamera } from '../src/camera3d.js';

const cam = createCamera(1280, 720);

function fakeCtx() {
  const calls = { clearRect: 0, fill: 0, drawImage: 0, stroke: 0, fillText: 0, transform: 0, clip: 0 };
  const transforms = [];
  const alphas = [];
  const images = [];
  const path = [];
  const clips = [];
  const grad = { addColorStop() {} };
  return {
    calls,
    transforms,
    alphas,
    images,
    clips,
    setTransform() {},
    transform(a, b, c, d, e, f) { calls.transform++; transforms.push([a, b, c, d, e, f]); },
    clearRect() { calls.clearRect++; },
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
    beginPath() { path.length = 0; },
    closePath() {},
    moveTo(x, y) { path.push([x, y]); },
    lineTo(x, y) { path.push([x, y]); },
    clip() { calls.clip++; clips.push(path.slice()); },
    arc() {}, arcTo() {}, ellipse() {},
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
    // The camera feed, then the printed artwork. A note large enough on screen
    // is drawn as a bowed sheet in several strips rather than one flat quad,
    // so this counts at least one blit per note beyond the feed.
    expect(canvas.ctx.calls.drawImage).toBeGreaterThan(2);
    expect(canvas.ctx.calls.transform).toBeGreaterThanOrEqual(2);
    expect(canvas.ctx.images[0]).toBe(video);
  });

  test('a small distant note stays a single quad rather than paying for strips', () => {
    const canvas = fakeCanvas();
    const r = renderer(canvas);
    r.draw({ video, cam, particles: [bill({ x: 0, y: 0, z: 9 })], shake: { x: 0, y: 0 } });
    // Feed plus exactly one blit: at this size the bend is under a pixel.
    expect(canvas.ctx.calls.drawImage).toBe(2);
    expect(canvas.ctx.calls.transform).toBe(1);
  });

  test('a note in flight is drawn bowed, not as a flat card', () => {
    const canvas = fakeCanvas();
    const r = renderer(canvas);
    r.draw({ video, cam, particles: [bill({ x: 0, y: 0, z: 1.2 })], shake: { x: 0, y: 0 } });
    // Several strips, each its own slice of the printed note.
    expect(canvas.ctx.calls.transform).toBeGreaterThan(2);
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

  test('the print is laid on the paper the right way up, not turned end for end', () => {
    // A determinant test cannot see this. Turning a note through 180 degrees
    // flips both texture axes, so the handedness is unchanged and the artwork
    // still comes out upside down. What pins it is where a known corner of the
    // print lands: for a note square-on with its length along screen x, the
    // top-left of the print has to be up and to the left of the note's centre.
    const canvas = fakeCanvas();
    const r = renderer(canvas);
    r.draw({
      video,
      cam,
      particles: [bill({ x: 0, y: 0, z: 0 }, {
        stuck: true, u: 0.5, v2: 0.5, restZ: 1.0, site: 'shoulder', tone: 0.5,
        n: { x: 0, y: 0, z: -1 }, t: { x: 1, y: 0, z: 0 },
      })],
      shake: { x: 0, y: 0 },
    });
    // The first triangle starts at texture (0,0), so the transform's offset is
    // exactly where the print's top-left corner was placed on screen.
    const [, , , , e, f] = canvas.ctx.transforms[0];
    expect(e).toBeLessThan(cam.cx); // left of centre
    expect(f).toBeLessThan(cam.cy); // above centre
  });

  test('a fold is drawn as joined-up triangles, so it cannot tear open', () => {
    // Each strip used to be one parallelogram, whose fourth corner is implied
    // rather than projected. Under perspective that corner does not agree with
    // the neighbouring strip's, so the note came apart into slits with the body
    // showing through. Triangles that share their corners cannot do that.
    const canvas = fakeCanvas();
    const r = renderer(canvas);
    r.draw({
      video,
      cam,
      // Square-on and close, so the fold is wide on screen and every strip
      // shows the same face.
      particles: [bill({ x: 0, y: 0, z: 0 }, {
        stuck: true, u: 0.5, v2: 0.5, restZ: 0.6, site: 'head', tone: 0.5,
        n: { x: 0, y: 0, z: -1 }, t: { x: 1, y: 0, z: 0 },
      })],
      shake: { x: 0, y: 0 },
    });
    // Two clipped triangles per strip of the fold.
    expect(canvas.ctx.calls.clip).toBe(canvas.ctx.calls.transform);
    const tri = canvas.ctx.transforms;
    expect(tri.length).toBeGreaterThanOrEqual(8);
    expect(tri.length % 2).toBe(0);
    // Every strip is showing the same side of the paper here, so the texture
    // runs straight across and the slice boundaries are known.
    expect(new Set(canvas.ctx.images.slice(1)).size).toBe(1);

    // Where a triangle puts a given point of the print. Neighbours that share
    // that point of the paper must put it in the same place, or the note has a
    // hole along the join.
    const at = (m, u, v) => ({ x: m[0] * u + m[2] * v + m[4], y: m[1] * u + m[3] * v + m[5] });
    const strips = tri.length / 2;
    const sliceW = fakeArt.width / strips;
    const texH = fakeArt.height;

    for (let i = 0; i < strips; i++) {
      const seam = (i + 1) * sliceW;
      // The two triangles of one strip meet along the diagonal.
      const d1 = at(tri[i * 2], seam, texH);
      const d2 = at(tri[i * 2 + 1], seam, texH);
      expect(d1.x).toBeCloseTo(d2.x, 6);
      expect(d1.y).toBeCloseTo(d2.y, 6);
      if (i === strips - 1) continue;
      // And this strip's far edge is the next strip's near edge, top corner...
      const a1 = at(tri[i * 2], seam, 0);
      const b1 = at(tri[(i + 1) * 2], seam, 0);
      expect(a1.x).toBeCloseTo(b1.x, 6);
      expect(a1.y).toBeCloseTo(b1.y, 6);
      // ...and bottom corner, which is the one the old parallelogram implied
      // rather than projected, and therefore got wrong.
      const a2 = at(tri[i * 2], seam, texH);
      const b2 = at(tri[(i + 1) * 2 + 1], seam, texH);
      expect(a2.x).toBeCloseTo(b2.x, 6);
      expect(a2.y).toBeCloseTo(b2.y, 6);
    }
  });

  test('a contact shadow is masked to the body, never cast on the room', () => {
    // A shadow exists on a surface or not at all. Stroked straight onto the
    // frame, the shadow of a note perched on the edge of a shoulder ran off the
    // body and darkened the background behind it.
    const canvas = fakeCanvas();
    const r = renderer(canvas);
    const stencil = { width: 16, height: 16 };
    r.draw({
      video,
      cam,
      particles: [bill({ x: 0, y: 0, z: 0 }, { stuck: true, u: 0.5, v2: 0.45, restZ: 1.2, site: 'shoulder' })],
      personStencil: stencil,
      personZ: 1.2,
      shake: { x: 0, y: 0 },
    });
    // Nothing is stroked onto the visible frame itself.
    expect(canvas.ctx.calls.stroke).toBe(0);
    // The shadow went to its own layer, which was then masked by the stencil
    // and composited: that layer is a canvas, and the stencil was drawn into it.
    const layers = canvas.ctx.images.filter((i) => i && typeof i.getContext === 'function');
    expect(layers.length).toBeGreaterThanOrEqual(2); // person cut-out, shadow layer
  });

  test('a note folds further over a tight curve than over a broad one', () => {
    // How deeply paper drapes is set by the radius it is lying over, and a body
    // offers several: a forearm is a tighter curve than a skull, and a skull
    // than the shelf of a shoulder. One sag for all of them made every resting
    // note bend into the same arc.
    const depth = (site) => {
      const canvas = fakeCanvas();
      const r = renderer(canvas);
      r.draw({
        video,
        cam,
        // Face-on and level, so the whole bend shows as vertical spread.
        particles: [bill({ x: 0, y: 0, z: 0 }, {
          stuck: true, u: 0.5, v2: 0.5, restZ: 1.2, site, tone: 0.5,
          n: { x: 0, y: -1, z: 0 }, t: { x: 1, y: 0, z: 0 },
        })],
        shake: { x: 0, y: 0 },
      });
      // Each strip of the bend is placed by its own transform; how far they
      // spread vertically is the depth of the fold on screen.
      const ys = canvas.ctx.transforms.map((m) => m[5]);
      return Math.max(...ys) - Math.min(...ys);
    };

    expect(depth('forearm')).toBeGreaterThan(depth('head'));
    expect(depth('head')).toBeGreaterThan(depth('shoulder'));
    // And an untracked surface still folds, rather than lying dead flat.
    expect(depth('silhouette')).toBeGreaterThan(0);
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
