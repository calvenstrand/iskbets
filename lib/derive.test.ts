import { describe, expect, it } from "vitest";
import { deriveRating, deriveSentiment, deriveWeekBadge } from "./derive";

describe("deriveRating", () => {
  it("maps the positive bands at their boundaries", () => {
    // Boundaries are exclusive on the low side (`pct > x`), so the
    // threshold value itself falls into the band below.
    expect(deriveRating(5.01)).toBe("🚀 TO THE MOON");
    expect(deriveRating(5)).toBe("📈 BULLISH AF");
    expect(deriveRating(2.01)).toBe("📈 BULLISH AF");
    expect(deriveRating(2)).toBe("💎 DIAMOND HANDS");
    expect(deriveRating(0.51)).toBe("💎 DIAMOND HANDS");
    expect(deriveRating(0.5)).toBeNull();
  });

  it("keeps the quiet middle band badge-free", () => {
    expect(deriveRating(0)).toBeNull();
    expect(deriveRating(0.5)).toBeNull();
    expect(deriveRating(-0.5)).toBeNull();
  });

  it("maps the negative bands at their boundaries", () => {
    expect(deriveRating(-0.51)).toBe("⚠️ TURBULENCE");
    expect(deriveRating(-2)).toBe("⚠️ TURBULENCE");
    expect(deriveRating(-2.01)).toBe("📉 GET REKT");
    expect(deriveRating(-4.99)).toBe("📉 GET REKT");
    expect(deriveRating(-5)).toBe("💀 LIQUIDATED");
    expect(deriveRating(-10)).toBe("💀 LIQUIDATED");
  });

  it("returns null for non-finite input so loading state shows no badge", () => {
    expect(deriveRating(NaN)).toBeNull();
    expect(deriveRating(Infinity)).toBeNull();
  });
});

describe("deriveSentiment", () => {
  it("maps bands at their boundaries", () => {
    expect(deriveSentiment(5.01)).toBe("moon");
    expect(deriveSentiment(5)).toBe("up");
    expect(deriveSentiment(0.51)).toBe("up");
    expect(deriveSentiment(0.5)).toBe("neutral");
    expect(deriveSentiment(-0.5)).toBe("down");
    expect(deriveSentiment(-0.49)).toBe("neutral");
    expect(deriveSentiment(-5)).toBe("rekt");
    expect(deriveSentiment(-4.99)).toBe("down");
  });

  it("returns neutral for non-finite input", () => {
    expect(deriveSentiment(NaN)).toBe("neutral");
  });

  it("aligns the rekt threshold with deriveRating's LIQUIDATED cutoff", () => {
    // Documented invariant: the -5% LIQUIDATED badge appears on exactly
    // the cards that get the max-intensity "rekt" glow.
    expect(deriveSentiment(-5)).toBe("rekt");
    expect(deriveRating(-5)).toBe("💀 LIQUIDATED");
  });
});

describe("deriveWeekBadge", () => {
  it("escalates winner badges by magnitude", () => {
    expect(deriveWeekBadge(10, "winner")).toBe("🏆 WEEK MVP");
    expect(deriveWeekBadge(5, "winner")).toBe("🚀 WEEK ROCKETSHIP");
    expect(deriveWeekBadge(2, "winner")).toBe("💎 WEEK DIAMOND");
    expect(deriveWeekBadge(1.99, "winner")).toBe("🪖 LAST APE STANDING");
    // A "winner" that's actually red still gets the consolation badge.
    expect(deriveWeekBadge(-3, "winner")).toBe("🪖 LAST APE STANDING");
  });

  it("escalates loser badges by magnitude", () => {
    expect(deriveWeekBadge(-15, "loser")).toBe("⚰️ WEEK REKT");
    expect(deriveWeekBadge(-7, "loser")).toBe("💀 WEEK BAGHOLDER");
    expect(deriveWeekBadge(-3, "loser")).toBe("📉 ROUGH WEEK");
    expect(deriveWeekBadge(0, "loser")).toBe("🩹 GRAZED");
  });

  it("crowns no loser when the worst stock still finished green", () => {
    expect(deriveWeekBadge(0.01, "loser")).toBeNull();
    expect(deriveWeekBadge(5, "loser")).toBeNull();
  });

  it("returns null for non-finite input", () => {
    expect(deriveWeekBadge(NaN, "winner")).toBeNull();
    expect(deriveWeekBadge(NaN, "loser")).toBeNull();
  });
});
