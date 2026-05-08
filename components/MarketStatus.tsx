"use client";

import { useEffect, useState } from "react";
import {
  hongKongStatus,
  londonStatus,
  newYorkStatus,
  pipClass,
  type Status,
  statusClass,
  stockholmStatus,
  tokyoStatus,
} from "@/lib/marketHours";

type Market = { code: string; name: string; status: Status };

// Ordered roughly by trading-day flow (east to west) so the bar reads
// like the day rolling across the globe.
function buildMarkets(now: Date): Market[] {
  return [
    { code: "TYO", name: "TOKYO", status: tokyoStatus(now) },
    { code: "HKG", name: "HONG KONG", status: hongKongStatus(now) },
    { code: "STO", name: "STOCKHOLM", status: stockholmStatus(now) },
    { code: "LON", name: "LONDON", status: londonStatus(now) },
    { code: "NYC", name: "NEW YORK", status: newYorkStatus(now) },
  ];
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

  const markets = buildMarkets(now);

  return (
    <div className="market-bar px-4 md:px-8 lg:px-12 py-2.5">
      {markets.map((m) => (
        <span key={m.code} className="market-cell">
          <span className={pipClass(m.status)} />
          <span className="market-code">{m.code}</span>
          <span className="market-full">
            {m.name}{" "}
            <span className={statusClass(m.status)}>{m.status}</span>
          </span>
        </span>
      ))}
    </div>
  );
}
