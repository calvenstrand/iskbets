import { NextResponse } from "next/server";
import { extractTickerSeries } from "@/lib/dailySnapshot";
import {
  getDailySnapshot,
  getDailySnapshotsInRange,
  getRecentDailySnapshots,
} from "@/lib/storage";

export const runtime = "nodejs";

// Same CDN posture as /api/data: public, tight edge TTL. History rows
// only mutate once per day (last trigger of the day wins), so this is
// generous, but matching /api/data keeps the caching story uniform.
const CACHE_HEADER = "public, s-maxage=20";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 400;

function bad(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

function ok(body: unknown): NextResponse {
  return NextResponse.json(body, {
    status: 200,
    headers: { "Cache-Control": CACHE_HEADER },
  });
}

/**
 * Read-only history API over the dated snapshots the trigger writes.
 * Public + CDN-cached, mirroring /api/data. Three modes:
 *
 *   ?date=YYYY-MM-DD              → that day's snapshot (404 if absent)
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD → snapshots in range, oldest→newest
 *   ?ticker=DDOG&days=30         → per-ticker series (date, price,
 *                                  change, mood) from the last N snapshots
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const ticker = searchParams.get("ticker");
  const daysRaw = searchParams.get("days");

  try {
    // ?ticker=DDOG&days=30 — per-ticker time series.
    if (ticker) {
      const days = parseDays(daysRaw);
      if (days === null) return bad("days must be a positive integer");
      const symbol = ticker.toUpperCase();
      const snapshots = await getRecentDailySnapshots(days);
      const series = extractTickerSeries(snapshots, symbol);
      return ok({ ticker: symbol, days, count: series.length, series });
    }

    // ?date=YYYY-MM-DD — a single day.
    if (date) {
      if (!DATE_RE.test(date)) return bad("date must be YYYY-MM-DD");
      const snapshot = await getDailySnapshot(date);
      if (!snapshot) {
        return NextResponse.json(
          { error: "no snapshot for that date", date },
          { status: 404 },
        );
      }
      return ok(snapshot);
    }

    // ?from=YYYY-MM-DD&to=YYYY-MM-DD — a range.
    if (from || to) {
      if (!from || !to) return bad("both from and to are required for a range");
      if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
        return bad("from and to must be YYYY-MM-DD");
      }
      // Tolerate reversed bounds.
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      const snapshots = await getDailySnapshotsInRange(lo, hi);
      return ok({ from: lo, to: hi, count: snapshots.length, snapshots });
    }

    return bad(
      "provide one of: ?date=YYYY-MM-DD, ?from=&to=, or ?ticker=&days=",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[history] read failed: ${msg}`);
    return NextResponse.json({ error: "history read failed" }, { status: 500 });
  }
}

/** Parse the `days` param → clamped positive int, or default when absent.
 * Returns null for a present-but-invalid value so the caller can 400. */
function parseDays(raw: string | null): number | null {
  if (raw === null) return DEFAULT_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return Math.min(n, MAX_DAYS);
}
