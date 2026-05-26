"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { inRecapWindow } from "@/lib/dateUtil";
import {
  detectSweep,
  pickTodayWinnerLoser,
  pickWeekWinnerLoser,
  type SweepResult,
} from "@/lib/leaderboard";
import { hasTradedToday } from "@/lib/marketHours";
import { TICKERS } from "@/lib/tickers";
import type {
  DashboardData,
  PublicStoredData,
  StockAnalysis,
  StockPrice,
  WeeklyChampion,
} from "@/lib/types";
import { CelebrationCard } from "./CelebrationCard";
import { GridSort, isSortMode, type SortMode } from "./GridSort";
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

// Pre-built market lookup so the grid sort doesn't scan TICKERS for
// every card.
const TICKER_MARKETS = new Map(TICKERS.map((t) => [t.symbol, t.market]));

// Tickers at least one friend holds — drives the "💎 OUR BAGS" sort.
const TICKER_OWNED = new Set(
  TICKERS.filter((t) => t.owners && t.owners.length > 0).map((t) => t.symbol),
);

const SORT_STORAGE_KEY = "iskbets:gridSort";

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
  sortMode: SortMode,
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

  // Grid sort mode. Seeded to "chaos" so the first client render matches
  // the server (no hydration mismatch); the saved preference is read from
  // localStorage post-mount and re-sorts then.
  const [sortMode, setSortMode] = useState<SortMode>("chaos");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SORT_STORAGE_KEY);
      if (saved && isSortMode(saved)) setSortMode(saved);
    } catch {
      // localStorage unavailable (private mode / blocked) — keep default.
    }
  }, []);

  const handleSortChange = (mode: SortMode): void => {
    setSortMode(mode);
    try {
      window.localStorage.setItem(SORT_STORAGE_KEY, mode);
    } catch {
      // Non-fatal — the choice still applies for this session.
    }
  };

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
    // Window focus catches "user clicked back into the browser from
    // another app" — visibilitychange only fires on tab/window
    // visibility flips, not cross-app focus changes. Common case:
    // user opens dashboard, switches to Slack/VS Code, then clicks
    // back. Without this listener they'd wait up to POLL_MS for the
    // next scheduled tick to see fresh data.
    const onFocus = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    if (document.visibilityState === "visible") {
      // Fire immediately on mount so the first paint after hydration
      // catches up to whatever's currently in /api/data — otherwise
      // viewers stare at SSR-cached HTML for up to POLL_MS (2 min)
      // before the first scheduled poll lands.
      refresh();
      startPolling();
    }

    return () => {
      cancelled = true;
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
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
