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
  let shadowLayer = null;
  let shadowCtx = null;

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

  // Contact shadows, masked to the person. A shadow exists on a surface or not
  // at all: drawn straight onto the frame, the shadow of a note perched on the
  // edge of a shoulder ran off the body and darkened the room behind it.
  function drawShadows(items, cam, stencil, w, h, shake) {
    if (!shadowLayer) {
      shadowLayer = makeCanvas();
      shadowCtx = shadowLayer.getContext('2d');
    }
    if (shadowLayer.width !== w || shadowLayer.height !== h) {
      shadowLayer.width = w;
      shadowLayer.height = h;
    }
    shadowCtx.setTransform(1, 0, 0, 1, 0, 0);
    shadowCtx.clearRect(0, 0, w, h);
    let any = false;
    shadowCtx.save();
    shadowCtx.translate(shake.x, shake.y);
    for (const it of items) {
      if (!it.p.stuck) continue;
      if (drawRestingShadow(shadowCtx, cam, it.p, it.pos, drapeBend(it.p))) any = true;
    }
    shadowCtx.restore();
    if (!any) return;
    shadowCtx.globalCompositeOperation = 'destination-in';
    drawMirrored(shadowCtx, stencil, w, h);
    shadowCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(shadowLayer, 0, 0);
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
      const pos = p.stuck ? stuckWorld(p, cam, personZ) : p.p;
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
      drawShadows(items, cam, personStencil, w, h, shake);
      ctx.save();
      ctx.translate(shake.x, shake.y);
      for (const it of items) {
        if (it.p.stuck || it.pos.z <= personZ) drawNote(ctx, cam, it.p, it.pos, sheet, dt, false);
      }
    } else {
      for (const it of items) drawNote(ctx, cam, it.p, it.pos, sheet, dt);
    }

    ctx.restore();
  }

  return { draw };
}

function hairline(ctx, pts, thickness, alpha) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#cdc6b0';
  ctx.lineWidth = Math.max(1, thickness + 0.9);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
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

// A note laid over a curve of radius R bends through an arc of L/R and its ends
// drop by R(1 - cos(L/2R)). What R is depends entirely on which part of a body
// caught it, so there is no single right sag: a crown is a tighter curve than a
// shoulder, and a forearm is tighter than either.
const DRAPE_RADIUS = {
  head: 0.09,       // m, a skull
  shoulder: 0.10,   // the trapezius shelf, a broad gentle curve
  forearm: 0.045,
  silhouette: 0.10, // no pose reading, so assume the gentle case
};

function drapeFor(p) {
  const r = DRAPE_RADIUS[p.site] || DRAPE_RADIUS.silhouette;
  // Past a quarter turn the paper has wrapped over the top of the curve and
  // hangs down its far side, so the drop stops growing at the radius itself.
  const half = Math.min(BILL_LONG / (2 * r), Math.PI / 2);
  // Notes never land identically, so vary each one a little around that.
  return r * (1 - Math.cos(half)) * (0.8 + (p.tone || 0.5) * 0.4);
}

// The contact shadow a resting note casts onto whatever it is lying on. Without
// it the money reads as painted over the picture rather than sitting on it.
//
// It follows the note's bow. Drawn as one straight line between the two
// drooping ends it cut under the middle of the note, where the paper rises, and
// read as a dark bar lying on the body by itself.
const SHADOW_SAMPLES = 5;
const SHADOW_DROP = 0.22; // of the sag, so the shadow peeks out below the paper

function drawRestingShadow(ctx, cam, p, pos, bend) {
  const half = BILL_LONG / 2;
  const shortAxis = cross(p.t, p.n);
  const ex = (shortAxis.x * BILL_SHORT) / 2;
  const ey = (shortAxis.y * BILL_SHORT) / 2;
  const ez = (shortAxis.z * BILL_SHORT) / 2;
  const at = (a) => project(cam, {
    x: pos.x + p.t.x * a * half + bend.x * (a * a + SHADOW_DROP) + ex,
    y: pos.y + p.t.y * a * half + bend.y * (a * a + SHADOW_DROP) + ey,
    z: pos.z + p.t.z * a * half + bend.z * (a * a + SHADOW_DROP) + ez,
  });

  const pts = [];
  for (let i = 0; i < SHADOW_SAMPLES; i++) {
    pts.push(at((i / (SHADOW_SAMPLES - 1)) * 2 - 1));
  }
  const span = Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y);
  if (!(span > 2) || span > 4000) return false;

  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = '#0d1510';
  ctx.lineWidth = Math.max(2, span * 0.075);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.restore();
  return true;
}

