import { deriveSentiment } from "./derive";
import type {
  DailySnapshot,
  DailySnapshotStock,
  Rating,
  Sentiment,
  StoredData,
} from "./types";

/**
 * Project the live stored snapshot down into the slim, archive-friendly
 * DailySnapshot shape. Keeps only what the history API surfaces —
 * symbol, price, day change %, mood rating + sentiment, and the WSB
 * comment — plus the day's mood headline and timestamps. Drops the
 * heavy/redundant fields the live snapshot carries (volume, 52-week
 * high/low, marketState, lastTradeAt, and the entire `pricesAtLastMood`
 * gating baseline), taking ~23 KB down to ~5 KB per day.
 */
export function computeDailySnapshot(args: {
  data: StoredData;
  date: string;
  capturedAt: number;
}): DailySnapshot {
  const { data, date, capturedAt } = args;

  const analysisByTicker = new Map(
    data.analysis.stocks.map((a) => [a.ticker, a]),
  );

  const stocks: DailySnapshotStock[] = data.stocks.map((s) => {
    const a = analysisByTicker.get(s.ticker);
    return {
      ticker: s.ticker,
      price: s.regularMarketPrice,
      changePct: Number(s.regularMarketChangePercent.toFixed(2)),
      ...(a?.rating ? { rating: a.rating } : {}),
      // sentiment is always present in the analyzer output; fall back to
      // deriving it from the change % for legacy/partial snapshots.
      sentiment: a?.sentiment ?? deriveSentiment(s.regularMarketChangePercent),
      ...(a?.comment ? { comment: a.comment } : {}),
    };
  });

  return {
    date,
    capturedAt,
    updatedAt: data.updatedAt,
    overallMood: data.analysis.overallMood,
    stocks,
  };
}

/** One point in a per-ticker history series. */
export type TickerSeriesPoint = {
  date: string;
  price: number;
  changePct: number;
  rating?: Rating;
  sentiment: Sentiment;
};

/**
 * Extract a single ticker's time series from a list of snapshots (kept
 * in whatever order the caller passes — the storage layer returns them
 * oldest→newest). Snapshots missing the ticker (e.g. it wasn't in the
 * universe yet) are skipped.
 */
export function extractTickerSeries(
  snapshots: DailySnapshot[],
  ticker: string,
): TickerSeriesPoint[] {
  const points: TickerSeriesPoint[] = [];
  for (const snap of snapshots) {
    const s = snap.stocks.find((x) => x.ticker === ticker);
    if (!s) continue;
    points.push({
      date: snap.date,
      price: s.price,
      changePct: s.changePct,
      ...(s.rating ? { rating: s.rating } : {}),
      sentiment: s.sentiment,
    });
  }
  return points;
}
