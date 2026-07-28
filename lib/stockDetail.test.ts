import { describe, expect, it } from "vitest";
import {
  buildMoodStrip,
  buildSparklinePath,
  fromTheTop,
  rangePosition,
} from "./stockDetail";
import type { TickerSeriesPoint } from "./dailySnapshot";

describe("buildMoodStrip", () => {
  it("returns one present cell per snapshot day when contiguous", () => {
    const points: TickerSeriesPoint[] = [
      { date: "2026-07-06", price: 10, changePct: 1, sentiment: "up" },
      { date: "2026-07-07", price: 11, changePct: 2, sentiment: "up" },
    ];
    const cells = buildMoodStrip(points);
    expect(cells).toHaveLength(2);
    expect(cells.every((c) => c.present)).toBe(true);
  });

  it("fills calendar gaps (weekends / holidays) with honest absent cells", () => {
    // Fri 2026-07-10 then Mon 2026-07-13 — Sat/Sun have no snapshot.
    const points: TickerSeriesPoint[] = [
      { date: "2026-07-10", price: 10, changePct: -0.5, sentiment: "neutral" },
      { date: "2026-07-13", price: 12, changePct: 4.0, sentiment: "up" },
    ];
    const cells = buildMoodStrip(points);
    expect(cells.map((c) => c.date)).toEqual([
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
      "2026-07-13",
    ]);
    expect(cells.map((c) => c.present)).toEqual([true, false, false, true]);
    // Absent cells carry no fabricated change/sentiment.
    const sat = cells[1];
    expect(sat?.present).toBe(false);
    expect("changePct" in (sat ?? {})).toBe(false);
  });

  it("sorts out-of-order input and spans the full range", () => {
    const points: TickerSeriesPoint[] = [
      { date: "2026-07-13", price: 12, changePct: 4, sentiment: "up" },
      { date: "2026-07-10", price: 10, changePct: -1, sentiment: "down" },
    ];
    const cells = buildMoodStrip(points);
    expect(cells).toHaveLength(4); // 10,11,12,13
    expect(cells[0]?.date).toBe("2026-07-10");
    expect(cells[3]?.date).toBe("2026-07-13");
  });

  it("returns [] for no history", () => {
    expect(buildMoodStrip([])).toEqual([]);
  });
});

describe("range + sparkline helpers", () => {
  it("rangePosition maps price onto low↔high and clamps overshoots", () => {
    expect(rangePosition(150, 100, 200)).toBeCloseTo(0.5);
    expect(rangePosition(90, 100, 200)).toBe(0); // clamped to low
    expect(rangePosition(250, 100, 200)).toBe(1); // clamped to high
  });

  it("rangePosition null-guards the free-tier 0/0 range", () => {
    expect(rangePosition(50, 0, 0)).toBeNull();
    expect(rangePosition(NaN, 100, 200)).toBeNull();
  });

  it("fromTheTop is a non-positive percentage, null when high is missing", () => {
    expect(fromTheTop(66, 100)).toBeCloseTo(-34);
    expect(fromTheTop(100, 100)).toBeCloseTo(0);
    expect(fromTheTop(50, 0)).toBeNull();
  });

  it("buildSparklinePath needs ≥2 finite points and starts with a moveto", () => {
    expect(buildSparklinePath([10], 100, 30)).toBeNull();
    const d = buildSparklinePath([10, 20, 15], 100, 30, 2);
    expect(d).not.toBeNull();
    expect(d!.startsWith("M")).toBe(true);
    // Highest price (20, index 1) should sit at the top (smallest y = pad).
    expect(d).toContain("M2.00 28.00"); // first point at min → bottom
  });
});
