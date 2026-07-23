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
