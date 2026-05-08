"use client";

import { useEffect, useState } from "react";

type Status = "OPEN" | "CLOSED" | "PRE-MARKET";

function partsFor(now: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const isWeekend = weekday === "Sat" || weekday === "Sun";
  return { isWeekend, minutes: hour * 60 + minute };
}

function stockholmStatus(now: Date): Status {
  const { isWeekend, minutes } = partsFor(now, "Europe/Stockholm");
  if (isWeekend) return "CLOSED";
  // 09:00 - 17:30 local time
  if (minutes >= 9 * 60 && minutes < 17 * 60 + 30) return "OPEN";
  return "CLOSED";
}

function newYorkStatus(now: Date): Status {
  const { isWeekend, minutes } = partsFor(now, "America/New_York");
  if (isWeekend) return "CLOSED";
  // Regular: 09:30 - 16:00 ET
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return "OPEN";
  // Pre-market: 04:00 - 09:30 ET
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "PRE-MARKET";
  return "CLOSED";
}

function pipClass(s: Status): string {
  if (s === "OPEN") return "market-pip open";
  if (s === "PRE-MARKET") return "market-pip pre";
  return "market-pip closed";
}

function statusClass(s: Status): string {
  if (s === "OPEN") return "market-status-open";
  if (s === "PRE-MARKET") return "market-status-pre";
  return "market-status-closed";
}

export function MarketStatus() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // SSR placeholder — avoids hydration mismatch with timezone-dependent state
  if (!now) {
    return (
      <div className="market-bar px-4 md:px-8 lg:px-12 py-2.5">
        <span style={{ color: "var(--text-faint)" }}>SYNCING MARKETS…</span>
      </div>
    );
  }

  const se = stockholmStatus(now);
  const ny = newYorkStatus(now);

  return (
    <div className="market-bar px-4 md:px-8 lg:px-12 py-2.5 flex flex-col sm:flex-row sm:items-center gap-y-1 sm:gap-x-4">
      <span>
        <span className={pipClass(se)} />
        STOCKHOLM <span className={statusClass(se)}>{se}</span>
      </span>
      <span
        className="hidden sm:inline"
        style={{ color: "var(--text-faint)" }}
      >
        │
      </span>
      <span>
        <span className={pipClass(ny)} />
        NEW YORK <span className={statusClass(ny)}>{ny}</span>
      </span>
    </div>
  );
}
