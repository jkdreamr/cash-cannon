// Person segmentation, which is what lets money pass behind you, land on you,
// and be occluded by you. Everything here degrades gracefully: if the model
// cannot load, the caller simply gets no mask and the scene still runs.

import { isInverted, makeSampler, maskCentroid } from './mask.js';

const SEG_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite';

export async function createSegmenter(ImageSegmenter, fileset) {
  const opts = {
    baseOptions: { modelAssetPath: SEG_MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  };
  try {
    return await ImageSegmenter.createFromOptions(fileset, opts);
  } catch (e) {
    opts.baseOptions.delegate = 'CPU';
    return await ImageSegmenter.createFromOptions(fileset, opts);
  }
}

export function createPersonTracker() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  let image = null;
  let sampler = null;
  let centre = null;
  let prevCentre = null;
  let motion = { speed: 0, dx: 0, dy: 0 };
  let lastMs = 0;
  let present = false;

  // Build a soft alpha stencil of the person for compositing.
  function paintStencil(data, w, h, inverted) {
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    if (!image || image.width !== w || image.height !== h) {
      image = ctx.createImageData(w, h);
    }
    const px = image.data;
    for (let i = 0, j = 0; i < data.length; i++, j += 4) {
      const on = data[i] > 0;
      const person = inverted ? !on : on;
      px[j] = 255;
      px[j + 1] = 255;
      px[j + 2] = 255;
      px[j + 3] = person ? 255 : 0;
    }
    ctx.putImageData(image, 0, 0);
  }

  return {
    canvas,
    get present() {
      return present;
    },
    get sampler() {
      return sampler;
    },
    get centre() {
      return centre;
    },
    get motion() {
      return motion;
    },

    // Feed a MediaPipe category mask.
    update(mask, nowMs) {
      const w = mask.width;
      const h = mask.height;
      const data = mask.getAsUint8Array();
      const inverted = isInverted(data, w, h);

      paintStencil(data, w, h, inverted);
      sampler = makeSampler(data, w, h, { inverted, mirrored: true });

      const c = maskCentroid(data, w, h, { inverted, mirrored: true, step: 4 });
      // Ignore implausible masks (a sliver, or the whole frame).
      present = !!c && c.coverage > 0.02 && c.coverage < 0.92;

      if (present) {
        const dtMs = Math.max(1, nowMs - lastMs);
        if (prevCentre && dtMs < 400) {
          const dx = c.u - prevCentre.u;
          const dy = c.v - prevCentre.v;
          const perSec = 1000 / dtMs;
          // Screen widths per second, so it is resolution independent.
          motion = { dx, dy, speed: Math.hypot(dx, dy) * perSec };
        }
        prevCentre = { u: c.u, v: c.v };
        centre = c;
      } else {
        sampler = null;
        centre = null;
        prevCentre = null;
        motion = { speed: 0, dx: 0, dy: 0 };
      }
      lastMs = nowMs;
    },

    clear() {
      present = false;
      sampler = null;
      centre = null;
      prevCentre = null;
      motion = { speed: 0, dx: 0, dy: 0 };
    },
  };
}
