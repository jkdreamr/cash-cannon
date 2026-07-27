// Pre-rendered banknote artwork.
//
// The art is drawn once into offscreen canvases at startup and then blitted per
// note per frame. That decouples how detailed a note is from what it costs to
// draw one, which is the only way to afford real engraving density with a
// hundred notes on screen.
//
// Colours come from what US currency actually is: the face is warm cream rag
// paper, NOT green. The green impression people carry comes from the ink on the
// reverse. A green front is the single clearest tell of fake CG money.

const ASPECT = 155.956 / 66.294; // real note proportions

const PAPER_LIGHT = '#e7e0cc';
const PAPER_MID = '#dcd4be';
const PAPER_SHADE = '#c3baa1';
const INK = '#22241f';        // warm green-black intaglio, never pure black
const PORTRAIT = '#5e5b4e';   // engraving at ~50% coverage over cream
const SEAL_GREEN = '#16603f';
const SERIAL_GREEN = '#1e6e48';
const FRB_BLACK = '#23231f';
const RIBBON_BLUE = '#3e76b0';
const COPPER = '#ae6c34';
const BACK_INK = '#23503a';

const SERIALS = ['LB47029183F', 'KC91847362A', 'JD25619047B', 'MA73058291E', 'HF61294837C', 'GG38475019D'];

function noise(ctx, w, h, amount, alpha) {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = 128 + (Math.random() * 2 - 1) * amount;
    d[i] = d[i + 1] = d[i + 2] = n;
    d[i + 3] = alpha;
  }
  ctx.putImageData(img, 0, 0);
}

// Soft vignette with no hard boundary. Engraved portraits dissolve into bare
// paper, so the falloff has to be gradual: a solid core with a crisp edge reads
// as a smudge rather than an engraving.
function vignette(ctx, x, y, rx, ry, strength) {
  const r = Math.max(rx, ry);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, 'rgba(94,91,78,0.80)');
  g.addColorStop(0.35, 'rgba(94,91,78,0.46)');
  g.addColorStop(0.68, 'rgba(94,91,78,0.16)');
  g.addColorStop(1, 'rgba(94,91,78,0)');
  ctx.save();
  ctx.globalAlpha = strength;
  ctx.translate(x, y);
  ctx.scale(rx / r, ry / r);
  ctx.translate(-x, -y);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// An engraved bust: head, a hint of shoulders, and the fine horizontal ruling
// that line engraving is actually made of.
function portrait(ctx, cx, cy, w, h) {
  vignette(ctx, cx, cy - h * 0.02, w * 0.115, h * 0.30, 0.9);
  vignette(ctx, cx, cy - h * 0.10, w * 0.062, h * 0.15, 0.5);

  ctx.save();
  // Shoulders, cut off by the lower edge of the portrait area.
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = PORTRAIT;
  ctx.beginPath();
  ctx.ellipse(cx, cy + h * 0.30, w * 0.105, h * 0.14, 0, Math.PI, Math.PI * 2);
  ctx.fill();

  // Engraving ruling. This is what stops it reading as an airbrushed blob.
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let i = -7; i <= 7; i++) {
    const y = cy + i * h * 0.028;
    const half = w * 0.115 * Math.sqrt(Math.max(0, 1 - (i / 8) ** 2));
    ctx.moveTo(cx - half, y);
    ctx.lineTo(cx + half, y);
  }
  ctx.stroke();
  ctx.restore();
}

// Rows of illegible marks. Thirty small marks read as real far better than two
// large legible ones.
function microtext(ctx, x, y, w, h, rows, colour, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colour;
  const rh = h / rows;
  for (let r = 0; r < rows; r++) {
    let cx = x;
    while (cx < x + w) {
      const seg = 1 + Math.random() * 2.5;
      ctx.fillRect(cx, y + r * rh, seg, Math.max(0.6, rh * 0.42));
      cx += seg + 0.9 + Math.random() * 1.2;
    }
  }
  ctx.restore();
}

