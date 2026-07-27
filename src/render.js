// Canvas 2D renderer for the 3D scene.
//
// Notes are drawn as real rectangles in space: their four corners are projected
// through the camera, so perspective, foreshortening and edge-on views all come
// out of the geometry rather than being faked. Depth sorting plus a cut-out of
// the person gives correct occlusion, so money can pass behind you.

import { cross, scale, dot, normalize } from './vec3.js';
import { project } from './camera3d.js';
import { BILL_LONG, BILL_SHORT, stuckWorld } from './physics.js';

// Light from the upper front, so notes flash as they tumble.
const LIGHT = normalize({ x: -0.3, y: -0.62, z: -0.72 });

export function createRenderer(canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  // The cut-out buffer is only needed once something is actually behind the
  // person, so it is created lazily and can be injected for testing.
  const makeCanvas = options.createCanvas || (() => document.createElement('canvas'));
  let cut = null;
  let cutCtx = null;

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

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (video && video.readyState >= 2) {
      drawMirrored(ctx, video, w, h);
    } else {
      ctx.fillStyle = '#07100b';
      ctx.fillRect(0, 0, w, h);
    }

    // Resolve a world position for every particle, then sort far to near.
    const items = [];
    for (const p of particles) {
      const pos = p.stuck ? stuckWorld(p, cam) : p.p;
      items.push({ p, pos });
    }
    items.sort((a, b) => b.pos.z - a.pos.z);

    const canOcclude = personStencil && personZ != null;
    ctx.save();
    ctx.translate(shake.x, shake.y);

    if (canOcclude) {
      let i = 0;
      // Behind the person.
      for (; i < items.length && items[i].pos.z > personZ; i++) {
        drawParticle(ctx, cam, items[i].p, items[i].pos);
      }
      ctx.restore();
      drawPerson(video, personStencil, w, h);
      ctx.save();
      ctx.translate(shake.x, shake.y);
      // In front of the person, including anything resting on them.
      for (; i < items.length; i++) {
        drawParticle(ctx, cam, items[i].p, items[i].pos);
      }
    } else {
      for (const it of items) drawParticle(ctx, cam, it.p, it.pos);
    }

    ctx.restore();
  }

  return { draw };
}

function drawParticle(ctx, cam, p, pos) {
  if (pos.z <= 0.05) return;
  drawBill(ctx, cam, p, pos);
}

