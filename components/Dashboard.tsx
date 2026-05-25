"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { inRecapWindow } from "@/lib/dateUtil";
import {
  detectSweep,
  pickTodayWinnerLoser,
  pickWeekWinnerLoser,
  type SweepResult,
} from "@/lib/leaderboard";
import { marketHasOpenedToday } from "@/lib/marketHours";
import { TICKERS } from "@/lib/tickers";
import type {
  DashboardData,
  PublicStoredData,
  StockAnalysis,
  StockPrice,
  WeeklyChampion,
} from "@/lib/types";
import { CelebrationCard } from "./CelebrationCard";
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

// Poll cadence — 2 min (was 5 min). Cron fires every 10 min so polling
// 5× per cycle catches each new snapshot within 2 min of it landing.
// All polls hit the 20s CDN cache so the extra requests cost nothing
// at origin. The 5-min cadence was leaving viewers staring at frozen
// prices for up to 6 min after market open (1-2 cron cycles).
const POLL_MS = 2 * 60 * 1000;
const FLASH_MS = 1800;

// Pre-built lookups so the grid sort doesn't scan TICKERS for every card.
const OWNED_TICKERS = new Set(
  TICKERS.filter((t) => (t.owners?.length ?? 0) > 0).map((t) => t.symbol),
);
const TICKER_MARKETS = new Map(TICKERS.map((t) => [t.symbol, t.market]));

/**
 * Sort for the dashboard grid. Two modes:
 *
 *   Today framing (weekday trading):
 *     1. Stale-market tickers LAST (market hasn't opened in this
 *        Stockholm calendar day, change% is from the previous session
 *        and uninteresting next to live action).
 *     2. Owners' picks first within each market-state group.
 *     3. Biggest abs(today%) first; ties broken by signed value so
 *        gainers edge out equal-magnitude losers.
 *
 *   Week framing (recap window — `weekChanges` provided):
 *     1. (Stale tier dropped — all data is fresh week data; no stocks
 *        are "stale" relative to a Mon-Fri baseline.)
 *     2. Owners' picks first.
 *     3. Biggest abs(week%) first; ties broken by signed value.
 *
 * Tickers without a Monday baseline fall through to 0 in week framing,
 * sinking to the bottom of the abs ordering — fine since they have no
 * weekly story to tell.
 */
function sortGridStocks(
  stocks: StockPrice[],
  now: Date,
  weekChanges: Map<string, number> | null,
): StockPrice[] {
  const useWeek = weekChanges !== null;
  return [...stocks].sort((a, b) => {
    if (!useWeek) {
      const aMarket = TICKER_MARKETS.get(a.ticker);
      const bMarket = TICKER_MARKETS.get(b.ticker);
      const aStale = aMarket ? !marketHasOpenedToday(aMarket, now) : false;
      const bStale = bMarket ? !marketHasOpenedToday(bMarket, now) : false;
      if (aStale !== bStale) return aStale ? 1 : -1;
    }

    const aOwned = OWNED_TICKERS.has(a.ticker);
    const bOwned = OWNED_TICKERS.has(b.ticker);
    if (aOwned !== bOwned) return aOwned ? -1 : 1;

    const aPct = useWeek
      ? (weekChanges.get(a.ticker) ?? 0)
      : a.regularMarketChangePercent;
    const bPct = useWeek
      ? (weekChanges.get(b.ticker) ?? 0)
      : b.regularMarketChangePercent;
    const aAbs = Math.abs(aPct);
    const bAbs = Math.abs(bPct);
    if (aAbs !== bAbs) return bAbs - aAbs;
    return bPct - aPct;
  });
}

/** Tickers whose AI comment changed between two snapshots. */
function findCommentChanges(
  prev: PublicStoredData,
  next: PublicStoredData,
): Set<string> {
  const oldComments = new Map(
    prev.analysis.stocks.map((s) => [s.ticker, s.comment ?? ""]),
  );
  const changed = new Set<string>();
  for (const s of next.analysis.stocks) {
    const newComment = s.comment ?? "";
    const oldComment = oldComments.get(s.ticker) ?? "";
    if (newComment !== oldComment && newComment !== "") {
      changed.add(s.ticker);
    }
  }
  return changed;
}

