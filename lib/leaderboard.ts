import { hasTradedToday } from "./marketHours";
import { buildOwnersByPerson, PEOPLE, type Person, TICKERS } from "./tickers";
import type { StockPrice } from "./types";

// Symbol → market, so the day-scope stale filter can ask hasTradedToday
// without threading the whole TICKERS list through every call.
const MARKET_BY_TICKER = new Map(TICKERS.map((t) => [t.symbol, t.market]));

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
  /** Mean of owned-ticker `regularMarketChangePercent`. In day scope
   * (a `now` was passed) only tickers that traded today are counted;
   * `NaN` when the friend has a valid WTD but no ticker traded today. */
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
  /** Best week-over-week mover among this person's owned tickers. `pct`
   * is the week change %. Undefined when no baseline exists for any
   * owned ticker. */
  topWeekMover?: Mover;
  /** Worst week-over-week mover, same shape and undefined-rule. */
  bottomWeekMover?: Mover;
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
 * Sort: defaults to descending by todayPct (then wtdPct, then name).
 * Pass `sortBy: "wtd"` for the recap-window flip — friends ranked by
 * the actual week story instead of today's intraday noise. Entries
 * without a wtdPct sink to the bottom under WTD sort.
 *
 * Pass `now` (the day-scope path) to stale-filter the TODAY aggregate:
 * a ticker whose market hasn't traded in this Stockholm calendar day is
 * excluded from today% + the day movers, so a US ticker frozen at
 * Friday's close can't skew a friend's Monday-morning score. The WTD
 * aggregate is baseline-based and always counts every owned ticker with
 * a Monday price — a frozen ticker's week change is still valid.
 */
