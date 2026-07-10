import type { DayMood } from "./types";

/**
 * Ticker-tape copy, one pool per scenario. Edits here are copy-only — the
 * selection logic (resolveScenario / pickSlogans) never needs to change.
 *
 * Emoji are load-bearing but sparse: at most one per line (the sole
 * exception is the pre-existing bloodbath "🔥🦍🔥" chant, kept verbatim).
 */
export const SCENARIOS = [
  "bloodbath",
  "clean-sweep",
  "recap",
  "stale",
  "default",
] as const;

export type Scenario = (typeof SCENARIOS)[number];

export const SLOGANS: Record<Scenario, string[]> = {
  // Weekday, mixed market.
  default: [
    "THE PEOPLE'S TERMINAL",
    "NOT FINANCIAL ADVICE 🦍",
    "BUY HIGH · SELL LOW · REPEAT",
    "YOUR PORTFOLIO IS SOMEONE ELSE'S EXIT LIQUIDITY",
    "DIVERSIFICATION IS FEAR",
    "ZOOM OUT (NOT TOO FAR)",
    "DUE DILIGENCE: THE VIBES ARE GOOD",
    "TIME IN THE MARKET > TIMING THE MARKET > US",
    "ISK GANG RISE UP",
    "SKATTEVERKET SEES EVERYTHING 👁️",
  ],
  bloodbath: [
    "EVERYTHING IS FINE 🔥🦍🔥",
    "THIS IS NOT A DRILL. IT'S A HOLE.",
    "BUYING OPPORTUNITY (COPE)",
    "WE EAT RED FOR BREAKFAST",
    "AVERAGE DOWN, FEEL NOTHING",
    "THE FLOOR WAS A CEILING ALL ALONG",
    "DIAMOND HANDS ARE FORGED IN DAYS LIKE THIS",
    "DON'T CHECK AVANZA. YOU ALREADY KNOW.",
    "SOMEWHERE, A SHORT SELLER IS LAUGHING",
  ],
  "clean-sweep": [
    "TENDIES FOR ALL 🍗",
    "GREEN. EVERYWHERE. STAY CALM.",
    "WE ARE ALL GENIUSES TODAY",
    "SCREENSHOT THIS. IT WON'T LAST.",
    "THE MARKET HAS APOLOGIZED",
    "SELL NOTHING. TELL EVERYONE.",
    "GENERATIONAL WEALTH (INTRADAY)",
    "EVEN YOUR WORST PICK IS UP",
  ],
  // Weekend recap window.
  recap: [
    "MARKETS SLEEP. LEGENDS TALLY.",
    "THE WEEK HAS BEEN JUDGED",
    "CHAMPION CROWNED · COPE ARCHIVED 👑",
    "MONDAY IS COMING. HYDRATE.",
    "REVIEW YOUR TRADES. OR DON'T.",
    "WEEKEND RULE: NO CHART TALK AT DINNER",
    // Added (same register) — recap pool was short; flagged in the PR.
    "THE LEDGER IS CLOSED. THE GROUP CHAT IS NOT.",
  ],
  // Weekday, markets closed (outside the weekend recap window).
  stale: [
    "MARKETS CLOSED · ANXIETY OPEN 24/7",
    "PRICES FROZEN · OPINIONS AREN'T",
    "AFTER HOURS IS FOR OVERTHINKING",
    "GO OUTSIDE. THE CANDLES WILL WAIT.",
    "NOTHING IS MOVING. CHECK ANYWAY.",
    // Added (same register) — stale pool was short; flagged in the PR.
    "REFRESHING WON'T REOPEN THE MARKET",
  ],
};

/** Share of interleaved slogans drawn from the active scenario's pool
 * (the rest from default). Bias, not replacement — a full swap reads as a
 * bug; a lean reads as mood. */
export const SCENARIO_MIX = 0.7;

/**
 * Resolve the tape scenario from the day's signals. First match wins, in
 * strict priority order:
 *   1. bloodbath      (whole eligible board red — detectSweep)
 *   2. clean-sweep    (whole eligible board green — detectSweep)
 *   3. recap          (weekend recap window, Fri 22:00 → Mon 09:00 STO)
 *   4. stale          (weekday, all tracked markets closed right now)
 *   5. default
 * A sweep outranks the recap window (a red/green week still gets its mood
 * on the weekend); the recap window outranks a plain closed market.
 */
export function resolveScenario(inputs: {
  sweep: DayMood | null | undefined;
  inRecap: boolean;
  marketClosed: boolean;
}): Scenario {
  if (inputs.sweep === "bloodbath") return "bloodbath";
  if (inputs.sweep === "clean-sweep") return "clean-sweep";
  if (inputs.inRecap) return "recap";
  if (inputs.marketClosed) return "stale";
  return "default";
}

/**
 * Build a deterministic sequence of `count` slogans for the tape.
 * SSR-safe: fully determined by (scenario, seed), never Math.random, so
 * server and client render the same tape. In a non-default scenario each
 * slot is drawn from that pool with probability SCENARIO_MIX, else from
 * default; both pools cycle from a seed-derived offset so the copy varies
 * by day without repeating adjacent lines within a pool.
 */
export function pickSlogans(
  scenario: Scenario,
  seed: number,
  count: number,
): string[] {
  const s = Math.abs(Math.trunc(seed)) || 1;
  const defaultPool = SLOGANS.default;

  if (scenario === "default") {
    return rotate(defaultPool, s, count);
  }

  const pool = SLOGANS[scenario];
  const threshold = Math.round(SCENARIO_MIX * 100);
  const out: string[] = [];
  let si = s % pool.length;
  let di = s % defaultPool.length;
  for (let i = 0; i < count; i++) {
    // Deterministic 0–99 roll. gcd(131,100)=1 so successive rolls sweep
    // the residues, landing ~SCENARIO_MIX below the threshold over a run.
    const roll = (s * 31 + i * 131) % 100;
    if (roll < threshold) {
      out.push(pool[si % pool.length]!);
      si++;
    } else {
      out.push(defaultPool[di % defaultPool.length]!);
      di++;
    }
  }
  return out;
}

function rotate(arr: string[], seed: number, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(arr[(seed + i) % arr.length]!);
  }
  return out;
}