function guilloche(ctx, x, y, w, h, colour, alpha, lines) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 0.5;
  for (let i = 0; i < lines; i++) {
    ctx.beginPath();
    const amp = h * (0.12 + (i / lines) * 0.3);
    for (let t = 0; t <= w; t += 3) {
      const yy = y + h / 2 + Math.sin((t / w) * Math.PI * 6 + i * 0.7) * amp * 0.5
        + Math.sin((t / w) * Math.PI * 13 + i) * amp * 0.16;
      if (t === 0) ctx.moveTo(x + t, yy);
      else ctx.lineTo(x + t, yy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function paperBase(ctx, w, h, variant) {
  // Never one flat value: real paper under real light always varies.
  const g = ctx.createLinearGradient(0, 0, w * 0.35, h);
  g.addColorStop(0, PAPER_LIGHT);
  g.addColorStop(0.55, PAPER_MID);
  g.addColorStop(1, PAPER_SHADE);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Handling grime along the long edges.
  const edge = ctx.createLinearGradient(0, 0, 0, h);
  edge.addColorStop(0, 'rgba(154,144,122,0.30)');
  edge.addColorStop(0.18, 'rgba(154,144,122,0)');
  edge.addColorStop(0.82, 'rgba(154,144,122,0)');
  edge.addColorStop(1, 'rgba(154,144,122,0.34)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);

  // Per-note creases, so no two notes are clones.
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = '#9a907a';
  ctx.lineWidth = Math.max(1, w * 0.0022);
  const creases = 1 + (variant % 3);
  for (let i = 0; i < creases; i++) {
    const cx = w * (0.2 + ((variant * 7 + i * 5) % 10) / 16);
    ctx.beginPath();
    ctx.moveTo(cx, -2);
    ctx.lineTo(cx + (i % 2 ? 4 : -4), h + 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFront(ctx, w, h, variant) {
  paperBase(ctx, w, h, variant);

  // Engraved border: two fine rules, inset, with an ornamental inner band.
  ctx.strokeStyle = INK;
  ctx.globalAlpha = 0.62;
  ctx.lineWidth = Math.max(1, w * 0.004);
  ctx.strokeRect(w * 0.028, h * 0.06, w * 0.944, h * 0.88);
  ctx.globalAlpha = 0.34;
  ctx.lineWidth = Math.max(0.6, w * 0.0018);
  ctx.strokeRect(w * 0.045, h * 0.095, w * 0.91, h * 0.81);
  ctx.globalAlpha = 1;

  guilloche(ctx, w * 0.05, h * 0.1, w * 0.9, h * 0.8, INK, 0.10, 7);

  // Blue security ribbon: the most valuable non-green pixels on the note.
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = RIBBON_BLUE;
  ctx.fillRect(w * 0.545, h * 0.06, w * 0.032, h * 0.88);
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#8fb6dc';
  ctx.fillRect(w * 0.549, h * 0.06, w * 0.010, h * 0.88);
  ctx.restore();

  // Portrait: left of centre, clear of the ribbon, dissolving into the paper.
  portrait(ctx, w * 0.355, h * 0.5, w, h);

  // The blank oval where the watermark sits on a real note. Empty paper in a
  // deliberate shape is itself a currency cue.
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = PAPER_LIGHT;
  ctx.beginPath();
  ctx.ellipse(w * 0.80, h * 0.5, w * 0.055, h * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Federal Reserve seal is BLACK, Treasury seal is GREEN. One of each is a
  // strong, cheap signal that this is real currency.
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = FRB_BLACK;
  ctx.lineWidth = Math.max(1, w * 0.0032);
  ctx.beginPath();
  ctx.arc(w * 0.215, h * 0.52, h * 0.155, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.arc(w * 0.215, h * 0.52, h * 0.10, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 0.55;
  ctx.fillStyle = SEAL_GREEN;
  ctx.beginPath();
  const sx = w * 0.665;
  const sy = h * 0.56;
  const sr = h * 0.15;
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const rr = sr * (i % 2 ? 1 : 0.9);
    const px = sx + Math.cos(a) * rr;
    const py = sy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // Corner denominations: small and dense, never two giant numerals.
  ctx.fillStyle = INK;
  ctx.globalAlpha = 0.8;
  const fs = Math.round(h * 0.10);
  ctx.font = `${fs}px Georgia, "Times New Roman", serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('100', w * 0.062, h * 0.155);
  ctx.textAlign = 'right';
  ctx.fillText('100', w * 0.938, h * 0.155);
  ctx.textAlign = 'left';
  ctx.fillText('100', w * 0.062, h * 0.85);
  ctx.globalAlpha = 1;

  // Large numeral bottom right, in the colour-shifting ink.
  ctx.fillStyle = COPPER;
  ctx.globalAlpha = 0.72;
  ctx.font = `bold ${Math.round(h * 0.26)}px Georgia, serif`;
  ctx.textAlign = 'right';
  ctx.fillText('100', w * 0.945, h * 0.79);
  ctx.globalAlpha = 1;

  // Lettering as marks rather than legible words: thirty illegible marks read
  // as real currency far better than two legible numerals.
  microtext(ctx, w * 0.245, h * 0.145, w * 0.30, h * 0.045, 1, INK, 0.6);  // country banner
  microtext(ctx, w * 0.245, h * 0.80, w * 0.26, h * 0.038, 1, INK, 0.5);   // denomination line
  microtext(ctx, w * 0.60, h * 0.145, w * 0.20, h * 0.04, 1, INK, 0.4);
  microtext(ctx, w * 0.30, h * 0.885, w * 0.34, h * 0.032, 1, INK, 0.42);
  microtext(ctx, w * 0.075, h * 0.42, w * 0.055, h * 0.16, 4, INK, 0.3);   // left ornament block
  microtext(ctx, w * 0.905, h * 0.30, w * 0.05, h * 0.14, 4, INK, 0.26);

  // Serial numbers, letterpress green, in the real asymmetric positions.
  ctx.fillStyle = SERIAL_GREEN;
  ctx.globalAlpha = 0.85;
  ctx.font = `${Math.round(h * 0.095)}px "Courier New", monospace`;
  ctx.textAlign = 'left';
  // Both clear of the portrait, which a real note also avoids overprinting.
  ctx.fillText(SERIALS[variant % SERIALS.length], w * 0.665, h * 0.265);
  ctx.fillText(SERIALS[variant % SERIALS.length], w * 0.615, h * 0.845);
  ctx.globalAlpha = 1;
}

function drawBack(ctx, w, h, variant) {
  paperBase(ctx, w, h, variant);

  // The reverse is where the green lives: dense engraving over the same paper.
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = BACK_INK;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  ctx.strokeStyle = BACK_INK;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = Math.max(1, w * 0.0045);
  ctx.strokeRect(w * 0.03, h * 0.07, w * 0.94, h * 0.86);
  ctx.globalAlpha = 1;

  guilloche(ctx, w * 0.04, h * 0.08, w * 0.92, h * 0.84, '#1a3d2b', 0.22, 9);

  // Independence Hall: a wide block, pediment and clock tower.
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#1a3d2b';
  ctx.fillRect(w * 0.34, h * 0.5, w * 0.32, h * 0.26);
  ctx.fillRect(w * 0.47, h * 0.28, w * 0.06, h * 0.24);
  ctx.beginPath();
  ctx.moveTo(w * 0.5, h * 0.2);
  ctx.lineTo(w * 0.535, h * 0.29);
  ctx.lineTo(w * 0.465, h * 0.29);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.32;
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(w * (0.355 + i * 0.05), h * 0.56, w * 0.016, h * 0.14);
  }
  ctx.restore();

  ctx.fillStyle = '#e7e0cc';
  ctx.globalAlpha = 0.82;
  const fs = Math.round(h * 0.13);
  ctx.font = `${fs}px Georgia, serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('100', w * 0.07, h * 0.17);
  ctx.textAlign = 'right';
  ctx.fillText('100', w * 0.93, h * 0.84);
  ctx.globalAlpha = 1;

  microtext(ctx, w * 0.30, h * 0.855, w * 0.4, h * 0.05, 1, '#dcd4be', 0.4);
}

// Build every variant once. `variants` distinct notes is enough that a drift of
// money never reads as clones.
export function createBillArt({ variants = 6, texWidth = 512, createCanvas } = {}) {
  const make = createCanvas || (() => document.createElement('canvas'));
  const w = texWidth;
  const h = Math.round(texWidth / ASPECT);

  const noiseCanvas = make();
  noiseCanvas.width = w;
  noiseCanvas.height = h;
  const nctx = noiseCanvas.getContext('2d');
  noise(nctx, w, h, 90, 26);

  const build = (drawFn) => {
    const out = [];
    for (let v = 0; v < variants; v++) {
      const c = make();
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      drawFn(ctx, w, h, v);
      // Paper fibre. The difference between "rendered" and "photographed".
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.globalCompositeOperation = 'overlay';
      ctx.drawImage(noiseCanvas, 0, 0);
      ctx.restore();
      out.push(c);
    }
    return out;
  };

  return { front: build(drawFront), back: build(drawBack), width: w, height: h, variants };
}
