import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPrices } from "./fetchPrices";
import { TICKERS } from "./tickers";
import type { StockPrice } from "./types";

// Wed 2026-07-08. Summer time: 15:35 STO (CEST) = 13:35 UTC = 09:35 ET —
// Stockholm open AND New York in its regular session, so every ticker is
// inside its live-data window.
const BOTH_LIVE = new Date("2026-07-08T13:35:00Z");
// 05:00 STO / 23:00 ET (prev day) — every market closed.
const ALL_CLOSED = new Date("2026-07-08T03:00:00Z");

const FINNHUB_QUOTE = {
  c: 50.5,
  d: 1.5,
  dp: 3.06,
  h: 51,
  l: 49,
  o: 49.5,
  pc: 49,
  t: 1751970900, // epoch SECONDS (Finnhub convention)
};

const AVANZA_STOCK = {
  name: "Investor B",
  listing: { currency: "SEK" },
  marketPlace: { marketOpen: true },
  quote: {
    last: 285.4,
    change: 3.94,
    changePercent: 1.4,
    totalVolumeTraded: 1_240_000,
  },
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

function mkCached(ticker: string): StockPrice {
  return {
    ticker,
    name: `${ticker} cached`,
    currency: "USD",
    regularMarketPrice: 10,
    regularMarketChange: 0.1,
    regularMarketChangePercent: 1,
    regularMarketVolume: 0,
    averageDailyVolume3Month: 0,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "CLOSED",
    lastTradeAt: 1751900000000,
  };
}

const fullCache = (): StockPrice[] => TICKERS.map((t) => mkCached(t.symbol));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("FINNHUB_API_KEY", "test-key");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  // Default: every provider answers happily.
  fetchMock.mockImplementation(async (input: unknown) => {
    const url = String(input);
    return url.includes("finnhub.io")
      ? jsonResponse(FINNHUB_QUOTE)
      : jsonResponse(AVANZA_STOCK);
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchPrices", () => {
  it("throws without FINNHUB_API_KEY", async () => {
    vi.stubEnv("FINNHUB_API_KEY", "");
    await expect(fetchPrices()).rejects.toThrow(/FINNHUB_API_KEY/);
  });

  it("maps Finnhub fields (incl. seconds→ms lastTradeAt) during live hours", async () => {
    vi.setSystemTime(BOTH_LIVE);
    const stocks = await fetchPrices();
    const us = stocks.find(
      (s) => TICKERS.find((t) => t.symbol === s.ticker)?.market === "US",
    );
    expect(us).toBeDefined();
    expect(us!.regularMarketPrice).toBe(FINNHUB_QUOTE.c);
    expect(us!.regularMarketChange).toBe(FINNHUB_QUOTE.d);
    expect(us!.regularMarketChangePercent).toBe(FINNHUB_QUOTE.dp);
    expect(us!.currency).toBe("USD");
    expect(us!.lastTradeAt).toBe(FINNHUB_QUOTE.t * 1000);
    expect(us!.marketState).toBe("REGULAR");
  });

  it("maps Avanza fields and stamps lastTradeAt=now while the orderbook is open", async () => {
    vi.setSystemTime(BOTH_LIVE);
    const stocks = await fetchPrices();
    const se = stocks.find(
      (s) => TICKERS.find((t) => t.symbol === s.ticker)?.market === "SE",
    );
    expect(se).toBeDefined();
    expect(se!.regularMarketPrice).toBe(AVANZA_STOCK.quote.last);
    expect(se!.currency).toBe("SEK");
    expect(se!.regularMarketVolume).toBe(AVANZA_STOCK.quote.totalVolumeTraded);
    expect(se!.marketState).toBe("REGULAR"); // marketOpen: true wins
    expect(se!.lastTradeAt).toBe(BOTH_LIVE.getTime());
  });

  it("reuses cached prices with ZERO network calls when every market is closed", async () => {
    vi.setSystemTime(ALL_CLOSED);
    const cached = fullCache();
    const stocks = await fetchPrices(cached);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stocks).toHaveLength(TICKERS.length);
    expect(stocks.every((s) => s.name.endsWith("cached"))).toBe(true);
  });

  it("bootstraps: fetches a ticker with no cache even outside its live window", async () => {
    vi.setSystemTime(ALL_CLOSED);
    const first = TICKERS[0]!;
    const cached = fullCache().filter((p) => p.ticker !== first.symbol);
    const stocks = await fetchPrices(cached);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(stocks).toHaveLength(TICKERS.length);
    const bootstrapped = stocks.find((s) => s.ticker === first.symbol);
    expect(bootstrapped?.name.endsWith("cached")).toBe(false);
  });

  it("falls back to the cached price when a live fetch fails", async () => {
    vi.setSystemTime(BOTH_LIVE);
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("finnhub.io")) return jsonResponse({}, false, 500);
      return jsonResponse(AVANZA_STOCK);
    });
    const stocks = await fetchPrices(fullCache());
    expect(stocks).toHaveLength(TICKERS.length);
    const usSymbols = new Set(
      TICKERS.filter((t) => t.market === "US").map((t) => t.symbol),
    );
    for (const s of stocks) {
      if (usSymbols.has(s.ticker)) expect(s.name.endsWith("cached")).toBe(true);
      else expect(s.name.endsWith("cached")).toBe(false);
    }
  });

  it("one broken ticker never crashes the batch — it's dropped, the rest survive", async () => {
    vi.setSystemTime(BOTH_LIVE);
    const victim = TICKERS.find((t) => t.market === "US")!;
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes(`symbol=${encodeURIComponent(victim.symbol)}`)) {
        throw new Error("connection reset");
      }
      return url.includes("finnhub.io")
        ? jsonResponse(FINNHUB_QUOTE)
        : jsonResponse(AVANZA_STOCK);
    });
    const stocks = await fetchPrices(); // no cache → nothing to fall back to
    expect(stocks).toHaveLength(TICKERS.length - 1);
    expect(stocks.some((s) => s.ticker === victim.symbol)).toBe(false);
  });

  it("treats a Finnhub zero-price quote as no data (falls back to cache)", async () => {
    vi.setSystemTime(BOTH_LIVE);
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("finnhub.io")) {
        return jsonResponse({ ...FINNHUB_QUOTE, c: 0 });
      }
      return jsonResponse(AVANZA_STOCK);
    });
    const stocks = await fetchPrices(fullCache());
    const usSymbols = new Set(
      TICKERS.filter((t) => t.market === "US").map((t) => t.symbol),
    );
    for (const s of stocks) {
      if (usSymbols.has(s.ticker)) {
        expect(s.name.endsWith("cached")).toBe(true);
      }
    }
  });

  it("Avanza marketOpen:false carries the cached lastTradeAt forward (holiday veto signal)", async () => {
    vi.setSystemTime(BOTH_LIVE);
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("finnhub.io")) return jsonResponse(FINNHUB_QUOTE);
      return jsonResponse({
        ...AVANZA_STOCK,
        marketPlace: { marketOpen: false },
      });
    });
    const cached = fullCache();
    const stocks = await fetchPrices(cached);
    const se = stocks.find(
      (s) => TICKERS.find((t) => t.symbol === s.ticker)?.market === "SE",
    );
    expect(se).toBeDefined();
    expect(se!.marketState).toBe("CLOSED");
    // Not stamped to `now` — the frozen cached stamp survives, so
    // hasTradedToday's holiday veto still fires downstream.
    expect(se!.lastTradeAt).toBe(mkCached("x").lastTradeAt);
  });
});
