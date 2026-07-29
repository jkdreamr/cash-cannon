import { classifyHand, LM } from './gesture.js';
import { createHandFiringState, updateFiring } from './firing.js';
import {
  createSystem, spawnBurst, spawnRain, step,
  carryStuck, shakeStuck, knockStuck, bindStuckToBody, applyBodyBasis, countStuck,
} from './physics.js';
import { createCamera, unproject, depthFromSpan } from './camera3d.js';
import { normalize } from './vec3.js';
import { createRenderer } from './render.js';
import { createAudio } from './audio.js';
import { createSegmenter, createPersonTracker } from './segmentation.js';
import { createPoseLandmarker, createBodyTracker } from './pose.js';

const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
// Imported on demand rather than at the top of the module. A static import of a
// multi-megabyte CDN bundle delays this whole file, which means the Start
// button has no click handler for the first few seconds and pressing it does
// nothing at all.
const VISION_BUNDLE_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

// Three synchronous models share one thread, so they are throttled AND
// staggered: at most one runs on any given frame. Letting two land together is
// what freezes the camera feed.
const DETECT_INTERVAL_MS = 55;
const SEGMENT_INTERVAL_MS = 110;
const POSE_INTERVAL_MS = 130;
const RAIN_INTERVAL_MS = 70;

// Anatomical constant rather than a per-frame measurement. Deriving the span
// from noisy landmarks put that noise straight into the depth estimate, and
// since projected note width is (BILL_LONG / span) x pixelSpan, it appeared
// directly as the notes pulsing in size.
const KNUCKLE_SPAN_M = 0.08;
// A hand naturally sits about 0.4 m from a webcam, where a note would render a
// third of the frame wide. Treating anything nearer as this far keeps notes a
// legible size without moving where they leave the fingertip on screen.
const MIN_MUZZLE_Z = 0.7;
const MAX_MUZZLE_Z = 4;
// Adult biacromial breadth. How wide your shoulders appear is the one reliable
// measure of how far away YOU are, and it is available whenever the body is
// tracked. Inferring your distance from your hand instead was wrong twice over:
// a hand is nowhere near the depth of a torso, and during a money shower there
// is often no hand in frame at all, so the estimate simply never updated.
const SHOULDER_BREADTH_M = 0.40;

// Add ?debug to the URL for a live readout of what the detector sees. It costs
// nothing when off, and turns "it is not firing" into numbers.
const DEBUG = new URLSearchParams(location.search).has('debug');
const diag = [];

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
const body = createBodyTracker();
const firingStates = new Map();
const handTracks = new Map();

let cam = createCamera(1280, 720);
let landmarker = null;
let segmenter = null;
let poser = null;
let running = false;
let starting = false;
let lastVideoTime = -1;
let lastTs = 0;
let lastDetectMs = 0;
let lastSegmentMs = 0;
let lastPoseMs = 0;
let lastRainMs = 0;
let lastChaChingMs = 0;
let segStamp = 0;
let poseStamp = 0;
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

// Exponential smoothing with a real time constant, so the amount of smoothing
// does not change with frame rate.
function smooth(prev, next, dt, tau) {
  if (prev == null) return next;
  const k = 1 - Math.exp(-dt / tau);
  return prev + (next - prev) * k;
}

async function loadModels() {
  const { HandLandmarker, ImageSegmenter, PoseLandmarker, FilesetResolver } =
    await import(VISION_BUNDLE_URL);
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

  // Both extras are optional. Without them money still flies and falls; it just
  // stops being occluded by you and resting on you.
  try {
    segmenter = await createSegmenter(ImageSegmenter, fileset);
  } catch (e) {
    segmenter = null;
  }
  try {
    poser = await createPoseLandmarker(PoseLandmarker, fileset);
  } catch (e) {
    poser = null;
  }
}

async function start() {
  // The button stays on screen through the camera prompt and a multi-second
  // model download, so an impatient second click is easy. Without this guard
  // that would start a second render loop for the rest of the session and
  // reload every model on top of the first.
  if (starting || running) return;
  starting = true;
  const btns = [el('startBtn'), el('retryBtn')];
  btns.forEach((b) => { b.disabled = true; });
  try {
    await startInner();
  } finally {
    starting = false;
    btns.forEach((b) => { b.disabled = false; });
    // Reset the label so a retry does not read "Starting...".
    if (!running) el('startBtn').textContent = 'Start camera';
  }
}

async function startInner() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showError(
      'The camera only works over https or http://localhost. If you opened the file directly, run "npm run serve" and visit http://localhost:8000.'
    );
    return;
  }

  audio.unlock();
  el('startBtn').textContent = 'Starting...';

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

