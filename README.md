# Cash Cannon 💵🔫

Turn on your camera, make a finger gun, and **make it rain**.
Runs entirely in your browser with hand tracking via MediaPipe, no backend.

## How to play

1. Click **Enable Camera** and allow access.
2. Make a finger gun (index out, other fingers folded).
3. **Hold the gun shape** and cash streams out of your fingertip. Point to aim.
4. Drop the shape to stop. Two hands = dual wield.
5. Toggle sound with the speaker button.

Tip: good light and a plain background behind your hand make tracking more
reliable. The finger shape is read in 3D, so it still works when the barrel
points toward the camera.

## Run locally

The camera needs a secure context, so open it via `localhost` (not `file://`):

```bash
npm run serve      # python3 -m http.server 8000
# then visit http://localhost:8000
```

Any static server works (e.g. `npx serve`). First load fetches the tracking
model from a CDN, so you need internet the first time.

## Deploy

It's a static site - push the folder to GitHub Pages, Netlify, or Vercel.
Those serve HTTPS, so the camera works with no extra setup. Nothing to build.

## Develop

```bash
npm install
npm test           # run the unit tests (vitest)
npm run test:watch # watch mode
```

Pure logic lives in `src/{vec,gesture,firing,physics}.js` and is unit-tested.
Side effects (camera, model, canvas, audio) live in `src/{main,render,audio}.js`.
