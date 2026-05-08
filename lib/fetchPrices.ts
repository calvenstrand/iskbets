import { TICKERS, type Ticker } from "./tickers";
import type { MarketState, StockPrice } from "./types";

const REAL_BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type ChartMeta = {
  symbol: string;
  currency?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketVolume?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  marketState?: string;
};

type ChartResponse = {
  chart?: {
    result?: Array<{ meta: ChartMeta }> | null;
    error?: { code: string; description: string } | null;
  };
};

function normalizeMarketState(raw: string | undefined): MarketState {
  if (raw === "REGULAR" || raw === "PRE" || raw === "POST" || raw === "CLOSED") {
    return raw;
  }
  if (raw === "PREPRE") return "PRE";
  if (raw === "POSTPOST" || raw === "POSTAFT") return "POST";
  return "CLOSED";
}

async function fetchOne(ticker: Ticker): Promise<StockPrice | null> {
  try {
    // /v8/finance/chart returns enough meta for our needs and — unlike
    // /v7/finance/quote — does not require Yahoo's crumb token, so it
    // works from Vercel's serverless IP pools.
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      ticker.symbol,
    )}?range=1d&interval=1m`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": REAL_BROWSER_UA,
        Accept: "application/json",
      },
      // Don't let Next.js cache this — the trigger is the cache layer.
      cache: "no-store",
    });

    if (!res.ok) {
      console.log(`[fetchPrices] ${ticker.symbol}: HTTP ${res.status}`);
      return null;
    }

    const data = (await res.json()) as ChartResponse;
    const apiError = data.chart?.error;
    if (apiError) {
      console.log(
        `[fetchPrices] ${ticker.symbol}: ${apiError.code} — ${apiError.description}`,
      );
      return null;
    }

    const result = data.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) {
      console.log(`[fetchPrices] ${ticker.symbol}: no meta in chart response`);
      return null;
    }

    const price = meta.regularMarketPrice;
    const prev = meta.chartPreviousClose ?? meta.previousClose;
    if (price == null || prev == null) {
      console.log(`[fetchPrices] ${ticker.symbol}: missing price fields, skipping`);
      return null;
    }

    const change = price - prev;
    const changePercent = prev !== 0 ? (change / prev) * 100 : 0;

    return {
      ticker: ticker.symbol,
      name: ticker.name,
      currency: meta.currency ?? "",
      regularMarketPrice: price,
      regularMarketChange: change,
      regularMarketChangePercent: changePercent,
      regularMarketVolume: meta.regularMarketVolume ?? 0,
      // /v8 chart meta doesn't expose averageDailyVolume3Month — we don't
      // surface it in the UI anyway, so default to 0.
      averageDailyVolume3Month: 0,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? 0,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? 0,
      marketState: normalizeMarketState(meta.marketState),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[fetchPrices] ${ticker.symbol}: failed — ${msg}`);
    return null;
  }
}

export async function fetchPrices(): Promise<StockPrice[]> {
  console.log(`[fetchPrices] fetching ${TICKERS.length} tickers`);
  const results = await Promise.all(TICKERS.map(fetchOne));
  const stocks = results.filter((s): s is StockPrice => s !== null);
  console.log(`[fetchPrices] ${stocks.length}/${TICKERS.length} succeeded`);
  return stocks;
}
