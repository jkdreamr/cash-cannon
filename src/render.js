// Canvas 2D renderer for the 3D scene.
//
// Notes are real rectangles in space: their corners are projected through the
// camera, so perspective, foreshortening and edge-on views fall out of the
// geometry. The face artwork is pre-rendered once (see billart.js) and blitted
// per note, which is what makes engraving-level detail affordable at a hundred
// notes a frame.

import { cross, scale, dot, normalize } from './vec3.js';
import { project } from './camera3d.js';
import { BILL_LONG, BILL_SHORT, stuckWorld } from './physics.js';
import { createBillArt } from './billart.js';

// Light from the upper front, so notes flash as they tumble.
const LIGHT = normalize({ x: -0.3, y: -0.62, z: -0.72 });

export function createRenderer(canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  const makeCanvas = options.createCanvas || (() => document.createElement('canvas'));
  // Built lazily so the module can be loaded without a DOM.
  let art = options.art || null;
  let cut = null;
  let cutCtx = null;

  function ensureArt() {
    if (!art) art = createBillArt({ createCanvas: makeCanvas });
    return art;
  }

  function drawMirrored(target, image, w, h) {
    target.save();
    target.translate(w, 0);
    target.scale(-1, 1);
    target.drawImage(image, 0, 0, w, h);
    target.restore();
  }

  // The person, cut out of the video by the segmentation stencil.
  function drawPerson(video, stencil, w, h) {
    if (!cut) {
      cut = makeCanvas();
      cutCtx = cut.getContext('2d');
    }
    if (cut.width !== w || cut.height !== h) {
      cut.width = w;
      cut.height = h;
    }
    cutCtx.setTransform(1, 0, 0, 1, 0, 0);
    cutCtx.clearRect(0, 0, w, h);
    drawMirrored(cutCtx, video, w, h);
    cutCtx.globalCompositeOperation = 'destination-in';
    cutCtx.imageSmoothingEnabled = true;
    drawMirrored(cutCtx, stencil, w, h);
    cutCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(cut, 0, 0);
  }

  function draw(state) {
    const {
      video, cam, particles, personStencil = null, personZ = null,
      shake = { x: 0, y: 0 },
    } = state;
    const w = cam.width;
    const h = cam.height;
    const sheet = ensureArt();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (video && video.readyState >= 2) {
      drawMirrored(ctx, video, w, h);
    } else {
      ctx.fillStyle = '#07100b';
      ctx.fillRect(0, 0, w, h);
    }

    const items = [];
    for (const p of particles) {
      const pos = p.stuck ? stuckWorld(p, cam) : p.p;
      items.push({ p, pos });
    }
    items.sort((a, b) => b.pos.z - a.pos.z);

    const dt = state.dt || 0;
    const canOcclude = personStencil && personZ != null;
    ctx.save();
    ctx.translate(shake.x, shake.y);

    if (canOcclude) {
      // Money resting ON someone lies on the surface facing the lens, so it is
      // never hidden by them however its stored depth compares to the body's
      // current one. Sorting it purely by depth made notes sink into the body
      // as that estimate drifted.
      for (const it of items) {
        if (!it.p.stuck && it.pos.z > personZ) drawNote(ctx, cam, it.p, it.pos, sheet, dt);
      }
      ctx.restore();
      drawPerson(video, personStencil, w, h);
      ctx.save();
      ctx.translate(shake.x, shake.y);
      for (const it of items) {
        if (it.p.stuck || it.pos.z <= personZ) drawNote(ctx, cam, it.p, it.pos, sheet, dt);
      }
    } else {
      for (const it of items) drawNote(ctx, cam, it.p, it.pos, sheet, dt);
    }

    ctx.restore();
  }

  return { draw };
}

function hairline(ctx, ax, ay, bx, by, thickness, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#cdc6b0';
  ctx.lineWidth = Math.max(1, thickness + 0.9);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.restore();
}

// A note leaving a finger crosses a large part of its own length every frame.
// A real camera records that as a streak; drawing a single hard copy instead
// makes the money look like it pops into existence away from the hand. These
// are the intermediate positions the note actually occupied during the frame.
const GHOSTS = [0.75, 0.5, 0.25];

// Paper laid over a head or a shoulder is not a rigid plate: it takes the shape
// of what it is lying on, with the ends drooping away over the curve. Drawing a
// resting note as one flat quad is what made it read as a blade stuck through
// somebody. The note is split along its length and each piece follows the sag,
// which is also what lets you see any of its face when it is lying flat on top
// of a head.
const DRAPE_STRIPS = 6;
// A note over a curve of radius R bends through arc L/R, dropping its ends by
// R(1-cos(arc/2)). Over a head that is about 0.09 of the note's length, over a
// shoulder slightly less. Anything near 0.17 reads as a croissant.
const DRAPE_SAG = BILL_LONG * 0.09;

