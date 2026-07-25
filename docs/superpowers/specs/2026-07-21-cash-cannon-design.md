# Cash Cannon - Design Spec

- **Date:** 2026-07-21
- **Status:** Approved (ready for implementation plan)

## Summary

A fun, browser-based interactive site. The user enables their camera, makes a
finger-gun gesture (index finger extended, thumb up like a cocked hammer), and
when they **drop the thumb** the "gun" fires - glossy dollar bills launch out of
the fingertip with a muzzle flash, recoil, and an ejected shell casing. The
whole thing runs client-side with no backend.

**Vibe:** flashy money (glossy green/gold bills, satisfying) but **minimal and
tasteful** - restrained UI chrome, physics that feel *correct*, no chaotic
particle spam.

## Goals

- Seamless: enable camera → make the gesture → money fires. No configuration.
- **Super realistic firing:** single-action revolver feel - cock (thumb up),
  fire (thumb drop), re-cock to fire again. Muzzle flash, recoil kick, shell
  casing, smoke puff.
- Tasteful physics: bills launch fast along the aim vector, then arc under
  gravity with drag and tumble.
- Self-contained static site: runs from `localhost` now, deploys to any static
  host (GitHub Pages / Netlify / Vercel) later. No build step required to ship.
- One toggle: **Sound FX** (synthesized, no audio files).
- Reliable: graceful handling of permission denial, missing camera, and model
  load failure.

## Non-goals (YAGNI)

- No score/HUD, combos, or leaderboard by default (kept out per user choice;
  trivially addable later).
- No money pile-up / floor accumulation (reads as clutter; against the tasteful
  goal). Bills fall off-screen and fade.
- No backend, accounts, or persistence.
- No extra gestures beyond the finger gun (peace-sign coins, palm bomb, etc.)
  in v1.
- No build tooling / bundler for the shipped site (vitest is dev-only).

## User Experience / Flow

1. **Landing screen:** centered title "Cash Cannon", a one-line how-to
   ("Make a finger gun 👉 - thumb up to cock, drop it to fire"), and a single
   **Enable Camera** button. (A user gesture is required for both camera and
   audio, so this button doubles as the audio-unlock.)
2. On click: request camera. On grant, the model loads (brief "Loading…"
   state), then the mirrored camera feed fills the screen.
3. **Live:** user raises a finger gun. A subtle status dot glows green when a
   gun is locked (tracking feedback). Thumb-drop fires a round of bills from the
   fingertip along the aim direction. Two hands = dual wield (independent).
4. **Chrome:** a small 🔊/🔇 toggle in a corner. Nothing else.

## Architecture

Plain ES modules, loaded directly by the browser via
`<script type="module">`. No bundler.

```
index.html          markup + minimal CSS, canvas + video elements, start screen
src/main.js         orchestration: camera, model init, RAF loop, wires modules
src/gesture.js      PURE: landmarks -> hand state (is-gun, aim, thumb up/down)
src/firing.js       PURE: per-hand firing state machine (cock/fire/re-cock)
src/physics.js      PURE: particle spawn + integration step (gravity/drag/spin)
src/render.js       Canvas 2D: mirrored feed, bills, muzzle flash, shells, smoke
src/audio.js        Web Audio: synthesized cha-ching / gunshot / cock click
test/gesture.test.js
test/firing.test.js
test/physics.test.js
package.json        dev-only: vitest
README.md           how to run locally + deploy
```

**Data flow (per animation frame):**

```
video frame -> HandLandmarker.detectForVideo() -> [hand landmarks]
  for each hand:
    gesture.js  -> { isGun, tip{x,y}, aim{x,y}, thumbAngle }
    firing.js   -> updates state machine, returns fireEvent? (with aim + tip)
    if fireEvent: physics.js spawns a bill burst + shell + muzzle flash
physics.js.step(dt) -> advance all particles
render.js.draw()    -> feed + particles + effects + status dot
audio.js            -> play SFX on fireEvent (if enabled)
```

Separation of concerns: `gesture`, `firing`, and `physics` are pure (no DOM,
no canvas, no globals) so they are unit-testable and hold in context easily.
`render`, `audio`, `main` own the browser/side-effect boundary.

## Hand Tracking & Gesture Detection

