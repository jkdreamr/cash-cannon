# Cash Cannon 💵🔫

Turn on your camera, make a finger gun, and **make it rain**.
Runs entirely in your browser with hand tracking via MediaPipe, no backend.

## How to play

1. Click **Start camera** and allow access.
2. Make a finger gun (index out, other fingers folded).
3. **Hold the gun shape** and cash streams out of your fingertip. Point to aim,
   including straight at the lens, and the notes fly at the viewer.
4. Drop the shape to stop. Two hands = dual wield.
5. Hit **Make it rain** to have money fall from the sky.
6. Notes that land on you stay there. Shake, or sweep a hand across yourself,
   to knock them off.
7. Toggle sound with the speaker button.

Tip: good light and a plain background behind your hand make tracking more
reliable. The finger shape is read in 3D, so it still works when the barrel
points toward the camera.

## Money that lands on you

Notes only come to rest where they physically could. A note stays on a surface
only while its tilt is under the friction angle, about 20 to 25 degrees for
paper on skin or cloth, and that is mass-free: a note slides whenever
tan(tilt) exceeds the friction coefficient, whatever it weighs. On a standing
person almost nothing qualifies. So money settles on your shoulders, the top of
your head, and a forearm held level, and slides off your chest and face exactly
as it would in life.

Once resting, a note is pinned to a frame built from your shoulder line, so it
travels with the part of you it is lying on: step sideways and it goes with you,
lean and it tips, come closer and it grows. Shake hard enough and it comes off
over about a second; sweep a hand across yourself and you brush it away.

## The physics

Notes are simulated as real banknotes in a real 3D space rather than as sprites
on a flat canvas:

- Every note is 156 x 66 mm and weighs a gram, falling under gravity against
  air resistance, so it reaches a terminal velocity of about 1.1 m/s. That is
  the real figure for paper money, and it is why cash flutters instead of
  dropping like a stone.
- Drag depends on which way the note meets the air. Edge-on it slips through
  with roughly one twelve-thousandth of the resistance it has broadside, so
  notes leave the muzzle edge-first, carry, then turn flat and brake hard.
- Lift on the tilted note, plus an aerodynamic torque that rotates it toward
  broadside, produces the tumbling and side-to-side swooping. None of that is
  scripted; it falls out of the forces.
- Your distance from the camera is measured from the apparent width of your
  hand, so everything lives at a true depth. Notes nearer the lens are larger,
  and money passes in front of you, behind you, or lands on you accordingly.
- The person is separated from the background each frame, which is what allows
  money to be hidden behind you and to come to rest on your shoulders.
- A money gun's roller shears one note off the stack at a time, so notes leave
  short edge first and tumbling end over end at 2 to 10 rev/s, about fifteen a
  second. Edge-on they knife through the air; once they turn flat they brake
  hard. None of the tumbling is animated, it falls out of the forces.
- The note artwork is real currency, not green rectangles. US paper money is
  warm cream rag stock, and the green everyone pictures is the ink on the back.
  Each note carries an engraved portrait, both seals, a blue security ribbon,
  its own serial number and its own creases and wear.

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
