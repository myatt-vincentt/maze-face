// Adaptive quality, pure (quality.test.ts): steps the simulation down while
// frames run slow and back up when there is room, so phones keep a smooth
// frame rate at the cost of coarser lines or a slower settle.

import { QUALITY } from "../config";

export type Quality = {
  level: number;
  /** Smoothed frame time (ms). */
  ms: number;
  slowFor: number;
  fastFor: number;
  /** Set to hold a level (development). */
  locked: boolean;
};

export const createQuality = (level: number): Quality => ({
  level: Math.max(0, Math.min(QUALITY.levels.length - 1, level)),
  ms: 16.7,
  slowFor: 0,
  fastFor: 0,
  locked: false,
});

/** One frame of `dt` seconds; returns true when the level changed. */
export const stepQuality = (q: Quality, dt: number): boolean => {
  // A single long frame is a hitch (a model loading, a tab switch), not a
  // sign the drawing is too heavy: skip it.
  if (dt > QUALITY.hitch) return false;
  const ms = dt * 1000;
  q.ms += (ms - q.ms) * 0.08;
  if (q.locked) return false;
  q.slowFor = q.ms > QUALITY.slowMs ? q.slowFor + dt : 0;
  q.fastFor = q.ms < QUALITY.fastMs ? q.fastFor + dt : 0;
  const last = QUALITY.levels.length - 1;
  if (q.slowFor > QUALITY.slowFor && q.level < last) {
    q.level += 1;
    q.slowFor = 0;
    q.fastFor = 0;
    q.ms = 16.7;
    return true;
  }
  if (q.fastFor > QUALITY.fastFor && q.level > 0) {
    q.level -= 1;
    q.slowFor = 0;
    q.fastFor = 0;
    return true;
  }
  return false;
};

/** The simulation's size for a level on a screen of this aspect (w / h). */
export const simSize = (level: number, aspect: number) => {
  const { height } = QUALITY.levels[level];
  let h = height;
  let w = Math.round(h * aspect);
  if (w * h > QUALITY.maxTexels) {
    const k = Math.sqrt(QUALITY.maxTexels / (w * h));
    h = Math.round(h * k);
    w = Math.round(w * k);
  }
  return { width: Math.max(16, w), height: Math.max(16, h) };
};