export function computeLeaderboard(
  stocks: StockPrice[],
  weekStartPrices: Record<string, number> | undefined,
  opts?: { sortBy?: "today" | "wtd"; now?: Date },
): LeaderboardEntry[] {
  const sortBy = opts?.sortBy ?? "today";
  const now = opts?.now;
  const priceByTicker = new Map(stocks.map((s) => [s.ticker, s]));
  const ownersByPerson = buildOwnersByPerson();

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
    let topWeekMover: Mover | undefined;
    let bottomWeekMover: Mover | undefined;
    for (const ticker of tickers) {
      const stock = priceByTicker.get(ticker);
      if (!stock) continue;
      const pct = stock.regularMarketChangePercent;

      // TODAY aggregate — a finite move that actually printed today when
      // `now` is supplied (day scope). Without `now` (recap/week scope)
      // the stale filter is a no-op, matching prior behavior.
      const market = MARKET_BY_TICKER.get(ticker);
      const tradedToday =
        !now || (market ? hasTradedToday(stock.lastTradeAt, market, now) : true);
      if (Number.isFinite(pct) && tradedToday) {
        todaySum += pct;
        todayCount++;
        if (!topMover || pct > topMover.pct) topMover = { ticker, pct };
        if (!bottomMover || pct < bottomMover.pct) bottomMover = { ticker, pct };
      }

      // WTD aggregate — baseline-based, independent of today's print.
      const baseline = weekStartPrices?.[ticker];
      if (baseline && baseline > 0 && Number.isFinite(stock.regularMarketPrice)) {
        const weekPct =
          ((stock.regularMarketPrice - baseline) / baseline) * 100;
        wtdSum += weekPct;
        wtdCoverage++;
        if (!topWeekMover || weekPct > topWeekMover.pct) {
          topWeekMover = { ticker, pct: weekPct };
        }
        if (!bottomWeekMover || weekPct < bottomWeekMover.pct) {
          bottomWeekMover = { ticker, pct: weekPct };
        }
      }
    }

    // Drop a friend only when they have nothing to show for EITHER
    // period — otherwise a friend whose bags are all stale today (e.g.
    // US-only before NY opens) still ranks on their valid WTD.
    if (todayCount === 0 && wtdCoverage === 0) continue;

    entries.push({
      person,
      name,
      tickers,
      todayPct: todayCount > 0 ? todaySum / todayCount : NaN,
      wtdPct: wtdCoverage > 0 ? wtdSum / wtdCoverage : null,
      wtdCoverage,
      ...(topMover ? { topMover } : {}),
      ...(bottomMover ? { bottomMover } : {}),
      ...(topWeekMover ? { topWeekMover } : {}),
      ...(bottomWeekMover ? { bottomWeekMover } : {}),
    });
  }

  // todayPct can be NaN (a friend with only stale tickers today but a
  // valid WTD) — coerce to -Infinity so those friends sink instead of
  // producing NaN comparisons that leave the order undefined.
  const todayOf = (e: LeaderboardEntry): number =>
    Number.isFinite(e.todayPct) ? e.todayPct : -Infinity;

  entries.sort((a, b) => {
    if (sortBy === "wtd") {
      // Recap-window sort: rank by the actual week story. Friends
      // without a baseline (wtdPct === null) sink to the bottom via
      // -Infinity, then break ties on todayPct, then name.
      const aw = a.wtdPct ?? -Infinity;
      const bw = b.wtdPct ?? -Infinity;
      if (aw !== bw) return bw - aw;
      if (todayOf(a) !== todayOf(b)) return todayOf(b) - todayOf(a);
      return a.name.localeCompare(b.name);
    }
    if (todayOf(a) !== todayOf(b)) return todayOf(b) - todayOf(a);
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

export type DayMover = {
  ticker: string;
  changePct: number;
};

export type SweepResult =
  | { type: "clean-sweep"; count: number; avgPct: number }
  | { type: "bloodbath"; count: number; avgPct: number }
  | { type: null };

/**
 * Detect a "clean sweep" (all positive) or "bloodbath" (all negative)
 * across a set of stocks. Only fires with ≥2 eligible stocks so we
 * don't celebrate when one lonely SE ticker is up at 09:01.
 *
 * For "today" framing: pass stocks pre-filtered to markets that have
 * opened in this Stockholm calendar day (otherwise stale US data
 * frozen at Friday's close would skew the count Mon morning).
 *
 * For "week" framing: pass stocks paired with their week change %.
 *
 * Caller decides which mode by what `pct` value it puts in the entries.
 */
export function detectSweep(
  entries: ReadonlyArray<{ pct: number }>,
): SweepResult {
  const finite = entries.filter((e) => Number.isFinite(e.pct));
  if (finite.length < 2) return { type: null };
  let positive = 0;
  let negative = 0;
  let sum = 0;
  for (const e of finite) {
    if (e.pct > 0) positive++;
    else if (e.pct < 0) negative++;
    sum += e.pct;
  }
  const avgPct = sum / finite.length;
  if (negative === 0 && positive > 0) {
    return { type: "clean-sweep", count: finite.length, avgPct };
  }
  if (positive === 0 && negative > 0) {
    return { type: "bloodbath", count: finite.length, avgPct };
  }
  return { type: null };
}

/**
 * Day-framing sweep: detectSweep over the stocks whose market has
 * actually traded in this Stockholm calendar day (the hasTradedToday
 * eligibility every day-scoped surface shares). Defined ONCE here so the
 * dashboard skin, the OG image, and the stock page can't drift on what
 * counts as a bloodbath / clean sweep. Week-framing sweeps (recap
 * window) stay caller-side — they need the weekStartPrices baseline.
 */
export function detectTodaySweep(
  stocks: StockPrice[],
  now: Date,
): SweepResult {
  return detectSweep(
    stocks
      .filter((s) => {
        const market = MARKET_BY_TICKER.get(s.ticker);
        return market ? hasTradedToday(s.lastTradeAt, market, now) : false;
      })
      .map((s) => ({ pct: s.regularMarketChangePercent })),
  );
}

/**
 * Pick today's biggest winner / loser by intraday change %, but ONLY
 * among stocks whose market has actually opened during this Stockholm
 * calendar day. Without this filter, a US ticker frozen at +1.8% from
 * Friday's close would beat any SE stock currently moving on a Monday
 * afternoon — labeled "TODAY'S BIGGEST WINNER" while NY hasn't even
 * opened yet.
 *
 * Returns undefined for either side when no eligible stocks exist
 * (e.g. overnight on a weekday before any market has opened, or
 * weekend) — caller should fall back to a less-filtered pick or hide.
 *
 * Owner of the TICKERS-list lookup matters here: each StockPrice carries
 * just the symbol, not its market. We bridge via the canonical TICKERS
 * map.
 */
export function pickTodayWinnerLoser(
  stocks: StockPrice[],
  now: Date,
): { winner?: DayMover; loser?: DayMover } {
  const tickerMeta = new Map(TICKERS.map((t) => [t.symbol, t]));
  let winner: DayMover | undefined;
  let loser: DayMover | undefined;
  for (const s of stocks) {
    const meta = tickerMeta.get(s.ticker);
    if (!meta) continue;
    if (!hasTradedToday(s.lastTradeAt, meta.market, now)) continue;
    if (!Number.isFinite(s.regularMarketChangePercent)) continue;
    const pct = s.regularMarketChangePercent;
    if (!winner || pct > winner.changePct) winner = { ticker: s.ticker, changePct: pct };
    if (!loser || pct < loser.changePct) loser = { ticker: s.ticker, changePct: pct };
  }
  return {
    ...(winner ? { winner } : {}),
    ...(loser ? { loser } : {}),
  };
}

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

/**
 * Today's biggest absolute winner/loser by `regularMarketChangePercent`,
 * unfiltered by market state. Used by the trigger route to stamp the
 * snapshot's `biggestWinner`/`biggestLoser` so they stay fresh on every
 * cron tick regardless of whether either AI call fires.
 *
 * Returns empty strings for an empty prices array — callers should fall
 * back to whatever they had cached.
 */
export function pickBiggestWinnerLoser(prices: StockPrice[]): {
  biggestWinner: string;
  biggestLoser: string;
} {
  if (prices.length === 0) return { biggestWinner: "", biggestLoser: "" };
  let winner = prices[0]!;
  let loser = prices[0]!;
  for (const p of prices) {
    if (p.regularMarketChangePercent > winner.regularMarketChangePercent) {
      winner = p;
    }
    if (p.regularMarketChangePercent < loser.regularMarketChangePercent) {
      loser = p;
    }
  }
  return { biggestWinner: winner.ticker, biggestLoser: loser.ticker };
}
