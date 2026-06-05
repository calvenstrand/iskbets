import { describe, expect, it } from "vitest";
import { TICKERS } from "./tickers";
import {
  __test,
  buildStaticComments,
} from "./stockMessages";
import type { Sentiment, StockPrice } from "./types";

const { MESSAGES, ownerPrefix } = __test;

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

describe("ownerPrefix", () => {
  it("uses the friend's first name for a single-owner ticker", () => {
    const t = TICKERS.find((t) => t.symbol === "RDDT");
    expect(t).toBeDefined();
    expect(ownerPrefix(t!)).toBe("Chris's ");
  });

  it('uses "the gang" by default for multi-owner tickers', () => {
    const t = TICKERS.find((t) => t.symbol === "GOOG"); // chris + oskar
    expect(t).toBeDefined();
    expect(ownerPrefix(t!)).toBe("the gang's ");
  });

  it('uses the COLLECTIVE_OVERRIDES entry when present (INVE-B → "the syndicate")', () => {
    const t = TICKERS.find((t) => t.symbol === "INVE-B.ST");
    expect(t).toBeDefined();
    expect(ownerPrefix(t!)).toBe("the syndicate's ");
  });

  it("returns an empty prefix for unowned tickers", () => {
    const t = TICKERS.find((t) => t.symbol === "NVDA");
    expect(t).toBeDefined();
    expect(ownerPrefix(t!)).toBe("");
  });
});

describe("buildStaticComments", () => {
  it("emits a sentiment-bucketed comment with the owner substituted", () => {
    const result = buildStaticComments([stock("RDDT", 8)]); // moon bucket
    expect(result).toHaveLength(1);
    const [r] = result;
    expect(r!.sentiment).toBe("moon");
    expect(r!.rating).toBe("🚀 TO THE MOON");
    expect(r!.comment).toBeDefined();
    expect(r!.comment).toContain("Chris's");
    // The template's literal "{owner}" must have been resolved.
    expect(r!.comment).not.toContain("{owner}");
  });

  it("omits the comment in the neutral band (no filler on quiet days)", () => {
    const result = buildStaticComments([stock("RDDT", 0.1)]);
    expect(result[0]!.sentiment).toBe("neutral");
    expect(result[0]!.comment).toBeUndefined();
  });

  it("emits no comment for an unknown ticker (graceful)", () => {
    const result = buildStaticComments([stock("UNKNOWN", 7)]);
    expect(result[0]!.comment).toBeUndefined();
  });

  it("leaves the {owner} placeholder fully resolved (no leakage for owned or unowned)", () => {
    // Unowned ticker: the line should start with the ticker word, not a
    // possessive — the `{owner}` placeholder must have collapsed to "".
    const unowned = buildStaticComments([stock("NVDA", 7)]);
    expect(unowned[0]!.comment).toBeDefined();
    expect(unowned[0]!.comment!).not.toContain("{owner}");
    expect(unowned[0]!.comment!.startsWith("NVDA")).toBe(true);

    // Owned ticker: prefix is the owner's possessive.
    const owned = buildStaticComments([stock("RDDT", 7)]);
    expect(owned[0]!.comment!).not.toContain("{owner}");
    expect(owned[0]!.comment!.startsWith("Chris's ")).toBe(true);
  });
});

describe("MESSAGES coverage", () => {
  // Every ticker in TICKERS should have entries for moon / up / down / rekt.
  // Neutral is intentionally omitted (quiet days = silent cards).
  const REQUIRED: Sentiment[] = ["moon", "up", "down", "rekt"];

  it("every ticker has a message for each non-neutral bucket", () => {
    const missing: { ticker: string; bucket: Sentiment }[] = [];
    for (const t of TICKERS) {
      const table = MESSAGES[t.symbol];
      if (!table) {
        for (const b of REQUIRED) missing.push({ ticker: t.symbol, bucket: b });
        continue;
      }
      for (const b of REQUIRED) {
        if (!table[b]) missing.push({ ticker: t.symbol, bucket: b });
      }
    }
    expect(missing).toEqual([]);
  });

  it("MESSAGES has no orphan entries (every key matches a TICKERS symbol)", () => {
    const known = new Set(TICKERS.map((t) => t.symbol));
    const orphans = Object.keys(MESSAGES).filter((k) => !known.has(k));
    expect(orphans).toEqual([]);
  });
});