// The contact shadow a resting note casts onto whatever it is lying on. Without
// it the money reads as painted over the picture rather than sitting on it.
function drawRestingShadow(ctx, cam, p, pos) {
  const half = BILL_LONG / 2;
  const shortAxis = cross(p.n, p.t);
  const a = project(cam, {
    x: pos.x - p.t.x * half - (shortAxis.x * BILL_SHORT) / 2,
    y: pos.y - p.t.y * half - (shortAxis.y * BILL_SHORT) / 2 + DRAPE_SAG,
    z: pos.z - p.t.z * half - (shortAxis.z * BILL_SHORT) / 2,
  });
  const b = project(cam, {
    x: pos.x + p.t.x * half - (shortAxis.x * BILL_SHORT) / 2,
    y: pos.y + p.t.y * half - (shortAxis.y * BILL_SHORT) / 2 + DRAPE_SAG,
    z: pos.z + p.t.z * half - (shortAxis.z * BILL_SHORT) / 2,
  });
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(span > 2) || span > 4000) return;
  ctx.save();
  ctx.globalAlpha = 0.26;
  ctx.strokeStyle = '#0d1510';
  ctx.lineWidth = Math.max(2, span * 0.075);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y + ctx.lineWidth * 0.35);
  ctx.lineTo(b.x, b.y + ctx.lineWidth * 0.35);
  ctx.stroke();
  ctx.restore();
}

function drawDraped(ctx, cam, p, pos, sheet) {
  const half = BILL_LONG / 2;
  const shortAxis = cross(p.n, p.t);
  const sx = (shortAxis.x * BILL_SHORT) / 2;
  const sy = (shortAxis.y * BILL_SHORT) / 2;
  const sz = (shortAxis.z * BILL_SHORT) / 2;

  // Centre line of the note, bowed so the far ends hang lower.
  const spine = (a) => ({
    x: pos.x + p.t.x * a * half,
    y: pos.y + p.t.y * a * half + DRAPE_SAG * a * a,
    z: pos.z + p.t.z * a * half,
  });

  const toCam = normalize({ x: -pos.x, y: -pos.y, z: -pos.z });
  const back = dot(p.n, toCam) < 0;
  const faces = back ? sheet.back : sheet.front;
  const tex = faces[(p.variant || 0) % faces.length];
  const shade = 0.58 + 0.42 * Math.min(1, Math.abs(dot(p.n, LIGHT)));
  const texW = tex.width || sheet.width;
  const texH = tex.height || sheet.height;

  for (let i = 0; i < DRAPE_STRIPS; i++) {
    const a0 = (i / DRAPE_STRIPS) * 2 - 1;
    const a1 = ((i + 1) / DRAPE_STRIPS) * 2 - 1;
    const m0 = spine(a0);
    const m1 = spine(a1);

    const q0 = project(cam, { x: m0.x - sx, y: m0.y - sy, z: m0.z - sz });
    const q1 = project(cam, { x: m1.x - sx, y: m1.y - sy, z: m1.z - sz });
    const q2 = project(cam, { x: m0.x + sx, y: m0.y + sy, z: m0.z + sz });

    let ox = q0.x;
    let oy = q0.y;
    let e1x = q1.x - q0.x;
    let e1y = q1.y - q0.y;
    let e2x = q2.x - q0.x;
    let e2y = q2.y - q0.y;
    const bw = Math.hypot(e1x, e1y);
    const bh = Math.hypot(e2x, e2y);
    if (bw < 0.4 || bh < 0.4 || bw > 4000 || bh > 4000) continue;
    if (e1x * e2y - e1y * e2x < 0) {
      ox = q2.x;
      oy = q2.y;
      e2x = -e2x;
      e2y = -e2y;
    }

    ctx.save();
    ctx.transform(e1x / bw, e1y / bw, e2x / bh, e2y / bh, ox, oy);
    // The matching slice of the printed note. The long axis runs along the
    // texture's width, and seen from the back the slices run the other way, so
    // the artwork bends with the paper instead of sliding across it. Strips
    // overlap by a fraction of a pixel to avoid seams between them.
    const sliceW = texW / DRAPE_STRIPS;
    const srcX = back ? texW - (i + 1) * sliceW : i * sliceW;
    ctx.drawImage(tex, srcX, 0, sliceW, texH, 0, 0, bw + 0.6, bh);
    if (shade < 0.99) {
      ctx.globalAlpha = (1 - shade) * 0.95;
      ctx.fillStyle = '#12180f';
      ctx.fillRect(0, 0, bw + 0.6, bh);
    }
    ctx.restore();
  }
}

