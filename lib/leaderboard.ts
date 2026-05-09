import { PEOPLE, type Person, TICKERS } from "./tickers";
import type { StockPrice } from "./types";

export type Mover = {
  /** Internal ticker symbol — call `displayTicker(ticker)` for UI. */
  ticker: string;
  /** Today's `regularMarketChangePercent`. */
  pct: number;
};

export type LeaderboardEntry = {
  person: Person;
  /** Display name — "Chris", "Eric", … from PEOPLE. */
  name: string;
  /** Tickers this person owns. */
  tickers: string[];
  /** Mean of owned-ticker `regularMarketChangePercent`. Always defined. */
  todayPct: number;
  /** Mean of (price - weekStartPrice) / weekStartPrice * 100 across owned
   * tickers that have a baseline. `null` when no baseline is available
   * (Monday archive missed, or first-ever deploy). */
  wtdPct: number | null;
  /** How many of `tickers` actually have today's price + a weekStart baseline. */
  wtdCoverage: number;
  /** Best mover of the day among this person's owned tickers. Undefined
   * when the person has zero tickers with finite data today. */
  topMover?: Mover;
  /** Worst mover of the day among this person's owned tickers. Same
   * undefined-when-empty rule. May equal topMover when only one ticker
   * has data — caller should de-dupe in render if needed. */
  bottomMover?: Mover;
};

/**
 * Compute per-friend portfolio performance.
 *
 * Today: simple mean across owned tickers of `regularMarketChangePercent`
 * (no position weighting — we don't track share counts).
 *
 * WTD: same simple mean, but of (today / monday - 1) for tickers that
 * have a Monday baseline. Returns null when no owned ticker has a
 * baseline yet — caller hides the WTD column in that case.
 *
 * Sort: descending by todayPct, then by wtdPct (descending), then by name.
 */
export function computeLeaderboard(
  stocks: StockPrice[],
  weekStartPrices: Record<string, number> | undefined,
): LeaderboardEntry[] {
  const priceByTicker = new Map(stocks.map((s) => [s.ticker, s]));
  const ownersByPerson = new Map<Person, string[]>();
  for (const t of TICKERS) {
    for (const owner of t.owners ?? []) {
      const existing = ownersByPerson.get(owner) ?? [];
      existing.push(t.symbol);
      ownersByPerson.set(owner, existing);
    }
  }

  const entries: LeaderboardEntry[] = [];
  for (const [person, name] of Object.entries(PEOPLE) as [Person, string][]) {
    const tickers = ownersByPerson.get(person) ?? [];
    if (tickers.length === 0) continue;

    let todaySum = 0;
    let todayCount = 0;
    let wtdSum = 0;
    let wtdCoverage = 0;
    let topMover: Mover | undefined;
    let bottomMover: Mover | undefined;
    for (const ticker of tickers) {
      const stock = priceByTicker.get(ticker);
      if (!stock) continue;
      const pct = stock.regularMarketChangePercent;
      if (!Number.isFinite(pct)) continue;
      todaySum += pct;
      todayCount++;
      if (!topMover || pct > topMover.pct) topMover = { ticker, pct };
      if (!bottomMover || pct < bottomMover.pct) bottomMover = { ticker, pct };
      const baseline = weekStartPrices?.[ticker];
      if (baseline && baseline > 0 && Number.isFinite(stock.regularMarketPrice)) {
        wtdSum += ((stock.regularMarketPrice - baseline) / baseline) * 100;
        wtdCoverage++;
      }
    }

    if (todayCount === 0) continue;

    entries.push({
      person,
      name,
      tickers,
      todayPct: todaySum / todayCount,
      wtdPct: wtdCoverage > 0 ? wtdSum / wtdCoverage : null,
      wtdCoverage,
      ...(topMover ? { topMover } : {}),
      ...(bottomMover ? { bottomMover } : {}),
    });
  }

  entries.sort((a, b) => {
    if (a.todayPct !== b.todayPct) return b.todayPct - a.todayPct;
    const aw = a.wtdPct ?? -Infinity;
    const bw = b.wtdPct ?? -Infinity;
    if (aw !== bw) return bw - aw;
    return a.name.localeCompare(b.name);
  });

  return entries;
}

/**
 * Pick the friend with the highest WTD% — the actual week champion, not
 * whoever is currently #1 on the live today% sort. Returns null when no
 * baseline exists yet so the caller can skip generation.
 */
export function pickWeekChampion(
  stocks: StockPrice[],
  weekStartPrices: Record<string, number> | undefined,
): LeaderboardEntry | null {
  if (!weekStartPrices) return null;
  const entries = computeLeaderboard(stocks, weekStartPrices);
  const withWtd = entries.filter((e) => e.wtdPct !== null);
  if (withWtd.length === 0) return null;
  withWtd.sort(
    (a, b) => (b.wtdPct ?? -Infinity) - (a.wtdPct ?? -Infinity),
  );
  return withWtd[0] ?? null;
}

export type WeekMover = {
  ticker: string;
  weekChangePct: number;
};

/**
 * Pick the week's biggest winner and loser by week-over-week change.
 * Returns undefined for either side when no baseline exists yet (new
 * deploy or Monday archive missed) so callers can fall back to today's
 * mover labels.
 */
export function pickWeekWinnerLoser(
  stocks: StockPrice[],
  weekStartPrices: Record<string, number> | undefined,
): { winner?: WeekMover; loser?: WeekMover } {
  if (!weekStartPrices) return {};
  let winner: WeekMover | undefined;
  let loser: WeekMover | undefined;
  for (const s of stocks) {
    const baseline = weekStartPrices[s.ticker];
    if (!baseline || baseline <= 0 || !Number.isFinite(s.regularMarketPrice)) {
      continue;
    }
    const pct = ((s.regularMarketPrice - baseline) / baseline) * 100;
    if (!winner || pct > winner.weekChangePct) {
      winner = { ticker: s.ticker, weekChangePct: pct };
    }
    if (!loser || pct < loser.weekChangePct) {
      loser = { ticker: s.ticker, weekChangePct: pct };
    }
  }
  return {
    ...(winner ? { winner } : {}),
    ...(loser ? { loser } : {}),
  };
}
