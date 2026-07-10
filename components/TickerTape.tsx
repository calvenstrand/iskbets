"use client";

import { useState } from "react";
import { pickSlogans, type Scenario } from "@/lib/slogans";
import { displayTicker } from "@/lib/tickers";
import {
  deriveTickerTier,
  tapeCarriesLine,
  tickerLine,
} from "@/lib/tickerLines";
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
  // `line` is the ticker's own one-liner, carried by only some entries
  // (extremes always, others ~1 in TAPE_CARRY_EVERY). Owner tag omitted
  // here — it's a card-only flourish.
  | { kind: "ticker"; ticker: string; pct: number; line?: string };

function buildTape(
  stocks: StockPrice[],
  scenario: Scenario,
  date: string,
): TapeItem[] {
  const tickers: TapeItem[] = stocks.map((s) => {
    // Tape uses the traded tier (frozen-market lines are a card-only
    // affordance, where marketStale is known). Deterministic per
    // (symbol, date) — SSR-safe.
    const tier = deriveTickerTier(s.regularMarketChangePercent, true);
    const carry = tapeCarriesLine(s.ticker, date, tier);
    return {
      kind: "ticker" as const,
      ticker: displayTicker(s.ticker),
      pct: s.regularMarketChangePercent,
      ...(carry ? { line: tickerLine(s.ticker, date, tier) } : {}),
    };
  });

  const sloganSeed = Number(date.replaceAll("-", "")) || 1;
  if (tickers.length === 0) {
    return pickSlogans(scenario, sloganSeed, SLOGANS_PER_LOOP).map((text) => ({
      kind: "slogan" as const,
      text,
    }));
  }

  // Seeded, scenario-biased slogans (SSR-safe — no random), spread evenly
  // across the ticker run so they don't cluster at the front of the loop.
  const count = Math.min(SLOGANS_PER_LOOP, tickers.length);
  const slogans = pickSlogans(scenario, sloganSeed, count);
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
      {item.line && <span className="tape-line">— {item.line}</span>}
    </span>
  );
}

export function TickerTape({
  stocks,
  scenario,
  date,
}: {
  stocks: StockPrice[];
  /** Active tape scenario (resolveScenario, computed in Dashboard). */
  scenario: Scenario;
  /** Stockholm calendar day (YYYY-MM-DD). Seeds the slogan mix and the
   * per-ticker lines — SSR-safe, stable per day. */
  date: string;
}) {
  const [paused, setPaused] = useState(false);
  const items = buildTape(stocks, scenario, date);

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
      {/* Duplicate the items so the marquee loop is seamless. The copy is
          purely visual — aria-hidden so screen readers hear the tape once,
          not twice; display:contents keeps the flex track layout intact. */}
      <div className="tape-track">
        {items.map((it, i) => renderItem(it, `a-${i}`))}
        <span aria-hidden="true" style={{ display: "contents" }}>
          {items.map((it, i) => renderItem(it, `b-${i}`))}
        </span>
      </div>
    </div>
  );
}
