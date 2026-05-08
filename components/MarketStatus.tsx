"use client";

import { useEffect, useState } from "react";
import {
  newYorkStatus,
  pipClass,
  statusClass,
  stockholmStatus,
} from "@/lib/marketHours";

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
