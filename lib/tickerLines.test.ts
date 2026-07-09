import { describe, expect, it } from "vitest";
import {
  deriveTickerTier,
  TAPE_CARRY_EVERY,
  tapeCarriesLine,
  TICKER_LINES,
  tickerLine,
} from "./tickerLines";

describe("deriveTickerTier", () => {
  it("returns notTraded when the market hasn't traded, whatever the %", () => {
    expect(deriveTickerTier(9, false)).toBe("notTraded");
    expect(deriveTickerTier(-9, false)).toBe("notTraded");
    expect(deriveTickerTier(0, false)).toBe("notTraded");
  });

  it("maps % bands to tiers, aligned with deriveRating boundaries", () => {
    expect(deriveTickerTier(5.01, true)).toBe("moon");
    expect(deriveTickerTier(5, true)).toBe("up");
    expect(deriveTickerTier(0.51, true)).toBe("up");
    expect(deriveTickerTier(0.5, true)).toBe("neutral");
    expect(deriveTickerTier(-0.5, true)).toBe("neutral");
    expect(deriveTickerTier(-0.51, true)).toBe("down");
    expect(deriveTickerTier(-2, true)).toBe("down");
    expect(deriveTickerTier(-2.01, true)).toBe("rekt");
    expect(deriveTickerTier(-4.99, true)).toBe("rekt");
    expect(deriveTickerTier(-5, true)).toBe("liquidated");
    expect(deriveTickerTier(-9, true)).toBe("liquidated");
  });

  it("treats non-finite % as neutral (not a fake mood)", () => {
    expect(deriveTickerTier(NaN, true)).toBe("neutral");
  });
});

describe("tickerLine", () => {
  it("is stable per (symbol, date) — same stock, same line all day", () => {
    const a = tickerLine("NVDA", "2026-07-09", "moon");
    const b = tickerLine("NVDA", "2026-07-09", "moon");
    expect(a).toBe(b);
  });

  it("draws from the tier's pool (with the owner slot stripped)", () => {
    const line = tickerLine("NVDA", "2026-07-09", "up");
    const stripped = TICKER_LINES.up.map((l) => l.replace(" ({owner})", ""));
    expect(stripped).toContain(line);
  });

  it("varies across symbols/dates (not one line for everyone)", () => {
    const base = tickerLine("NVDA", "2026-07-09", "rekt");
    const otherSym = tickerLine("TSLA", "2026-07-09", "rekt");
    const otherDay = tickerLine("NVDA", "2026-07-10", "rekt");
    expect(base === otherSym && base === otherDay).toBe(false);
  });

  it("fills the owner slot only when an owner is given, else strips it", () => {
    const OWNER_LINE = "SOMEONE CHECK ON THE OWNER";
    // Find a (symbol, date) whose rekt pick lands on the owner-aware line.
    const symbols = ["NVDA", "TSLA", "GME", "AMD", "COIN", "MSTR", "SHOP"];
    let hit: { sym: string; date: string } | null = null;
    for (let d = 1; d <= 28 && !hit; d++) {
      const date = `2026-07-${String(d).padStart(2, "0")}`;
      for (const sym of symbols) {
        if (tickerLine(sym, date, "rekt") === OWNER_LINE) {
          hit = { sym, date };
          break;
        }
      }
    }
    expect(hit).not.toBeNull();
    if (hit) {
      // No owner → base line; owner → tag appended, uppercased.
      expect(tickerLine(hit.sym, hit.date, "rekt")).toBe(OWNER_LINE);
      expect(tickerLine(hit.sym, hit.date, "rekt", "Oskar")).toBe(
        `${OWNER_LINE} (OSKAR)`,
      );
    }
  });
});

describe("tapeCarriesLine", () => {
  it("extremes (moon / liquidated) always carry their line", () => {
    for (const sym of ["NVDA", "TSLA", "GME", "AMD"]) {
      expect(tapeCarriesLine(sym, "2026-07-09", "moon")).toBe(true);
      expect(tapeCarriesLine(sym, "2026-07-09", "liquidated")).toBe(true);
    }
  });

  it("is deterministic per (symbol, date)", () => {
    const a = tapeCarriesLine("NVDA", "2026-07-09", "down");
    const b = tapeCarriesLine("NVDA", "2026-07-09", "down");
    expect(a).toBe(b);
  });

  it("carries roughly 1 in TAPE_CARRY_EVERY non-extreme tickers", () => {
    const symbols = Array.from({ length: 400 }, (_, i) => `SYM${i}`);
    const carried = symbols.filter((s) =>
      tapeCarriesLine(s, "2026-07-09", "down"),
    ).length;
    const rate = carried / symbols.length;
    const target = 1 / TAPE_CARRY_EVERY;
    expect(rate).toBeGreaterThan(target - 0.12);
    expect(rate).toBeLessThan(target + 0.12);
  });
});
