"use client";

import { useEffect, useState } from "react";

const LAUNCH_EPOCH_MS = Date.UTC(2025, 5, 1); // 2025-06-01

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Stockholm",
  weekday: "long",
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatDate(d: Date): string {
  return dateFormatter.format(d).toUpperCase();
}

function issueNumber(d: Date): number {
  const days = Math.floor((d.getTime() - LAUNCH_EPOCH_MS) / 86_400_000);
  return Math.max(1, days);
}

export function Header() {
  // Render an empty placeholder during SSR / first paint so the masthead
  // hydrates without timezone-related mismatches. The dashboard's tape and
  // cards render immediately; the dateline filling in a beat later is fine.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="masthead">
      <h1 className="masthead-brand">
        I<span className="dollar">$</span>KBETS
      </h1>
      <div className="masthead-rule" aria-hidden="true" />
      <div className="masthead-dateline">
        {now ? (
          <>
            <span>{formatDate(now)}</span>
            <span className="sep" aria-hidden="true">
              ·
            </span>
            <span>ISSUE №{issueNumber(now)}</span>
            <span className="sep" aria-hidden="true">
              ·
            </span>
            <span className="motto">THE PEOPLE&apos;S TERMINAL</span>
          </>
        ) : (
          <span className="masthead-dateline-placeholder">
            ── · ── · THE PEOPLE&apos;S TERMINAL
          </span>
        )}
      </div>
    </header>
  );
}
