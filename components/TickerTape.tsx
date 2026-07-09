"use client";

import { useState } from "react";
import { displayTicker } from "@/lib/tickers";
import type { DayMood, StockPrice } from "@/lib/types";

const SLOGANS = [
  "GREED IS GOOD",
  "DIAMOND HANDS",
  "TO THE MOON",
  "STONKS ONLY GO UP",
  "BUY HIGH SELL LOW",
  "PRINTER GO BRRR",
  "THIS IS THE WAY",
  "APES TOGETHER STRONG",
  "BTFD",
  "LFG",
  "MONEY NEVER SLEEPS",
  "BAGHOLDER NATION",
  "TENDIES INCOMING",
  "YOLO",
];

// During a market-wide sweep the tape leans into the moment — same
// interleave, just a themed slogan pool. Deterministic (no random), so
// SSR and CSR agree.
const BLOODBATH_SLOGANS = [
  "BLOOD IN THE STREETS",
  "THIS IS FINE",
  "BUY THE DIP",
  "CATCHING KNIVES",
  "HODL",
  "RED WEDDING",
  "BAGHOLDER NATION",
  "GENERATIONAL BUYING OP",
  "DOWN BAD",
  "DIAMOND HANDS",
  "IT'S JUST A DIP",
  "PAIN",
];

const CLEAN_SWEEP_SLOGANS = [
  "GREEN DAY",
  "UP ONLY",
  "TO THE MOON",
  "PRINTER GO BRRR",
  "TENDIES INCOMING",
  "WE ARE SO BACK",
  "EVERYBODY EATS",
  "STONKS ONLY GO UP",
  "GREEN CANDLES ONLY",
  "LFG",
  "DIAMOND HANDS PAY OFF",
  "TOUCH GRASS LATER",
];

function sloganPool(sweep: DayMood | null | undefined): string[] {
  if (sweep === "bloodbath") return BLOODBATH_SLOGANS;
  if (sweep === "clean-sweep") return CLEAN_SWEEP_SLOGANS;
  return SLOGANS;
}

function formatPct(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

type TapeItem =
  | { kind: "slogan"; text: string }
  | { kind: "ticker"; ticker: string; pct: number };

function buildTape(
  stocks: StockPrice[],
  sweep: DayMood | null | undefined,
): TapeItem[] {
  const tickers: TapeItem[] = stocks.map((s) => ({
    kind: "ticker" as const,
    ticker: displayTicker(s.ticker),
    pct: s.regularMarketChangePercent,
  }));
  const slogans: TapeItem[] = sloganPool(sweep).map((text) => ({
    kind: "slogan" as const,
    text,
  }));
  // Interleave: roughly one slogan per ticker
  const out: TapeItem[] = [];
  const max = Math.max(tickers.length, slogans.length);
  for (let i = 0; i < max; i++) {
    const slogan = slogans[i];
    const ticker = tickers[i];
    if (slogan) out.push(slogan);
    if (ticker) out.push(ticker);
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
  sweep,
}: {
  stocks: StockPrice[];
  sweep?: DayMood | null;
}) {
  const [paused, setPaused] = useState(false);
  const items = buildTape(stocks, sweep);

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
