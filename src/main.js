import { HandLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
import { classifyHand } from './gesture.js';
import { createHandFiringState, updateFiring } from './firing.js';
import { createSystem, spawnBurst, spawnRain, step } from './physics.js';
import { createRenderer } from './render.js';
import { createAudio } from './audio.js';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

// Detection is synchronous and heavy, so we run it on a throttle and reuse the
// last result between runs. Rendering still happens every frame, which keeps
// the camera feed smooth instead of freezing while inference runs.
const DETECT_INTERVAL_MS = 55;
const RAIN_INTERVAL_MS = 90; // how often "make it rain" drops a batch of bills

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
const firingStates = new Map(); // handedness label -> firing state

let landmarker = null;
let running = false;
let lastVideoTime = -1;
let lastTs = 0;
let shakeMag = 0;
let lastChaChingMs = 0; // throttle the cash-register bells during continuous fire
let fireCount = 0;      // used to eject a shell casing every few shots
let lastDetectMs = 0;   // detection throttle clock
let lastHands = [];     // most recent detection, reused between throttled runs
let lastWorld = [];
let lastLabels = [];
let raining = false;    // "make it rain" toggle
let lastRainMs = 0;
const shake = { x: 0, y: 0 };

function showError(msg) {
  errorMsg.textContent = msg;
  errorOverlay.classList.remove('hidden');
}
function hideError() {
  errorOverlay.classList.add('hidden');
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
}
window.addEventListener('resize', resizeCanvas);

async function loadModel() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const opts = {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 2,
    // Lenient thresholds so hands are picked up readily, including hard poses
    // like the barrel pointing toward the camera. The gesture classifier still
    // gates what actually fires.
    minHandDetectionConfidence: 0.3,
    minHandPresenceConfidence: 0.3,
    minTrackingConfidence: 0.3,
  };
  try {
    return await HandLandmarker.createFromOptions(fileset, opts);
  } catch (e) {
    // Some machines/browsers lack a usable GPU delegate - fall back to CPU.
    opts.baseOptions.delegate = 'CPU';
    return await HandLandmarker.createFromOptions(fileset, opts);
  }
}

async function start() {
  // Secure-context / API guard (the classic file:// trap).
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showError(
      'The camera only works over https or http://localhost. If you opened the file directly, run "npm run serve" and visit http://localhost:8000.'
    );
    return;
  }

  audio.unlock(); // this click is our autoplay unlock

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
    if (!landmarker) landmarker = await loadModel();
  } catch (e) {
    showError('Could not load the hand-tracking model. Check your internet connection and Try Again.');
    return;
  }

  hideError();
  startOverlay.classList.add('hidden');
  soundBtn.style.display = 'flex';
  rainBtn.style.display = 'inline-flex';
  resizeCanvas();
  running = true;
  lastTs = performance.now();
  requestAnimationFrame(loop);
}

function loop(ts) {
  if (!running) return;
  let dt = (ts - lastTs) / 1000;
  lastTs = ts;
  if (dt > 0.05) dt = 0.05; // clamp after tab-switch stalls

  const w = canvas.width;
  const h = canvas.height;
  const bounds = { width: w, height: h };

  // Run detection on a throttle and only on a fresh video frame, so heavy
  // inference never blocks the render loop. The last result is reused between
  // runs; the feed keeps painting every frame.
  if (
    ts - lastDetectMs >= DETECT_INTERVAL_MS &&
    video.readyState >= 2 &&
    video.currentTime !== lastVideoTime
  ) {
    lastDetectMs = ts;
    lastVideoTime = video.currentTime;
    try {
      const res = landmarker.detectForVideo(video, ts);
      lastHands = res.landmarks || [];
      lastWorld = res.worldLandmarks || [];
      const handed = res.handednesses || res.handedness || [];
      lastLabels = lastHands.map((_, i) => handed[i]?.[0]?.categoryName || `h${i}`);
    } catch (err) {
      // A single bad inference frame must not kill the animation loop.
    }
  }
  const hands = lastHands;
  const worldHands = lastWorld;
  const labels = lastLabels;

  const seen = new Set();
  const status = [];

  for (let i = 0; i < hands.length; i++) {
    const label = labels[i];
    seen.add(label);
    // Positions and aim come from mirrored 2D pixel space (selfie view); the
    // finger shape is judged from 3D world landmarks so it survives the barrel
    // pointing toward or away from the camera.
    const lmPix = hands[i].map((pt) => ({ x: (1 - pt.x) * w, y: pt.y * h }));
    const shapeLm = worldHands[i] || hands[i];
    const hand = classifyHand(lmPix, shapeLm);

    if (!firingStates.has(label)) firingStates.set(label, createHandFiringState());
    const state = firingStates.get(label);
    const r = updateFiring(state, hand, ts);

    if (r.didFire) {
      let aim = hand.aim;
      if ((hand.aimMag || 0) < 0.05 * h) {
        // Barrel points at/away from the camera: spray cash outward in all
        // directions so it still reads as bursting toward the screen.
        const a = Math.random() * Math.PI * 2;
        aim = { x: Math.cos(a), y: Math.sin(a) };
      }
      const shell = fireCount % 4 === 0; // eject a casing every few shots
      fireCount += 1;
      spawnBurst(system, { tip: hand.tip, aim, nowMs: ts, bills: 2, shell });
      audio.shot();
      if (ts - lastChaChingMs > 380) {
        audio.chaChing();
        lastChaChingMs = ts;
      }
      shakeMag = 4; // gentle continuous rumble, not a per-shot kick
    }

    if (hand.isGunShape) status.push({ cocked: r.firing });
  }

  // Advance grace timers for hands that vanished this frame.
  for (const [label, state] of firingStates) {
    if (!seen.has(label)) updateFiring(state, null, ts);
  }

  // "Make it rain": drop bills from the top regardless of hands.
  if (raining && ts - lastRainMs > RAIN_INTERVAL_MS) {
    lastRainMs = ts;
    spawnRain(system, { width: w, count: 2 });
  }

  step(system, dt, bounds);

  // Decay recoil shake.
  shakeMag = Math.max(0, shakeMag - 40 * dt);
  shake.x = (Math.random() - 0.5) * shakeMag;
  shake.y = (Math.random() - 0.5) * shakeMag;

  renderer.draw({ video, particles: system.particles, bounds, shake, status });
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