// Returns true if a model ran, so callers can keep one inference per frame.
function runDetection(ts) {
  if (ts - lastDetectMs < DETECT_INTERVAL_MS) return false;
  if (video.readyState < 2 || video.currentTime === lastVideoTime) return false;
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
  return true;
}

function runSegmentation(ts) {
  if (!segmenter || ts - lastSegmentMs < SEGMENT_INTERVAL_MS) return false;
  if (video.readyState < 2) return false;
  lastSegmentMs = ts;
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
    // Keep the previous mask.
  }
  return true;
}

function runPose(ts) {
  if (!poser || ts - lastPoseMs < POSE_INTERVAL_MS) return false;
  if (video.readyState < 2) return false;
  lastPoseMs = ts;
  poseStamp = Math.max(poseStamp + 1, Math.round(ts));
  try {
    const res = poser.detectForVideo(video, poseStamp);
    body.update(res && res.landmarks);
  } catch (err) {
    // Keep the previous body frame rather than snapping the money about.
  }
  return true;
}

// Turn one detected hand into real 3D: where the muzzle is in space and which
// way it points, including straight at the lens. Everything here is smoothed,
// because the raw landmarks are re-measured only about fifteen times a second
// and any wobble shows up directly as notes changing size and position.
function resolveHand(i, w, h, ts, dt) {
  const lm = hands[i];
  const world = worldHands[i];
  const label = labels[i];
  const pix = lm.map((pt) => ({ x: (1 - pt.x) * w, y: pt.y * h }));
  const hand = classifyHand(pix, world || lm);

  const pixels = Math.hypot(
    pix[LM.INDEX_MCP].x - pix[LM.PINKY_MCP].x,
    pix[LM.INDEX_MCP].y - pix[LM.PINKY_MCP].y
  );
  let zRaw = depthFromSpan(cam, KNUCKLE_SPAN_M, pixels);
  if (!zRaw || !isFinite(zRaw)) zRaw = 0.9;
  zRaw = Math.min(Math.max(zRaw, 0.2), MAX_MUZZLE_Z);

  let dirRaw;
  if (world) {
    const a = world[LM.INDEX_MCP];
    const b = world[LM.INDEX_TIP];
    dirRaw = normalize({ x: -(b.x - a.x), y: b.y - a.y, z: b.z - a.z });
  } else {
    dirRaw = { x: hand.aim.x, y: hand.aim.y, z: 0 };
  }
  if (!(Math.abs(dirRaw.x) + Math.abs(dirRaw.y) + Math.abs(dirRaw.z) > 0.1)) {
    dirRaw = { x: 0, y: -1, z: 0 };
  }

  const tipPix = pix[LM.INDEX_TIP];
  let track = handTracks.get(label);
  if (!track) {
    track = { z: zRaw, tx: tipPix.x, ty: tipPix.y, dx: dirRaw.x, dy: dirRaw.y, dz: dirRaw.z, ts };
    handTracks.set(label, track);
  }

  track.z = smooth(track.z, zRaw, dt, 0.12);
  track.tx = smooth(track.tx, tipPix.x, dt, 0.045);
  track.ty = smooth(track.ty, tipPix.y, dt, 0.045);
  track.dx = smooth(track.dx, dirRaw.x, dt, 0.07);
  track.dy = smooth(track.dy, dirRaw.y, dt, 0.07);
  track.dz = smooth(track.dz, dirRaw.z, dt, 0.07);

  const z = Math.min(Math.max(track.z, MIN_MUZZLE_Z), MAX_MUZZLE_Z);
  const tip3 = unproject(cam, track.tx, track.ty, z);
  const dir = normalize({ x: track.dx, y: track.dy, z: track.dz });

  // Hand speed from the smoothed tip, in screen widths per second.
  const u = track.tx / w;
  const v = track.ty / h;
  const speed = track.pu == null ? 0 : Math.hypot(u - track.pu, v - track.pv) / Math.max(dt, 0.004);
  track.pu = u;
  track.pv = v;
  track.ts = ts;

  return { hand, tip3, dir, z, u, v, speed };
}

