import YahooFinance from "yahoo-finance2";
import { TICKERS, type Ticker } from "./tickers";
import type { MarketState, StockPrice } from "./types";

const REAL_BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const yf = new YahooFinance();

// Yahoo aggressively throttles requests with a default node-fetch UA. Wrap
// the instance's fetch to inject a real-browser UA on every call.
const originalFetch = yf._env.fetch;
yf._env.fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", REAL_BROWSER_UA);
  }
  return originalFetch(input, { ...init, headers });
};

function normalizeMarketState(raw: string | undefined): MarketState {
  if (raw === "REGULAR" || raw === "PRE" || raw === "POST" || raw === "CLOSED") {
    return raw;
  }
  if (raw === "PREPRE") return "PRE";
  if (raw === "POSTPOST" || raw === "POSTAFT") return "POST";
  return "CLOSED";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOne(
  ticker: Ticker,
  attempt = 0,
): Promise<StockPrice | null> {
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
    // Retry once on 429 — Yahoo crumb endpoint sometimes rate-limits cold
    // serverless pools but recovers within a second.
    if (msg.includes("429") && attempt < 2) {
      const delay = 600 * (attempt + 1);
      console.log(
        `[fetchPrices] ${ticker.symbol}: 429, retrying in ${delay}ms (attempt ${attempt + 1}/2)`,
      );
      await sleep(delay);
      return fetchOne(ticker, attempt + 1);
    }
    console.log(`[fetchPrices] ${ticker.symbol}: failed — ${msg}`);
    return null;
  }
}

export async function fetchPrices(): Promise<StockPrice[]> {
  console.log(`[fetchPrices] fetching ${TICKERS.length} tickers`);

  // Yahoo's crumb endpoint 429s on burst traffic. Prime with one request
  // first so the cookie+crumb get cached on the yf singleton, then
  // parallelize the rest.
  const [first, ...rest] = TICKERS;
  const firstResult = first ? await fetchOne(first) : null;
  const restResults =
    rest.length > 0 ? await Promise.all(rest.map((t) => fetchOne(t))) : [];
  const all = first ? [firstResult, ...restResults] : restResults;

  const stocks = all.filter((s): s is StockPrice => s !== null);
  console.log(`[fetchPrices] ${stocks.length}/${TICKERS.length} succeeded`);
  return stocks;
}
