import { describe, expect, it } from "vitest";
import {
  pickSlogans,
  resolveScenario,
  SCENARIO_MIX,
  SLOGANS,
} from "./slogans";

describe("resolveScenario priority", () => {
  it("bloodbath beats everything else", () => {
    expect(
      resolveScenario({
        sweep: "bloodbath",
        inRecap: true,
        marketClosed: true,
      }),
    ).toBe("bloodbath");
  });

  it("clean-sweep beats recap + stale", () => {
    expect(
      resolveScenario({
        sweep: "clean-sweep",
        inRecap: true,
        marketClosed: true,
      }),
    ).toBe("clean-sweep");
  });

  it("recap beats stale (weekend closed market is a recap, not stale)", () => {
    expect(
      resolveScenario({ sweep: null, inRecap: true, marketClosed: true }),
    ).toBe("recap");
  });

  it("stale wins when markets are closed on a plain weekday", () => {
    expect(
      resolveScenario({ sweep: null, inRecap: false, marketClosed: true }),
    ).toBe("stale");
  });

  it("falls through to default when nothing special is happening", () => {
    expect(
      resolveScenario({
        sweep: undefined,
        inRecap: false,
        marketClosed: false,
      }),
    ).toBe("default");
  });

  it("a sweep outranks the recap window even on the weekend", () => {
    // A red week still gets its bloodbath tape on Saturday.
    expect(
      resolveScenario({
        sweep: "bloodbath",
        inRecap: true,
        marketClosed: true,
      }),
    ).not.toBe("recap");
  });
});

describe("pickSlogans", () => {
  it("is deterministic for a given (scenario, seed) — SSR-safe", () => {
    const a = pickSlogans("bloodbath", 20260709, 30);
    const b = pickSlogans("bloodbath", 20260709, 30);
    expect(a).toEqual(b);
  });

  it("varies by seed (day-to-day churn)", () => {
    const a = pickSlogans("stale", 20260709, 30);
    const b = pickSlogans("stale", 20260710, 30);
    expect(a).not.toEqual(b);
  });

  it("default scenario draws only from the default pool", () => {
    const picks = pickSlogans("default", 42, 40);
    const defaults = new Set(SLOGANS.default);
    expect(picks.every((p) => defaults.has(p))).toBe(true);
  });

  it("biases toward the scenario pool (~SCENARIO_MIX), not a full swap", () => {
    // Over a long run the split lands near the mix — biased, not replaced.
    const count = 200;
    const picks = pickSlogans("clean-sweep", 12345, count);
    const scenarioSet = new Set(SLOGANS["clean-sweep"]);
    const defaultSet = new Set(SLOGANS.default);
    const fromScenario = picks.filter((p) => scenarioSet.has(p)).length;
    const fromDefault = picks.filter((p) => defaultSet.has(p)).length;
    // Every pick comes from one of the two pools.
    expect(fromScenario + fromDefault).toBe(count);
    // Scenario share is close to SCENARIO_MIX, and default is clearly
    // present (not a full replacement).
    expect(fromScenario / count).toBeGreaterThan(SCENARIO_MIX - 0.1);
    expect(fromScenario / count).toBeLessThan(SCENARIO_MIX + 0.1);
    expect(fromDefault).toBeGreaterThan(0);
  });

  it("returns exactly `count` lines", () => {
    expect(pickSlogans("recap", 7, 14)).toHaveLength(14);
    expect(pickSlogans("default", 7, 14)).toHaveLength(14);
  });
});
