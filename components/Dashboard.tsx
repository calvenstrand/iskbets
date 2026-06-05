"use client";

import { useMemo } from "react";
import {
  detectSweep,
  pickTodayWinnerLoser,
  pickWeekWinnerLoser,
  type SweepResult,
} from "@/lib/leaderboard";
import { hasTradedToday } from "@/lib/marketHours";
import { TICKERS } from "@/lib/tickers";
import type {
  PublicStoredData,
  StockAnalysis,
  StockPrice,
  WeeklyChampion,
} from "@/lib/types";
import { useGridSort } from "@/hooks/useGridSort";
import { stockholmMondayOfWeek } from "@/lib/dateUtil";
import { useNow } from "@/hooks/useNow";
import { usePollDashboard } from "@/hooks/usePollDashboard";
import { CelebrationCard } from "./CelebrationCard";
import { GridSort } from "./GridSort";
import { Header } from "./Header";
import { Leaderboard } from "./Leaderboard";
import { MarketStatus } from "./MarketStatus";
import { MoodBanner } from "./MoodBanner";
import { PullToRefresh } from "./PullToRefresh";
import { StockCard } from "./StockCard";
import { TickerTape } from "./TickerTape";
import { UpdatedFooter } from "./UpdatedFooter";
import { WeeklyChampionCard } from "./WeeklyChampion";

type DashboardProps = {
  data: PublicStoredData;
  weeklyChampion?: WeeklyChampion;
  weekStartPrices?: Record<string, number>;
  /** Server-computed initial value for the recap window (Fri 22:00 STO →
   * Mon 09:00 STO). Dashboard re-checks every minute on the client so
   * the UI flips automatically when the window opens / closes — but
   * seeding from the server keeps the first paint correct. */
  initialInRecap: boolean;
  /** Server's wall-clock time (epoch ms) at render. Dashboard seeds its
   * `now` state from this so the first client render matches the
   * server (no hydration mismatch in time-dependent logic — sort,
   * stale flags, today-winner pick). useEffect then takes over with
   * real client time. */
  initialNowMs: number;
};

// Pre-built market lookup so the grid sort doesn't scan TICKERS for
// every card.
const TICKER_MARKETS = new Map(TICKERS.map((t) => [t.symbol, t.market]));

// Tickers at least one friend holds — drives the "💎 OUR BAGS" sort.
const TICKER_OWNED = new Set(
  TICKERS.filter((t) => t.owners && t.owners.length > 0).map((t) => t.symbol),
);

/**
 * Sort for the dashboard grid. The viewer picks the ordering via the
 * GridSort pills (default `chaos`); the metric each mode reads follows
 * the active framing:
 *
 *   Today framing (weekday trading): `regularMarketChangePercent`, and a
 *     stale-market tier pins closed-market tickers LAST regardless of
 *     mode — their numbers are from a previous session and they render
 *     dimmed anyway, so they shouldn't crowd the top of any sort.
 *
 *   Week framing (recap window — `weekChanges` provided): week-over-week
 *     %, no stale tier (all data is fresh relative to the Mon baseline).
 *     Tickers without a Monday baseline fall through to 0, sinking to the
 *     bottom — fine since they have no weekly story to tell.
 *
 * Modes:
 *   chaos  — biggest abs move first; ties broken by signed value so
 *            gainers edge out equal-magnitude losers.
 *   moon   — top gainers first (signed %, descending).
 *   rekt   — biggest losers first (signed %, ascending).
 *   stacks — priciest tickers first; non-finite prices sink.
 *   bags   — friend-group holdings first, then biggest movers within
 *            each tier.
 */
