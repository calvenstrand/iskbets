"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { inRecapWindow } from "@/lib/dateUtil";
import {
  pickTodayWinnerLoser,
  pickWeekWinnerLoser,
} from "@/lib/leaderboard";
import { marketHasOpenedToday } from "@/lib/marketHours";
import { TICKERS } from "@/lib/tickers";
import type {
  Brief,
  DashboardData,
  StockAnalysis,
  StockPrice,
  StoredData,
  WeeklyChampion,
} from "@/lib/types";
import { BriefCard } from "./Brief";
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
  data: StoredData;
  morningBrief?: Brief;
  eveningBrief?: Brief;
  weekendBrief?: Brief;
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

const POLL_MS = 5 * 60 * 1000; // 5 min — comfortably below the 15-min cron cadence
const FLASH_MS = 1800;

// Pre-built lookups so the grid sort doesn't scan TICKERS for every card.
const OWNED_TICKERS = new Set(
  TICKERS.filter((t) => (t.owners?.length ?? 0) > 0).map((t) => t.symbol),
);
const TICKER_MARKETS = new Map(TICKERS.map((t) => [t.symbol, t.market]));

/**
 * Three-tier sort for the dashboard grid:
 *   1. Stale-market tickers go LAST (their market hasn't opened in this
 *      Stockholm calendar day, so the change% is from the previous
 *      session and uninteresting next to live action).
 *   2. Within each group: owners' picks first.
 *   3. Within each owner-status group: biggest gainers first.
 */
function sortGridStocks(stocks: StockPrice[], now: Date): StockPrice[] {
  return [...stocks].sort((a, b) => {
    const aMarket = TICKER_MARKETS.get(a.ticker);
    const bMarket = TICKER_MARKETS.get(b.ticker);
    const aStale = aMarket ? !marketHasOpenedToday(aMarket, now) : false;
    const bStale = bMarket ? !marketHasOpenedToday(bMarket, now) : false;
    if (aStale !== bStale) return aStale ? 1 : -1;

    const aOwned = OWNED_TICKERS.has(a.ticker);
    const bOwned = OWNED_TICKERS.has(b.ticker);
    if (aOwned !== bOwned) return aOwned ? -1 : 1;

    return b.regularMarketChangePercent - a.regularMarketChangePercent;
  });
}

/** Tickers whose AI comment changed between two snapshots. */
function findCommentChanges(
  prev: StoredData,
  next: StoredData,
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
  morningBrief: initialMorning,
  eveningBrief: initialEvening,
  weekendBrief: initialWeekend,
  weeklyChampion: initialWeeklyChampion,
  weekStartPrices: initialWeekStart,
  initialInRecap,
  initialNowMs,
}: DashboardProps) {
  const [snapshot, setSnapshot] = useState<StoredData>(initialData);
  const [morningBrief, setMorningBrief] = useState<Brief | undefined>(
    initialMorning,
  );
  const [eveningBrief, setEveningBrief] = useState<Brief | undefined>(
    initialEvening,
  );
  const [weekendBrief, setWeekendBrief] = useState<Brief | undefined>(
    initialWeekend,
  );
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
  const [briefFlash, setBriefFlash] = useState(false);

  // Refs for closure-stable access to the latest state from the poll loop.
  const snapshotRef = useRef(snapshot);
  const morningRef = useRef(morningBrief);
  const eveningRef = useRef(eveningBrief);
  const weekendRef = useRef(weekendBrief);
  snapshotRef.current = snapshot;
  morningRef.current = morningBrief;
  eveningRef.current = eveningBrief;
  weekendRef.current = weekendBrief;

  // Single timeout per flash kind so a fast follow-up update doesn't cut
  // the previous flash short.
  const tickerFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moodFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const briefFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        const prevMorningGen = morningRef.current?.generatedAt ?? 0;
        const prevEveningGen = eveningRef.current?.generatedAt ?? 0;
        const prevWeekendGen = weekendRef.current?.generatedAt ?? 0;

        const changedTickers = findCommentChanges(prev, fresh.snapshot);
        const moodChanged =
          prev.analysis.overallMood !== fresh.snapshot.analysis.overallMood;
        const morningChanged =
          (fresh.morningBrief?.generatedAt ?? 0) > prevMorningGen;
        const eveningChanged =
          (fresh.eveningBrief?.generatedAt ?? 0) > prevEveningGen;
        const weekendChanged =
          (fresh.weekendBrief?.generatedAt ?? 0) > prevWeekendGen;

        // Update state regardless — silent UX even when nothing flashes.
        setSnapshot(fresh.snapshot);
        setMorningBrief(fresh.morningBrief);
        setEveningBrief(fresh.eveningBrief);
        setWeekendBrief(fresh.weekendBrief);
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
        if (morningChanged || eveningChanged || weekendChanged) {
          if (briefFlashTimer.current) clearTimeout(briefFlashTimer.current);
          setBriefFlash(true);
          briefFlashTimer.current = setTimeout(() => {
            if (!cancelled) setBriefFlash(false);
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

    // Only poll while the tab is visible. With the cron firing every 15 min
    // and a 5-min poll, leaving the tab open overnight would otherwise burn
    // ~144 needless /api/data calls per user.
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
      if (briefFlashTimer.current) clearTimeout(briefFlashTimer.current);
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

  const featuredTickers = new Set<string>();
  if (winner) featuredTickers.add(winner.ticker);
  if (loser) featuredTickers.add(loser.ticker);

  const gridStocks: StockPrice[] = sortGridStocks(
    snapshot.stocks.filter((s) => !featuredTickers.has(s.ticker)),
    now,
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
          live trading, the dashboard tightens up around today's data. */}
      {inRecap && weeklyChampion && (
        <WeeklyChampionCard champion={weeklyChampion} />
      )}

      {inRecap && (
        <Leaderboard
          stocks={snapshot.stocks}
          weekStartPrices={weekStartPrices}
        />
      )}

      <MoodBanner
        mood={snapshot.analysis.overallMood}
        avgChangePct={avgChangePct}
        flash={moodFlash}
      />

      <BriefCard
        morningBrief={morningBrief}
        eveningBrief={eveningBrief}
        weekendBrief={weekendBrief}
        flash={briefFlash}
      />

      <section className="px-4 md:px-8 lg:px-12 mt-8 mb-12">
        {(winner || loser) && (
          <div className="stock-grid-featured gap-3 mb-6">
            {winner && (
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
            )}
            {loser && (
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
            )}
          </div>
        )}

        <div className="stock-grid gap-3">
          {gridStocks.map((stock, i) => {
            const market = TICKER_MARKETS.get(stock.ticker);
            const stale = market
              ? !marketHasOpenedToday(market, now)
              : false;
            return (
              <StockCard
                key={stock.ticker}
                stock={stock}
                analysis={analysisByTicker.get(stock.ticker)}
                index={i + 2}
                flashing={flashedTickers.has(stock.ticker)}
                marketStale={stale}
              />
            );
          })}
        </div>
      </section>

      <UpdatedFooter updatedAt={snapshot.updatedAt} />
    </main>
  );
}
