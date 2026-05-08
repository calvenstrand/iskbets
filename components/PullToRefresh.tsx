"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const THRESHOLD = 80;
const MAX_PULL = 140;
const REFRESH_HOLD_MS = 700;

export function PullToRefresh() {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Refs mirror state so event handlers (mounted once) read fresh values
  // without re-binding listeners on every state change.
  const startYRef = useRef<number | null>(null);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const activeRef = useRef(false);

  useEffect(() => {
    function setPullBoth(v: number) {
      pullRef.current = v;
      setPull(v);
    }

    function setRefreshingBoth(v: boolean) {
      refreshingRef.current = v;
      setRefreshing(v);
    }

    function onStart(e: TouchEvent) {
      if (refreshingRef.current) return;
      if (window.scrollY > 0) return;
      const t = e.touches[0];
      if (!t) return;
      startYRef.current = t.clientY;
      activeRef.current = true;
    }

    function onMove(e: TouchEvent) {
      if (!activeRef.current) return;
      if (refreshingRef.current) return;
      if (startYRef.current === null) return;
      // Cancel if the user scrolled away from the top
      if (window.scrollY > 0) {
        startYRef.current = null;
        activeRef.current = false;
        setPullBoth(0);
        return;
      }
      const t = e.touches[0];
      if (!t) return;
      const delta = t.clientY - startYRef.current;
      if (delta <= 0) {
        setPullBoth(0);
        return;
      }
      // Rubber-band: half-rate past the threshold
      const eased =
        delta < THRESHOLD ? delta : THRESHOLD + (delta - THRESHOLD) / 2;
      setPullBoth(Math.min(eased, MAX_PULL));
    }

    function onEnd() {
      if (!activeRef.current) return;
      activeRef.current = false;
      if (refreshingRef.current) return;

      if (pullRef.current >= THRESHOLD) {
        setRefreshingBoth(true);
        setPullBoth(THRESHOLD);
        router.refresh();
        setTimeout(() => {
          setRefreshingBoth(false);
          setPullBoth(0);
        }, REFRESH_HOLD_MS);
      } else {
        setPullBoth(0);
      }
      startYRef.current = null;
    }

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [router]);

  if (pull <= 0 && !refreshing) return null;

  const past = pull >= THRESHOLD;
  const label = refreshing
    ? "REFRESHING…"
    : past
      ? "RELEASE TO REFRESH"
      : "PULL TO REFRESH";

  return (
    <div className="ptr" style={{ height: `${pull}px` }} aria-live="polite">
      <div className="ptr-content">
        <span className={refreshing ? "ptr-spin" : ""}>↻</span>
        <span>{label}</span>
      </div>
    </div>
  );
}