function sortGridStocks(
  stocks: StockPrice[],
  now: Date,
  weekChanges: Map<string, number> | null,
  sortMode: ReturnType<typeof useGridSort>[0],
): StockPrice[] {
  const useWeek = weekChanges !== null;
  const pctOf = (s: StockPrice): number =>
    useWeek
      ? (weekChanges.get(s.ticker) ?? 0)
      : s.regularMarketChangePercent;

  return [...stocks].sort((a, b) => {
    if (!useWeek) {
      const aMarket = TICKER_MARKETS.get(a.ticker);
      const bMarket = TICKER_MARKETS.get(b.ticker);
      const aStale = aMarket
        ? !hasTradedToday(a.lastTradeAt, aMarket, now)
        : false;
      const bStale = bMarket
        ? !hasTradedToday(b.lastTradeAt, bMarket, now)
        : false;
      if (aStale !== bStale) return aStale ? 1 : -1;
    }

    const aPct = pctOf(a);
    const bPct = pctOf(b);

    switch (sortMode) {
      case "moon":
        if (aPct !== bPct) return bPct - aPct;
        break;
      case "rekt":
        if (aPct !== bPct) return aPct - bPct;
        break;
      case "stacks": {
        const aPrice = Number.isFinite(a.regularMarketPrice)
          ? a.regularMarketPrice
          : -Infinity;
        const bPrice = Number.isFinite(b.regularMarketPrice)
          ? b.regularMarketPrice
          : -Infinity;
        if (aPrice !== bPrice) return bPrice - aPrice;
        break;
      }
      case "bags": {
        const aOwned = TICKER_OWNED.has(a.ticker);
        const bOwned = TICKER_OWNED.has(b.ticker);
        if (aOwned !== bOwned) return aOwned ? -1 : 1;
        break;
      }
    }

    // Shared fallback (and the whole story for `chaos`): biggest abs
    // move first, ties broken by signed value.
    const aAbs = Math.abs(aPct);
    const bAbs = Math.abs(bPct);
    if (aAbs !== bAbs) return bAbs - aAbs;
    return bPct - aPct;
  });
}