function drawBill(ctx, cam, p, pos) {
  const long = scale(p.t, BILL_LONG / 2);
  const shortAxis = cross(p.n, p.t);
  const short = scale(shortAxis, BILL_SHORT / 2);

  // Four corners of the note in space, then projected.
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
  if (bw < 1 || bw > 4000) return;

  // A note seen from one side yields a left-handed screen basis, which makes
  // the canvas mirror everything drawn into it. Re-anchor to the opposite
  // corner so the artwork is never rendered back to front.
  if (e1x * e2y - e1y * e2x < 0) {
    ox = c3.x;
    oy = c3.y;
    e2x = -e2x;
    e2y = -e2y;
  }

  // Distance haze, so deep notes settle into the background.
  const alpha = pos.z > 4 ? Math.max(0.25, 1 - (pos.z - 4) / 7) : 1;

  // Edge-on: the note is a hairline. Drawing the quad would vanish, so draw the
  // paper edge instead, which is what you actually see.
  if (bh < 1.6) {
    ctx.save();
    ctx.globalAlpha = alpha * 0.85;
    ctx.strokeStyle = '#b9c2a6';
    ctx.lineWidth = Math.max(1, bh + 0.9);
    ctx.beginPath();
    ctx.moveTo(c0.x, c0.y);
    ctx.lineTo(c1.x, c1.y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const ux = e1x / bw;
  const uy = e1y / bw;
  const vx = e2x / bh;
  const vy = e2y / bh;

  // Lambert shading on the note face, so it glints while tumbling.
  const facing = dot(p.n, LIGHT);
  const shade = 0.55 + 0.45 * Math.min(1, Math.abs(facing));
  // Which side are we looking at?
  const toCam = normalize({ x: -pos.x, y: -pos.y, z: -pos.z });
  const back = dot(p.n, toCam) < 0;

  // Real currency paper is a pale desaturated sage, not a vivid green. Each
  // note is nudged slightly so a drift of them does not read as clones.
  const tone = p.tone || 0;
  const k = shade * (0.94 + tone * 0.12);
  const paper = back ? rgb(184, 198, 172, k) : rgb(206, 212, 189, k);
  const ink = back ? rgb(58, 92, 68, k) : rgb(62, 88, 68, k);

  // A note lying on someone casts a small shadow onto them. Without this
  // contact cue the money reads as pasted over the picture.
  if (p.stuck) {
    const off = Math.max(1.5, bw * 0.035);
    ctx.save();
    ctx.globalAlpha = alpha * 0.28;
    ctx.transform(ux, uy, vx, vy, ox + off * 0.5, oy + off);
    ctx.fillStyle = '#0d1a10';
    roundRect(ctx, 0, 0, bw, bh, Math.min(bw, bh) * 0.06);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.transform(ux, uy, vx, vy, ox, oy);

  ctx.fillStyle = paper;
  roundRect(ctx, 0, 0, bw, bh, Math.min(bw, bh) * 0.06);
  ctx.fill();

  if (bw > 18) {
    // Engraved border.
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(0.5, bw * 0.008);
    ctx.globalAlpha = alpha * 0.75;
    roundRect(ctx, bw * 0.045, bh * 0.09, bw * 0.91, bh * 0.82, Math.min(bw, bh) * 0.04);
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }

  if (bw > 34) {
    if (back) {
      // Reverse: the engraved hall, a low wide block with a pediment.
      ctx.fillStyle = rgb(96, 128, 100, k);
      ctx.globalAlpha = alpha * 0.5;
      ctx.fillRect(bw * 0.3, bh * 0.42, bw * 0.4, bh * 0.3);
      ctx.fillRect(bw * 0.45, bh * 0.26, bw * 0.1, bh * 0.18);
      ctx.globalAlpha = alpha;
    } else {
      // Obverse: portrait oval left of centre, seal to the right.
      ctx.fillStyle = rgb(104, 116, 98, k);
      ctx.globalAlpha = alpha * 0.55;
      ctx.beginPath();
      ctx.ellipse(bw * 0.42, bh * 0.52, bw * 0.115, bh * 0.31, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = alpha * 0.4;
      ctx.beginPath();
      ctx.ellipse(bw * 0.63, bh * 0.55, bw * 0.05, bh * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = alpha;
    }
  }

  // Corner denominations, the way a real note is marked.
  if (bw > 56) {
    ctx.fillStyle = ink;
    ctx.globalAlpha = alpha * 0.85;
    const fs = Math.max(4, Math.round(bh * 0.17));
    ctx.font = `${fs}px Georgia, "Times New Roman", serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('100', bw * 0.08, bh * 0.2);
    ctx.textAlign = 'right';
    ctx.fillText('100', bw * 0.92, bh * 0.8);
    ctx.globalAlpha = alpha;
  }

  // Fine engraving lines only once the note is large enough to show them.
  if (bw > 90) {
    ctx.strokeStyle = ink;
    ctx.globalAlpha = alpha * 0.18;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let i = 1; i <= 3; i++) {
      const y = bh * (0.2 + i * 0.16);
      ctx.moveTo(bw * 0.08, y);
      ctx.lineTo(bw * 0.34, y);
    }
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }

  // A faint sheen across the top, which is how paper catches the light.
  ctx.fillStyle = `rgba(255,255,255,${0.07 * shade})`;
  roundRect(ctx, 0, 0, bw, bh * 0.4, Math.min(bw, bh) * 0.05);
  ctx.fill();

  ctx.restore();
}

function rgb(r, g, b, k) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
