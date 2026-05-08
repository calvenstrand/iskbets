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

  // Yahoo's crumb endpoint 429s on burst traffic. If we Promise.all all
  // tickers from a cold function, all of them race to bootstrap a session
  // and every single one fails with 429. Prime with one request first so
  // the cookie+crumb get cached on the yf singleton, then parallelize the
  // rest.
  const [first, ...rest] = TICKERS;
  const firstResult = first ? await fetchOne(first) : null;
  const restResults =
    rest.length > 0 ? await Promise.all(rest.map(fetchOne)) : [];
  const all = first ? [firstResult, ...restResults] : restResults;

  const stocks = all.filter((s): s is StockPrice => s !== null);
  console.log(`[fetchPrices] ${stocks.length}/${TICKERS.length} succeeded`);
  return stocks;
}