export function Dashboard({
  data: initialData,
  weeklyChampion: initialWeeklyChampion,
  weekStartPrices: initialWeekStart,
  initialInRecap,
  initialNowMs,
}: DashboardProps) {
  const { now, inRecap } = useNow(initialNowMs, initialInRecap);
  const [sortMode, handleSortChange] = useGridSort();
  const { snapshot, weeklyChampion, weekStartPrices, flashedTickers, moodFlash } =
    usePollDashboard({
      snapshot: initialData,
      weeklyChampion: initialWeeklyChampion,
      weekStartPrices: initialWeekStart,
    });

  // Today's winner/loser, recomputed whenever `now` ticks or the
  // snapshot refreshes. Filters out tickers whose market hasn't opened
  // in this STO calendar day. SSR-safe because server and client
  // first-render with identical inputs (snapshot from props, now from
  // initialNowMs).
  const liveTodayMovers = useMemo(
    () => pickTodayWinnerLoser(snapshot.stocks, now),
    [snapshot, now],
  );

  const analysisByTicker = useMemo(
    () => new Map<string, StockAnalysis>(snapshot.analysis.stocks.map((a) => [a.ticker, a])),
    [snapshot.analysis.stocks],
  );

  // Featured cards swap framing based on the recap window:
  //   inside (Fri 22:00 → Mon 09:00 STO): WEEK's biggest mover, computed
  //     from the weekStartPrices baseline.
  //   outside (live trading hours of weekdays): TODAY's biggest mover
  //     filtered to markets that have actually opened today (so a US
  //     ticker frozen at Friday's +1.8% can't beat live SE moves on a
  //     Monday afternoon before NY opens).
  // Final fallback: snapshot.analysis.biggestWinner from the AI run.
  // Used only when neither week nor today filtering yields a pick
  // (e.g. very first deploy + overnight on a weekday with no market
  // having opened yet today).
  const weekMovers = pickWeekWinnerLoser(snapshot.stocks, weekStartPrices);
  const useWeekFraming = inRecap && !!weekMovers.winner;
  const featuredScope: "week" | "day" = useWeekFraming ? "week" : "day";
  const winnerTicker = useWeekFraming
    ? (weekMovers.winner?.ticker ?? snapshot.analysis.biggestWinner)
    : (liveTodayMovers.winner?.ticker ?? snapshot.analysis.biggestWinner);
  const loserTicker = useWeekFraming
    ? (weekMovers.loser?.ticker ?? snapshot.analysis.biggestLoser)
    : (liveTodayMovers.loser?.ticker ?? snapshot.analysis.biggestLoser);

  const winner = snapshot.stocks.find((s) => s.ticker === winnerTicker);
  const loser = snapshot.stocks.find((s) => s.ticker === loserTicker);

  // Sweep detection: when EVERY eligible stock is the same direction,
  // swap the empty featured slot (no real loser / no real winner) for
  // a celebration card. Eligibility matches the featured-card framing:
  //   - week framing: stocks that have a Monday baseline (weekChangePct)
  //   - day framing: stocks whose market has opened in this STO day
  // Anything else gets the regular winner+loser pair.
  const sweep: SweepResult = useWeekFraming
    ? detectSweep(
        weekStartPrices
          ? snapshot.stocks
              .map((s) => {
                const baseline = weekStartPrices[s.ticker];
                if (
                  !baseline ||
                  baseline <= 0 ||
                  !Number.isFinite(s.regularMarketPrice)
                ) {
                  return null;
                }
                return {
                  pct: ((s.regularMarketPrice - baseline) / baseline) * 100,
                };
              })
              .filter((x): x is { pct: number } => x !== null)
          : [],
      )
    : detectSweep(
        snapshot.stocks
          .filter((s) => {
            const market = TICKER_MARKETS.get(s.ticker);
            return market ? hasTradedToday(s.lastTradeAt, market, now) : false;
          })
          .map((s) => ({ pct: s.regularMarketChangePercent })),
      );

  const featuredTickers = new Set<string>();
  if (winner) featuredTickers.add(winner.ticker);
  if (loser) featuredTickers.add(loser.ticker);

  // Week-change lookup for the grid cards during recap. Computed once
  // per render from the Monday baseline; `null` outside the recap
  // window so the grid falls back to today-framing (current behavior).
  // Tickers without a baseline are absent from the map — sort defaults
  // them to 0 abs change so they sink to the bottom.
  const weekChangeByTicker = useMemo<Map<string, number> | null>(() => {
    if (!inRecap || !weekStartPrices) return null;
    const map = new Map<string, number>();
    for (const s of snapshot.stocks) {
      const baseline = weekStartPrices[s.ticker];
      if (!baseline || baseline <= 0) continue;
      if (!Number.isFinite(s.regularMarketPrice)) continue;
      map.set(s.ticker, ((s.regularMarketPrice - baseline) / baseline) * 100);
    }
    return map;
  }, [snapshot.stocks, weekStartPrices, inRecap]);

  const gridStocks: StockPrice[] = sortGridStocks(
    snapshot.stocks.filter((s) => !featuredTickers.has(s.ticker)),
    now,
    weekChangeByTicker,
    sortMode,
  );

  const totalChangePct = snapshot.stocks.reduce(
    (sum, s) => sum + (s.regularMarketChangePercent ?? 0),
    0,
  );
  const avgChangePct = snapshot.stocks.length
    ? totalChangePct / snapshot.stocks.length
    : 0;

  return (
    <main>
      <PullToRefresh />
      <TickerTape stocks={snapshot.stocks} />
      <Header />
      <MarketStatus />
      {/* Champion of the Week + Friend Leaderboard are recap-window
          content — they only earn screen real estate when there's a
          full week to recap (Fri 22:00 STO → Mon 09:00 STO). During
          live trading, the dashboard tightens up around today's data.
          When both are present, they sit side-by-side in a .recap-row
          (50/50 on desktop, stacked on narrow). When only one is
          available (e.g. weeklyChampion missing the first week after
          deploy), it renders standalone with its native layout. */}
      {inRecap && weeklyChampion && weeklyChampion.weekStart === stockholmMondayOfWeek(now) ? (
        <div className="recap-row">
          <WeeklyChampionCard champion={weeklyChampion} />
          <Leaderboard
            stocks={snapshot.stocks}
            weekStartPrices={weekStartPrices}
            recapMode
          />
        </div>
      ) : (
        inRecap && (
          <Leaderboard
            stocks={snapshot.stocks}
            weekStartPrices={weekStartPrices}
            recapMode
          />
        )
      )}

      {/* Mood banner hides during the recap window — Friday's close
          would otherwise masquerade as a live "today" mood on Sat/Sun,
          and the Champion of the Week card already owns the editorial
          framing for the whole weekend. Returns Monday at 09:00 STO
          when the live trading day begins again. */}
      {!inRecap && (
        <MoodBanner
          mood={snapshot.analysis.overallMood}
          avgChangePct={avgChangePct}
          flash={moodFlash}
        />
      )}

      {/* relative z-0: the stock cards set `container-type: inline-size`
          (for their mobile container queries), which makes each card its
          own stacking context. WebKit/Safari then mis-paints those above
          the sticky ticker tape (z-index 50) on scroll. Capping the whole
          card section in a z-0 stacking context confines every card below
          the tape. */}
      <section className="px-4 md:px-8 lg:px-12 mt-8 mb-12 relative z-0">
        {(winner || loser) && (
          <div className="stock-grid-featured gap-3 mb-6">
            {/* WINNER slot — replaced by a 🩸 BLOODBATH celebration when
                every eligible stock is red, otherwise the regular
                biggest-winner StockCard. */}
            {sweep.type === "bloodbath" ? (
              <CelebrationCard
                kind="bloodbath"
                count={sweep.count}
                avgPct={sweep.avgPct}
                scope={featuredScope}
              />
            ) : (
              winner && (
                <StockCard
                  stock={winner}
                  analysis={analysisByTicker.get(winner.ticker)}
                  featured="winner"
                  featuredScope={featuredScope}
                  {...(useWeekFraming && weekMovers.winner
                    ? { featuredWeekChangePct: weekMovers.winner.weekChangePct }
                    : {})}
                  index={0}
                  flashing={flashedTickers.has(winner.ticker)}
                />
              )
            )}
            {/* LOSER slot — replaced by a 💎 CLEAN SWEEP celebration when
                every eligible stock is green. */}
            {sweep.type === "clean-sweep" ? (
              <CelebrationCard
                kind="clean-sweep"
                count={sweep.count}
                avgPct={sweep.avgPct}
                scope={featuredScope}
              />
            ) : (
              loser && (
                <StockCard
                  stock={loser}
                  analysis={analysisByTicker.get(loser.ticker)}
                  featured="loser"
                  featuredScope={featuredScope}
                  {...(useWeekFraming && weekMovers.loser
                    ? { featuredWeekChangePct: weekMovers.loser.weekChangePct }
                    : {})}
                  index={1}
                  flashing={flashedTickers.has(loser.ticker)}
                />
              )
            )}
          </div>
        )}

        <GridSort value={sortMode} onChange={handleSortChange} />

        <div className="stock-grid gap-3">
          {gridStocks.map((stock, i) => {
            const market = TICKER_MARKETS.get(stock.ticker);
            // During recap mode, "stale" loses meaning — every card
            // is showing week data which is fresh relative to the Mon
            // baseline. Skip the dim treatment so the weekend grid
            // doesn't look uniformly washed out.
            const stale =
              !weekChangeByTicker && market
                ? !hasTradedToday(stock.lastTradeAt, market, now)
                : false;
            const wk = weekChangeByTicker?.get(stock.ticker);
            return (
              <StockCard
                key={stock.ticker}
                stock={stock}
                analysis={analysisByTicker.get(stock.ticker)}
                index={i + 2}
                flashing={flashedTickers.has(stock.ticker)}
                marketStale={stale}
                {...(wk !== undefined ? { weekChangePct: wk } : {})}
              />
            );
          })}
        </div>
      </section>

      <UpdatedFooter updatedAt={snapshot.updatedAt} />
    </main>
  );
}
