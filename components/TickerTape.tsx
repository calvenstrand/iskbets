"use client";

import { useState } from "react";
import { pickSlogans, type Scenario } from "@/lib/slogans";
import { displayTicker } from "@/lib/tickers";
import type { StockPrice } from "@/lib/types";

// How many slogans to sprinkle across one loop of the tape — kept close
// to the previous density (a slogan every ~2-3 tickers) rather than one
// per ticker, so prices still lead and the copy accents.
const SLOGANS_PER_LOOP = 14;

function formatPct(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

type TapeItem =
  | { kind: "slogan"; text: string }
  | { kind: "ticker"; ticker: string; pct: number };

function buildTape(
  stocks: StockPrice[],
  scenario: Scenario,
  seed: number,
): TapeItem[] {
  const tickers: TapeItem[] = stocks.map((s) => ({
    kind: "ticker" as const,
    ticker: displayTicker(s.ticker),
    pct: s.regularMarketChangePercent,
  }));
  if (tickers.length === 0) {
    return pickSlogans(scenario, seed, SLOGANS_PER_LOOP).map((text) => ({
      kind: "slogan" as const,
      text,
    }));
  }

  // Seeded, scenario-biased slogans (SSR-safe — no random), spread evenly
  // across the ticker run so they don't cluster at the front of the loop.
  const count = Math.min(SLOGANS_PER_LOOP, tickers.length);
  const slogans = pickSlogans(scenario, seed, count);
  const out: TapeItem[] = [];
  let si = 0;
  for (let i = 0; i < tickers.length; i++) {
    if (si < count && i >= Math.floor((si * tickers.length) / count)) {
      out.push({ kind: "slogan", text: slogans[si]! });
      si++;
    }
    out.push(tickers[i]!);
  }
  return out;
}

function renderItem(item: TapeItem, key: string) {
  if (item.kind === "slogan") {
    return (
      <span key={key} className="tape-item tape-slogan">
        <span className="tape-diamond">◆</span> {item.text}
      </span>
    );
  }
  const cls = item.pct >= 0 ? "tape-up" : "tape-down";
  return (
    <span key={key} className="tape-item tape-ticker">
      <span className="tape-diamond">◆</span>
      <span>{item.ticker}</span>
      <span className={cls}>{formatPct(item.pct)}</span>
    </span>
  );
}

export function TickerTape({
  stocks,
  scenario,
  seed,
}: {
  stocks: StockPrice[];
  /** Active tape scenario (resolveScenario, computed in Dashboard). */
  scenario: Scenario;
  /** Stable per-day seed so the slogan mix is SSR-safe and refreshes daily. */
  seed: number;
}) {
  const [paused, setPaused] = useState(false);
  const items = buildTape(stocks, scenario, seed);

  return (
    <div
      className={`tape ${paused ? "paused" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`Ticker tape (tap to ${paused ? "resume" : "pause"})`}
      aria-pressed={paused}
      onClick={() => setPaused((p) => !p)}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          setPaused((p) => !p);
        }
      }}
    >
      {/* Duplicate the items so the marquee loop is seamless */}
      <div className="tape-track">
        {items.map((it, i) => renderItem(it, `a-${i}`))}
        {items.map((it, i) => renderItem(it, `b-${i}`))}
      </div>
    </div>
  );
}
