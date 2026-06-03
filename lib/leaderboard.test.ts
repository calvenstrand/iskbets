import { describe, expect, it } from "vitest";
import {
  computeLeaderboard,
  detectSweep,
  pickTodayWinnerLoser,
  pickWeekChampion,
  pickWeekWinnerLoser,
} from "./leaderboard";
import { TICKERS } from "./tickers";
import type { StockPrice } from "./types";

/** Build a StockPrice with sensible defaults; override what a test cares
 * about. Dead fields (volume / 52w) are zeroed — nothing under test reads
 * them. */
function stock(
  ticker: string,
  pct: number,
  price = 100,
  opts: Partial<StockPrice> = {},
): StockPrice {
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
    ...opts,
  };
}

describe("detectSweep", () => {
  it("flags a clean sweep when every finite stock is green", () => {
    expect(detectSweep([{ pct: 1 }, { pct: 2 }, { pct: 3 }])).toEqual({
      type: "clean-sweep",
      count: 3,
      avgPct: 2,
    });
  });

  it("flags a bloodbath when every finite stock is red", () => {
    expect(detectSweep([{ pct: -2 }, { pct: -4 }])).toEqual({
      type: "bloodbath",
      count: 2,
      avgPct: -3,
    });
  });

  it("returns null type on a mixed board", () => {
    expect(detectSweep([{ pct: 2 }, { pct: -2 }]).type).toBeNull();
  });

  it("needs at least two finite stocks to fire", () => {
    expect(detectSweep([{ pct: 5 }]).type).toBeNull();
    expect(detectSweep([]).type).toBeNull();
  });

  it("ignores non-finite entries when counting and averaging", () => {
    expect(detectSweep([{ pct: NaN }, { pct: 4 }, { pct: 6 }])).toEqual({
      type: "clean-sweep",
      count: 2,
      avgPct: 5,
    });
  });
});

describe("pickWeekWinnerLoser", () => {
  it("picks the max and min week-over-week movers", () => {
    const stocks = [
      stock("A", 0, 110), // +10% vs 100 baseline
      stock("B", 0, 90), // -10%
      stock("C", 0, 105), // +5%
    ];
    const baseline = { A: 100, B: 100, C: 100 };
    const { winner, loser } = pickWeekWinnerLoser(stocks, baseline);
    expect(winner?.ticker).toBe("A");
    expect(winner?.weekChangePct).toBeCloseTo(10);
    expect(loser?.ticker).toBe("B");
    expect(loser?.weekChangePct).toBeCloseTo(-10);
  });

  it("skips tickers with a missing or non-positive baseline", () => {
    const stocks = [stock("A", 0, 110), stock("B", 0, 90)];
    // Only A has a usable baseline → it is both winner and loser.
    const { winner, loser } = pickWeekWinnerLoser(stocks, { A: 100, B: 0 });
    expect(winner?.ticker).toBe("A");
    expect(loser?.ticker).toBe("A");
  });

  it("returns nothing when no baseline map is provided", () => {
    expect(pickWeekWinnerLoser([stock("A", 0, 110)], undefined)).toEqual({});
  });
});

describe("pickTodayWinnerLoser", () => {
  // 14:00 UTC = 16:00 STO: SE still open, NY open (10:00 ET). Both
  // markets count as "opened today".
  const now = new Date(Date.UTC(2026, 5, 3, 14, 0));
  const todayMs = now.getTime();
  const yesterdayMs = todayMs - 86_400_000;

  it("picks winner/loser among stocks that actually traded today", () => {
    const stocks = [
      stock("NVDA", 5, 100, { lastTradeAt: todayMs }),
      stock("VOLV-B.ST", -3, 100, { lastTradeAt: todayMs }),
    ];
    const { winner, loser } = pickTodayWinnerLoser(stocks, now);
    expect(winner?.ticker).toBe("NVDA");
    expect(loser?.ticker).toBe("VOLV-B.ST");
  });

  it("excludes a stale ticker even when its move is the most extreme (holiday veto)", () => {
    const stocks = [
      stock("NVDA", 5, 100, { lastTradeAt: todayMs }),
      stock("VOLV-B.ST", -3, 100, { lastTradeAt: todayMs }),
      // Biggest mover both ways, but its last print was yesterday →
      // a closed-exchange carry-forward, not today's action.
      stock("GME", 99, 100, { lastTradeAt: yesterdayMs }),
      stock("AMD", -99, 100, { lastTradeAt: yesterdayMs }),
    ];
    const { winner, loser } = pickTodayWinnerLoser(stocks, now);
    expect(winner?.ticker).toBe("NVDA");
    expect(loser?.ticker).toBe("VOLV-B.ST");
  });
});

