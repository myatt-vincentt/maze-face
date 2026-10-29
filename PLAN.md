# Plan

Maze Face: you, drawn live as one winding maze line on white paper. It grows
out from your face until the whole portrait is drawn, re-forms as you move,
and fades back to a blank page when you leave.

## How it works

- **Paper.** The camera picture is never shown: a warm white page with a
  faint grain covers it, and only the lines are drawn on it, in near-black ink.
- **Lines.** A Gray-Scott reaction-diffusion simulation in its labyrinth
  ("fingerprint") regime runs on the GPU in two swapped float buffers, several
  steps a frame. The lines are where its pattern crosses one level, drawn at
  the same width on screen everywhere (the distance to that level is measured
  in screen pixels) and anti-aliased; the simulation is read through a smooth
  cubic filter so the lines stay round.
- **Tone.** Tone comes only from line spacing. Each texel diffuses toward
  neighbours a few texels away, closer in dark areas and further in light
  ones, so dark areas (hair, shadows) get tight lines and light areas (skin,
  light clothes) wide open loops; a little next-door diffusion keeps the
  finest ripples settled. The tone is the camera's brightness against the area
  around it, so it holds up in any light, and it follows the camera with a
  little lag.
- **The person only.** The portrait mask, trusted only around the tracked
  face and the body below it and held steady over a few frames, keeps the
  pattern to the person; outside it the page is forced blank, so the lines end
  cleanly at the silhouette, and a thin outline traces the edge of what is
  drawn.
- **Growing.** The page starts blank. When a face shows, the drawing seeds at
  the nose and grows out as a wobbly blob through the person in about 5 s
  (strict ease-out). New lines are sown as small drops just inside the growing
  edge, spaced like the pattern there, so they start at the right size.
- **Moving.** Frame-to-frame change inside the person is motion: where it is
  high the pattern loosens into wide loops and random drops dissolve it; when
  you hold still the tone takes over again and it sharpens.
- **Leaving.** When the face is lost the drawing holds still; if the person
  suddenly vanishes from the mask the simulation holds too, so the drawing is
  never wiped before it can fade. After 1.2 s without a face it fades back to
  a blank page, and the next face grows fresh.
- **Hint.** One wordless hint: a small see-through pencil-grey ghost face
  (the SDK's face hint, holding still, no disc) low in the centre. It fades
  away for good once the first portrait is fully drawn.
- **Camera mini-map.** Folded by default: a small Night-glass pill with a
  camera glyph top-right. Tapping it unfolds a live camera thumbnail (about a
  fifth of the screen width, the screen's shape, mirrored like the drawing,
  the person's outline traced faintly) from the corner with a short ease-out
  scale and fade; tapping the thumbnail or the pill folds it back. Thin rounded
  corners, a hairline grey edge and the faintest shadow. It only reads the
  camera and the mask and is remembered while the page is open.
- **Quality.** Four levels of simulation size and steps per frame. Desktop
  starts at the best, phones one lower; it steps down while frames run slow
  and back up when there is room. Single long frames (a model loading) don't
  count.
- **Full screen.** The page fills the whole window (`src/App.tsx` swaps the
  9:16 frame for a full-window container).
- **No sound, no photo, no text.**
