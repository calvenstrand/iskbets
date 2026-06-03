import { describe, expect, it } from "vitest";
import { shouldRerunComments, shouldRerunMood } from "./aiGating";
import type { StockPrice } from "./types";

// June 2026 is CEST (UTC+2). Annotated with Stockholm local equivalent.
const utc = (
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
): number => Date.UTC(y, mo - 1, d, h, mi);

function stock(ticker: string, pct: number): StockPrice {
  return {
    ticker,
    name: ticker,
    currency: "USD",
    regularMarketPrice: 100,
    regularMarketChange: 0,
    regularMarketChangePercent: pct,
    regularMarketVolume: 0,
    averageDailyVolume3Month: 0,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  };
}

const BASELINE = [stock("NVDA", 1), stock("TSLA", -2)];
const SAME_PRICES = [stock("NVDA", 1), stock("TSLA", -2)];

// ============================================================
// shouldRerunComments
// ============================================================

describe("shouldRerunComments", () => {
  const now = utc(2026, 6, 3, 12, 0); // Wed 14:00 STO

  it("reruns when there is no prior analysis", () => {
    expect(shouldRerunComments(SAME_PRICES, undefined, undefined, now).rerun).toBe(true);
    expect(shouldRerunComments(SAME_PRICES, BASELINE, undefined, now).rerun).toBe(true);
  });

  it("skips when within the 59-min floor", () => {
    const analyzedAt = now - 30 * 60 * 1000; // 30 min ago
    const d = shouldRerunComments(SAME_PRICES, BASELINE, analyzedAt, now);
    expect(d.rerun).toBe(false);
    expect(d.reason).toMatch(/floor/);
  });

  it("reruns when the 4-hour ceiling is exceeded", () => {
    const analyzedAt = now - 5 * 60 * 60 * 1000; // 5 h ago
    const d = shouldRerunComments(SAME_PRICES, BASELINE, analyzedAt, now);
    expect(d.rerun).toBe(true);
    expect(d.reason).toMatch(/ceiling/);
  });

  it("reruns when a ticker's change% moved more than 2pp since the baseline", () => {
    const analyzedAt = now - 60 * 60 * 1000; // 60 min ago (past floor)
    const movedPrices = [stock("NVDA", 3.5), stock("TSLA", -2)]; // NVDA +2.5pp
    const d = shouldRerunComments(movedPrices, BASELINE, analyzedAt, now);
    expect(d.rerun).toBe(true);
    expect(d.reason).toMatch(/NVDA/);
  });

  it("skips when delta is below the 2pp threshold after the floor", () => {
    const analyzedAt = now - 60 * 60 * 1000;
    const slightMove = [stock("NVDA", 1.5), stock("TSLA", -2)]; // only 0.5pp
    const d = shouldRerunComments(slightMove, BASELINE, analyzedAt, now);
    expect(d.rerun).toBe(false);
  });

  it("reruns when a new ticker appears in the snapshot (floor does not block new tickers)", () => {
    // The new-ticker check runs after the floor, so we need analyzedAt past the floor.
    const analyzedAt = now - 60 * 60 * 1000; // 60 min ago — past the 59-min floor
    const withNewTicker = [...SAME_PRICES, stock("GME", 10)];
    const d = shouldRerunComments(withNewTicker, BASELINE, analyzedAt, now);
    expect(d.rerun).toBe(true);
    expect(d.reason).toMatch(/GME/);
  });
});

// ============================================================
// shouldRerunMood
// ============================================================

describe("shouldRerunMood", () => {
  it("skips on weekend with no prior mood", () => {
    const sat = utc(2026, 6, 6, 12, 0); // Sat 14:00 STO
    const d = shouldRerunMood(SAME_PRICES, undefined, undefined, sat);
    expect(d.rerun).toBe(false);
    expect(d.reason).toMatch(/weekend/);
  });

  it("skips on a weekday before the 09:30 STO checkpoint with no prior mood", () => {
    const before930 = utc(2026, 6, 3, 6, 0); // Wed 08:00 STO
    const d = shouldRerunMood(SAME_PRICES, undefined, undefined, before930);
    expect(d.rerun).toBe(false);
    expect(d.reason).toMatch(/09:30/);
  });

  it("reruns on a weekday at/after 09:30 STO with no prior mood", () => {
    const after930 = utc(2026, 6, 3, 7, 30); // Wed 09:30 STO
    const d = shouldRerunMood(SAME_PRICES, undefined, undefined, after930);
    expect(d.rerun).toBe(true);
  });

  it("never refreshes mood on weekends even with a prior mood", () => {
    const sat = utc(2026, 6, 6, 12, 0);
    const moodAt = sat - 2 * 60 * 60 * 1000;
    const d = shouldRerunMood(SAME_PRICES, BASELINE, moodAt, sat);
    expect(d.rerun).toBe(false);
    expect(d.reason).toMatch(/weekend/);
  });

  it("skips within the 90-min floor", () => {
    const now = utc(2026, 6, 3, 12, 0); // Wed 14:00 STO
    const moodAt = now - 45 * 60 * 1000; // 45 min ago
    const d = shouldRerunMood(SAME_PRICES, BASELINE, moodAt, now);
    expect(d.rerun).toBe(false);
    expect(d.reason).toMatch(/floor/);
  });

  it("reruns when a daily checkpoint is crossed", () => {
    // Mood generated at 10:00 STO (after the 09:30 cp, before 12:00).
    // Now 12:30 STO — crossed the 12:00 checkpoint. Elapsed 150 min > 89 min floor.
    const moodAt = utc(2026, 6, 3, 8, 0); // 10:00 STO
    const now = utc(2026, 6, 3, 10, 30); // 12:30 STO
    const d = shouldRerunMood(SAME_PRICES, BASELINE, moodAt, now);
    expect(d.rerun).toBe(true);
    expect(d.reason).toMatch(/12:00/);
  });

  it("reruns on first tick of a new STO day past the 09:30 checkpoint", () => {
    const yesterday = utc(2026, 6, 2, 20, 0); // Tue 22:00 STO
    const now = utc(2026, 6, 3, 8, 0); // Wed 10:00 STO — new day, past 09:30
    const d = shouldRerunMood(SAME_PRICES, BASELINE, yesterday, now);
    expect(d.rerun).toBe(true);
    expect(d.reason).toMatch(/09:30/);
  });

  it("uses the delta backstop when no checkpoint was crossed", () => {
    // Mood generated at 12:30 STO (after 12:00 cp), now 14:30 STO (before 16:00 cp).
    // Elapsed 120 min > 89 min floor. No checkpoint between 12:30 and 14:30.
    const moodAt = utc(2026, 6, 3, 10, 30); // 12:30 STO
    const now = utc(2026, 6, 3, 12, 30); // 14:30 STO
    const bigMove = [stock("NVDA", 5.5), stock("TSLA", -2)]; // NVDA +4.5pp vs baseline
    const d = shouldRerunMood(bigMove, BASELINE, moodAt, now);
    expect(d.rerun).toBe(true);
    expect(d.reason).toMatch(/NVDA/);
  });

  it("skips when past floor, no checkpoint crossed, and delta is small", () => {
    const moodAt = utc(2026, 6, 3, 10, 30); // 12:30 STO
    const now = utc(2026, 6, 3, 12, 30); // 14:30 STO — past floor, between 12:00 and 16:00
    const d = shouldRerunMood(SAME_PRICES, BASELINE, moodAt, now);
    expect(d.rerun).toBe(false);
  });
});
