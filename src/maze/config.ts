// Every number that shapes the drawing, in one place.

/** The face tracker's rate (only the face's place and size are needed). */
export const FACE_FPS = 15;

/** How the portrait grows, holds and fades (seconds). */
export const GROW = {
  /** From the first seed at the face to the whole person drawn. */
  seconds: 5,
  /** The seed blob's starting size (screen heights). */
  start: 0.03,
  /** How far the growing edge wobbles (share of its radius), so it reads as a blob. */
  wobble: 0.16,
  /** The band just inside the growing edge where new lines are sown (screen heights). */
  band: 0.05,
};

export const LEAVE = {
  /** No face for this long and the drawing holds still. */
  hold: 0.15,
  /** No face for this long and the drawing starts to fade. */
  grace: 1.2,
  /** The fade back to a blank page. */
  fade: 1.4,
};

/**
 * The line pattern (a Gray-Scott reaction-diffusion simulation, in its
 * labyrinth regime). The pattern's scale is set by how far apart each texel
 * looks at its neighbours: `ring` texels in the darkest parts, more in the
 * lightest, so dark areas get tight lines and light areas wide loops.
 */
export const PATTERN = {
  feed: 0.03,
  kill: 0.057,
  /** Diffusion of the two chemicals (per step, with the neighbours at `ring`). */
  du: 0.3,
  dv: 0.15,
  /**
   * A little plain next-door diffusion on top, so the finest ripples (which
   * the far neighbours can't see) always settle instead of crawling.
   */
  near: 0.25,
  /** Neighbour distance in texels: darkest, lightest, and while moving fast. */
  ringDark: 0.7,
  ringLight: 3.0,
  ringLoose: 3.2,
  /** The overall line spacing (the dev keys change it), and its limits. */
  spacing: 1,
  spacingMin: 0.6,
  spacingMax: 1.5,
};

/** How the camera picture becomes tone (0 dark .. 1 light). */
export const TONE = {
  /** Local contrast: detail against the area around it, and the area itself. */
  detail: 3.2,
  area: 1.0,
  /** How fast the tone follows the camera (per second): the drawing's lag. */
  follow: 3,
  /** Motion: frame-to-frame change above `floor` times `gain`, fading at `decay` per second. */
  floor: 0.035,
  gain: 7,
  decay: 2.2,
};

/** The steadied person mask: share of the screen and how fast it follows (per second). */
export const PERSON = {
  scale: 0.5,
  max: 720,
  rate: 14,
};

/** The paper and the ink. */
export const PAPER = {
  paper: [0.965, 0.953, 0.925] as const,
  ink: [0.09, 0.085, 0.08] as const,
  /** Line width as a share of the screen's height (device pixels), and its floor. */
  line: 0.0013,
  lineMin: 1.0,
  /** The simulation value the lines are drawn at. */
  level: 0.16,
};

/**
 * Quality levels, best first: simulation height in texels (width follows the
 * screen) and steps per frame. The scene starts at `start` (one lower on
 * phones) and steps down while frames run slow, back up when there is room.
 */
export const QUALITY = {
  levels: [
    { height: 960, steps: 12 },
    { height: 840, steps: 10 },
    { height: 720, steps: 8 },
    { height: 600, steps: 6 },
  ],
  start: 0,
  phoneStart: 1,
  /** Frame times (ms, smoothed) that step down / up, and how long they must last (s). */
  slowMs: 22,
  fastMs: 17.5,
  slowFor: 1.5,
  fastFor: 4,
  /** Frames longer than this (s) are hitches and don't count. */
  hitch: 0.1,
  /** The most texels a level may use (wide windows get a shorter simulation). */
  maxTexels: 900_000,
};

/** The wordless hint: a small see-through ghost face, low in the centre. */
export const HINT = {
  /** Where on screen (−1…1, y up), and how far in front of the camera. */
  at: [0, -0.7] as const,
  distance: 1.5,
  /** The face's height (scene units at that distance). */
  height: 0.11,
  /** Seconds before it fades in, and fade times. */
  delay: 0.6,
  fadeIn: 0.6,
  fadeOut: 0.6,
  renderOrder: 1500,
};
