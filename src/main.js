import {
  HandLandmarker,
  ImageSegmenter,
  FilesetResolver,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
import { classifyHand, LM } from './gesture.js';
import { createHandFiringState, updateFiring } from './firing.js';
import {
  createSystem, spawnBurst, spawnRain, step,
  carryStuck, shakeStuck, knockStuck,
} from './physics.js';
import { createCamera, unproject, depthFromSpan } from './camera3d.js';
import { normalize } from './vec3.js';
import { createRenderer } from './render.js';
import { createAudio } from './audio.js';
import { createSegmenter, createPersonTracker } from './segmentation.js';

const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

// Inference is synchronous and heavy, so both models run on a throttle while
// the scene keeps rendering every frame. The feed never stalls.
const DETECT_INTERVAL_MS = 55;
const SEGMENT_INTERVAL_MS = 110;
const RAIN_INTERVAL_MS = 70;

const el = (id) => document.getElementById(id);
const canvas = el('feed');
const video = el('cam');
const startOverlay = el('start');
const errorOverlay = el('error');
const errorMsg = el('errorMsg');
const soundBtn = el('sound');
const rainBtn = el('rain');

const renderer = createRenderer(canvas);
const audio = createAudio();
const system = createSystem();
const person = createPersonTracker();
const firingStates = new Map();
const handTracks = new Map(); // smoothed per-hand state between detections

let cam = createCamera(1280, 720);
let landmarker = null;
let segmenter = null;
let running = false;
let lastVideoTime = -1;
let lastTs = 0;
let lastDetectMs = 0;
let lastSegmentMs = 0;
let lastRainMs = 0;
let lastChaChingMs = 0;
let segStamp = 0;
let shakeMag = 0;
let raining = false;
let personZ = 1.5;
let hands = [];
let worldHands = [];
let labels = [];
const shake = { x: 0, y: 0 };

function showError(msg) {
  errorMsg.textContent = msg;
  errorOverlay.classList.remove('hidden');
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  cam = createCamera(canvas.width, canvas.height);
}
window.addEventListener('resize', resizeCanvas);

async function loadModels() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const opts = {
    baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.3,
    minHandPresenceConfidence: 0.3,
    minTrackingConfidence: 0.3,
  };
  try {
    landmarker = await HandLandmarker.createFromOptions(fileset, opts);
  } catch (e) {
    opts.baseOptions.delegate = 'CPU';
    landmarker = await HandLandmarker.createFromOptions(fileset, opts);
  }

  // Segmentation is a bonus: it adds depth occlusion and money landing on you.
  // If it will not load, the scene still runs without those.
  try {
    segmenter = await createSegmenter(ImageSegmenter, fileset);
  } catch (e) {
    segmenter = null;
  }
}

async function start() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showError(
      'The camera only works over https or http://localhost. If you opened the file directly, run "npm run serve" and visit http://localhost:8000.'
    );
    return;
  }

  audio.unlock();

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
      showError('Camera permission was blocked. Allow camera access in your browser, then Try Again.');
    } else if (e && e.name === 'NotFoundError') {
      showError('No camera was found. Plug in or enable a webcam, then Try Again.');
    } else {
      showError('Could not start the camera. Try Again.');
    }
    return;
  }

  video.srcObject = stream;
  await video.play();
  await new Promise((res) => {
    if (video.readyState >= 2) return res();
    video.addEventListener('loadeddata', res, { once: true });
  });

  try {
    if (!landmarker) await loadModels();
  } catch (e) {
    showError('Could not load the hand-tracking model. Check your internet connection and Try Again.');
    return;
  }

  errorOverlay.classList.add('hidden');
  startOverlay.classList.add('hidden');
  soundBtn.style.display = 'flex';
  rainBtn.style.display = 'inline-flex';
  resizeCanvas();
  running = true;
  lastTs = performance.now();
  requestAnimationFrame(loop);
}

function runDetection(ts) {
  if (ts - lastDetectMs < DETECT_INTERVAL_MS) return;
  if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastDetectMs = ts;
  lastVideoTime = video.currentTime;
  try {
    const res = landmarker.detectForVideo(video, ts);
    hands = res.landmarks || [];
    worldHands = res.worldLandmarks || [];
    const handed = res.handednesses || res.handedness || [];
    labels = hands.map((_, i) => handed[i]?.[0]?.categoryName || `h${i}`);
  } catch (err) {
    // One bad inference frame must never kill the loop.
  }
}

function runSegmentation(ts) {
  if (!segmenter || ts - lastSegmentMs < SEGMENT_INTERVAL_MS) return;
  if (video.readyState < 2) return;
  lastSegmentMs = ts;
  // MediaPipe requires strictly increasing timestamps per task instance.
  segStamp = Math.max(segStamp + 1, Math.round(ts));
  try {
    segmenter.segmentForVideo(video, segStamp, (result) => {
      const mask = result.categoryMask;
      if (!mask) return;
      try {
        person.update(mask, ts);
      } finally {
        mask.close();
      }
    });
  } catch (err) {
    // Ignore a dropped segmentation frame; the previous mask stays valid.
  }
}