function loop(ts) {
  if (!running) return;
  let dt = (ts - lastTs) / 1000;
  lastTs = ts;
  if (dt > 0.05) dt = 0.05;

  const w = canvas.width;
  const h = canvas.height;

  // One heavy inference per frame at most.
  if (!runDetection(ts)) {
    if (!runSegmentation(ts)) runPose(ts);
  }

  if (body.present) {
    const zFromBody = depthFromSpan(cam, SHOULDER_BREADTH_M, body.basis.width * cam.width);
    if (zFromBody && isFinite(zFromBody)) {
      personZ = smooth(personZ, Math.min(Math.max(zFromBody, 0.4), 6), dt, 0.4);
    }
  }

  // Money already resting on someone follows the body it is lying on.
  if (body.present) {
    applyBodyBasis(system, body.basis);
  } else if (person.present && person.centre) {
    const m = person.motion;
    if (m.dx || m.dy) {
      carryStuck(system, m.dx, m.dy);
      person.motion.dx = 0;
      person.motion.dy = 0;
    }
  }

  if (person.present && person.motion.speed > 0) {
    shakeStuck(system, {
      speed: person.motion.speed,
      dirX: Math.sign(person.motion.dx || 0),
      dirY: Math.sign(person.motion.dy || 0),
      dt,
      cam,
    });
  }

  const seen = new Set();
  diag.length = 0;
  for (let i = 0; i < hands.length; i++) {
    const label = labels[i];
    seen.add(label);
    const { hand, tip3, dir, z, u, v, speed } = resolveHand(i, w, h, ts, dt);

    // Only fall back to the hand when the body itself is not being tracked.
    if (!body.present) personZ = smooth(personZ, z + 0.3, dt, 0.5);

    if (speed > 0.5) knockStuck(system, { u, v, radius: 0.11, speed, cam });

    if (!firingStates.has(label)) firingStates.set(label, createHandFiringState());
    const state = firingStates.get(label);
    const r = updateFiring(state, hand, ts);

    if (r.didFire) {
      // A real gun sheds one note at a time; the cadence supplies the stream.
      spawnBurst(system, { origin: tip3, dir, count: 1, preAdvance: Math.random() * dt });
      audio.shot();
      if (ts - lastChaChingMs > 380) {
        audio.chaChing();
        lastChaChingMs = ts;
      }
      shakeMag = 2.5;
    }

    if (DEBUG) {
      diag.push(
        `${label}  gun:${hand.isGunShape ? 'yes' : 'no '}`
        + `  fingers i${hand.fingers.indexExtended ? 1 : 0}`
        + `m${hand.fingers.middleExtended ? 1 : 0}`
        + `r${hand.fingers.ringExtended ? 1 : 0}`
        + `p${hand.fingers.pinkyExtended ? 1 : 0}`
        + `  thumbGap:${hand.thumbGap.toFixed(2)} (need 0.70)`
        + `  hammer:${r.thumbUp ? 'UP' : 'down'}`
        + `  firing:${r.firing ? 'yes' : 'no'}`
        + `  hand:${z.toFixed(2)}m`
      );
    }
  }

  for (const [label, state] of firingStates) {
    if (!seen.has(label)) updateFiring(state, null, ts);
  }

  if (raining && ts - lastRainMs > RAIN_INTERVAL_MS) {
    lastRainMs = ts;
    spawnRain(system, { cam, count: 2, focusZ: person.present ? personZ : null });
  }

  step(system, dt, {
    cam,
    time: ts / 1000,
    wind: true,
    personZ: person.present ? personZ : null,
    sampleMask: person.present ? person.sampler : null,
    stickTest: body.present ? (u, v) => body.stickTest(u, v) : null,
  });

  // Anything that just came to rest is pinned to the body from now on.
  if (body.present) bindStuckToBody(system, body.basis);

  shakeMag = Math.max(0, shakeMag - 40 * dt);
  shake.x = (Math.random() - 0.5) * shakeMag;
  shake.y = (Math.random() - 0.5) * shakeMag;

  renderer.draw({
    video,
    cam,
    particles: system.particles,
    dt,
    personStencil: person.present ? person.canvas : null,
    personZ: person.present ? personZ : null,
    shake,
  });

  if (DEBUG) drawDiagnostics(w, h);

  requestAnimationFrame(loop);
}

function drawDiagnostics(w, h) {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const lines = [
    `hands:${hands.length}  body:${body.present ? 'tracked' : 'none'}`
    + `  silhouette:${person.present ? 'yes' : 'no'}  resting:${countStuck(system)}`
    + `  notes:${system.particles.length}`,
    ...diag,
  ];
  ctx.font = `${Math.round(h * 0.018)}px ui-monospace, Menlo, monospace`;
  ctx.textBaseline = 'top';
  const pad = Math.round(h * 0.012);
  const lh = Math.round(h * 0.026);
  ctx.fillStyle = 'rgba(4, 14, 9, 0.72)';
  ctx.fillRect(pad, pad, w - pad * 2, lh * lines.length + pad);
  ctx.fillStyle = '#8ff2b5';
  lines.forEach((line, i) => ctx.fillText(line, pad * 2, pad * 1.5 + i * lh));
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
