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
};

export const RATINGS = [
  "🚀 TO THE MOON",
  "💎 DIAMOND HANDS",
  "📈 BULLISH AF",
  "⚠️ TURBULENCE",
  "📉 GET REKT",
] as const;

export type Rating = (typeof RATINGS)[number];

export const SENTIMENTS = ["moon", "up", "neutral", "down", "rekt"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export type StockAnalysis = {
  ticker: string;
  rating: Rating;
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

/** A long-form analyst brief (morning recap or evening wrap-up). */
export type Brief = {
  /** YYYY-MM-DD in Stockholm timezone — the day this brief is FOR. */
  date: string;
  text: string;
  generatedAt: number;
};

/** What the dashboard reads. Bundles snapshot + briefs from separate Redis keys. */
export type DashboardData = {
  snapshot: StoredData;
  morningBrief?: Brief;
  eveningBrief?: Brief;
  weekendBrief?: Brief;
  /** Compact ticker → price map captured at the start of the trading week
   * (first Monday trigger). Used by the leaderboard for WTD performance.
   * Optional — at the very first deploy or if Monday's archive missed,
   * the leaderboard gracefully hides the WTD column. */
  weekStartPrices?: Record<string, number>;
};

/** Snapshot taken at the first Monday trigger of the week — baseline for
 * the leaderboard's WTD column and the Weekend Wire's week-over-week recap. */
export type WeekStartSnapshot = {
  /** YYYY-MM-DD of the Monday this baseline is for. */
  weekStart: string;
  stocks: StockPrice[];
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
