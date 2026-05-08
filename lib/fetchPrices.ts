import { newYorkStatus, stockholmStatus } from "./marketHours";
import { TICKERS, type Ticker } from "./tickers";
import type { MarketState, StockPrice } from "./types";

const REAL_BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type FinnhubQuote = {
  c: number; // current price
  d: number; // change
  dp: number; // change percent
  h: number;
  l: number;
  o: number;
  pc: number;
  t: number;
};

type AvanzaStock = {
  lastPrice?: number;
  change?: number;
  changePercent?: number;
  highestPrice52Weeks?: number;
  lowestPrice52Weeks?: number;
  totalVolumeTraded?: number;
  currency?: string;
  marketState?: {
    isOpen?: boolean;
  };
};

function deriveMarketState(market: Ticker["market"], now: Date): MarketState {
  const status =
    market === "SE" ? stockholmStatus(now) : newYorkStatus(now);
  if (status === "OPEN") return "REGULAR";
  if (status === "PRE-MARKET") return "PRE";
  return "CLOSED";
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

// ============== Avanza (Stockholm) ==============

async function fetchOneFromAvanza(
  ticker: Ticker,
  now: Date,
): Promise<StockPrice | null> {
  if (!ticker.avanzaId) {
    console.log(`[fetchPrices] ${ticker.symbol}: no avanzaId configured`);
    return null;
  }
  try {
    const url = `https://www.avanza.se/_api/market-guide/stock/${ticker.avanzaId}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": REAL_BROWSER_UA,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      console.log(`[fetchPrices] ${ticker.symbol}: HTTP ${res.status}`);
      return null;
    }

    const q = (await res.json()) as AvanzaStock;
    if (
      typeof q.lastPrice !== "number" ||
      typeof q.change !== "number" ||
      typeof q.changePercent !== "number"
    ) {
      console.log(`[fetchPrices] ${ticker.symbol}: missing price fields`);
      return null;
    }

    // Avanza tells us if the market is open right now; otherwise fall back
    // to time-based derivation.
    let marketState: MarketState;
    if (q.marketState?.isOpen === true) marketState = "REGULAR";
    else if (q.marketState?.isOpen === false) marketState = "CLOSED";
    else marketState = deriveMarketState(ticker.market, now);

    return {
      ticker: ticker.symbol,
      name: ticker.name,
      currency: q.currency ?? "SEK",
      regularMarketPrice: q.lastPrice,
      regularMarketChange: q.change,
      regularMarketChangePercent: q.changePercent,
      regularMarketVolume: q.totalVolumeTraded ?? 0,
      averageDailyVolume3Month: 0,
      fiftyTwoWeekHigh: q.highestPrice52Weeks ?? 0,
      fiftyTwoWeekLow: q.lowestPrice52Weeks ?? 0,
      marketState,
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
  if (!finnhubKey) throw new Error("FINNHUB_API_KEY env var not set");

  const now = new Date();
  const results = await Promise.all(
    TICKERS.map((t) =>
      t.market === "SE"
        ? fetchOneFromAvanza(t, now)
        : fetchOneFromFinnhub(t, finnhubKey, now),
    ),
  );

  const stocks = results.filter((s): s is StockPrice => s !== null);
  console.log(`[fetchPrices] ${stocks.length}/${TICKERS.length} succeeded`);
  return stocks;
}
