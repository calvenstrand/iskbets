"use client";

import { useEffect, useRef, useState } from "react";
import { TICKERS } from "@/lib/tickers";
import type {
  Brief,
  DashboardData,
  StockAnalysis,
  StockPrice,
  StoredData,
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

type DashboardProps = {
  data: StoredData;
  morningBrief?: Brief;
  eveningBrief?: Brief;
  weekendBrief?: Brief;
  weekStartPrices?: Record<string, number>;
};

const POLL_MS = 5 * 60 * 1000; // 5 min — comfortably below the 15-min cron cadence
const FLASH_MS = 1800;

// Pre-built lookup so the grid sort doesn't scan TICKERS for every card.
const OWNED_TICKERS = new Set(
  TICKERS.filter((t) => (t.owners?.length ?? 0) > 0).map((t) => t.symbol),
);

// Owners' picks bubble to the top, then everyone else.
// Within each group, biggest gainers first.
function sortGridStocks(stocks: StockPrice[]): StockPrice[] {
  return [...stocks].sort((a, b) => {
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
  weekStartPrices: initialWeekStart,
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
  const [weekStartPrices, setWeekStartPrices] = useState<
    Record<string, number> | undefined
  >(initialWeekStart);

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
        const res = await fetch("/api/data", { cache: "no-store" });
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

  const winnerTicker = snapshot.analysis.biggestWinner;
  const loserTicker = snapshot.analysis.biggestLoser;

  const winner = snapshot.stocks.find((s) => s.ticker === winnerTicker);
  const loser = snapshot.stocks.find((s) => s.ticker === loserTicker);

  const featuredTickers = new Set<string>();
  if (winner) featuredTickers.add(winner.ticker);
  if (loser) featuredTickers.add(loser.ticker);

  const gridStocks: StockPrice[] = sortGridStocks(
    snapshot.stocks.filter((s) => !featuredTickers.has(s.ticker)),
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
      <BriefCard
        morningBrief={morningBrief}
        eveningBrief={eveningBrief}
        weekendBrief={weekendBrief}
        flash={briefFlash}
      />
      <MoodBanner
        mood={snapshot.analysis.overallMood}
        avgChangePct={avgChangePct}
        flash={moodFlash}
      />

      <Leaderboard stocks={snapshot.stocks} weekStartPrices={weekStartPrices} />

      <section className="px-4 md:px-8 lg:px-12 mt-8 mb-12">
        {(winner || loser) && (
          <div className="stock-grid-featured gap-3 mb-6">
            {winner && (
              <StockCard
                stock={winner}
                analysis={analysisByTicker.get(winner.ticker)}
                featured="winner"
                index={0}
                flashing={flashedTickers.has(winner.ticker)}
              />
            )}
            {loser && (
              <StockCard
                stock={loser}
                analysis={analysisByTicker.get(loser.ticker)}
                featured="loser"
                index={1}
                flashing={flashedTickers.has(loser.ticker)}
              />
            )}
          </div>
        )}

        <div className="stock-grid gap-3">
          {gridStocks.map((stock, i) => (
            <StockCard
              key={stock.ticker}
              stock={stock}
              analysis={analysisByTicker.get(stock.ticker)}
              index={i + 2}
              flashing={flashedTickers.has(stock.ticker)}
            />
          ))}
        </div>
      </section>

      <UpdatedFooter updatedAt={snapshot.updatedAt} />
    </main>
  );
}
