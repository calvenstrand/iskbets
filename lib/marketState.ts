import { isMarketInRegularSession, tradedTodaySignal } from "./marketHours";
import { TICKERS } from "./tickers";
import type { StockPrice } from "./types";

/**
 * Per-market session state, classified from the clock + provider signals.
 * Drives the MARKETS RIGHT NOW header in the AI user messages so the
 * model anchors its narrative to today's story instead of yesterday's
 * frozen numbers.
 *
 *   live          — currently in regular session, prices update.
 *   fresh-frozen  — not in session right now BUT we have evidence that
 *                   at least one ticker traded today (Stockholm calendar
 *                   day). Still today's story; counts equally with
 *                   `live` for mood framing.
 *   stale-frozen  — no ticker for this market has a today-trade. Numbers
 *                   are from a previous session — background only.
 */
export type MarketSessionState = "live" | "fresh-frozen" | "stale-frozen";

export function computeMarketState(
  market: "SE" | "US",
  pricesForMarket: StockPrice[],
  now: Date,
): MarketSessionState {
  if (isMarketInRegularSession(market, now)) return "live";
  // `tradedTodaySignal` defaults to true when `lastTradeAt` is missing
  // (so the dashboard's holiday veto degrades safely to clock behavior).
  // Here we want the OPPOSITE — actual evidence — so require an explicit
  // finite timestamp before counting a ticker as "traded today."
  const anyTradedToday = pricesForMarket.some((p) => {
    if (
      typeof p.lastTradeAt !== "number" ||
      !Number.isFinite(p.lastTradeAt) ||
      p.lastTradeAt <= 0
    ) {
      return false;
    }
    return tradedTodaySignal(p.lastTradeAt, now);
  });
  return anyTradedToday ? "fresh-frozen" : "stale-frozen";
}

/** Per-market state classification for the whole portfolio. */
export function classifyMarkets(
  prices: StockPrice[],
  now: Date,
): { se: MarketSessionState; us: MarketSessionState } {
  const tickerMeta = new Map(TICKERS.map((t) => [t.symbol, t]));
  const sePrices = prices.filter(
    (p) => tickerMeta.get(p.ticker)?.market === "SE",
  );
  const usPrices = prices.filter(
    (p) => tickerMeta.get(p.ticker)?.market === "US",
  );
  return {
    se: computeMarketState("SE", sePrices, now),
    us: computeMarketState("US", usPrices, now),
  };
}

/**
 * Build the MARKETS RIGHT NOW header prepended to the AI user message.
 * Gives the model structural per-market state + the mood-anchor rule
 * without making it infer state from 30+ per-ticker `marketLive`
 * booleans in the price JSON.
 */
export function buildMarketsHeader(prices: StockPrice[], now: Date): string {
  const { se, us } = classifyMarkets(prices, now);
  const stoTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);

  const describe = (label: string, state: MarketSessionState): string => {
    switch (state) {
      case "live":
        return `${label} = LIVE (in regular session right now — today's intraday)`;
      case "fresh-frozen":
        return `${label} = FRESH-FROZEN (closed for the day, but numbers below ARE today's session — still today's story)`;
      case "stale-frozen":
        return `${label} = STALE-FROZEN (has not traded today — the \`regularMarketChangePercent\` for these tickers below is the PREVIOUS session's close, NOT today)`;
    }
  };

  return `MARKETS RIGHT NOW (Stockholm ${stoTime} STO):
- ${describe("SE (Stockholmsbörsen)", se)}
- ${describe("US (NYSE/NASDAQ)", us)}

MOOD ANCHOR RULE: the OVERALL MOOD must come from today's story.
- A LIVE or FRESH-FROZEN side is "today" — both qualify as the mood headline, picked by which side has the bigger moves or more owner drama.
- A STALE-FROZEN side is "yesterday" — background only. Do NOT lead the mood line with a STALE-FROZEN ticker's number, even if the % looks dramatic. That move already happened yesterday and the dashboard's "today" mood shouldn't relitigate it.

`;
}
