// Shared per-frame state: written by the driver (MazeScene.tsx), read by the
// hint and the development keys.
import type { WebGLRenderTarget } from "three";

import { PATTERN, QUALITY } from "./config";
import { createGrowth } from "./sim/growth";
import { createQuality } from "./sim/quality";

const phone =
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(pointer: coarse)").matches;

export const mazeState = {
  growth: createGrowth(),
  quality: createQuality(phone ? QUALITY.phoneStart : QUALITY.start),
  /** The tracked face (screen uv, y up), or null. */
  face: null as null | { x: number; y: number; w: number; h: number },
  /** The simulation's size now. */
  sim: { width: 0, height: 0 },
  /** Overall line spacing (1 = as designed). */
  spacing: PATTERN.spacing,
  /** Set by the dev keys. */
  restart: false,
  fakeMotion: false,
  /** 0 the paper, 1 the camera faintly under it, 2 the tone (development). */
  view: 0,
  /** The latest buffers, for the development read-outs. */
  targets: {
    state: null as WebGLRenderTarget | null,
    field: null as WebGLRenderTarget | null,
    mask: null as WebGLRenderTarget | null,
  },
};
