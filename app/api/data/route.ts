import { NextResponse } from "next/server";
import { parseMockMode } from "@/lib/mockData";
import { getDashboardData } from "@/lib/storage";

export const runtime = "nodejs";

// Edge-cache the response. Underlying data mutates every 10 min via
// the cron, so a tight CDN TTL barely wastes origin calls but cuts
// the staleness window dramatically.
//
// s-maxage=20 (was 60): the CDN collapses bursty polling into ~3
// origin calls/min total regardless of viewer count, while still
// surfacing fresh data within ~20s of a cron write landing in Redis.
//
// stale-while-revalidate REMOVED (was =300): the user reported a
// recurring pattern where the dashboard wouldn't reflect the morning
// cron writes until the *third* tick of the day (~20 min after open).
// Root cause was SWR serving stale-from-Friday data on the first
// post-expiry request and only revalidating in the background — the
// CLIENT sees the stale response, the fresh data lands in cache for
// the NEXT poll, and with our 2-min polling cadence + multiple edge
// nodes that compounds across cron cycles. Dropping SWR makes every
// request after the 20s window do a synchronous origin fetch:
// ~50-100ms extra latency, but never serves stale.
//
// Origin load math: 30 viewers polling every 2 min = 900 polls/hour.
// With s-maxage=20 and no SWR, CDN still collapses each 20s window to
// 1 origin call: 180 origin calls/hour. Comfortably below Upstash
// free-tier limits (10k commands/day).
const CACHE_HEADER = "public, s-maxage=20";

export async function GET(request: Request): Promise<NextResponse> {
  // Dev-only `?mode=X` preview support — see lib/mockData.ts MockMode.
  // In production the storage layer ignores the param (mock branch
  // never fires when Redis is configured), so this is safe to read
  // unconditionally. CDN cache key already includes the query string,
  // so different modes get separate cache entries.
  const mode = parseMockMode(
    new URL(request.url).searchParams.get("mode") ?? undefined,
  );
  const data = await getDashboardData({ mode });
  if (!data) {
    return NextResponse.json(
      { error: "No data yet, trigger a fetch first" },
      { status: 404 },
    );
  }
  return NextResponse.json(data, {
    status: 200,
    headers: { "Cache-Control": CACHE_HEADER },
  });
}
