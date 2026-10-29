# Maze Face

You, drawn live as one winding maze line on white paper. The page starts blank; when your face
shows, the line seeds at your face and grows out through you until the whole portrait is drawn,
in about five seconds. Tone comes only from the spacing of the lines: tight in the dark (hair,
shadows), wide open loops in the light (skin, light clothes). Only you are drawn, with a clean
outline; the background stays plain paper. The drawing re-forms with a little lag as you move;
move fast and it dissolves into loose loops, hold still and it sharpens again. Leave, and it
fades back to a blank page; the next person grows fresh. The camera picture itself is never
shown, and the page fills the whole screen.

- Thumbnail: `public/images/maze-face-thumbnail.jpg` (the share image).
- The lines are a reaction-diffusion simulation (Gray-Scott, labyrinth regime) run on the GPU
  several steps a frame, its scale set by the camera's tone, kept to the person by the steadied
  portrait mask, and drawn as even-width anti-aliased contours on paper (`src/maze/MazeScene.tsx`,
  `shaders.ts`, `passes.ts`).
- The portrait's life (blank, growing, drawn, fading) and the adaptive quality are pure and
  unit-tested (`src/maze/sim/growth.ts`, `sim/quality.ts`). Phones start one quality level lower;
  the simulation steps down while frames run slow and back up when there is room.
- The only hint is a small see-through ghost face low in the centre (the SDK's
  `FaceExpressionHint`, `public/models/face-v1.glb`, see `CREDITS.md`); it goes for good once the
  first portrait is drawn.
- Camera mini-map (`src/maze/MiniMap.tsx`): a small glass pill top-right unfolds a live camera
  thumbnail (mirrored like the drawing, the person's outline traced faintly on it); tap the
  thumbnail or the pill to fold it. Folded by default, remembered while the page is open; it
  never affects the drawing.
- `src/App.tsx` uses a full-window container instead of the 9:16 frame; re-apply after a template
  upgrade.
- Dev preview without a camera: the media switcher starts on the SDK's sample video. Keys: `R`
  restarts the growth, `[` / `]` tighter / wider lines, `M` pretends you are moving fast, `C`
  cycles the view (paper, camera faintly under it, tone). `window.__maze` has read-outs (growth,
  simulation size, steps per frame, motion). How it works: `PLAN.md`.

---

# v2-template

The Vincentt starter app: a real React + R3F + Vincentt XR SDK (`@vincentt-xr/sdk`)
WebXR app, bundled by esbuild.

## Shape

```
src/
  main.tsx            mount — never edited
  App.tsx             protected shell: XRProvider + AspectRatioContainer +
                      XRScene + media-source binding, camera, lighting,
                      VideoBackground, PreviewAnchors — never edited
  Scene.tsx           the agent's surface: add SDK components and R3F
                      primitives here
  PreviewAnchors.tsx  editor-preview integration — never edited
```

See `AGENTS.md` and `GROUNDING.md` for the API reference and how to author scenes.

## Develop

```
pnpm install
pnpm dev          # esbuild dev server on localhost:5173 (output in .dev/)
pnpm preview      # on-device preview over a secure tunnel (needs `vincentt login`)
pnpm typecheck
pnpm build        # production bundle to dist/
```

## Release

`vincentt init` scaffolds from the **`latest` tag**, not from `main`. Merging to `main` does
not ship a template to creators — cutting a release does.

```
git tag 1.1.0 <sha>      # bare semver, no `v` prefix
git push origin 1.1.0    # the Release workflow verifies the tag, then moves `latest`
```

The Release workflow (`.github/workflows/release.yml`) installs from the frozen lockfile,
builds, and typechecks **the tagged tree** before force-updating `latest` to it. A tag that
fails leaves `latest` where it was, so a broken release cannot reach a new creator.

The job runs in the `release` environment, which accepts bare-semver tags only. To re-run it by
hand, dispatch it from the tag itself ("Use workflow from: 1.1.0"); a dispatch from `main` is
refused.

**Never move `latest` by hand.** It is force-updated by that workflow and nowhere else; moving
it manually decouples the pointer from the version it claims to be.

Creators can pin a specific version — `vincentt init --template 1.0.0` — which is the escape
hatch when a release turns out to be bad. That is why the version tags are immutable and only
`latest` moves.

### `MIGRATION.md` and the platform release row

Root `MIGRATION.md` carries one entry per released tag, newest first, authored in the same
PR as the change: `required: true|false`, a one-line summary, and optional notes bullets.
`required: false` means no consumer action is needed, never that the entry was skipped. The
Release workflow refuses to move `latest` for a tag with no valid entry, then — once `latest`
has moved — posts that entry as this release's row to the platform (`POST
/platform/releases`, component `template`), via `scripts/release-row.mjs`. Both steps read
`MIGRATION.md` from `main`, not from the tagged tree: the note is reviewed via PR into `main`
and is append-only per version, so `main`'s copy is the reviewed source for any tag, including
one cut before this file existed. That row is what `vincentt outdated` reads back to tell a
creator's agent what changed and what to do about it.
