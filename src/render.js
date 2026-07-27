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
  if (p.kind === 'flash') {
    drawFlash(ctx, cam, p, pos);
    return;
  }
  drawBill(ctx, cam, p, pos);
}

function drawFlash(ctx, cam, p, pos) {
  const s = project(cam, pos);
  const a = Math.max(0, p.life / p.maxLife);
  const r = Math.max(2, p.r * s.scale * (0.7 + 0.6 * a));
  const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
  g.addColorStop(0, `rgba(255,250,220,${0.75 * a})`);
  g.addColorStop(0.45, `rgba(255,214,110,${0.4 * a})`);
  g.addColorStop(1, 'rgba(255,190,60,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawBill(ctx, cam, p, pos) {
  const long = scale(p.t, BILL_LONG / 2);
  const shortAxis = cross(p.n, p.t);
  const short = scale(shortAxis, BILL_SHORT / 2);

  // Four corners of the note in space, then projected.
  const c0 = project(cam, { x: pos.x - long.x - short.x, y: pos.y - long.y - short.y, z: pos.z - long.z - short.z });
  const c1 = project(cam, { x: pos.x + long.x - short.x, y: pos.y + long.y - short.y, z: pos.z + long.z - short.z });
  const c3 = project(cam, { x: pos.x - long.x + short.x, y: pos.y - long.y + short.y, z: pos.z - long.z + short.z });

  const e1x = c1.x - c0.x;
  const e1y = c1.y - c0.y;
  const e2x = c3.x - c0.x;
  const e2y = c3.y - c0.y;
  const bw = Math.hypot(e1x, e1y);
  const bh = Math.hypot(e2x, e2y);
  if (bw < 1 || bw > 4000) return;

  // Distance haze, so deep notes settle into the background.
  const alpha = pos.z > 4 ? Math.max(0.25, 1 - (pos.z - 4) / 7) : 1;

  // Edge-on: the note is a hairline. Drawing the quad would vanish, so draw the
  // paper edge instead, which is what you actually see.
  if (bh < 1.6) {
    ctx.save();
    ctx.globalAlpha = alpha * 0.85;
    ctx.strokeStyle = '#2f9b64';
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
  const shade = 0.52 + 0.48 * Math.min(1, Math.abs(facing));
  // Which side are we looking at?
  const toCam = normalize({ x: -pos.x, y: -pos.y, z: -pos.z });
  const back = dot(p.n, toCam) < 0;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.transform(ux, uy, vx, vy, c0.x, c0.y);

  const g = ctx.createLinearGradient(0, 0, 0, bh);
  if (back) {
    g.addColorStop(0, tint(0x2f, 0x8d, 0x5e, shade));
    g.addColorStop(1, tint(0x1a, 0x66, 0x42, shade));
  } else {
    g.addColorStop(0, tint(0x46, 0xb8, 0x7c, shade));
    g.addColorStop(1, tint(0x23, 0x82, 0x53, shade));
  }
  ctx.fillStyle = g;
  roundRect(ctx, 0, 0, bw, bh, Math.min(bw, bh) * 0.08);
  ctx.fill();

  if (bw > 26) {
    ctx.strokeStyle = `rgba(232,255,240,${0.42 * shade})`;
    ctx.lineWidth = Math.max(0.6, bw * 0.012);
    roundRect(ctx, bw * 0.05, bh * 0.1, bw * 0.9, bh * 0.8, Math.min(bw, bh) * 0.05);
    ctx.stroke();

    // Portrait oval and denomination, only when big enough to read.
    ctx.fillStyle = `rgba(240,255,246,${0.16 * shade})`;
    ctx.beginPath();
    ctx.ellipse(bw * 0.5, bh * 0.5, bw * 0.13, bh * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (bw > 46 && !back) {
    ctx.fillStyle = `rgba(238,255,244,${0.92 * shade})`;
    ctx.font = `bold ${Math.round(bh * 0.3)}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$100', bw * 0.24, bh * 0.5);
  }

  // A soft sheen across the upper half sells the paper.
  ctx.fillStyle = `rgba(255,255,255,${0.1 * shade})`;
  roundRect(ctx, 0, 0, bw, bh * 0.42, Math.min(bw, bh) * 0.06);
  ctx.fill();

  ctx.restore();
}

function tint(r, g, b, k) {
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
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
