import YahooFinance from "yahoo-finance2";
import { TICKERS, type Ticker } from "./tickers";
import type { MarketState, StockPrice } from "./types";

const yf = new YahooFinance();

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
    const q = await yf.quote(ticker.symbol);
    if (
      q.regularMarketPrice == null ||
      q.regularMarketChange == null ||
      q.regularMarketChangePercent == null
    ) {
      console.log(`[fetchPrices] ${ticker.symbol}: missing price fields, skipping`);
      return null;
    }

    return {
      ticker: ticker.symbol,
      name: ticker.name,
      currency: q.currency ?? "",
      regularMarketPrice: q.regularMarketPrice,
      regularMarketChange: q.regularMarketChange,
      regularMarketChangePercent: q.regularMarketChangePercent,
      regularMarketVolume: q.regularMarketVolume ?? 0,
      averageDailyVolume3Month: q.averageDailyVolume3Month ?? 0,
      fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? 0,
      fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? 0,
      marketState: normalizeMarketState(q.marketState),
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
