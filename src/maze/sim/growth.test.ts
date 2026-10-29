import { describe, expect, it } from "vitest";

import { GROW, LEAVE } from "../config";
import { createGrowth, stepGrowth } from "./growth";
import { createQuality, simSize, stepQuality } from "./quality";

const run = (
  g: ReturnType<typeof createGrowth>,
  face: boolean,
  seconds: number,
) => {
  for (let t = 0; t < seconds; t += 1 / 60) stepGrowth(g, face, 1 / 60);
};

describe("growth", () => {
  it("stays blank until a face shows, then grows to drawn", () => {
    const g = createGrowth();
    run(g, false, 2);
    expect(g.phase).toBe("blank");
    stepGrowth(g, true, 1 / 60);
    expect(g.phase).toBe("growing");
    expect(g.clear).toBe(true);
    run(g, true, GROW.seconds / 2);
    expect(g.progress).toBeGreaterThan(0.5);
    expect(g.progress).toBeLessThan(1);
    run(g, true, GROW.seconds);
    expect(g.phase).toBe("drawn");
    expect(g.grownOnce).toBe(true);
  });

  it("rides out a short loss of the face", () => {
    const g = createGrowth();
    run(g, true, GROW.seconds + 1);
    run(g, false, LEAVE.grace * 0.8);
    expect(g.phase).toBe("drawn");
    expect(g.frozen).toBe(true);
    stepGrowth(g, true, 1 / 60);
    expect(g.frozen).toBe(false);
  });

  it("fades to blank when the person leaves, and the next one grows fresh", () => {
    const g = createGrowth();
    run(g, true, GROW.seconds + 1);
    run(g, false, LEAVE.grace + LEAVE.fade * 0.5);
    expect(g.phase).toBe("fading");
    expect(g.ink).toBeGreaterThan(0);
    expect(g.ink).toBeLessThan(1);
    run(g, false, LEAVE.fade);
    expect(g.phase).toBe("blank");
    expect(g.ink).toBe(0);
    stepGrowth(g, true, 1 / 60);
    expect(g.phase).toBe("growing");
    expect(g.progress).toBeLessThan(0.05);
  });

  it("restarts on request", () => {
    const g = createGrowth();
    run(g, true, GROW.seconds + 1);
    stepGrowth(g, true, 1 / 60, true);
    expect(g.phase).toBe("growing");
    expect(g.clear).toBe(true);
  });
});

describe("quality", () => {
  it("steps down while slow and back up when fast", () => {
    const q = createQuality(0);
    for (let i = 0; i < 300; i += 1) stepQuality(q, 1 / 30);
    expect(stepQuality(createQuality(0), 0.5)).toBe(false);
    expect(q.level).toBeGreaterThan(0);
    const low = q.level;
    for (let i = 0; i < 60 * 12; i += 1) stepQuality(q, 1 / 60);
    expect(q.level).toBeLessThan(low);
  });

  it("caps the texel count on wide screens", () => {
    const s = simSize(0, 16 / 9);
    expect(s.width * s.height).toBeLessThanOrEqual(900_000 + 2000);
    expect(simSize(2, 9 / 19.5).height).toBe(720);
  });
});
