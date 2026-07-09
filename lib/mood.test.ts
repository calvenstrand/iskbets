import { describe, expect, it } from "vitest";
import {
  computeMoodRecord,
  MOOD_HISTORY_CAP,
  selectRecentMood,
  upsertMoodRecords,
} from "./mood";
import type { MoodRecord, StockPrice } from "./types";

function stock(ticker: string, pct: number, price = 100): StockPrice {
  return {
    ticker,
    name: ticker,
    currency: "USD",
    regularMarketPrice: price,
    regularMarketChange: 0,
    regularMarketChangePercent: pct,
    regularMarketVolume: 0,
    averageDailyVolume3Month: 0,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  };
}

function rec(date: string, overall: MoodRecord["overall"] = "up"): MoodRecord {
  return { date, overall, avgPct: 1, tickers: {} };
}

describe("computeMoodRecord", () => {
  it("averages finite change%s and derives overall + per-ticker sentiment", () => {
    const r = computeMoodRecord(
      [stock("A", 6), stock("B", 1), stock("C", -1)],
      "2026-07-09",
    );
    // avg = (6 + 1 - 1) / 3 = 2 → up
    expect(r.avgPct).toBeCloseTo(2);
    expect(r.overall).toBe("up");
    expect(r.tickers).toEqual({ A: "moon", B: "up", C: "down" });
    expect(r.date).toBe("2026-07-09");
  });

  it("maps deriveSentiment boundaries for the overall mood", () => {
    // A single stock → avg == its pct, so this pins the boundary buckets.
    expect(computeMoodRecord([stock("X", 5.01)], "d").overall).toBe("moon");
    expect(computeMoodRecord([stock("X", 5)], "d").overall).toBe("up");
    expect(computeMoodRecord([stock("X", 0.5)], "d").overall).toBe("neutral");
    expect(computeMoodRecord([stock("X", -0.5)], "d").overall).toBe("down");
    expect(computeMoodRecord([stock("X", -5)], "d").overall).toBe("rekt");
  });

  it("skips non-finite tickers from both the average and the map", () => {
    const r = computeMoodRecord(
      [stock("A", 4), stock("B", NaN), stock("C", 2)],
      "d",
    );
    // NaN ticker excluded → avg = (4 + 2) / 2 = 3, and B absent from map.
    expect(r.avgPct).toBeCloseTo(3);
    expect(r.tickers).toEqual({ A: "up", C: "up" });
    expect("B" in r.tickers).toBe(false);
  });

  it("is a neutral zero-day when nothing has finite data", () => {
    const r = computeMoodRecord([stock("A", NaN)], "d");
    expect(r.avgPct).toBe(0);
    expect(r.overall).toBe("neutral");
    expect(r.tickers).toEqual({});
  });
});

describe("upsertMoodRecords", () => {
  it("overwrites the same-day record (last-write-wins), no duplicates", () => {
    const start = [rec("2026-07-07"), rec("2026-07-08", "up")];
    const next = upsertMoodRecords(start, rec("2026-07-08", "rekt"));
    expect(next).toHaveLength(2);
    expect(next.map((r) => r.date)).toEqual(["2026-07-07", "2026-07-08"]);
    expect(next[1]?.overall).toBe("rekt");
  });

  it("keeps the array sorted oldest→newest regardless of insert order", () => {
    let h: MoodRecord[] = [];
    for (const d of ["2026-07-09", "2026-07-07", "2026-07-08"]) {
      h = upsertMoodRecords(h, rec(d));
    }
    expect(h.map((r) => r.date)).toEqual([
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
    ]);
  });

  it("caps retention at MOOD_HISTORY_CAP, trimming the oldest", () => {
    let h: MoodRecord[] = [];
    const base = Date.UTC(2025, 0, 1);
    const total = MOOD_HISTORY_CAP + 10;
    for (let i = 0; i < total; i++) {
      const d = new Date(base + i * 86_400_000).toISOString().slice(0, 10);
      h = upsertMoodRecords(h, rec(d));
    }
    expect(h).toHaveLength(MOOD_HISTORY_CAP);
    // The oldest 10 fell off → first kept day is base + 10, last is newest.
    const firstKept = new Date(base + 10 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const newest = new Date(base + (total - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(h[0]?.date).toBe(firstKept);
    expect(h.at(-1)?.date).toBe(newest);
  });
});

describe("selectRecentMood", () => {
  it("returns oldest→newest, at most `days` most-recent records", () => {
    const all = [
      rec("2026-07-05"),
      rec("2026-07-06"),
      rec("2026-07-07"),
      rec("2026-07-08"),
    ];
    const got = selectRecentMood(all, 2);
    expect(got.map((r) => r.date)).toEqual(["2026-07-07", "2026-07-08"]);
  });

  it("sorts unsorted input and returns everything when days<=0", () => {
    const all = [rec("2026-07-08"), rec("2026-07-06"), rec("2026-07-07")];
    expect(selectRecentMood(all, 0).map((r) => r.date)).toEqual([
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
    ]);
  });
});
