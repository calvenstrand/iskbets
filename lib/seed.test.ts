import { describe, expect, it } from "vitest";
import { hashString, pickSeeded } from "./seed";

describe("hashString", () => {
  it("is deterministic", () => {
    expect(hashString("DDOG:2026-07-10")).toBe(hashString("DDOG:2026-07-10"));
  });

  it("returns an unsigned 32-bit integer", () => {
    for (const s of ["", "a", "DDOG:2026-07-10", "🦍🦍🦍"]) {
      const h = hashString(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("avalanches inputs sharing a long common tail (the ticker+date case)", () => {
    // Every ticker hashed with the same date must not cluster onto the
    // same pool index — that's the exact failure mode the murmur
    // finalizer exists to prevent.
    const date = "2026-07-10";
    const symbols = ["NVDA", "TSLA", "GME", "PLTR", "DDOG", "INVE-B.ST", "VOLV-B.ST", "SWED-A.ST"];
    const indices = new Set(symbols.map((s) => hashString(`${s}:${date}`) % 5));
    expect(indices.size).toBeGreaterThan(2);
  });
});

describe("pickSeeded", () => {
  const pool = ["a", "b", "c", "d", "e"] as const;

  it("is stable per seed and always picks from the pool", () => {
    for (const seed of ["x", "2026-07-10T14:00:00Z", ""]) {
      const first = pickSeeded(pool, seed);
      expect(pickSeeded(pool, seed)).toBe(first);
      expect(pool).toContain(first);
    }
  });

  it("varies across seeds", () => {
    const picks = new Set(
      Array.from({ length: 30 }, (_, i) => pickSeeded(pool, `seed-${i}`)),
    );
    expect(picks.size).toBeGreaterThan(1);
  });

  it("throws on an empty pool", () => {
    expect(() => pickSeeded([], "x")).toThrow();
  });
});
