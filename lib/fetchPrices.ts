import { newYorkStatus, stockholmStatus } from "./marketHours";
import { TICKERS, type Ticker } from "./tickers";
import type { MarketState, StockPrice } from "./types";

type FinnhubQuote = {
  c: number; // current price
  d: number; // change
  dp: number; // change percent
  h: number; // day high
  l: number; // day low
  o: number; // open
  pc: number; // previous close
  t: number; // timestamp (epoch s)
};

type TwelveDataResponse = {
  // Quote fields
  symbol?: string;
  name?: string;
  currency?: string;
  open?: string;
  close?: string;
  change?: string;
  percent_change?: string;
  volume?: string;
  average_volume?: string;
  is_market_open?: boolean;
  fifty_two_week?: {
    high?: string;
    low?: string;
  };
  // Error fields (only set on error responses)
  status?: string;
  code?: number;
  message?: string;
};

function deriveMarketState(market: Ticker["market"], now: Date): MarketState {
  const status =
    market === "SE" ? stockholmStatus(now) : newYorkStatus(now);
  if (status === "OPEN") return "REGULAR";
  if (status === "PRE-MARKET") return "PRE";
  return "CLOSED";
}

function safeParseFloat(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v !== "string") return NaN;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
}

function safeParseInt(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? Math.floor(v) : 0;
  if (typeof v !== "string") return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

// ============== Finnhub (US) ==============

async function fetchOneFromFinnhub(
  ticker: Ticker,
  apiKey: string,
  now: Date,
): Promise<StockPrice | null> {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(
      ticker.symbol,
    )}&token=${apiKey}`;

    const res = await fetch(url, { cache: "no-store" });

    if (!res.ok) {
      console.log(`[fetchPrices] ${ticker.symbol}: HTTP ${res.status}`);
      return null;
    }

    const q = (await res.json()) as Partial<FinnhubQuote>;
    if (
      typeof q.c !== "number" ||
      q.c === 0 ||
      typeof q.d !== "number" ||
      typeof q.dp !== "number"
    ) {
      console.log(`[fetchPrices] ${ticker.symbol}: no quote data`);
      return null;
    }

    return {
      ticker: ticker.symbol,
      name: ticker.name,
      currency: "USD",
      regularMarketPrice: q.c,
      regularMarketChange: q.d,
      regularMarketChangePercent: q.dp,
      regularMarketVolume: 0,
      averageDailyVolume3Month: 0,
      fiftyTwoWeekHigh: 0,
      fiftyTwoWeekLow: 0,
      marketState: deriveMarketState(ticker.market, now),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[fetchPrices] ${ticker.symbol}: failed — ${msg}`);
    return null;
  }
}

// ============== Twelve Data (Stockholm) ==============

async function fetchOneFromTwelveData(
  ticker: Ticker,
  apiKey: string,
  now: Date,
): Promise<StockPrice | null> {
  try {
    // Twelve Data wants the bare symbol + an explicit exchange param,
    // and uses dots instead of hyphens for share classes (so Yahoo-style
    // INVE-B.ST → INVE.B). Strip the ".ST" suffix and swap "-" for ".".
    const symbol = ticker.symbol.replace(/\.ST$/, "").replace(/-/g, ".");
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(
      symbol,
    )}&exchange=Stockholm&apikey=${apiKey}`;

    const res = await fetch(url, { cache: "no-store" });

    if (!res.ok) {
      console.log(`[fetchPrices] ${ticker.symbol}: HTTP ${res.status}`);
      return null;
    }

    const q = (await res.json()) as TwelveDataResponse;

    if (q.status === "error" || typeof q.code === "number") {
      console.log(
        `[fetchPrices] ${ticker.symbol}: TD ${q.code ?? "?"} — ${q.message ?? "unknown"}`,
      );
      return null;
    }

    const close = safeParseFloat(q.close);
    const change = safeParseFloat(q.change);
    const percentChange = safeParseFloat(q.percent_change);
    if (
      !Number.isFinite(close) ||
      !Number.isFinite(change) ||
      !Number.isFinite(percentChange)
    ) {
      console.log(`[fetchPrices] ${ticker.symbol}: missing price fields`);
      return null;
    }

    return {
      ticker: ticker.symbol,
      name: ticker.name,
      currency: q.currency ?? "SEK",
      regularMarketPrice: close,
      regularMarketChange: change,
      regularMarketChangePercent: percentChange,
      regularMarketVolume: safeParseInt(q.volume),
      averageDailyVolume3Month: safeParseInt(q.average_volume),
      fiftyTwoWeekHigh: safeParseFloat(q.fifty_two_week?.high) || 0,
      fiftyTwoWeekLow: safeParseFloat(q.fifty_two_week?.low) || 0,
      marketState: deriveMarketState(ticker.market, now),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[fetchPrices] ${ticker.symbol}: failed — ${msg}`);
    return null;
  }
}

// ============== Orchestrator ==============

export async function fetchPrices(): Promise<StockPrice[]> {
  console.log(`[fetchPrices] fetching ${TICKERS.length} tickers`);

  const finnhubKey = process.env.FINNHUB_API_KEY;
  const twelvedataKey = process.env.TWELVEDATA_API_KEY;
  if (!finnhubKey) throw new Error("FINNHUB_API_KEY env var not set");
  if (!twelvedataKey) throw new Error("TWELVEDATA_API_KEY env var not set");

  const now = new Date();
  const results = await Promise.all(
    TICKERS.map((t) =>
      t.market === "SE"
        ? fetchOneFromTwelveData(t, twelvedataKey, now)
        : fetchOneFromFinnhub(t, finnhubKey, now),
    ),
  );

  const stocks = results.filter((s): s is StockPrice => s !== null);
  console.log(`[fetchPrices] ${stocks.length}/${TICKERS.length} succeeded`);
  return stocks;
}