describe("computeLeaderboard", () => {
  // A full board where every owned ticker moves identically — lets us
  // assert the mean math without hardcoding the ownership graph.
  const uniformBoard = (pct: number, price = 100): StockPrice[] =>
    TICKERS.map((t) => stock(t.symbol, pct, price));

  it("returns an empty list when no stock has finite data", () => {
    expect(computeLeaderboard([], undefined)).toEqual([]);
    const allNaN = TICKERS.map((t) => stock(t.symbol, NaN));
    expect(computeLeaderboard(allNaN, undefined)).toEqual([]);
  });

  it("computes today% as the simple mean of owned tickers", () => {
    const entries = computeLeaderboard(uniformBoard(2), undefined);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.todayPct).toBeCloseTo(2);
    }
  });

  it("leaves wtdPct null when no baseline is available", () => {
    const entries = computeLeaderboard(uniformBoard(2), undefined);
    for (const e of entries) expect(e.wtdPct).toBeNull();
  });

  it("computes wtd% from the Monday baseline", () => {
    // Price 110 vs baseline 100 → +10% for every owned ticker.
    const baseline = Object.fromEntries(TICKERS.map((t) => [t.symbol, 100]));
    const entries = computeLeaderboard(uniformBoard(2, 110), baseline);
    for (const e of entries) {
      expect(e.wtdPct).not.toBeNull();
      expect(e.wtdPct as number).toBeCloseTo(10);
      expect(e.wtdCoverage).toBe(e.tickers.length);
    }
  });

  it("sorts descending by today% by default", () => {
    // Spread moves across the board so people land at different means.
    const stocks = TICKERS.map((t, i) => stock(t.symbol, (i % 7) - 3));
    const entries = computeLeaderboard(stocks, undefined);
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1];
      const cur = entries[i];
      if (!prev || !cur) continue;
      expect(prev.todayPct).toBeGreaterThanOrEqual(cur.todayPct);
    }
  });

  it("sorts descending by wtd% in recap mode", () => {
    const baseline = Object.fromEntries(
      TICKERS.map((t, i) => [t.symbol, 100 + (i % 5)]),
    );
    const stocks = TICKERS.map((t) => stock(t.symbol, 0, 110));
    const entries = computeLeaderboard(stocks, baseline, { sortBy: "wtd" });
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1];
      const cur = entries[i];
      if (!prev || !cur) continue;
      const pw = prev.wtdPct ?? -Infinity;
      const cw = cur.wtdPct ?? -Infinity;
      expect(pw).toBeGreaterThanOrEqual(cw);
    }
  });
});

describe("pickWeekChampion", () => {
  it("returns null without a baseline map", () => {
    const stocks = TICKERS.map((t) => stock(t.symbol, 1, 110));
    expect(pickWeekChampion(stocks, undefined)).toBeNull();
  });

  it("returns null when no owned ticker has a usable baseline", () => {
    const stocks = TICKERS.map((t) => stock(t.symbol, 1, 110));
    const zeroed = Object.fromEntries(TICKERS.map((t) => [t.symbol, 0]));
    expect(pickWeekChampion(stocks, zeroed)).toBeNull();
  });

  it("returns the highest-WTD friend when baselines exist", () => {
    const baseline = Object.fromEntries(TICKERS.map((t) => [t.symbol, 100]));
    const stocks = TICKERS.map((t) => stock(t.symbol, 0, 110)); // +10% all
    const champ = pickWeekChampion(stocks, baseline);
    expect(champ).not.toBeNull();
    expect(champ?.wtdPct as number).toBeCloseTo(10);
  });
});
