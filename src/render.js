const BILL_W = 84;
const BILL_H = 40;

// The bill gradient is identical for every bill (local, origin-centred space),
// so build it once and reuse it instead of allocating one per bill per frame.
let billGrad = null;
function billGradient(ctx) {
  if (!billGrad) {
    billGrad = ctx.createLinearGradient(0, -BILL_H / 2, 0, BILL_H / 2);
    billGrad.addColorStop(0, '#3aa76d');
    billGrad.addColorStop(1, '#1f7a4d');
  }
  return billGrad;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');

  function draw(state) {
    const { video, particles, bounds, shake = { x: 0, y: 0 }, status = [] } = state;
    const w = bounds.width;
    const h = bounds.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Mirrored (selfie) video feed.
    if (video && video.readyState >= 2) {
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();
    } else {
      ctx.fillStyle = '#0b0f0c';
      ctx.fillRect(0, 0, w, h);
    }

    ctx.save();
    ctx.translate(shake.x, shake.y);
    for (const p of particles) drawParticle(ctx, p);
    ctx.restore();

    drawStatus(ctx, status, w);
  }

  return { draw };
}

function drawParticle(ctx, p) {
  const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));

  if (p.kind === 'flash') {
    const r = p.r * (0.6 + 0.8 * (p.life / p.maxLife));
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, `rgba(255,255,220,${alpha})`);
    g.addColorStop(0.5, `rgba(255,210,90,${alpha * 0.7})`);
    g.addColorStop(1, 'rgba(255,180,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (p.kind === 'smoke') {
    ctx.fillStyle = `rgba(190,190,190,${alpha * 0.22})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (p.kind === 'shell') {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = `rgba(214,178,74,${alpha})`;
    roundRect(ctx, -7, -3, 14, 6, 3);
    ctx.fill();
    ctx.restore();
    return;
  }

  // bill
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  let sx = Math.cos(p.flip); // fake 3D tumble
  if (Math.abs(sx) < 0.12) sx = 0.12 * (sx < 0 ? -1 : 1);
  ctx.scale(sx, 1);

  ctx.fillStyle = billGradient(ctx);
  roundRect(ctx, -BILL_W / 2, -BILL_H / 2, BILL_W, BILL_H, 6);
  ctx.fill();

  ctx.strokeStyle = 'rgba(230,255,240,0.5)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, -BILL_W / 2 + 4, -BILL_H / 2 + 4, BILL_W - 8, BILL_H - 8, 4);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.12)'; // gloss highlight (top half)
  roundRect(ctx, -BILL_W / 2, -BILL_H / 2, BILL_W, BILL_H / 2, 6);
  ctx.fill();

  ctx.fillStyle = '#eafff1';
  ctx.font = 'bold 15px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$100', 0, 0);
  ctx.restore();
}

function drawStatus(ctx, status, w) {
  const n = status.length;
  for (let i = 0; i < n; i++) {
    const cx = w / 2 + (i - (n - 1) / 2) * 26;
    ctx.beginPath();
    ctx.arc(cx, 24, 7, 0, Math.PI * 2);
    ctx.fillStyle = status[i].cocked ? '#37e36b' : 'rgba(255,255,255,0.35)';
    ctx.fill();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