// One triangle of the printed note, mapped from three of its corners.
//
// A canvas transform is affine, which is exact over a triangle and wrong over a
// quad seen in perspective. Drawing each strip of a fold as a single
// parallelogram was the mistake: the fourth corner is implied rather than
// projected, so neighbouring strips did not meet. Up close the note tore into
// slits with the body showing through, and the guard against mirrored artwork
// fired on some strips and not others, which turned parts of the note upside
// down. Triangles share their corners exactly and cannot come apart.
function drawTexTriangle(ctx, tex, uv, xy, fade, shade) {
  const [u0, v0, u1, v1, u2, v2] = uv;
  const [x0, y0, x1, y1, x2, y2] = xy;
  const du1 = u1 - u0;
  const dv1 = v1 - v0;
  const du2 = u2 - u0;
  const dv2 = v2 - v0;
  const det = du1 * dv2 - du2 * dv1;
  if (!det) return;
  // Screen area: a degenerate sliver is not worth a clip and a blit.
  if (Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) < 0.5) return;

  const a = ((x1 - x0) * dv2 - (x2 - x0) * dv1) / det;
  const c = ((x2 - x0) * du1 - (x1 - x0) * du2) / det;
  const b = ((y1 - y0) * dv2 - (y2 - y0) * dv1) / det;
  const d = ((y2 - y0) * du1 - (y1 - y0) * du2) / det;

  ctx.save();
  ctx.globalAlpha = fade;
  // Grow the clip a hair outward from the centre so adjacent triangles overlap
  // instead of leaving a hairline of background along their shared edge.
  const gx = (x0 + x1 + x2) / 3;
  const gy = (y0 + y1 + y2) / 3;
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const px = [x0, x1, x2][k];
    const py = [y0, y1, y2][k];
    const ex = px - gx;
    const ey = py - gy;
    const l = Math.hypot(ex, ey) || 1;
    const qx = px + (ex / l) * 0.7;
    const qy = py + (ey / l) * 0.7;
    if (k === 0) ctx.moveTo(qx, qy); else ctx.lineTo(qx, qy);
  }
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, x0 - a * u0 - c * v0, y0 - b * u0 - d * v0);
  ctx.drawImage(tex, 0, 0);
  if (shade < 0.99) {
    ctx.globalAlpha = fade * (1 - shade) * 0.95;
    ctx.fillStyle = '#12180f';
    // In texture space, clipped to this triangle.
    ctx.fillRect(0, 0, tex.width, tex.height);
  }
  ctx.restore();
}

