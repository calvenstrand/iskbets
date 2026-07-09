// Per-ticker one-liners keyed to the stock's own situation. These are the
// FALLBACK for the card empty state (no AI comment) and occasional tape
// garnish — they never replace real AI commentary.
//
// Tiers extend deriveSentiment's scale to the mood family's granularity so
// the deep-red band splits: they line up 1:1 with deriveRating's bands —
// down = TURBULENCE (-0.5..-2), rekt = GET REKT (-2..-5), liquidated =
// LIQUIDATED (≤ -5) — plus a notTraded state for a frozen market.

/**
 * Owner-aware lines carry a `({owner})` slot. On the card it's filled with
 * the ticker's owner (e.g. "(OSKAR)") when there is one; with no owner, or
 * on the tape, the slot is stripped back to the base line. So the base copy
 * is exactly the reviewed text — the owner tag is purely additive.
 */
const OWNER = "({owner})";

export type TickerTier =
  | "moon"
  | "up"
  | "neutral"
  | "down"
  | "rekt"
  | "liquidated"
  | "notTraded";

export const TICKER_LINES: Record<TickerTier, string[]> = {
  // > +5%
  moon: [
    "RE-MORTGAGE THE HOUSE",
    `SOMEONE KNEW SOMETHING ${OWNER}`, // owner-aware (added slot — flagged)
    "PRINTING. ACTUAL PRINTING.",
    "TELL YOUR COWORKERS. TODAY YOU'RE A GENIUS.",
    "THIS IS WHY WE DON'T SELL",
    "SCREENSHOT BEFORE IT'S GONE",
  ],
  // +0.5–5%
  up: [
    "RESPECTABLE. SUSPICIOUS, BUT RESPECTABLE.",
    "GREEN IS GREEN",
    "SLOW COOK. GOOD TENDIES.",
    `DOING ITS JOB QUIETLY ${OWNER}`, // owner-aware (added slot — flagged)
    "UP, BUT DON'T GET WEIRD ABOUT IT",
  ],
  // ±0.5%
  neutral: [
    "FLATLINING. CHECK PULSE.",
    `THE MARKET FORGOT THIS ONE EXISTS ${OWNER}`, // owner-aware (added slot — flagged)
    "PAINT DRYING, TICKER EDITION",
    "NO NEWS IS NO NEWS",
    "CROUCHING TIGER, HIDDEN NOTHING",
  ],
  // -0.5–2%  (TURBULENCE)
  down: [
    "IT'S CALLED CONSOLIDATION, LOOK IT UP",
    "MINOR FLESH WOUND",
    "DIP OR DECLINE? ASK AGAIN TOMORROW",
    `AVERTING EYES, HOLDING BAGS ${OWNER}`, // owner-aware (added slot — flagged)
    "SHAKING OUT THE TOURISTS (US)",
  ],
  // -2–5%  (GET REKT)
  rekt: [
    "THOUGHTS AND PRAYERS 🕯️",
    "SUPPORT LEVEL WAS A SUGGESTION",
    `SOMEONE CHECK ON THE OWNER ${OWNER}`, // owner-aware (from the brief)
    "THIS IS FINE. THIS IS NOT FINE.",
    "BUY THE DIP THEY SAID",
  ],
  // ≤ -5%  (LIQUIDATED)
  liquidated: [
    `F IN THE CHAT ${OWNER}`, // owner-aware (added slot — flagged)
    "COVERAGE DOWNGRADED TO GRIEF COUNSELING",
    "IT'S A LONG-TERM HOLD NOW. IT HAS TO BE.",
    "DELETE THE APP",
    "WE DON'T LOOK AT THIS ONE ANYMORE",
  ],
  // hasTradedToday === false — frozen market
  notTraded: [
    "MARKET CLOSED. STILL GUILTY.",
    "FROZEN AT FRIDAY'S CRIMES",
    "ASLEEP. DREAM OF GREEN.",
  ],
};

/** Tape carries a ticker's line for ~1 in this many non-extreme tickers.
 * Extremes (moon / liquidated) always carry theirs — they've earned it. */
export const TAPE_CARRY_EVERY = 4;

/**
 * Resolve the line tier from a ticker's change % and whether it traded
 * today. Bands mirror deriveRating so the line agrees with the card's
 * rating badge; a stale ticker is `notTraded` regardless of its frozen %.
 */
export function deriveTickerTier(pct: number, traded: boolean): TickerTier {
  if (!traded) return "notTraded";
  if (!Number.isFinite(pct)) return "neutral";
  if (pct > 5) return "moon";
  if (pct > 0.5) return "up";
  if (pct >= -0.5) return "neutral";
  if (pct >= -2) return "down";
  if (pct > -5) return "rekt";
  return "liquidated";
}

// FNV-1a over `symbol:date` (the varying symbol first) followed by a
// murmur3 finalizer — a stable per-ticker-per-day seed so the same stock
// shows the same line all day and SSR/CSR agree (no random). The
// avalanche matters: the inputs share a long common `date` tail, and
// without it the low bits cluster and many cards land on the same line.
function seedFor(symbol: string, date: string): number {
  let h = 0x811c9dc5;
  const str = `${symbol}:${date}`;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function applyOwner(line: string, owner?: string): string {
  if (!line.includes(OWNER)) return line;
  return owner
    ? line.replace(OWNER, `(${owner.toUpperCase()})`)
    : line.replace(` ${OWNER}`, "");
}

/**
 * The stable line for a ticker's tier today. Deterministic per
 * (symbol, date) — never random. `owner` fills an owner-aware slot (card
 * only); omit it (tape) and the slot is stripped to the base line.
 */
export function tickerLine(
  symbol: string,
  date: string,
  tier: TickerTier,
  owner?: string,
): string {
  const pool = TICKER_LINES[tier];
  const raw = pool[seedFor(symbol, date) % pool.length]!;
  return applyOwner(raw, owner);
}

/**
 * Whether this ticker's tape entry should carry its line today. Extremes
 * always do; the rest ~1 in TAPE_CARRY_EVERY, deterministic per
 * (symbol, date) so the choice is stable and SSR-safe.
 */
export function tapeCarriesLine(
  symbol: string,
  date: string,
  tier: TickerTier,
): boolean {
  if (tier === "moon" || tier === "liquidated") return true;
  // A different salt than tickerLine's pick so carry ≠ line-index rhythm.
  return seedFor(`carry:${symbol}`, date) % TAPE_CARRY_EVERY === 0;
}