**Library:** MediaPipe Tasks Vision `HandLandmarker` (Google's current model),
loaded from the jsDelivr CDN with the GPU delegate, `runningMode: "VIDEO"`,
`numHands: 2`. Returns 21 normalized landmarks per hand.

**Landmark indices (MediaPipe standard):**
- 0 = wrist
- Thumb: 1 CMC, 2 MCP, 3 IP, 4 tip
- Index: 5 MCP, 6 PIP, 7 DIP, 8 tip
- Middle: 9 MCP, 10 PIP, 11 DIP, 12 tip
- Ring: 13 MCP, 14 PIP, 15 DIP, 16 tip
- Pinky: 17 MCP, 18 PIP, 19 DIP, 20 tip

**Finger extended/curled test:** a finger is *extended* when its tip is farther
from the wrist (0) than its PIP joint is; *curled* when closer. (Simple,
rotation-invariant, works for the arbitrary hand orientations of a finger gun.)

**Gun gesture:** index extended AND middle, ring, pinky all curled. Thumb state
is tracked separately (it's the trigger, not part of the gun test). Apply
**hysteresis** (must clearly pass to enter the gun state, and clearly fail to
leave) so detection doesn't flicker frame-to-frame.

**Aim vector:** direction from index MCP (5) → index tip (8), normalized. Bills
spawn at the tip (8) and travel along this vector. Coordinates are mapped into
mirrored canvas space (selfie view) so pointing right on screen shoots right.

**Thumb up/down (the trigger):** measure the angle between the thumb vector
(MCP 2 → tip 4) and the index proximal vector (MCP 5 → PIP 6). Cocked/"up" =
large angle (thumb abducted away from the index). Released/"down" = small angle
(thumb rotated toward the index). Hysteresis thresholds (e.g. up if angle ≳ 35°,
down if ≲ 20°; tuned during implementation, covered by tests).

## Firing Mechanic - "Super Realistic" (single-action)

Per-hand state machine in `firing.js`:

```
NO_GUN ──gun detected──► GUN_IDLE ──thumb up──► COCKED ──thumb drops──► FIRED
  ▲                         │                      ▲                      │
  │                         │                      └──── thumb raised ────┘
  └──────────── gun lost (from any state) ─────────┘         (re-cock)
```

- **GUN_IDLE:** gun formed but not yet cocked (e.g. thumb still down). This is
  the key guard: forming a gun with the thumb already down does **not** fire -
  you must cock first. Never fires from this state.
- **COCKED:** gun held with thumb up (hammer back). Status dot green.
- **Fire trigger:** the thumb crossing the down threshold *from COCKED* emits
  exactly one fire event (edge-triggered, not level-triggered). A shot is only
  possible after a genuine thumb-up → thumb-down transition.
- **Re-cock required:** after firing you must raise the thumb back up
  (COCKED) before the next shot can fire - mimics single-action revolver cocking
  and prevents machine-gun spam.
- **Cooldown:** a minimum time between shots (~120 ms) as a safety debounce even
  if the thumb is flicked very fast.
- **Losing the gun** (hand leaves / gesture breaks) resets to NO_GUN from any
  state.

**Realism effects on each shot (`physics.js` + `render.js`):**
- **Muzzle flash:** bright white→gold radial flash at the fingertip, ~60–90 ms.
- **Recoil / muzzle climb:** launch direction biased a few degrees upward with
  small per-shot randomness; a brief, decaying screen shake (2–4 px) for kick.
  (We can't move the user's hand, so recoil is expressed in the effect.)
- **Shell casing:** a small gold coin/casing ejected roughly perpendicular to
  the aim, spinning, falling under gravity - the "spent round."
- **Smoke:** a small translucent puff at the muzzle that rises and fades.
- **Round size:** a *tight* burst of ~3–6 bills per shot (a discrete "round",
  not a firehose), high initial speed, each with random spin.

## Particle / Bill Physics (`physics.js`, pure)

- State: array of particles `{x, y, vx, vy, rot, vrot, life, kind}` where kind ∈
  {bill, shell, smoke, flash}.
- `spawnBurst(tip, aim, opts)` creates bills (speed ~900–1400 px/s along aim +
  upward recoil bias + cone spread), one shell, one smoke, one flash.
- `step(dt)` integrates: gravity (+y), air drag (velocity *= drag^dt), rotation
  (`rot += vrot*dt`), life decay. Bills fade/return to pool when off-screen or
  life ≤ 0.
- **Particle cap** (e.g. 400) - oldest recycled first - to protect performance.
- Deterministic given inputs + injected RNG, so bursts and the step are testable.

## Rendering (`render.js`, Canvas 2D)

- Canvas sized to viewport (devicePixelRatio-aware), `scaleX(-1)` mirror so the
  feed and particles read as a selfie.
- Draw order: mirrored video → smoke → bills → shells → muzzle flash →
  status dot / UI.
- **Bill look:** rounded-rect with a green vertical gradient, faint gloss
  highlight, "$100" text and a subtle portrait oval. Tumble faked by oscillating
  horizontal scale (`scaleX`) with rotation for a 3D-flip feel.
- Screen shake applied as a small canvas translate that decays per frame.

## Audio (`audio.js`, Web Audio API - synthesized, no files)

- Unlocked by the Enable-Camera click (autoplay policy).
- **Fire SFX:** short noise-burst transient + low thump (the "shot") blended
  with two quick bell tones (the "cha-ching"). Slight random pitch per shot so
  rapid fire doesn't sound identical.
- **Cock click:** a soft click when the thumb returns to COCKED (re-arm).
- Master toggle (🔊/🔇); defaults on after unlock. All synthesized so the site
  stays fully self-contained and offline-capable.

## UI / Minimal Chrome

- Start screen: title, one-line instructions, Enable Camera button.
- Live: mirrored feed, corner 🔊 toggle, subtle status dot (grey = no gun,
  green = cocked/locked). No score or HUD by default.
- Responsive: fills the viewport; works on desktop webcam. (Mobile is a
  nice-to-have, not a target for v1.)

## Error Handling & Edge Cases

- **Camera permission denied / dismissed:** friendly overlay explaining the site
  needs the camera, with a Retry button.
- **No camera device:** clear message.
- **Model / WASM load failure** (offline, CDN blocked): message noting an
  internet connection is needed on first load, with Retry.
- **`file://` (insecure context):** `getUserMedia` is unavailable; detect this
  and show a note telling the user to serve via `localhost` (README has the
  one-liner). This is the single most likely "it doesn't work" trap.
- **Hand leaves frame mid-cock:** state resets cleanly; no stuck/auto fire.
- **Two hands:** independent state machines; either or both can fire.

## Performance

- `requestAnimationFrame` loop; `detectForVideo` throttled to the video frame.
- Particle cap + object pooling to avoid GC churn.
- Canvas cleared/redrawn each frame; effects are cheap 2D primitives.

## Running Locally & Deployment

- **Camera requires a secure context:** `https://` or `localhost` - *not*
  `file://`. To run locally: `python3 -m http.server` (preinstalled on macOS)
  in the project root, then open `http://localhost:8000`.
- **Deploy:** upload the folder to any static host (GitHub Pages / Netlify /
  Vercel). They serve over HTTPS, so the camera works with no extra config.
- The MediaPipe model + WASM load from CDN, so first load needs internet;
  after that the browser caches them.

## Testing

- **Unit (vitest, dev-only):**
  - `gesture.test.js` - synthetic landmark sets → correct is-gun / aim /
    thumb-angle classification, including hysteresis edges.
  - `firing.test.js` - the state machine: cock → fire emits exactly one event,
    re-cock required, cooldown respected, gun-loss resets.
  - `physics.test.js` - spawn counts, integration (gravity/drag), off-screen
    recycling, particle cap, determinism with injected RNG.
- **Manual / live:** camera feed, gesture feel, recoil, sound, error overlays,
  two-hand dual wield. (Vision + rendering can't be meaningfully unit-tested.)

## Tech Choices & Rejected Alternatives

- **MediaPipe HandLandmarker** over TensorFlow.js handpose / handtrack.js:
  higher accuracy, current/maintained, easy CDN load.
- **Canvas 2D** over WebGL/three.js: a tasteful ~dozens-of-bills scene doesn't
  need a GPU engine; 2D yields cleaner glossy bills with less code.
- **Build-free static ES modules** over Vite: keeps the shipped artifact
  drop-anywhere portable; vitest still tests the same modules in Node.
- **Single-action thumb-cock trigger** over continuous "make it rain": reads as
  a real gun, matches the "super realistic" ask, avoids firehose spam.
- **Synthesized Web Audio** over audio files: zero assets, fully self-contained,
  offline-capable.

## Future Toggles (out of scope for v1)

Score/combo HUD, money pile-up physics, extra gestures (peace-sign coin spray,
open-palm money bomb), full-auto mode, shareable clip capture. All fit the
architecture without rework.
