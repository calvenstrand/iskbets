import { describe, expect, it } from "vitest";
import {
  buildAnalystLog,
  buildMoodStrip,
  buildSparklinePath,
  extractTickerHistory,
  fromTheTop,
  monthYearOf,
  rangePosition,
  type TickerHistoryPoint,
} from "./stockDetail";
import type { DailySnapshot } from "./types";

// A tiny snapshot builder: each arg is a partial per-ticker row keyed by
// ticker, so tests read as "on this date, DDOG did X".
function snap(
  date: string,
  rows: Record<
    string,
    { changePct: number; sentiment: DailySnapshot["stocks"][number]["sentiment"]; comment?: string; price?: number }
  >,
): DailySnapshot {
  return {
    date,
    capturedAt: 0,
    updatedAt: `${date}T22:00:00.000Z`,
    overallMood: "test mood",
    stocks: Object.entries(rows).map(([ticker, r]) => ({
      ticker,
      price: r.price ?? 100,
      changePct: r.changePct,
      sentiment: r.sentiment,
      ...(r.comment ? { comment: r.comment } : {}),
    })),
  };
}

describe("extractTickerHistory", () => {
  it("keeps only the requested ticker and carries the comment through", () => {
    const snapshots = [
      snap("2026-07-06", {
        DDOG: { changePct: 2.2, sentiment: "up", comment: "obs bag fed" },
        NVDA: { changePct: 6.8, sentiment: "moon" },
      }),
      snap("2026-07-07", { NVDA: { changePct: -1.1, sentiment: "down" } }), // no DDOG that day
      snap("2026-07-08", { DDOG: { changePct: -3.4, sentiment: "down" } }),
    ];
    const series = extractTickerHistory(snapshots, "DDOG");
    expect(series.map((p) => p.date)).toEqual(["2026-07-06", "2026-07-08"]);
    expect(series[0]?.comment).toBe("obs bag fed");
    expect(series[1]?.comment).toBeUndefined();
  });
});

describe("buildMoodStrip", () => {
  it("returns one present cell per snapshot day when contiguous", () => {
    const points: TickerHistoryPoint[] = [
      { date: "2026-07-06", price: 10, changePct: 1, sentiment: "up" },
      { date: "2026-07-07", price: 11, changePct: 2, sentiment: "up" },
    ];
    const cells = buildMoodStrip(points);
    expect(cells).toHaveLength(2);
    expect(cells.every((c) => c.present)).toBe(true);
  });

  it("fills calendar gaps (weekends / holidays) with honest absent cells", () => {
    // Fri 2026-07-10 then Mon 2026-07-13 — Sat/Sun have no snapshot.
    const points: TickerHistoryPoint[] = [
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
    const points: TickerHistoryPoint[] = [
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

describe("buildAnalystLog", () => {
  it("lists commentary days newest-first with the seed as the oldest row", () => {
    const points: TickerHistoryPoint[] = [
      { date: "2026-07-06", price: 10, changePct: 1, sentiment: "up", comment: "first take" },
      { date: "2026-07-07", price: 10, changePct: 0.1, sentiment: "neutral" }, // no comment → no row
      { date: "2026-07-08", price: 11, changePct: 6, sentiment: "moon", comment: "ripping" },
    ];
    const log = buildAnalystLog(points, { fallbackMonthYear: "JAN 2099" });
    // 2 entries + 1 seed
    expect(log).toHaveLength(3);
    expect(log[0]).toMatchObject({ kind: "entry", date: "2026-07-08", comment: "ripping" });
    expect(log[1]).toMatchObject({ kind: "entry", date: "2026-07-06", comment: "first take" });
    expect(log[2]).toEqual({ kind: "coverage-initiated", monthYear: "JUL 2026" });
  });

  it("seeds coverage month from the EARLIEST snapshot, ignoring fallback when history exists", () => {
    const points: TickerHistoryPoint[] = [
      { date: "2026-05-29", price: 10, changePct: 1, sentiment: "up" },
      { date: "2026-07-08", price: 11, changePct: 6, sentiment: "moon", comment: "late take" },
    ];
    const log = buildAnalystLog(points, { fallbackMonthYear: "JAN 2099" });
    const seed = log[log.length - 1];
    expect(seed).toEqual({ kind: "coverage-initiated", monthYear: "MAY 2026" });
  });

  it("empty history → just the seeded coverage marker from the fallback", () => {
    const log = buildAnalystLog([], { fallbackMonthYear: "JUL 2026" });
    expect(log).toEqual([{ kind: "coverage-initiated", monthYear: "JUL 2026" }]);
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

  it("monthYearOf formats the seed label", () => {
    expect(monthYearOf("2026-07-09")).toBe("JUL 2026");
    expect(monthYearOf("2026-12-01")).toBe("DEC 2026");
  });
});
