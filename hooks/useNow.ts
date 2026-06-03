"use client";

import { useEffect, useState } from "react";
import { inRecapWindow } from "@/lib/dateUtil";

type NowState = { now: Date; inRecap: boolean };

/** Ticks every minute, keeping `now` and `inRecap` in sync with real
 * wall-clock time. Seeded from `initialNowMs` so the first client
 * render matches the server (no hydration mismatch in time-dependent
 * logic). A re-check fires immediately after hydration in case the
 * server timestamp is a few seconds stale. */
export function useNow(initialNowMs: number, initialInRecap: boolean): NowState {
  const [state, setState] = useState<NowState>({
    now: new Date(initialNowMs),
    inRecap: initialInRecap,
  });

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setState({ now, inRecap: inRecapWindow(now) });
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  return state;
}
