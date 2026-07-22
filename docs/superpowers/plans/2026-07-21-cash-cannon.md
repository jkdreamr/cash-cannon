# Cash Cannon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser toy where the user's camera tracks a finger-gun gesture and, on a realistic single-action thumb-cock trigger, glossy dollar bills fire out of the fingertip with muzzle flash, recoil, and an ejected shell casing.

**Architecture:** A build-free static site. Pure logic modules (`vec`, `gesture`, `firing`, `physics`) are unit-tested with vitest and hold no DOM/browser state. Side-effect modules (`audio`, `render`, `main`) own the camera, MediaPipe model, Canvas 2D, and Web Audio. `main.js` runs the per-frame loop: detect landmarks → classify gesture → advance per-hand firing state machine → spawn/step particles → render + play sound.

**Tech Stack:** Vanilla ES modules (no bundler), MediaPipe Tasks Vision `HandLandmarker` (CDN), Canvas 2D, Web Audio API (synthesized SFX), vitest (dev-only).

## Global Constraints

Every task's requirements implicitly include this section.

- **Node 18+** required (for vitest).
- **`package.json` has `"type": "module"`** so `.js` is ESM in both Node and browser. All imports use explicit `.js` extensions and relative paths.
- **No runtime build step.** The shipped site is `index.html` + `src/*.js` loaded via `<script type="module">`. vitest and `node_modules` never ship and are never imported by `src/`.
- **MediaPipe pinned:** ESM + WASM from `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14`; model from `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`.
- **Camera needs a secure context** (`https://` or `localhost`/`127.0.0.1`) — never `file://`.
- **All audio is synthesized** via Web Audio — zero audio asset files.
- **Coordinate space:** `gesture` and `physics` operate in *any* consistent 2D space. `main.js` feeds them **mirrored pixel space**: `px = (1 - lm.x) * width`, `py = lm.y * height`. Because the feed is drawn mirrored (selfie), this keeps aim and particles aligned with what the user sees, and bill text renders un-mirrored.
- **Exact public names** (consumed across tasks): `classifyHand`, `fingerExtended`, `LM`; `createHandFiringState`, `updateFiring`; `createSystem`, `spawnBurst`, `step`, `MAX_PARTICLES`; `createAudio`; `createRenderer`; vec helpers `sub`, `len`, `dist`, `normalize`, `angleBetweenDeg`, `rotate`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `package.json` | dev tooling (vitest), `"type":"module"`, scripts |
| `.gitignore` | ignore `node_modules`, coverage |
| `src/vec.js` | pure 2D vector math (shared by gesture + physics) |
| `src/gesture.js` | pure: landmarks → `{ isGunShape, tip, aim, thumbAngle, fingers }` |
| `src/firing.js` | pure per-hand state machine (cock → fire → re-cock) |
| `src/physics.js` | pure particle system: spawn burst + integrate + cull |
| `src/audio.js` | Web Audio synthesized SFX (fire / cock), mute toggle |
| `src/render.js` | Canvas 2D: mirrored feed, bills, flash, shell, smoke, status |
| `src/main.js` | orchestration: camera, model, RAF loop, UI, error states |
| `index.html` | markup + minimal CSS, start & error overlays |
| `README.md` | run locally + deploy |
| `test/*.test.js` | vitest specs for the pure/testable modules |

---

## Task 1: Project scaffolding & test harness

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `test/smoke.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm test` (vitest) and `npm run serve` command for later tasks.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "cash-cannon",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Finger-gun hand-tracking money cannon in the browser.",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "serve": "python3 -m http.server 8000"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```gitignore
node_modules/
coverage/
.DS_Store
```

- [ ] **Step 3: Create `test/smoke.test.js`** (proves the harness runs)

```js
import { expect, test } from 'vitest';