function drawNote(ctx, cam, p, pos, sheet, dt) {
  if (p.stuck) {
    drawRestingShadow(ctx, cam, p, pos);
    drawDraped(ctx, cam, p, pos, sheet);
    return;
  }
  if (!dt || !p.v) {
    drawBill(ctx, cam, p, pos, sheet);
    return;
  }

  // How far it moved on screen during the frame just rendered.
  const back = { x: pos.x - p.v.x * dt, y: pos.y - p.v.y * dt, z: pos.z - p.v.z * dt };
  if (back.z <= 0.06) {
    drawBill(ctx, cam, p, pos, sheet);
    return;
  }
  const a = project(cam, pos);
  const b = project(cam, back);
  const travel = Math.hypot(a.x - b.x, a.y - b.y);
  const noteWidth = (cam.f * BILL_LONG) / pos.z;

  if (travel > noteWidth * 0.35) {
    for (const f of GHOSTS) {
      drawBill(
        ctx, cam, p,
        { x: pos.x - p.v.x * dt * f, y: pos.y - p.v.y * dt * f, z: pos.z - p.v.z * dt * f },
        sheet,
        0.38 * (1 - f * 0.5)
      );
    }
  }
  drawBill(ctx, cam, p, pos, sheet);
}

function drawBill(ctx, cam, p, pos, sheet, fade = 1) {
  if (pos.z <= 0.06) return;

  const long = scale(p.t, BILL_LONG / 2);
  const shortAxis = cross(p.n, p.t);
  const short = scale(shortAxis, BILL_SHORT / 2);

  const c0 = project(cam, { x: pos.x - long.x - short.x, y: pos.y - long.y - short.y, z: pos.z - long.z - short.z });
  const c1 = project(cam, { x: pos.x + long.x - short.x, y: pos.y + long.y - short.y, z: pos.z + long.z - short.z });
  const c3 = project(cam, { x: pos.x - long.x + short.x, y: pos.y - long.y + short.y, z: pos.z - long.z + short.z });

  let ox = c0.x;
  let oy = c0.y;
  let e1x = c1.x - c0.x;
  let e1y = c1.y - c0.y;
  let e2x = c3.x - c0.x;
  let e2y = c3.y - c0.y;
  const bw = Math.hypot(e1x, e1y);
  const bh = Math.hypot(e2x, e2y);
  if (bw > 6000 || bh > 6000) return;

  // Distance haze, so deep notes settle into the background.
  const alpha = (pos.z > 4 ? Math.max(0.25, 1 - (pos.z - 4) / 7) : 1) * fade;

  // Turning edge-on, the note becomes its own paper edge. Banknote stock is
  // 0.11 mm thick, which is a quarter of a pixel even at arm's length, so a
  // note square-on to the lens genuinely disappears rather than becoming a
  // crisp line. Fading it out as it closes up gives the flicker real money has
  // while it tumbles, instead of leaving hard slivers lying about the frame.
  const FADE = 4;
  if (bh < FADE && bw >= FADE) {
    hairline(ctx, c0.x, c0.y, c1.x, c1.y, bh, alpha * 0.7 * (bh / FADE));
    return;
  }
  if (bw < FADE && bh >= FADE) {
    hairline(ctx, c0.x, c0.y, c3.x, c3.y, bw, alpha * 0.7 * (bw / FADE));
    return;
  }
  if (bw < FADE && bh < FADE) return;

  // A note seen from one side yields a left-handed screen basis, which makes
  // the canvas mirror everything drawn into it. Re-anchor to the opposite
  // corner so the artwork is never rendered back to front.
  if (e1x * e2y - e1y * e2x < 0) {
    ox = c3.x;
    oy = c3.y;
    e2x = -e2x;
    e2y = -e2y;
  }

  const ux = e1x / bw;
  const uy = e1y / bw;
  const vx = e2x / bh;
  const vy = e2y / bh;

  const toCam = normalize({ x: -pos.x, y: -pos.y, z: -pos.z });
  const back = dot(p.n, toCam) < 0;
  const faces = back ? sheet.back : sheet.front;
  const tex = faces[(p.variant || 0) % faces.length];

  // Lambert term. Notes catch the light as they tumble.
  const shade = 0.58 + 0.42 * Math.min(1, Math.abs(dot(p.n, LIGHT)));

  // Resting notes never reach here: they are drawn draped over whatever they
  // are lying on, with their own contact shadow.

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.transform(ux, uy, vx, vy, ox, oy);
  ctx.drawImage(tex, 0, 0, bw, bh);

  // Shade by darkening rather than washing with white: currency has no pure
  // white on it, and a straight-edged white band is an obvious shader hack.
  if (shade < 0.99) {
    ctx.globalAlpha = alpha * (1 - shade) * 0.95;
    ctx.fillStyle = '#12180f';
    ctx.fillRect(0, 0, bw, bh);
  }
  ctx.restore();
}