export function Dashboard({
  data: initialData,
  weeklyChampion: initialWeeklyChampion,
  weekStartPrices: initialWeekStart,
  initialInRecap,
  initialNowMs,
}: DashboardProps) {
  const [snapshot, setSnapshot] = useState<PublicStoredData>(initialData);
  const [weeklyChampion, setWeeklyChampion] = useState<
    WeeklyChampion | undefined
  >(initialWeeklyChampion);
  const [weekStartPrices, setWeekStartPrices] = useState<
    Record<string, number> | undefined
  >(initialWeekStart);

  // Unified time state. Seeded from server-rendered initialNowMs so
  // the first client render uses the same timestamp as the server
  // (no hydration mismatch in any time-dependent logic — sort, stale
  // flags, today-winner pick, recap window). useEffect then ticks
  // every minute, keeping the dashboard in sync with real time
  // without page reloads. All time-dependent derivations below pull
  // from this single `now`.
  const [now, setNow] = useState<Date>(() => new Date(initialNowMs));
  const [inRecap, setInRecap] = useState(initialInRecap);

  useEffect(() => {
    const tick = () => {
      const newNow = new Date();
      setNow(newNow);
      setInRecap(inRecapWindow(newNow));
    };
    tick(); // re-check immediately post-hydration in case clocks differ
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // Today's winner/loser, recomputed whenever `now` ticks or the
  // snapshot refreshes. Filters out tickers whose market hasn't opened
  // in this STO calendar day. SSR-safe because server and client
  // first-render with identical inputs (snapshot from props, now from
  // initialNowMs).
  const liveTodayMovers = useMemo(
    () => pickTodayWinnerLoser(snapshot.stocks, now),
    [snapshot, now],
  );

  // Visual flash state — set on poll diff, cleared after FLASH_MS.
  const [flashedTickers, setFlashedTickers] = useState<Set<string>>(
    () => new Set(),
  );
  const [moodFlash, setMoodFlash] = useState(false);

  // Refs for closure-stable access to the latest state from the poll loop.
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // Single timeout per flash kind so a fast follow-up update doesn't cut
  // the previous flash short.
  const tickerFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moodFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function refresh() {
      try {
        // Forward the page's search params (e.g. `?mode=weekend`) so the
        // polled data stays consistent with the initial server render.
        // Production: query string is empty, behavior unchanged.
        const url = new URL("/api/data", window.location.origin);
        const liveParams = new URL(window.location.href).searchParams;
        for (const [k, v] of liveParams) url.searchParams.set(k, v);
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) return;
        const fresh = (await res.json()) as DashboardData;
        if (cancelled) return;

        const prev = snapshotRef.current;
        const changedTickers = findCommentChanges(prev, fresh.snapshot);
        const moodChanged =
          prev.analysis.overallMood !== fresh.snapshot.analysis.overallMood;

        // Update state regardless — silent UX even when nothing flashes.
        setSnapshot(fresh.snapshot);
        setWeeklyChampion(fresh.weeklyChampion);
        setWeekStartPrices(fresh.weekStartPrices);

        if (changedTickers.size > 0) {
          if (tickerFlashTimer.current) {
            clearTimeout(tickerFlashTimer.current);
          }
          setFlashedTickers(changedTickers);
          tickerFlashTimer.current = setTimeout(() => {
            if (!cancelled) setFlashedTickers(new Set());
          }, FLASH_MS);
        }
        if (moodChanged) {
          if (moodFlashTimer.current) clearTimeout(moodFlashTimer.current);
          setMoodFlash(true);
          moodFlashTimer.current = setTimeout(() => {
            if (!cancelled) setMoodFlash(false);
          }, FLASH_MS);
        }
      } catch {
        // Silent — try again next interval.
      }
    }

    function startPolling() {
      if (interval !== null) return; // idempotent — already running
      interval = setInterval(refresh, POLL_MS);
    }

    function stopPolling() {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    }

    // Only poll while the tab is visible. With the cron firing every 10 min
    // and a 2-min poll, leaving the tab open overnight would otherwise burn
    // ~720 needless /api/data calls per user (all CDN-cached but still
    // pointless).
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh(); // catch up immediately on return
        startPolling();
      } else {
        stopPolling();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    if (document.visibilityState === "visible") {
      startPolling();
    }

    return () => {
      cancelled = true;
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
      if (tickerFlashTimer.current) clearTimeout(tickerFlashTimer.current);
      if (moodFlashTimer.current) clearTimeout(moodFlashTimer.current);
    };
  }, []);

  const analysisByTicker = new Map<string, StockAnalysis>(
    snapshot.analysis.stocks.map((a) => [a.ticker, a]),
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
            return market ? marketHasOpenedToday(market, now) : false;
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
      {inRecap && weeklyChampion ? (
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

      <section className="px-4 md:px-8 lg:px-12 mt-8 mb-12">
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

        <div className="stock-grid gap-3">
          {gridStocks.map((stock, i) => {
            const market = TICKER_MARKETS.get(stock.ticker);
            // During recap mode, "stale" loses meaning — every card
            // is showing week data which is fresh relative to the Mon
            // baseline. Skip the dim treatment so the weekend grid
            // doesn't look uniformly washed out.
            const stale =
              !weekChangeByTicker && market
                ? !marketHasOpenedToday(market, now)
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
