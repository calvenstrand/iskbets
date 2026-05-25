export type MarketState = "REGULAR" | "PRE" | "POST" | "CLOSED";

export type StockPrice = {
  ticker: string;
  name: string;
  currency: string;
  regularMarketPrice: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  regularMarketVolume: number;
  averageDailyVolume3Month: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  marketState: MarketState;
  /** Epoch ms of the last trade the provider reported (Finnhub `t`, or
   * `now` for Avanza when it says the market is open — carried forward
   * across cron fires otherwise). Lets the dashboard tell "this stock
   * actually traded today" from "the clock says the session window is
   * open" — the difference being exchange holidays, when the window is
   * open but nothing trades. Optional: absent on legacy snapshots and
   * when neither provider exposed a usable timestamp, in which case the
   * gating falls back to the pure clock check. */
  lastTradeAt?: number;
};

export const RATINGS = [
  "🚀 TO THE MOON",
  "💎 DIAMOND HANDS",
  "📈 BULLISH AF",
  "⚠️ TURBULENCE",
  "📉 GET REKT",
  "💀 LIQUIDATED",
] as const;

export type Rating = (typeof RATINGS)[number];

export const SENTIMENTS = ["moon", "up", "neutral", "down", "rekt"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export type StockAnalysis = {
  ticker: string;
  /** Optional. Only present when the move is big enough to warrant a
   * badge. Quiet stocks in the -0.5% to +0.5% band get no rating so
   * the badge isn't reduced to wallpaper. See lib/derive.ts. */
  rating?: Rating;
  sentiment: Sentiment;
  /** Optional. Only present for stocks the analyzer thought were worth a one-liner. */
  comment?: string;
};

export type AnalysisPayload = {
  stocks: StockAnalysis[];
  overallMood: string;
  biggestWinner: string;
  biggestLoser: string;
};

/** Champion-of-the-week recap, generated Friday evening (22:45 STO).
 * Targets the friend with the highest WTD% — the actual week's leader
 * — not whoever is currently #1 on the live "today%" sort. Pinned
 * through the weekend; overwritten by the next Friday's call. The only
 * AI-generated narrative the dashboard surfaces (long-form morning /
 * evening / weekend briefs were removed for cost). */
export type WeeklyChampion = {
  /** YYYY-MM-DD of the Monday for the week this champion covers. */
  weekStart: string;
  /** YYYY-MM-DD of the Friday — used in the card's date range header. */
  weekEnd: string;
  /** keyof PEOPLE — used for the gold name on the card. */
  person: string;
  /** Display name ("Chris", "Eric", …). */
  name: string;
  /** WTD % of the champion at end of week. */
  wtdPct: number;
  /** WSB recap line from Claude — 2–3 sentences, week-over-week story. */
  line: string;
  /** Epoch ms when generated. */
  generatedAt: number;
};

/** Snapshot shape exposed to the frontend / public /api/data. Drops the
 * trigger-route bookkeeping fields (`lastFetch`, `analyzedAt`,
 * `pricesAtLastAnalysis`) so they don't leak in the public payload —
 * `pricesAtLastAnalysis` in particular duplicates the entire stocks
 * array and reveals the AI gating logic. The frontend only consumes
 * `stocks`, `analysis`, and `updatedAt`. */
export type PublicStoredData = Omit<
  StoredData,
  "lastFetch" | "analyzedAt" | "pricesAtLastAnalysis"
>;

/** What the dashboard reads. Bundles the live snapshot, the optional
 * weekly champion (Friday-evening AI recap, pinned through the
 * weekend), and the compact week-start price map for WTD math. */
export type DashboardData = {
  snapshot: PublicStoredData;
  /** The most recent weekly champion (generated last Friday). Pinned for
   * the whole following week — the title on the card carries the date
   * range so it's always clear which week it refers to. */
  weeklyChampion?: WeeklyChampion;
  /** Compact ticker → price map captured at the start of the trading week
   * (first Monday trigger). Used by the leaderboard for WTD performance.
   * Optional — at the very first deploy or if Monday's archive missed,
   * the leaderboard gracefully hides the WTD column. */
  weekStartPrices?: Record<string, number>;
};

/** Snapshot taken at the first Monday trigger of the week — baseline for
 * the leaderboard's WTD column and the Weekly Champion's week-over-week
 * recap. */
export type WeekStartSnapshot = {
  /** YYYY-MM-DD of the Monday this baseline is for. */
  weekStart: string;
  stocks: StockPrice[];
};

/** Compact, archive-friendly snapshot of one trading day's close.
 * Written by the post-close branch right after the snapshot is locked
 * in for the day; stored in a Redis hash keyed by `date`. ~1.5 KB per
 * day; 250 trading days/year ≈ 350 KB. Designed so future features
 * (per-stock charts, day-by-day leaderboards, volatility / streak
 * stats, mid-week recaps) have raw daily history to draw from. */
export type DailyResult = {
  /** YYYY-MM-DD (Stockholm). The trading day this captures. */
  date: string;
  /** Epoch ms when the archive entry was written (during the
   * 22:00–22:45 STO post-close window). */
  capturedAt: number;
  /** Per-stock today close + intraday change. */
  stocks: Array<{
    ticker: string;
    name: string;
    currency: string;
    close: number;
    changePct: number;
  }>;
  /** Per-friend day% — simple mean of owned-ticker `changePct`. */
  friends: Array<{
    person: string; // keyof PEOPLE
    name: string;
    dayPct: number;
  }>;
  /** Today's `overallMood` from the analyzer. */
  overallMood: string;
};

/** Compact, archive-friendly summary of one trading week's result.
 * Written Friday evening (22:45–23:30 STO) after the weekly archive
 * window fires; stored in a Redis hash keyed by `weekStart`. Designed
 * to be cheap to accumulate (~3KB per week, 52 weeks ≈ 150KB) so future
 * features (history graphs, year-end recap, monthly leaderboards) have
 * a corpus to draw from. */
export type WeeklyResult = {
  /** Monday YYYY-MM-DD (Stockholm). Sort key. */
  weekStart: string;
  /** Friday YYYY-MM-DD (Stockholm). */
  weekEnd: string;
  /** Epoch ms when the archive entry was written. */
  capturedAt: number;
  /** Per-stock week-over-week change. */
  stocks: Array<{
    ticker: string;
    name: string;
    currency: string;
    /** Friday's closing price. */
    fridayClose: number;
    /** (fridayClose - mondayBaseline) / mondayBaseline * 100. */
    weekChangePct: number;
  }>;
  /** Per-friend WTD% for the week, computed from `stocks` + ownership. */
  friends: Array<{
    person: string; // keyof PEOPLE
    name: string;
    tickers: string[];
    wtdPct: number;
  }>;
  /** Friday's `overallMood` carried forward. */
  overallMood: string;
};

export type StoredData = {
  stocks: StockPrice[];
  analysis: AnalysisPayload;
  /** ISO timestamp of when prices were last refreshed (every cron / trigger). */
  updatedAt: string;
  /** Epoch ms of when prices were last refreshed (every cron / trigger). */
  lastFetch: number;
  /**
   * Epoch ms of when the AI analysis was last regenerated. Distinct from
   * lastFetch — the AI runs less often than the price refresh.
   * Optional only because legacy snapshots may predate this field.
   */
  analyzedAt?: number;
  /**
   * Snapshot of price data at the moment the AI was last run. Used to
   * compute "did anything move enough to warrant a new AI run?" on the
   * next trigger. Optional only because legacy snapshots may predate this.
   */
  pricesAtLastAnalysis?: StockPrice[];
};
