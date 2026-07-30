// Pure data-shaping for the per-stock detail view. All functions here are
// deterministic transforms over the dated snapshot history — no I/O, no
// clock reads (callers pass any "today" reference in). The per-ticker
// series itself comes from dailySnapshot.ts's extractTickerSeries; this
// file only shapes it into the view's panels.
//
// History: there used to be a local extractTickerHistory here that kept
// the snapshot `comment` field, because the ANALYST LOG panel rendered a
// dated commentary feed. That panel was removed once per-ticker comments
// stopped being AI-generated (they're the table-driven lines from
// stockMessages.ts, so a dated feed of them said nothing), which left the
// local extractor a pure duplicate of extractTickerSeries.

import type { Sentiment } from "./types";
import type { TickerSeriesPoint } from "./dailySnapshot";

/** Price chart stays locked until the ticker has this many dated
 * receipts. The gate + the SVG both ship now so it flips on by itself
 * as the cron accumulates snapshots. */
export const SPARKLINE_UNLOCK_DAYS = 30;

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
export function buildMoodStrip(points: TickerSeriesPoint[]): MoodCell[] {
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
