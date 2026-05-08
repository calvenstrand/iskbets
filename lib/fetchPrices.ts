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

function deriveMarketState(market: Ticker["market"], now: Date): MarketState {
  const status =
    market === "SE" ? stockholmStatus(now) : newYorkStatus(now);
  if (status === "OPEN") return "REGULAR";
  if (status === "PRE-MARKET") return "PRE";
  return "CLOSED";
}

async function fetchOne(
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
    // Finnhub returns c=0 (and dp=0) for symbols it can't resolve
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
      currency: ticker.market === "SE" ? "SEK" : "USD",
      regularMarketPrice: q.c,
      regularMarketChange: q.d,
      regularMarketChangePercent: q.dp,
      // /quote doesn't return volume; not surfaced in the UI anyway.
      regularMarketVolume: 0,
      averageDailyVolume3Month: 0,
      // /quote doesn't return 52w; "X% from glory" will be hidden when
      // fiftyTwoWeekHigh is 0 (the StockCard already guards on this).
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

export async function fetchPrices(): Promise<StockPrice[]> {
  console.log(`[fetchPrices] fetching ${TICKERS.length} tickers`);

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    throw new Error("FINNHUB_API_KEY env var not set");
  }

  const now = new Date();
  const results = await Promise.all(
    TICKERS.map((t) => fetchOne(t, apiKey, now)),
  );
  const stocks = results.filter((s): s is StockPrice => s !== null);
  console.log(`[fetchPrices] ${stocks.length}/${TICKERS.length} succeeded`);
  return stocks;
}
