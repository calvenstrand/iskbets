import { describe, expect, it } from "vitest";
import { buildOwnersByPerson, PEOPLE, TICKERS } from "./tickers";

describe("buildOwnersByPerson", () => {
  it("returns a map with an entry for every person who owns at least one ticker", () => {
    const map = buildOwnersByPerson();
    const peopleWithOwnership = new Set(
      TICKERS.flatMap((t) => t.owners ?? []),
    );
    for (const person of peopleWithOwnership) {
      expect(map.has(person)).toBe(true);
    }
  });

  it("does not include people who own no tickers", () => {
    const map = buildOwnersByPerson();
    const peopleWithOwnership = new Set(
      TICKERS.flatMap((t) => t.owners ?? []),
    );
    for (const person of Object.keys(PEOPLE) as (keyof typeof PEOPLE)[]) {
      if (!peopleWithOwnership.has(person)) {
        expect(map.has(person)).toBe(false);
      }
    }
  });

  it("each ticker in a person's list actually lists them as an owner", () => {
    const map = buildOwnersByPerson();
    const tickerMeta = new Map(TICKERS.map((t) => [t.symbol, t]));
    for (const [person, tickers] of map) {
      for (const symbol of tickers) {
        const meta = tickerMeta.get(symbol);
        expect(meta?.owners).toContain(person);
      }
    }
  });

  it("is idempotent — calling it twice returns equivalent maps", () => {
    const a = buildOwnersByPerson();
    const b = buildOwnersByPerson();
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    for (const [person, tickers] of a) {
      expect(tickers.slice().sort()).toEqual((b.get(person) ?? []).slice().sort());
    }
  });
});
