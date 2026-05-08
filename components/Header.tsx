"use client";

import { useEffect, useState } from "react";
import type { StockPrice } from "@/lib/types";

const QUOTES: string[] = [
  "Greed, for lack of a better word, is good.",
  "Money never sleeps, pal.",
  "Lunch is for wimps.",
  "The most valuable commodity I know of is information.",
  "What's worth doing is worth doing for money.",
];

type HeaderProps = {
  stocks: StockPrice[];
};

type Tone = "up" | "down" | "neutral";

function tone(value: number): Tone {
  if (value > 0.05) return "up";
  if (value < -0.05) return "down";
  return "neutral";
}

function fmtPct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

type Stats = {
  count: number;
  avg: number;
  green: number;
  red: number;
  high: number;
  low: number;
};

function computeStats(stocks: StockPrice[]): Stats {
  const count = stocks.length;
  const pcts = stocks.map((s) => s.regularMarketChangePercent);
  const sum = pcts.reduce((s, x) => s + x, 0);
  const avg = count > 0 ? sum / count : 0;
  const green = stocks.filter((s) => s.regularMarketChangePercent > 0).length;
  const red = stocks.filter((s) => s.regularMarketChangePercent < 0).length;
  const high = pcts.length > 0 ? Math.max(...pcts) : 0;
  const low = pcts.length > 0 ? Math.min(...pcts) : 0;
  return { count, avg, green, red, high, low };
}

function StatCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: Tone;
}) {
  const toneClass = tone ? `stat-value ${tone}` : "stat-value";
  return (
    <div className="stat-cell">
      <div className="stat-label">{label}</div>
      <div className={toneClass}>{value}</div>
    </div>
  );
}

export function Header({ stocks }: HeaderProps) {
  const [quoteIdx, setQuoteIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setQuoteIdx((i) => (i + 1) % QUOTES.length);
    }, 8000);
    return () => clearInterval(id);
  }, []);

  const stats = computeStats(stocks);

  return (
    <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 px-4 md:px-8 lg:px-12 py-6">
      <div>
        <h1 className="brand">
          I<span className="dollar">$</span>KBETS
        </h1>
        <p key={quoteIdx} className="gekko-quote mt-2">
          — {QUOTES[quoteIdx] ?? QUOTES[0]}
        </p>
      </div>

      <div className="header-stats" aria-label="portfolio summary">
        <StatCell label="STONKS" value={stats.count} />
        <StatCell label="AVG" value={fmtPct(stats.avg)} tone={tone(stats.avg)} />
        <StatCell label="▲ GREEN" value={stats.green} tone="up" />
        <StatCell label="▼ RED" value={stats.red} tone="down" />
        <StatCell
          label="DAY HIGH"
          value={fmtPct(stats.high)}
          tone={tone(stats.high)}
        />
        <StatCell
          label="DAY LOW"
          value={fmtPct(stats.low)}
          tone={tone(stats.low)}
        />
      </div>
    </header>
  );
}
