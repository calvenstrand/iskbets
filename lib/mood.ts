import { deriveSentiment } from "./derive";
import type { MoodRecord, Sentiment, StockPrice } from "./types";

/** Retention cap for the rolling mood history. ~90 trading days ≈ 4½
 * months — enough to back a 30-day strip with headroom, small enough
 * that the whole array (enums + one number per day) is a cheap read. */
export const MOOD_HISTORY_CAP = 90;

/** Default window the strip / getMoodHistory ask for. */
export const MOOD_HISTORY_DAYS = 30;

/**
 * Derive one day's mood record from a snapshot's stocks. Pure — no LLM,
 * no clock, no I/O; mood is a rule-based function of the change %s
 * (deriveSentiment). Tickers with non-finite prices are skipped entirely
 * (both from the average and the per-ticker map) so a missing quote never
 * fakes a "neutral" day for that ticker.
 */
export function computeMoodRecord(
  stocks: StockPrice[],
  date: string,
): MoodRecord {
  const finite = stocks.filter((s) =>
    Number.isFinite(s.regularMarketChangePercent),
  );
  const avgPct =
    finite.length > 0
      ? finite.reduce((sum, s) => sum + s.regularMarketChangePercent, 0) /
        finite.length
      : 0;
  const tickers: Record<string, Sentiment> = {};
  for (const s of finite) {
    tickers[s.ticker] = deriveSentiment(s.regularMarketChangePercent);
  }
  return {
    date,
    overall: deriveSentiment(avgPct),
    avgPct,
    tickers,
  };
}

/**
 * UPSERT a record into the history by its Stockholm date, keeping the
 * array sorted oldest→newest and capped. Same-day = overwrite: multiple
 * pipeline runs a day just refine that day's entry (last-write-wins),
 * never appending duplicates. The trade-off is that an intraday swing
 * before close can flip the recorded mood — acceptable, since the strip
 * reflects "where the day landed as of the last run", and the final run
 * of the day is the closing print.
 */
export function upsertMoodRecords(
  existing: MoodRecord[],
  record: MoodRecord,
  cap: number = MOOD_HISTORY_CAP,
): MoodRecord[] {
  const merged = existing
    .filter((r) => r.date !== record.date)
    .concat(record)
    .sort((a, b) => a.date.localeCompare(b.date));
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}

/**
 * Normalize a stored history to oldest→newest and take at most the last
 * `days`. `days <= 0` returns the whole (sorted) history.
 */
export function selectRecentMood(
  all: MoodRecord[],
  days: number = MOOD_HISTORY_DAYS,
): MoodRecord[] {
  const sorted = [...all].sort((a, b) => a.date.localeCompare(b.date));
  return days > 0 ? sorted.slice(-days) : sorted;
}
