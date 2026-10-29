// Development only (Scene.tsx lazy-loads this behind a NODE_ENV check).
//   R      restart the growth
//   [ / ]  tighter / wider line spacing
//   M      pretend the person is moving fast (toggle)
//   C      cycle the view: paper, camera faintly under it, tone
//
// Also `window.__maze` for scripted checks: `growth` (%), `phase`, `sim`
// (size), `steps` (per frame), `quality` (level), `frameMs`, `motion`
// (0..1, read from the GPU on each call), `alive` (share of the screen being
// drawn), and `restart()`, `setQuality(level | null)`, `setSpacing(x)`.
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { DataUtils, HalfFloatType, type WebGLRenderer } from "three";

import { PAPER, PATTERN, QUALITY } from "./config";
import { mazeState } from "./state";

const s = mazeState;

/** The field buffer's averages: alive share and motion inside the person. */
const readField = (gl: WebGLRenderer | null) => {
  const t = s.targets.field;
  if (!gl || !t) return { alive: 0, motion: 0 };
  const px = new Uint8Array(t.width * t.height * 4);
  gl.readRenderTargetPixels(t, 0, 0, t.width, t.height, px);
  let alive = 0;
  let moving = 0;
  let inside = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] > 127) alive += 1;
    if (px[i + 2] > 0 || px[i] > 127) {
      inside += 1;
      moving += px[i + 2] / 255;
    }
  }
  const n = t.width * t.height;
  return { alive: alive / n, motion: inside ? moving / inside : 0 };
};

let glRef: WebGLRenderer | null = null;

/** The simulation's v: largest value and share of texels above the line level. */
const readState = (gl: WebGLRenderer | null) => {
  const t = s.targets.state;
  if (!gl || !t) return null;
  const n = t.width * t.height;
  const half = t.texture.type === HalfFloatType;
  const px = half ? new Uint16Array(n * 4) : new Float32Array(n * 4);
  gl.readRenderTargetPixels(t, 0, 0, t.width, t.height, px);
  let max = 0;
  let over = 0;
  for (let i = 0; i < n; i += 1) {
    const v = half ? DataUtils.fromHalfFloat(px[i * 4 + 1]) : px[i * 4 + 1];
    if (v > max) max = v;
    if (v > PAPER.level) over += 1;
  }
  return {
    max: Math.round(max * 1000) / 1000,
    over: Math.round((over / n) * 1000) / 1000,
  };
};

const debug = {
  state: mazeState,
  get growth() {
    return Math.round(s.growth.progress * 100);
  },
  get phase() {
    return s.growth.phase;
  },
  get sim() {
    return `${s.sim.width}x${s.sim.height}`;
  },
  get steps() {
    return QUALITY.levels[s.quality.level].steps;
  },
  get quality() {
    return s.quality.level;
  },
  get frameMs() {
    return Math.round(s.quality.ms * 10) / 10;
  },
  get motion() {
    return Math.round(readField(glRef).motion * 100) / 100;
  },
  get alive() {
    return Math.round(readField(glRef).alive * 1000) / 1000;
  },
  get field() {
    return readState(glRef);
  },
  get spacing() {
    return s.spacing;
  },
  restart() {
    s.restart = true;
  },
  setQuality(level: number | null) {
    if (level === null) {
      s.quality.locked = false;
      return;
    }
    s.quality.level = Math.max(0, Math.min(QUALITY.levels.length - 1, level));
    s.quality.locked = true;
  },
  setSpacing(x: number) {
    s.spacing = Math.max(PATTERN.spacingMin, Math.min(PATTERN.spacingMax, x));
  },
  setFakeMotion(on: boolean) {
    s.fakeMotion = on;
  },
};

const DevKeys = () => {
  const gl = useThree((st) => st.gl);
  useEffect(() => {
    glRef = gl;
    (window as unknown as { __maze: typeof debug }).__maze = debug;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "r") debug.restart();
      else if (k === "[")
        debug.setSpacing(Math.round((s.spacing - 0.1) * 10) / 10);
      else if (k === "]")
        debug.setSpacing(Math.round((s.spacing + 0.1) * 10) / 10);
      else if (k === "m") s.fakeMotion = !s.fakeMotion;
      else if (k === "c") s.view = (s.view + 1) % 3;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gl]);
  return null;
};

export default DevKeys;
