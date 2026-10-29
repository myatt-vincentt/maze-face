// The portrait's life, pure (growth.test.ts): a blank page; a face is found
// and the drawing grows out from it until the whole person is drawn; the
// person leaves and it fades back to a blank page; the next face starts fresh.

import { GROW, LEAVE } from "../config";

export type Phase = "blank" | "growing" | "drawn" | "fading";

export type Growth = {
  phase: Phase;
  /** Seconds in this phase. */
  t: number;
  /** How far the growth has come, 0..1 (eased: fast at first, settling at the end). */
  progress: number;
  /** How much of the drawing shows, 0..1 (it fades out when the person leaves). */
  ink: number;
  /** Seconds since a face was last seen. */
  lostFor: number;
  /** Set once the first portrait is fully drawn (the hint then goes for good). */
  grownOnce: boolean;
  /** True on the step that wipes the page clean for a fresh start. */
  clear: boolean;
  /** True while the drawing holds still (the face is gone, or it is fading). */
  frozen: boolean;
};

export const createGrowth = (): Growth => ({
  phase: "blank",
  t: 0,
  progress: 0,
  ink: 0,
  lostFor: 0,
  grownOnce: false,
  clear: true,
  frozen: false,
});

const easeOut = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return 1 - (1 - t) * (1 - t);
};

const startGrowing = (g: Growth) => {
  g.phase = "growing";
  g.t = 0;
  g.progress = 0;
  g.ink = 1;
  g.clear = true;
  g.frozen = false;
};

/** One step: `face` is whether a face is seen now; `restart` starts over. */
export const stepGrowth = (
  g: Growth,
  face: boolean,
  dt: number,
  restart = false,
): Growth => {
  g.clear = false;
  g.lostFor = face ? 0 : g.lostFor + dt;
  if (restart) {
    startGrowing(g);
    return g;
  }
  // The face is gone: the drawing holds still (so a person walking out of
  // the picture doesn't wipe it before it can fade), and growth waits.
  const lost = g.lostFor > LEAVE.hold;
  g.frozen = g.phase === "fading" || (g.phase !== "blank" && lost);
  if (!(g.phase === "growing" && lost)) g.t += dt;
  const gone = g.lostFor > LEAVE.grace;
  switch (g.phase) {
    case "blank":
      g.ink = 0;
      g.progress = 0;
      if (face) startGrowing(g);
      break;
    case "growing":
      g.progress = easeOut(g.t / GROW.seconds);
      if (g.t >= GROW.seconds) {
        g.phase = "drawn";
        g.t = 0;
        g.progress = 1;
        g.grownOnce = true;
      }
      if (gone) {
        g.phase = "fading";
        g.t = 0;
      }
      break;
    case "drawn":
      if (gone) {
        g.phase = "fading";
        g.t = 0;
      }
      break;
    case "fading":
      g.ink = 1 - easeOut(g.t / LEAVE.fade);
      if (face) {
        // Someone is back: they grow fresh.
        startGrowing(g);
      } else if (g.t >= LEAVE.fade) {
        g.phase = "blank";
        g.t = 0;
        g.ink = 0;
        g.progress = 0;
        g.clear = true;
        g.frozen = false;
      }
      break;
    default:
      break;
  }
  return g;
};
