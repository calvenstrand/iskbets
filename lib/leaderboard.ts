import { PEOPLE, type Person, TICKERS } from "./tickers";
import type { StockPrice } from "./types";

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
    for (const ticker of tickers) {
      const stock = priceByTicker.get(ticker);
      if (!stock) continue;
      todaySum += stock.regularMarketChangePercent;
      todayCount++;
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
