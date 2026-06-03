"use client";

import { useEffect, useRef, useState } from "react";
import type {
  DashboardData,
  PublicStoredData,
  WeeklyChampion,
} from "@/lib/types";

const POLL_MS = 2 * 60 * 1000;
const FLASH_MS = 1800;

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

type PollState = {
  snapshot: PublicStoredData;
  weeklyChampion: WeeklyChampion | undefined;
  weekStartPrices: Record<string, number> | undefined;
  flashedTickers: Set<string>;
  moodFlash: boolean;
};

/** Polls /api/data every 2 minutes while the tab is visible, pausing
 * when hidden to avoid needless background requests. On tab return and
 * window focus, fires an immediate catch-up request. Flashes tickers
 * whose AI comment just changed, and the mood banner when overallMood
 * changes. */
export function usePollDashboard(initial: {
  snapshot: PublicStoredData;
  weeklyChampion: WeeklyChampion | undefined;
  weekStartPrices: Record<string, number> | undefined;
}): PollState {
  const [snapshot, setSnapshot] = useState(initial.snapshot);
  const [weeklyChampion, setWeeklyChampion] = useState(initial.weeklyChampion);
  const [weekStartPrices, setWeekStartPrices] = useState(initial.weekStartPrices);
  const [flashedTickers, setFlashedTickers] = useState<Set<string>>(() => new Set());
  const [moodFlash, setMoodFlash] = useState(false);

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const tickerFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moodFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function refresh() {
      try {
        // Forward the page's search params (e.g. `?mode=weekend`) so the
        // polled data stays consistent with the initial server render.
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

        setSnapshot(fresh.snapshot);
        setWeeklyChampion(fresh.weeklyChampion);
        setWeekStartPrices(fresh.weekStartPrices);

        if (changedTickers.size > 0) {
          if (tickerFlashTimer.current) clearTimeout(tickerFlashTimer.current);
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
      if (interval !== null) return;
      interval = setInterval(refresh, POLL_MS);
    }

    function stopPolling() {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh();
        startPolling();
      } else {
        stopPolling();
      }
    };
    // Window focus catches cross-app focus changes that visibilitychange
    // misses (e.g. switching back from Slack/VS Code).
    const onFocus = () => {
      if (document.visibilityState === "visible") refresh();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    if (document.visibilityState === "visible") {
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

  return { snapshot, weeklyChampion, weekStartPrices, flashedTickers, moodFlash };
}