test('vitest harness runs', () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 4: Install and run**

Run: `npm install && npm test`
Expected: vitest reports `1 passed` for `test/smoke.test.js`.

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore test/smoke.test.js
git commit -m "chore: scaffold project with vitest harness"
```

---

## Task 2: Vector math (`src/vec.js`)

**Files:**
- Create: `src/vec.js`
- Test: `test/vec.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `sub(a, b) -> {x, y}`
  - `len(v) -> number`
  - `dist(a, b) -> number`
  - `normalize(v) -> {x, y}` (unit vector; `{x:0,y:0}` if zero-length)
  - `angleBetweenDeg(a, b) -> number` (0..180)
  - `rotate(v, deg) -> {x, y}` (standard 2D rotation; +deg rotates x→y)

- [ ] **Step 1: Write the failing test** — `test/vec.test.js`

```js
import { describe, expect, test } from 'vitest';
import { sub, len, dist, normalize, angleBetweenDeg, rotate } from '../src/vec.js';

describe('vec', () => {
  test('sub and len', () => {
    expect(sub({ x: 3, y: 5 }, { x: 1, y: 2 })).toEqual({ x: 2, y: 3 });
    expect(len({ x: 3, y: 4 })).toBe(5);
  });
  test('dist', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
  test('normalize returns unit vector, guards zero', () => {
    const n = normalize({ x: 0, y: 8 });
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBeCloseTo(1);
    expect(normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
  test('angleBetweenDeg', () => {
    expect(angleBetweenDeg({ x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
    expect(angleBetweenDeg({ x: 1, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0);
  });
  test('rotate 90deg', () => {
    const r = rotate({ x: 1, y: 0 }, 90);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/vec.test.js`
Expected: FAIL — cannot resolve `../src/vec.js`.

- [ ] **Step 3: Write minimal implementation** — `src/vec.js`

```js
export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function len(v) {
  return Math.hypot(v.x, v.y);
}

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function normalize(v) {
  const l = Math.hypot(v.x, v.y);
  if (l === 0) return { x: 0, y: 0 };
  return { x: v.x / l, y: v.y / l };
}

export function angleBetweenDeg(a, b) {
  const la = Math.hypot(a.x, a.y);
  const lb = Math.hypot(b.x, b.y);
  if (la === 0 || lb === 0) return 0;
  let c = (a.x * b.x + a.y * b.y) / (la * lb);
  c = Math.max(-1, Math.min(1, c));
  return (Math.acos(c) * 180) / Math.PI;
}

export function rotate(v, deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/vec.test.js`
Expected: PASS — all vec tests green.

- [ ] **Step 5: Commit**

```bash
git add src/vec.js test/vec.test.js
git commit -m "feat: add 2D vector math helpers"
```

---

## Task 3: Gesture classification (`src/gesture.js`)

**Files:**
- Create: `src/gesture.js`
- Test: `test/gesture.test.js`

**Interfaces:**
- Consumes: `sub, normalize, dist, angleBetweenDeg` from `src/vec.js`.
- Produces:
  - `LM` — landmark index constants.
  - `fingerExtended(lm, tipIdx, pipIdx, wristIdx=0) -> boolean`
  - `classifyHand(lm) -> { isGunShape, tip:{x,y}, aim:{x,y}, thumbAngle:number, fingers:{indexExtended,middleExtended,ringExtended,pinkyExtended} }`
  - `lm` is an array of ≥21 points `{x, y}` in any consistent 2D space.

- [ ] **Step 1: Write the failing test** — `test/gesture.test.js`

```js
import { describe, expect, test } from 'vitest';
import { classifyHand } from '../src/gesture.js';

// 21 MediaPipe landmarks in normalized space (origin top-left, y down).
function gunHand(thumb) {
  const lm = [
    { x: 0.50, y: 0.90 }, // 0 wrist
    { x: 0.42, y: 0.82 }, // 1 thumb cmc
    { x: 0.40, y: 0.74 }, // 2 thumb mcp
    { x: 0.33, y: 0.70 }, // 3 thumb ip
    thumb === 'up' ? { x: 0.26, y: 0.66 } : { x: 0.42, y: 0.58 }, // 4 thumb tip
    { x: 0.50, y: 0.62 }, // 5 index mcp
    { x: 0.50, y: 0.50 }, // 6 index pip
    { x: 0.50, y: 0.40 }, // 7 index dip
    { x: 0.50, y: 0.30 }, // 8 index tip
    { x: 0.56, y: 0.62 }, // 9 middle mcp
    { x: 0.56, y: 0.58 }, // 10 middle pip
    { x: 0.55, y: 0.63 }, // 11 middle dip
    { x: 0.55, y: 0.66 }, // 12 middle tip (curled)
    { x: 0.60, y: 0.63 }, // 13 ring mcp
    { x: 0.60, y: 0.59 }, // 14 ring pip
    { x: 0.59, y: 0.64 }, // 15 ring dip
    { x: 0.59, y: 0.67 }, // 16 ring tip (curled)
    { x: 0.64, y: 0.64 }, // 17 pinky mcp
    { x: 0.64, y: 0.60 }, // 18 pinky pip
    { x: 0.63, y: 0.65 }, // 19 pinky dip
    { x: 0.63, y: 0.68 }, // 20 pinky tip (curled)
  ];
  return lm;
}

function openHand() {
  const lm = gunHand('up').slice();
  // extend middle, ring, pinky (tips far above wrist)
  lm[12] = { x: 0.56, y: 0.28 };
  lm[16] = { x: 0.62, y: 0.30 };
  lm[20] = { x: 0.68, y: 0.34 };
  return lm;
}

describe('classifyHand', () => {
  test('detects gun shape (index only)', () => {
    const h = classifyHand(gunHand('up'));
    expect(h.isGunShape).toBe(true);
    expect(h.fingers.indexExtended).toBe(true);
    expect(h.fingers.middleExtended).toBe(false);
  });

  test('open hand is not a gun', () => {
    expect(classifyHand(openHand()).isGunShape).toBe(false);
  });

  test('aim points along the index finger (up = -y here)', () => {
    const h = classifyHand(gunHand('up'));
    expect(h.aim.y).toBeLessThan(-0.9); // near (0,-1)
    expect(Math.abs(h.aim.x)).toBeLessThan(0.1);
  });

  test('thumb up gives a larger angle than thumb down', () => {
    const up = classifyHand(gunHand('up')).thumbAngle;
    const down = classifyHand(gunHand('down')).thumbAngle;
    expect(up).toBeGreaterThan(35);
    expect(down).toBeLessThan(18);
    expect(up).toBeGreaterThan(down);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/gesture.test.js`
Expected: FAIL — cannot resolve `../src/gesture.js`.

- [ ] **Step 3: Write minimal implementation** — `src/gesture.js`

```js
import { sub, normalize, dist, angleBetweenDeg } from './vec.js';

// MediaPipe hand landmark indices.
export const LM = {
  WRIST: 0,
  THUMB_MCP: 2,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_TIP: 8,
  MIDDLE_PIP: 10,
  MIDDLE_TIP: 12,
  RING_PIP: 14,
  RING_TIP: 16,
  PINKY_PIP: 18,
  PINKY_TIP: 20,
};

// A finger is extended when its tip is farther from the wrist than its PIP joint.
export function fingerExtended(lm, tipIdx, pipIdx, wristIdx = LM.WRIST) {
  return dist(lm[tipIdx], lm[wristIdx]) > dist(lm[pipIdx], lm[wristIdx]);
}

export function classifyHand(lm) {
  const indexExtended = fingerExtended(lm, LM.INDEX_TIP, LM.INDEX_PIP);
  const middleExtended = fingerExtended(lm, LM.MIDDLE_TIP, LM.MIDDLE_PIP);
  const ringExtended = fingerExtended(lm, LM.RING_TIP, LM.RING_PIP);
  const pinkyExtended = fingerExtended(lm, LM.PINKY_TIP, LM.PINKY_PIP);

  const isGunShape = indexExtended && !middleExtended && !ringExtended && !pinkyExtended;

  const aim = normalize(sub(lm[LM.INDEX_TIP], lm[LM.INDEX_MCP]));
  const thumbVec = sub(lm[LM.THUMB_TIP], lm[LM.THUMB_MCP]);
  const indexProx = sub(lm[LM.INDEX_PIP], lm[LM.INDEX_MCP]);
  const thumbAngle = angleBetweenDeg(thumbVec, indexProx);

  return {
    isGunShape,
    tip: { x: lm[LM.INDEX_TIP].x, y: lm[LM.INDEX_TIP].y },
    aim,
    thumbAngle,
    fingers: { indexExtended, middleExtended, ringExtended, pinkyExtended },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/gesture.test.js`
Expected: PASS — all gesture tests green.

- [ ] **Step 5: Commit**

```bash
git add src/gesture.js test/gesture.test.js
git commit -m "feat: classify finger-gun gesture from hand landmarks"
```

---

## Task 4: Firing state machine (`src/firing.js`)

**Files:**
- Create: `src/firing.js`
- Test: `test/firing.test.js`

**Interfaces:**
- Consumes: nothing (operates on the *shape* of a `classifyHand` result).
- Produces:
  - `createHandFiringState() -> { phase, thumb, lostFrames, lastFireMs }`
  - `updateFiring(state, hand, nowMs, cfg?) -> { didFire:boolean, tip?, aim? }`
    - `hand` = `{ isGunShape, tip, aim, thumbAngle }` or `null` (no hand this frame).
    - `phase` ∈ `NO_GUN | GUN_IDLE | COCKED | FIRED`.
    - `cfg` defaults: `{ thumbUpDeg:32, thumbDownDeg:18, graceFrames:6, cooldownMs:120 }`.

- [ ] **Step 1: Write the failing test** — `test/firing.test.js`

```js
import { describe, expect, test } from 'vitest';
import { createHandFiringState, updateFiring } from '../src/firing.js';

const GUN = (thumbAngle) => ({ isGunShape: true, tip: { x: 1, y: 2 }, aim: { x: 0, y: -1 }, thumbAngle });
const UP = 50;   // clearly above thumbUpDeg
const DOWN = 5;  // clearly below thumbDownDeg

describe('updateFiring', () => {
  test('forming a gun with thumb already down does NOT fire', () => {
    const s = createHandFiringState();
    let now = 0;
    for (let i = 0; i < 10; i++) {
      const r = updateFiring(s, GUN(DOWN), (now += 16));
      expect(r.didFire).toBe(false);
    }
    expect(s.phase).toBe('GUN_IDLE');
  });

  test('cock then drop fires exactly once', () => {
    const s = createHandFiringState();
    let now = 0;
    updateFiring(s, GUN(UP), (now += 16));   // cock
    expect(s.phase).toBe('COCKED');
    const fire = updateFiring(s, GUN(DOWN), (now += 200)); // drop
    expect(fire.didFire).toBe(true);
    expect(fire.tip).toEqual({ x: 1, y: 2 });
    // holding down does not refire
    const again = updateFiring(s, GUN(DOWN), (now += 200));
    expect(again.didFire).toBe(false);
  });

  test('must re-cock (thumb up) before firing again', () => {
    const s = createHandFiringState();
    let now = 0;
    updateFiring(s, GUN(UP), (now += 16));
    expect(updateFiring(s, GUN(DOWN), (now += 200)).didFire).toBe(true);
    updateFiring(s, GUN(UP), (now += 200));   // re-cock
    expect(updateFiring(s, GUN(DOWN), (now += 200)).didFire).toBe(true);
  });

  test('cooldown blocks a too-fast second shot', () => {
    const s = createHandFiringState();
    let now = 1000;
    updateFiring(s, GUN(UP), now);
    expect(updateFiring(s, GUN(DOWN), (now += 200)).didFire).toBe(true);
    updateFiring(s, GUN(UP), (now += 10));    // re-cock fast
    expect(updateFiring(s, GUN(DOWN), (now += 10)).didFire).toBe(false); // within 120ms
  });

  test('losing the gun beyond grace resets to NO_GUN', () => {
    const s = createHandFiringState();
    let now = 0;
    updateFiring(s, GUN(UP), (now += 16)); // COCKED
    for (let i = 0; i < 6; i++) updateFiring(s, null, (now += 16)); // within grace
    expect(s.phase).toBe('COCKED');
    updateFiring(s, null, (now += 16)); // 7th absent frame > grace
    expect(s.phase).toBe('NO_GUN');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/firing.test.js`
Expected: FAIL — cannot resolve `../src/firing.js`.

- [ ] **Step 3: Write minimal implementation** — `src/firing.js`

```js
const DEFAULTS = { thumbUpDeg: 32, thumbDownDeg: 18, graceFrames: 6, cooldownMs: 120 };

export function createHandFiringState() {
  return { phase: 'NO_GUN', thumb: 'down', lostFrames: 0, lastFireMs: -Infinity };
}

// hand: { isGunShape, tip, aim, thumbAngle } | null
export function updateFiring(state, hand, nowMs, cfg = DEFAULTS) {
  if (!hand || !hand.isGunShape) {
    state.lostFrames += 1;
    if (state.lostFrames > cfg.graceFrames) {
      state.phase = 'NO_GUN';
      state.thumb = 'down';
    }
    return { didFire: false };
  }
  state.lostFrames = 0;

  // Debounced thumb position (hysteresis) + edge detection.
  let thumbEvent = null;
  if (state.thumb === 'down' && hand.thumbAngle >= cfg.thumbUpDeg) {
    state.thumb = 'up';
    thumbEvent = 'toUp';
  } else if (state.thumb === 'up' && hand.thumbAngle <= cfg.thumbDownDeg) {
    state.thumb = 'down';
    thumbEvent = 'toDown';
  }

  let didFire = false;
  switch (state.phase) {
    case 'NO_GUN':
      state.phase = state.thumb === 'up' ? 'COCKED' : 'GUN_IDLE';
      break;
    case 'GUN_IDLE':
      if (state.thumb === 'up') state.phase = 'COCKED';
      break;
    case 'COCKED':
      if (thumbEvent === 'toDown') {
        if (nowMs - state.lastFireMs >= cfg.cooldownMs) {
          didFire = true;
          state.lastFireMs = nowMs;
        }
        state.phase = 'FIRED';
      }
      break;
    case 'FIRED':
      if (thumbEvent === 'toUp') state.phase = 'COCKED';
      break;
  }

  return { didFire, tip: hand.tip, aim: hand.aim };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/firing.test.js`
Expected: PASS — all firing tests green.

- [ ] **Step 5: Commit**

```bash
git add src/firing.js test/firing.test.js
git commit -m "feat: single-action finger-gun firing state machine"
```

---

## Task 5: Particle physics (`src/physics.js`)

**Files:**
- Create: `src/physics.js`
- Test: `test/physics.test.js`

**Interfaces:**
- Consumes: `rotate` from `src/vec.js`.
- Produces:
  - `MAX_PARTICLES` (number).
  - `createSystem() -> { particles: [] }`
  - `spawnBurst(sys, { tip:{x,y}, aim:{x,y}, nowMs?, rng? }) -> void` — appends flash, smoke, 3–6 bills, 1 shell; enforces the cap.
  - `step(sys, dt, bounds:{width,height}) -> void` — integrates gravity/drag/rotation, culls dead/off-screen particles.
  - Particle kinds: `flash | smoke | bill | shell`. Bills carry `flip`/`vflip` (tumble); flash/smoke carry `r` (radius).

- [ ] **Step 1: Write the failing test** — `test/physics.test.js`

```js
import { describe, expect, test } from 'vitest';
import { createSystem, spawnBurst, step, MAX_PARTICLES } from '../src/physics.js';

const TIP = { x: 100, y: 100 };
const AIM = { x: 1, y: 0 };
const BOUNDS = { width: 1000, height: 1000 };
const count = (sys, kind) => sys.particles.filter((p) => p.kind === kind).length;

describe('physics', () => {
  test('spawnBurst adds flash, smoke, shell and 3..6 bills', () => {
    const sys = createSystem();
    spawnBurst(sys, { tip: TIP, aim: AIM, rng: () => 0 }); // min bills
    expect(count(sys, 'flash')).toBe(1);
    expect(count(sys, 'smoke')).toBe(1);
    expect(count(sys, 'shell')).toBe(1);
    expect(count(sys, 'bill')).toBe(3);

    const sys2 = createSystem();
    spawnBurst(sys2, { tip: TIP, aim: AIM, rng: () => 0.999 }); // max bills
    expect(count(sys2, 'bill')).toBe(6);
  });

  test('gravity increases downward velocity and y', () => {
    const sys = createSystem();
    spawnBurst(sys, { tip: TIP, aim: AIM, rng: () => 0.5 });
    const bill = sys.particles.find((p) => p.kind === 'bill');
    const y0 = bill.y;
    const vy0 = bill.vy;
    step(sys, 0.1, BOUNDS);
    expect(bill.vy).toBeGreaterThan(vy0);
    expect(bill.y).toBeGreaterThan(y0);
  });

  test('drag reduces horizontal speed magnitude', () => {
    const sys = createSystem();
    sys.particles.push({ kind: 'bill', x: 0, y: 0, vx: 1000, vy: 0, rot: 0, vrot: 0, flip: 0, vflip: 0, life: 5, maxLife: 5 });
    step(sys, 0.1, BOUNDS);
    expect(Math.abs(sys.particles[0].vx)).toBeLessThan(1000);
  });

  test('off-screen and dead particles are culled', () => {
    const sys = createSystem();
    sys.particles.push({ kind: 'bill', x: 0, y: 5000, vx: 0, vy: 0, rot: 0, vrot: 0, flip: 0, vflip: 0, life: 5, maxLife: 5 });
    sys.particles.push({ kind: 'flash', x: 0, y: 0, vx: 0, vy: 0, rot: 0, vrot: 0, r: 10, life: 0.02, maxLife: 0.09 });
    step(sys, 0.1, BOUNDS);
    expect(sys.particles.length).toBe(0);
  });

  test('particle cap is enforced by spawnBurst', () => {
    const sys = createSystem();
    for (let i = 0; i < MAX_PARTICLES + 100; i++) {
      sys.particles.push({ kind: 'bill', x: 0, y: 0, vx: 0, vy: 0, rot: 0, vrot: 0, flip: 0, vflip: 0, life: 5, maxLife: 5 });
    }
    spawnBurst(sys, { tip: TIP, aim: AIM, rng: () => 0.5 });
    expect(sys.particles.length).toBeLessThanOrEqual(MAX_PARTICLES);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/physics.test.js`
Expected: FAIL — cannot resolve `../src/physics.js`.

- [ ] **Step 3: Write minimal implementation** — `src/physics.js`

```js
import { rotate } from './vec.js';

const GRAVITY = 2000;        // px/s^2
const DRAG = 0.55;           // fraction of velocity retained per second
export const MAX_PARTICLES = 400;

export function createSystem() {
  return { particles: [] };
}

export function spawnBurst(sys, { tip, aim, nowMs = 0, rng = Math.random }) {
  // Muzzle flash.
  sys.particles.push({
    kind: 'flash', x: tip.x, y: tip.y, vx: 0, vy: 0, rot: 0, vrot: 0,
    r: 60, life: 0.09, maxLife: 0.09,
  });

  // Smoke puff (drifts along aim, rises, expands).
  sys.particles.push({
    kind: 'smoke', x: tip.x, y: tip.y, vx: aim.x * 40, vy: aim.y * 40 - 30,
    rot: 0, vrot: 0, r: 22, life: 0.5, maxLife: 0.5,
  });

  // Bills — tight burst with upward recoil bias + cone spread.
  const billCount = 3 + Math.floor(rng() * 4); // 3..6
  for (let i = 0; i < billCount; i++) {
    const spreadDeg = (rng() - 0.5) * 24;   // +/- 12 deg cone
    const recoilDeg = -8 - rng() * 6;        // bias toward screen-up (-y)
    const dir = rotate(aim, spreadDeg + recoilDeg);
    const speed = 900 + rng() * 500;         // 900..1400 px/s
    sys.particles.push({
      kind: 'bill', x: tip.x, y: tip.y,
      vx: dir.x * speed, vy: dir.y * speed,
      rot: rng() * Math.PI * 2, vrot: (rng() - 0.5) * 16,
      flip: rng() * Math.PI * 2, vflip: 6 + rng() * 8,
      life: 2.6, maxLife: 2.6,
    });
  }

  // Shell casing — ejected roughly perpendicular to aim, with a little pop up.
  const shellDir = rotate(aim, 80 + rng() * 20);
  const shellSpeed = 300 + rng() * 200;
  sys.particles.push({
    kind: 'shell', x: tip.x, y: tip.y,
    vx: shellDir.x * shellSpeed, vy: shellDir.y * shellSpeed - 120,
    rot: 0, vrot: (rng() - 0.5) * 30, life: 1.4, maxLife: 1.4,
  });

  enforceCap(sys);
}

function enforceCap(sys) {
  if (sys.particles.length <= MAX_PARTICLES) return;
  let overflow = sys.particles.length - MAX_PARTICLES;
  sys.particles = sys.particles.filter((p) => {
    if (overflow > 0 && p.kind === 'bill') {
      overflow -= 1;
      return false; // drop oldest bills first
    }
    return true;
  });
}

export function step(sys, dt, bounds) {
  const dragFactor = Math.pow(DRAG, dt);
  for (const p of sys.particles) {
    if (p.kind === 'bill' || p.kind === 'shell') {
      p.vy += GRAVITY * dt;
      p.vx *= dragFactor;
      p.vy *= dragFactor;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vrot * dt;
    if (p.kind === 'bill') p.flip += p.vflip * dt;
    if (p.kind === 'smoke') p.r += 40 * dt;
    p.life -= dt;
  }
  const maxY = bounds.height + 80;
  sys.particles = sys.particles.filter((p) => p.life > 0 && p.y < maxY);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/physics.test.js`
Expected: PASS — all physics tests green.

- [ ] **Step 5: Commit**

```bash
git add src/physics.js test/physics.test.js
git commit -m "feat: dollar-bill particle system with recoil, shell, smoke"
```

---

## Task 6: Synthesized audio (`src/audio.js`)

**Files:**
- Create: `src/audio.js`
- Test: `test/audio.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `createAudio(makeCtx?) -> { unlock(), setEnabled(bool), isEnabled(), fire(), cock() }`
  - `makeCtx` is an optional factory returning an AudioContext-like object (injected for tests). In the browser it defaults to `window.AudioContext || window.webkitAudioContext`.

- [ ] **Step 1: Write the failing test** — `test/audio.test.js`

```js
import { describe, expect, test } from 'vitest';
import { createAudio } from '../src/audio.js';

function fakeCtx() {
  const calls = { osc: 0, buf: 0 };
  const node = { connect: (dest) => dest, start() {}, stop() {} };
  return {
    calls,
    currentTime: 0,
    sampleRate: 44100,
    state: 'running',
    destination: {},
    resume() {},
    createOscillator() {
      calls.osc++;
      return { type: '', frequency: { setValueAtTime() {} }, ...node };
    },
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, ...node };
    },
    createBiquadFilter() {
      return { type: '', frequency: { setValueAtTime() {} }, ...node };
    },
    createBuffer(_ch, n) {
      return { getChannelData: () => new Float32Array(n) };
    },
    createBufferSource() {
      calls.buf++;
      return { buffer: null, ...node };
    },
  };
}

