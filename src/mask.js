// Pure helpers for the person segmentation mask.
//
// The mask arrives in video space, but everything on screen is mirrored for the
// selfie view, so the samplers flip x to keep the two in agreement.

// Segmentation models differ on which category index means "person". The frame
// border is almost always background, so if most border pixels read as "on",
// the polarity is inverted and we flip it.
export function isInverted(data, width, height) {
  let on = 0;
  let total = 0;
  const stepX = Math.max(1, Math.floor(width / 32));
  const stepY = Math.max(1, Math.floor(height / 32));
  for (let x = 0; x < width; x += stepX) {
    for (const y of [0, height - 1]) {
      if (data[y * width + x] > 0) on += 1;
      total += 1;
    }
  }
  for (let y = 0; y < height; y += stepY) {
    for (const x of [0, width - 1]) {
      if (data[y * width + x] > 0) on += 1;
      total += 1;
    }
  }
  return total > 0 && on / total > 0.6;
}

function readAt(data, width, height, u, v, inverted, mirrored) {
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return false;
  const mu = mirrored ? 1 - u : u;
  const x = Math.min(width - 1, Math.max(0, Math.round(mu * (width - 1))));
  const y = Math.min(height - 1, Math.max(0, Math.round(v * (height - 1))));
  const on = data[y * width + x] > 0;
  return inverted ? !on : on;
}

// Returns a function taking normalised on-screen coordinates and reporting
// whether the person occupies that point.
export function makeSampler(data, width, height, { inverted = false, mirrored = true } = {}) {
  return (u, v) => readAt(data, width, height, u, v, inverted, mirrored);
}

// Centre of mass of the person in normalised on-screen coordinates, plus how
// much of the frame they fill. Used to carry resting notes along and to detect
// shaking. Returns null when nobody is visible.
export function maskCentroid(data, width, height, { inverted = false, mirrored = true, step = 4 } = {}) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  let total = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      total += 1;
      const on = data[y * width + x] > 0;
      if (inverted ? !on : on) {
        sx += x;
        sy += y;
        n += 1;
      }
    }
  }
  if (n < 8) return null;
  const u = sx / n / (width - 1);
  return {
    u: mirrored ? 1 - u : u,
    v: sy / n / (height - 1),
    coverage: n / Math.max(1, total),
  };
}
