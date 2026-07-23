import { HandLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
import { classifyHand } from './gesture.js';
import { createHandFiringState, updateFiring } from './firing.js';
import { createSystem, spawnBurst, step } from './physics.js';
import { createRenderer } from './render.js';
import { createAudio } from './audio.js';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

const el = (id) => document.getElementById(id);
const canvas = el('feed');
const video = el('cam');
const startOverlay = el('start');
const errorOverlay = el('error');
const errorMsg = el('errorMsg');
const soundBtn = el('sound');

const renderer = createRenderer(canvas);
const audio = createAudio();
const system = createSystem();
const firingStates = new Map(); // handedness label -> firing state

let landmarker = null;
let running = false;
let lastVideoTime = -1;
let lastTs = 0;
let shakeMag = 0;
const shake = { x: 0, y: 0 };

function showError(msg) {
  errorMsg.textContent = msg;
  errorOverlay.classList.remove('hidden');
}
function hideError() {
  errorOverlay.classList.add('hidden');
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
  };
  try {
    return await HandLandmarker.createFromOptions(fileset, opts);
  } catch (e) {
    // Some machines/browsers lack a usable GPU delegate — fall back to CPU.
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

  // Detect only when the video advanced to a new frame.
  let hands = [];
  let labels = [];
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const res = landmarker.detectForVideo(video, ts);
    hands = res.landmarks || [];
    const handed = res.handednesses || res.handedness || [];
    labels = hands.map((_, i) => handed[i]?.[0]?.categoryName || `h${i}`);
  }

  const seen = new Set();
  const status = [];

  for (let i = 0; i < hands.length; i++) {
    const label = labels[i];
    seen.add(label);
    // Map to mirrored pixel space so aim + particles match the selfie view.
    const lmPix = hands[i].map((pt) => ({ x: (1 - pt.x) * w, y: pt.y * h }));
    const hand = classifyHand(lmPix);

    if (!firingStates.has(label)) firingStates.set(label, createHandFiringState());
    const state = firingStates.get(label);
    const before = state.phase;
    const r = updateFiring(state, hand, ts);

    if (r.didFire) {
      spawnBurst(system, { tip: hand.tip, aim: hand.aim, nowMs: ts });
      audio.fire();
      shakeMag = 7;
    }
    if (state.phase === 'COCKED' && before !== 'COCKED') audio.cock();

    if (hand.isGunShape) status.push({ cocked: state.phase === 'COCKED' });
  }

  // Advance grace timers for hands that vanished this frame.
  for (const [label, state] of firingStates) {
    if (!seen.has(label)) updateFiring(state, null, ts);
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
  const next = !audio.isEnabled();
  audio.setEnabled(next);
  soundBtn.textContent = next ? '🔊' : '🔇';
});