describe('createAudio', () => {
  test('fire() builds oscillators + a noise buffer when enabled', () => {
    const ctx = fakeCtx();
    const audio = createAudio(() => ctx);
    audio.fire();
    expect(ctx.calls.osc).toBeGreaterThanOrEqual(1);
    expect(ctx.calls.buf).toBe(1);
  });

  test('muting prevents sound generation', () => {
    const ctx = fakeCtx();
    const audio = createAudio(() => ctx);
    audio.setEnabled(false);
    audio.fire();
    audio.cock();
    expect(ctx.calls.osc).toBe(0);
    expect(ctx.calls.buf).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/audio.test.js`
Expected: FAIL — cannot resolve `../src/audio.js`.

- [ ] **Step 3: Write minimal implementation** — `src/audio.js`

```js
export function createAudio(makeCtx) {
  const Native =
    typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  const factory = makeCtx || (Native ? () => new Native() : null);

  let ctx = null;
  let enabled = true;

  function ensure() {
    if (!factory) return null;
    if (!ctx) ctx = factory();
    return ctx;
  }

  function unlock() {
    const c = ensure();
    if (c && c.state === 'suspended' && c.resume) c.resume();
  }

  function tone(c, type, freq, t0, dur, gain) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noiseBurst(c, t0, dur, gain) {
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource();
    src.buffer = buf;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1900, t0);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    src.connect(lp).connect(g).connect(c.destination);
    src.start(t0);
  }

  function fire() {
    if (!enabled) return;
    const c = ensure();
    if (!c) return;
    const t = c.currentTime;
    noiseBurst(c, t, 0.12, 0.5);            // gunshot crack
    tone(c, 'sine', 90, t, 0.14, 0.5);      // low thump
    tone(c, 'square', 1200, t + 0.02, 0.12, 0.18); // "cha"
    tone(c, 'square', 1750, t + 0.10, 0.18, 0.18); // "ching"
  }

  function cock() {
    if (!enabled) return;
    const c = ensure();
    if (!c) return;
    tone(c, 'square', 520, c.currentTime, 0.04, 0.12); // hammer click
  }

  return {
    unlock,
    setEnabled: (v) => {
      enabled = !!v;
    },
    isEnabled: () => enabled,
    fire,
    cock,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/audio.test.js`
Expected: PASS — both audio tests green.

- [ ] **Step 5: Commit**

```bash
git add src/audio.js test/audio.test.js
git commit -m "feat: synthesized gunshot + cha-ching audio"
```

---

## Task 7: Canvas renderer (`src/render.js`)

**Files:**
- Create: `src/render.js`
- Test: `test/render.test.js`

**Interfaces:**
- Consumes: particle objects from `physics.js` (fields `kind, x, y, rot, r, flip, life, maxLife`).
- Produces:
  - `createRenderer(canvas) -> { draw(state) }`
  - `state = { video, particles, bounds:{width,height}, shake:{x,y}, status:[{cocked:boolean}] }`
  - Draws the mirrored video, then particles, then per-hand status dots.

- [ ] **Step 1: Write the failing test** — `test/render.test.js`

```js
import { describe, expect, test } from 'vitest';
import { createRenderer } from '../src/render.js';

function fakeCtx() {
  const calls = { clearRect: 0, fill: 0, drawImage: 0 };
  const grad = { addColorStop() {} };
  return {
    calls,
    setTransform() {},
    clearRect() { calls.clearRect++; },
    save() {}, restore() {},
    translate() {}, scale() {}, rotate() {},
    beginPath() {}, closePath() {}, moveTo() {}, arc() {}, arcTo() {},
    fillRect() {}, strokeRect() {}, stroke() {},
    fill() { calls.fill++; },
    drawImage() { calls.drawImage++; },
    fillText() {},
    createLinearGradient() { return grad; },
    createRadialGradient() { return grad; },
    set fillStyle(_) {}, set strokeStyle(_) {}, set lineWidth(_) {},
    set globalAlpha(_) {}, set font(_) {}, set textAlign(_) {}, set textBaseline(_) {},
  };
}

function fakeCanvas() {
  const ctx = fakeCtx();
  return { ctx, getContext: () => ctx };
}

describe('createRenderer', () => {
  test('draws a frame with one of each particle kind without throwing', () => {
    const canvas = fakeCanvas();
    const r = createRenderer(canvas);
    const particles = [
      { kind: 'flash', x: 10, y: 10, r: 40, rot: 0, life: 0.05, maxLife: 0.09 },
      { kind: 'smoke', x: 10, y: 10, r: 20, rot: 0, life: 0.3, maxLife: 0.5 },
      { kind: 'shell', x: 10, y: 10, rot: 1, life: 1, maxLife: 1.4 },
      { kind: 'bill', x: 10, y: 10, rot: 0.3, flip: 0.5, life: 2, maxLife: 2.6 },
    ];
    r.draw({
      video: null,
      particles,
      bounds: { width: 200, height: 200 },
      shake: { x: 0, y: 0 },
      status: [{ cocked: true }, { cocked: false }],
    });
    expect(canvas.ctx.calls.clearRect).toBe(1);
    expect(canvas.ctx.calls.fill).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/render.test.js`
Expected: FAIL — cannot resolve `../src/render.js`.

- [ ] **Step 3: Write minimal implementation** — `src/render.js`

```js
const BILL_W = 84;
const BILL_H = 40;

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

  const g = ctx.createLinearGradient(0, -BILL_H / 2, 0, BILL_H / 2);
  g.addColorStop(0, '#3aa76d');
  g.addColorStop(1, '#1f7a4d');
  ctx.fillStyle = g;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/render.test.js`
Expected: PASS — renderer smoke test green.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — all specs across vec/gesture/firing/physics/audio/render.

- [ ] **Step 6: Commit**

```bash
git add src/render.js test/render.test.js
git commit -m "feat: Canvas 2D renderer for feed, bills, flash, shell, smoke"
```

---

## Task 8: HTML shell, styles, and overlays (`index.html`)

**Files:**
- Create: `index.html`

**Interfaces:**
- Consumes: nothing yet (script wired in Task 9).
- Produces DOM the orchestrator (Task 9) queries by id:
  - `#feed` (canvas), `#cam` (hidden video), `#start` (overlay), `#startBtn`, `#hint`,
    `#error` (overlay), `#errorMsg`, `#retryBtn`, `#sound` (toggle button).

- [ ] **Step 1: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Cash Cannon</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      html, body { margin: 0; height: 100%; background: #07100b; overflow: hidden; }
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
      #feed { position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; }
      #cam { position: fixed; width: 2px; height: 2px; opacity: 0; pointer-events: none; left: -10px; }

      .overlay {
        position: fixed; inset: 0; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 22px; text-align: center;
        background: radial-gradient(120% 120% at 50% 30%, #0d2318 0%, #050b08 70%);
        color: #eafff1; padding: 24px;
      }
      .hidden { display: none !important; }
      .title {
        font-size: clamp(40px, 9vw, 96px); font-weight: 800; letter-spacing: -0.03em;
        margin: 0; background: linear-gradient(180deg, #7ef3b0, #29d67a 55%, #14663f);
        -webkit-background-clip: text; background-clip: text; color: transparent;
        text-shadow: 0 2px 40px rgba(41, 214, 122, 0.25);
      }
      .hint { margin: 0; max-width: 30ch; opacity: 0.8; font-size: clamp(14px, 2.4vw, 18px); line-height: 1.5; }
      .btn {
        appearance: none; border: 0; cursor: pointer; font-weight: 700;
        font-size: 18px; color: #05130c; padding: 16px 30px; border-radius: 999px;
        background: linear-gradient(180deg, #6ef0a6, #23c974); box-shadow: 0 10px 30px rgba(35, 201, 116, 0.4);
        transition: transform 0.08s ease, box-shadow 0.2s ease;
      }
      .btn:hover { transform: translateY(-1px); }
      .btn:active { transform: translateY(1px) scale(0.99); }

      #sound {
        position: fixed; top: 14px; right: 14px; z-index: 5;
        width: 46px; height: 46px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.18);
        background: rgba(6, 20, 13, 0.55); backdrop-filter: blur(8px); color: #eafff1;
        font-size: 20px; cursor: pointer; display: none; align-items: center; justify-content: center;
      }
      #error .title { font-size: clamp(24px, 5vw, 40px); }
      #errorMsg { max-width: 34ch; opacity: 0.85; line-height: 1.55; }
    </style>
  </head>
  <body>
    <canvas id="feed"></canvas>
    <video id="cam" playsinline muted></video>

    <button id="sound" title="Toggle sound" aria-label="Toggle sound">🔊</button>

    <div id="start" class="overlay">
      <h1 class="title">Cash Cannon</h1>
      <p id="hint" class="hint">
        Make a finger gun 👉 — thumb <b>up</b> to cock, drop it to <b>fire</b>. Point to aim.
      </p>
      <button id="startBtn" class="btn">Enable Camera</button>
    </div>

    <div id="error" class="overlay hidden">
      <h1 class="title">Hold up 🤠</h1>
      <p id="errorMsg" class="hint"></p>
      <button id="retryBtn" class="btn">Try Again</button>
    </div>

    <script type="module" src="./src/main.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Verify it loads**

Run: `npm run serve` then open `http://localhost:8000`.
Expected: the "Cash Cannon" start screen renders with the gradient title, hint, and **Enable Camera** button. (Clicking does nothing yet — `main.js` arrives in Task 9. The browser console will show a 404/really an empty module for `./src/main.js` until then; that's expected.)

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: landing + error overlays and canvas shell"
```

---

## Task 9: Orchestration & camera loop (`src/main.js`)

**Files:**
- Create: `src/main.js`

**Interfaces:**
- Consumes: `classifyHand` (gesture), `createHandFiringState`/`updateFiring` (firing), `createSystem`/`spawnBurst`/`step` (physics), `createRenderer` (render), `createAudio` (audio); MediaPipe `HandLandmarker`/`FilesetResolver` from CDN; DOM ids from Task 8.
- Produces: the running app (no exports). Wires the per-frame pipeline and all error states.

- [ ] **Step 1: Create `src/main.js`**

```js
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
const prevPhase = new Map();    // handedness label -> last phase (for cock click)

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
    prevPhase.set(label, state.phase);

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
```

- [ ] **Step 2: Manual verification — happy path**

Run: `npm run serve`, open `http://localhost:8000`, click **Enable Camera**, allow the camera.
Expected:
- Mirrored webcam feed fills the screen; the start overlay disappears; the 🔊 button appears.
- Make a finger gun with the thumb up → a status dot near the top turns green.
- Drop the thumb → a burst of glossy `$100` bills fires from your fingertip along the pointing direction, with a muzzle flash, a shell casing flipping out, a small smoke puff, a brief screen shake, and a cha-ching.
- You must raise the thumb and drop it again to fire the next shot (no machine-gun).
- Two hands both work independently.

- [ ] **Step 3: Manual verification — error paths**

- Click **Enable Camera** and **deny** permission → friendly "permission was blocked" overlay with Try Again; granting on retry works.
- Open `index.html` via `file://` → the secure-context overlay explains to use `npm run serve`.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat: wire camera, hand tracking, firing, particles, audio"
```

---

## Task 10: README & final verification

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: run/deploy docs.

- [ ] **Step 1: Create `README.md`**

````markdown
# Cash Cannon 💵🔫

Turn on your camera, make a finger gun, cock your thumb, and **fire money**.
Runs entirely in your browser — hand tracking via MediaPipe, no backend.

## How to play

1. Click **Enable Camera** and allow access.
2. Make a finger gun 👉 (index out, other fingers curled).
3. **Thumb up = cocked.** Drop the thumb to fire a burst of bills along your aim.
4. Raise and drop the thumb again for each shot. Two hands = dual wield.
5. Toggle sound with the 🔊 button.

## Run locally

The camera needs a secure context, so open it via `localhost` (not `file://`):

```bash
npm run serve      # python3 -m http.server 8000
# then visit http://localhost:8000
```

Any static server works (e.g. `npx serve`). First load fetches the tracking
model from a CDN, so you need internet the first time.

## Deploy

It's a static site — push the folder to GitHub Pages, Netlify, or Vercel.
Those serve HTTPS, so the camera works with no extra setup. Nothing to build.

## Develop

```bash
npm install
npm test           # run the unit tests (vitest)
npm run test:watch # watch mode
```

Pure logic lives in `src/{vec,gesture,firing,physics}.js` and is unit-tested.
Side effects (camera, model, canvas, audio) live in `src/{main,render,audio}.js`.
````

- [ ] **Step 2: Run the full test suite one last time**

Run: `npm test`
Expected: PASS — every spec green.

- [ ] **Step 3: Final manual smoke test**

Run: `npm run serve`, open `http://localhost:8000`, confirm the full fire flow and the 🔊 toggle work.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README with run and deploy instructions"
```

---

## Self-Review

**Spec coverage:**
- Camera enable + start screen → Tasks 8, 9. ✓
- MediaPipe `HandLandmarker`, 2 hands, GPU→CPU fallback → Task 9. ✓
- Gun detection (extended/curled, aim vector, hysteresis) → Task 3 (`classifyHand`) + Task 4 (thumb hysteresis). ✓
- Super-realistic single-action firing (GUN_IDLE → COCKED → FIRED → re-cock, cooldown, grace) → Task 4. ✓
- Muzzle flash, recoil/muzzle-climb, shell casing, smoke, screen shake → Task 5 (spawn) + Task 7 (draw) + Task 9 (shake). ✓
- Bill physics (gravity, drag, tumble, cull, cap) → Task 5. ✓
- Glossy tasteful bills, mirrored feed, status dot, minimal chrome → Task 7 + Task 8. ✓
- Synthesized sound + mute toggle → Task 6 + Task 9. ✓
- Error handling: permission denied, no camera, model load fail, `file://` → Task 9. ✓
- Build-free static site, `localhost`/deploy → Tasks 1, 8, 10. ✓
- Unit tests for gesture/firing/physics (+ vec, audio, render smoke) → Tasks 2–7. ✓

**Placeholder scan:** No TBD/TODO; every code and test step is complete. ✓

**Type consistency:** Names match across tasks — `classifyHand`→`{isGunShape,tip,aim,thumbAngle}` consumed by `updateFiring`; `updateFiring` returns `{didFire,tip,aim}` consumed by `spawnBurst({tip,aim,nowMs,rng})`; particle fields (`kind,x,y,rot,r,flip,life,maxLife`) produced by `physics.js` and consumed by `render.js`; `createAudio().{fire,cock,unlock,setEnabled,isEnabled}` used in `main.js`. ✓

**Coordinate space:** `main.js` maps to mirrored pixel space once (`(1-x)*w, y*h`); gesture/physics stay space-agnostic; renderer draws bills un-mirrored so text reads correctly. ✓