// Turn one detected hand into real 3D: where the fingertip is in space and
// which way the barrel points, including straight at the lens.
function resolveHand(i, w, h) {
  const lm = hands[i];
  const world = worldHands[i];
  const pix = lm.map((pt) => ({ x: (1 - pt.x) * w, y: pt.y * h }));
  const shape = world || lm;
  const hand = classifyHand(pix, shape);

  // Distance from the apparent width across the knuckles.
  let z = null;
  if (world) {
    const a = world[LM.INDEX_MCP];
    const b = world[LM.PINKY_MCP];
    const meters = Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
    const pixels = Math.hypot(
      pix[LM.INDEX_MCP].x - pix[LM.PINKY_MCP].x,
      pix[LM.INDEX_MCP].y - pix[LM.PINKY_MCP].y
    );
    z = depthFromSpan(cam, meters, pixels);
  }
  if (!z || !isFinite(z)) z = 0.9;
  z = Math.min(Math.max(z, 0.25), 4);

  const tipPix = pix[LM.INDEX_TIP];
  const tip3 = unproject(cam, tipPix.x, tipPix.y, z);

  // True 3D aim. World landmark x is mirrored to match the selfie view, and z
  // decreases toward the camera, so pointing at yourself shoots at the viewer.
  let dir;
  if (world) {
    const a = world[LM.INDEX_MCP];
    const b = world[LM.INDEX_TIP];
    dir = normalize({ x: -(b.x - a.x), y: b.y - a.y, z: b.z - a.z });
  } else {
    dir = { x: hand.aim.x, y: hand.aim.y, z: 0 };
  }
  if (!(Math.abs(dir.x) + Math.abs(dir.y) + Math.abs(dir.z) > 0.1)) {
    dir = { x: 0, y: -1, z: 0 };
  }

  return { hand, tip3, dir, z, tipPix };
}

function loop(ts) {
  if (!running) return;
  let dt = (ts - lastTs) / 1000;
  lastTs = ts;
  if (dt > 0.05) dt = 0.05;

  const w = canvas.width;
  const h = canvas.height;

  runDetection(ts);
  runSegmentation(ts);

  // Carry resting money with the body, and shake it loose when you move.
  if (person.present && person.centre) {
    const m = person.motion;
    if (m.dx || m.dy) {
      carryStuck(system, m.dx, m.dy);
      person.motion.dx = 0;
      person.motion.dy = 0;
    }
    if (m.speed > 0) {
      shakeStuck(system, {
        speed: m.speed,
        dirX: Math.sign(m.dx || 0),
        dirY: Math.sign(m.dy || 0),
        dt,
      });
    }
  }

  const seen = new Set();
  for (let i = 0; i < hands.length; i++) {
    const label = labels[i];
    seen.add(label);
    const { hand, tip3, dir, z, tipPix } = resolveHand(i, w, h);

    // The body sits a little behind the hand.
    personZ = personZ * 0.9 + (z + 0.3) * 0.1;

    // A quick hand sweep brushes money off you.
    const track = handTracks.get(label);
    const u = tipPix.x / w;
    const v = tipPix.y / h;
    if (track) {
      const dtHand = Math.max(0.001, (ts - track.ts) / 1000);
      const speed = Math.hypot(u - track.u, v - track.v) / dtHand;
      if (speed > 0.35) knockStuck(system, { u, v, radius: 0.11, speed });
    }
    handTracks.set(label, { u, v, ts });

    if (!firingStates.has(label)) firingStates.set(label, createHandFiringState());
    const state = firingStates.get(label);
    const r = updateFiring(state, hand, ts);

    if (r.didFire) {
      spawnBurst(system, { origin: tip3, dir, count: 2 });
      audio.shot();
      if (ts - lastChaChingMs > 380) {
        audio.chaChing();
        lastChaChingMs = ts;
      }
      shakeMag = 3;
    }
  }

  for (const [label, state] of firingStates) {
    if (!seen.has(label)) updateFiring(state, null, ts);
  }

  if (raining && ts - lastRainMs > RAIN_INTERVAL_MS) {
    lastRainMs = ts;
    spawnRain(system, { cam, count: 2 });
  }

  step(system, dt, {
    cam,
    time: ts / 1000,
    wind: true,
    personZ: person.present ? personZ : null,
    sampleMask: person.present ? person.sampler : null,
  });

  shakeMag = Math.max(0, shakeMag - 40 * dt);
  shake.x = (Math.random() - 0.5) * shakeMag;
  shake.y = (Math.random() - 0.5) * shakeMag;

  renderer.draw({
    video,
    cam,
    particles: system.particles,
    personStencil: person.present ? person.canvas : null,
    personZ: person.present ? personZ : null,
    shake,
  });

  requestAnimationFrame(loop);
}

el('startBtn').addEventListener('click', start);
el('retryBtn').addEventListener('click', start);

soundBtn.addEventListener('click', () => {
  const on = !audio.isEnabled();
  audio.setEnabled(on);
  soundBtn.classList.toggle('muted', !on);
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.setAttribute('aria-label', on ? 'Mute sound' : 'Unmute sound');
});

rainBtn.addEventListener('click', () => {
  raining = !raining;
  rainBtn.classList.toggle('on', raining);
  rainBtn.setAttribute('aria-pressed', String(raining));
});
