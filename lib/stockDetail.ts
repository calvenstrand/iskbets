// Pure data-shaping for the per-stock detail view. All functions here are
// deterministic transforms over the dated snapshot history — no I/O, no
// clock reads (callers pass any "today" reference in). Kept separate from
// dailySnapshot.ts's extractTickerSeries (which deliberately drops the AI
// `comment` for the public /api/history contract) because the detail view
// needs the commentary line to build its ANALYST LOG.

import type { DailySnapshot, Rating, Sentiment } from "./types";

/** Price chart stays locked until the ticker has this many dated
 * receipts. The gate + the SVG both ship now so it flips on by itself
 * as the cron accumulates snapshots. */
export const SPARKLINE_UNLOCK_DAYS = 30;

/** One day of a single ticker's history, INCLUDING the optional AI
 * comment (extractTickerSeries drops it; the analyst log needs it). */
export type TickerHistoryPoint = {
  date: string;
  price: number;
  changePct: number;
  rating?: Rating;
  sentiment: Sentiment;
  comment?: string;
};

/**
 * Pull one ticker's per-day history out of a list of dated snapshots,
 * keeping the commentary line. Snapshots that predate the ticker (it
 * wasn't in the universe yet) are skipped. Order follows the input
 * (storage returns oldest→newest).
 */
export function extractTickerHistory(
  snapshots: DailySnapshot[],
  ticker: string,
): TickerHistoryPoint[] {
  const points: TickerHistoryPoint[] = [];
  for (const snap of snapshots) {
    const s = snap.stocks.find((x) => x.ticker === ticker);
    if (!s) continue;
    points.push({
      date: snap.date,
      price: s.price,
      changePct: s.changePct,
      ...(s.rating ? { rating: s.rating } : {}),
      sentiment: s.sentiment,
      ...(s.comment ? { comment: s.comment } : {}),
    });
  }
  return points;
}

/** One square in the contribution-graph mood strip. A `present: false`
 * cell is an honest hole — a calendar day inside the covered span with
 * no snapshot (weekend, holiday, missed cron). Never faked as neutral. */
export type MoodCell =
  | { date: string; present: true; changePct: number; sentiment: Sentiment }
  | { date: string; present: false };

/**
 * Build the mood strip: one cell per CALENDAR day from the first to the
 * last snapshot date (inclusive). Days with a snapshot become present
 * cells carrying the mood + change; gaps become absent cells so the
 * strip reads honestly instead of inventing squares. Returns `[]` for
 * empty input (the caller renders the "coverage initiated" empty state).
 * Input need not be pre-sorted — we sort defensively.
 */
export function buildMoodStrip(points: TickerHistoryPoint[]): MoodCell[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map((p) => [p.date, p]));
  const first = sorted[0]!.date;
  const last = sorted[sorted.length - 1]!.date;

  const cells: MoodCell[] = [];
  for (const date of eachDate(first, last)) {
    const p = byDate.get(date);
    cells.push(
      p
        ? { date, present: true, changePct: p.changePct, sentiment: p.sentiment }
        : { date, present: false },
    );
  }
  return cells;
}

/** A rendered analyst-log row. `kind: "entry"` is a real dated
 * commentary line; the terminal `kind: "coverage-initiated"` marker is
 * always appended as the oldest row so the feed is never empty. */
export type AnalystLogEntry =
  | {
      kind: "entry";
      date: string;
      changePct: number;
      sentiment: Sentiment;
      rating?: Rating;
      comment: string;
    }
  | { kind: "coverage-initiated"; monthYear: string };

/**
 * Reverse-chronological analyst feed: every dated AI commentary line for
 * this ticker, newest first, capped off by the seeded "coverage
 * initiated" marker (the month+year of the earliest snapshot we hold, or
 * `fallbackMonthYear` when there's no history at all). Days without a
 * commentary line don't produce a row — the log is the commentary spine,
 * not a price ledger — but the seed guarantees a non-empty, honest panel
 * for brand-new coverage.
 */
export function buildAnalystLog(
  points: TickerHistoryPoint[],
  opts: { fallbackMonthYear: string },
): AnalystLogEntry[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const monthYear =
    sorted.length > 0 ? monthYearOf(sorted[0]!.date) : opts.fallbackMonthYear;

  const entries: AnalystLogEntry[] = [];
  for (const p of sorted) {
    if (!p.comment) continue;
    entries.push({
      kind: "entry",
      date: p.date,
      changePct: p.changePct,
      sentiment: p.sentiment,
      ...(p.rating ? { rating: p.rating } : {}),
      comment: p.comment,
    });
  }
  entries.reverse(); // newest first
  entries.push({ kind: "coverage-initiated", monthYear });
  return entries;
}

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

/** "2026-07-09" → "JUL 2026". Robust to a malformed date string. */
export function monthYearOf(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const mm = MONTHS[(m ?? 0) - 1] ?? "———";
  return `${mm} ${y ?? "————"}`;
}

/**
 * Where `price` sits on the low↔high span, as a 0..1 fraction (0 = at
 * the 52-week low, 1 = at the high). Returns null when the range is
 * unusable (non-finite inputs, or high ≤ low — e.g. US tickers whose
 * free-tier quote reports 0 for both bounds). Clamps out-of-range prices
 * so a fresh all-time-high/low can't push the marker off the bar.
 */
export function rangePosition(
  price: number,
  low: number,
  high: number,
): number | null {
  if (![price, low, high].every((n) => Number.isFinite(n))) return null;
  if (high <= low) return null;
  const clamped = Math.min(Math.max(price, low), high);
  return (clamped - low) / (high - low);
}

/**
 * Percent distance from the 52-week high (≤ 0; ~0 means at/above the
 * top). Null when the high is unavailable (0 on the free tier). The
 * caller turns this into the "-34% FROM THE TOP 🥶" line.
 */
export function fromTheTop(price: number, high: number): number | null {
  if (!Number.isFinite(price) || !Number.isFinite(high) || high <= 0) {
    return null;
  }
  return ((price - high) / high) * 100;
}

/**
 * Hand-rolled SVG path (`d` attribute) for the price sparkline — no
 * chart dependency. Maps each price to an evenly-spaced x and a
 * min↔max-normalized y within a `pad`-inset box. Returns null when
 * there aren't at least two finite points to draw a line between.
 * y is flipped so higher prices sit higher on the SVG canvas.
 */
export function buildSparklinePath(
  prices: number[],
  width: number,
  height: number,
  pad = 2,
): string | null {
  if (prices.length < 2 || !prices.every((n) => Number.isFinite(n))) {
    return null;
  }
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1; // flat series → a centered horizontal line
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const stepX = innerW / (prices.length - 1);

  return prices
    .map((p, i) => {
      const x = pad + i * stepX;
      const y = pad + innerH - ((p - min) / span) * innerH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

/** Inclusive YYYY-MM-DD walk from `from` to `to`, UTC-based so DST never
 * skips or doubles a day. Guarded against inverted/absurd ranges. */
function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const end = parseUTC(to);
  let cur = parseUTC(from);
  let guard = 0;
  while (cur <= end && guard < 4000) {
    out.push(formatUTC(cur));
    cur += 86_400_000;
    guard++;
  }
  return out;
}

function parseUTC(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function formatUTC(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