function drawCurved(ctx, cam, p, pos, sheet, bend, strips, fade = 1) {
  const half = BILL_LONG / 2;
  // Across the note, oriented so that the edge at -shortAxis is the one the
  // print's top row belongs to. Taking it the other way round put texture row
  // zero along the note's bottom edge, which printed the whole note upside
  // down and left the mapping mirror-handed.
  const shortAxis = cross(p.t, p.n);
  const sx = (shortAxis.x * BILL_SHORT) / 2;
  const sy = (shortAxis.y * BILL_SHORT) / 2;
  const sz = (shortAxis.z * BILL_SHORT) / 2;

  // Centre line of the note, bowed along its length by `bend`.
  const spine = (a) => ({
    x: pos.x + p.t.x * a * half + bend.x * a * a,
    y: pos.y + p.t.y * a * half + bend.y * a * a,
    z: pos.z + p.t.z * a * half + bend.z * a * a,
  });
  // Which way the paper faces partway along the fold. Taking this once for the
  // whole note is what let a folded note show the wrong side of itself.
  const normalAt = (a) => normalize(cross(
    shortAxis,
    { x: p.t.x * half + 2 * bend.x * a, y: p.t.y * half + 2 * bend.y * a, z: p.t.z * half + 2 * bend.z * a }
  ));

  const first = sheet.front[(p.variant || 0) % sheet.front.length];
  const texW = first.width || sheet.width;
  const texH = first.height || sheet.height;
  const sliceW = texW / strips;

  for (let i = 0; i < strips; i++) {
    const a0 = (i / strips) * 2 - 1;
    const a1 = ((i + 1) / strips) * 2 - 1;
    const m0 = spine(a0);
    const m1 = spine(a1);
    // Behind the lens: projecting these gives nonsense coordinates.
    if (m0.z < 0.05 || m1.z < 0.05) continue;

    const mid = spine((a0 + a1) / 2);
    const n = normalAt((a0 + a1) / 2);
    const toCam = normalize({ x: -mid.x, y: -mid.y, z: -mid.z });
    const back = dot(n, toCam) < 0;
    const faces = back ? sheet.back : sheet.front;
    const tex = faces[(p.variant || 0) % faces.length];
    // Shading follows the fold, so a curved note is lit across its bend rather
    // than painted one flat tone.
    const shade = 0.58 + 0.42 * Math.min(1, Math.abs(dot(n, LIGHT)));

    // Seen from behind, the note's length runs the other way across the print.
    const tu0 = back ? texW - i * sliceW : i * sliceW;
    const tu1 = back ? texW - (i + 1) * sliceW : (i + 1) * sliceW;

    const c0 = project(cam, { x: m0.x - sx, y: m0.y - sy, z: m0.z - sz });
    const c1 = project(cam, { x: m1.x - sx, y: m1.y - sy, z: m1.z - sz });
    const c2 = project(cam, { x: m1.x + sx, y: m1.y + sy, z: m1.z + sz });
    const c3 = project(cam, { x: m0.x + sx, y: m0.y + sy, z: m0.z + sz });

    drawTexTriangle(ctx, tex,
      [tu0, 0, tu1, 0, tu1, texH],
      [c0.x, c0.y, c1.x, c1.y, c2.x, c2.y], fade, shade);
    drawTexTriangle(ctx, tex,
      [tu0, 0, tu1, texH, tu0, texH],
      [c0.x, c0.y, c2.x, c2.y, c3.x, c3.y], fade, shade);
  }
}

// No banknote in the air is flat. A money gun's roller curls every note as it
// shears it off the stack, and air pressure keeps it bowed the whole way down,
// which is exactly why they flutter. Drawn as rigid rectangles they read as
// playing cards. The bend is small and about the long axis, the way a note
// curls in the hand.
const AIR_CURL = BILL_LONG * 0.055;

function curlFor(p) {
  // Each note keeps its own curl, so a drift of them is not all one shape.
  const k = AIR_CURL * (0.55 + (p.tone || 0.5) * 0.9);
  return { x: -p.n.x * k, y: -p.n.y * k, z: -p.n.z * k };
}

// Which way a resting note's ends droop. They curl around the surface they are
// lying on, which means away from that surface, not straight down the world
// axis. Bending along world down was wrong whenever the note sat at an angle:
// the fold was no longer square to the paper, so the note squashed along its
// own length instead of bowing, and one end came out sharply kinked.
function drapeBend(p) {
  const k = drapeFor(p);
  return { x: -p.n.x * k, y: -p.n.y * k, z: -p.n.z * k };
}

function drawNote(ctx, cam, p, pos, sheet, dt, withShadow = true) {
  if (p.stuck) {
    const bend = drapeBend(p);
    if (withShadow) drawRestingShadow(ctx, cam, p, pos, bend);
    drawCurved(ctx, cam, p, pos, sheet, bend, DRAPE_STRIPS);
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
    // Along its length, where the paper is curled. Stroked as one straight
    // segment this was the only rigid thing left in the frame, and at any size
    // it read as a scratch on the picture rather than a note turned edge-on.
    const curl = curlFor(p);
    const pts = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 4) * 2 - 1;
      pts.push(project(cam, {
        x: pos.x + long.x * a + curl.x * a * a,
        y: pos.y + long.y * a + curl.y * a * a,
        z: pos.z + long.z * a + curl.z * a * a,
      }));
    }
    hairline(ctx, pts, bh, alpha * 0.7 * (bh / FADE));
    return;
  }
  if (bw < FADE && bh >= FADE) {
    // Across its width, which is short enough that the curl is imperceptible.
    hairline(ctx, [c0, c3], bw, alpha * 0.7 * (bw / FADE));
    return;
  }
  if (bw < FADE && bh < FADE) return;

  // Big enough on screen for the curl to be visible, so draw the note as the
  // bowed sheet it is. Small distant ones stay a single quad, where the bend
  // would be under a pixel and the extra strips would only cost time.
  if (bw > 55) {
    drawCurved(ctx, cam, p, pos, sheet, curlFor(p), 4, alpha);
    return;
  }

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
