import { NextResponse } from "next/server";
import { parseMockMode } from "@/lib/mockData";
import { getDashboardData } from "@/lib/storage";

export const runtime = "nodejs";

// Edge-cache the response. Underlying data mutates every 10 min via
// the cron, so a tight CDN TTL doesn't waste origin calls but does
// cut the staleness window dramatically.
//
// s-maxage=20 (was 60): Avanza often serves Friday's close for the
// first few minutes after Stockholm opens, so even when the trigger
// runs at 09:03 the snapshot can still look frozen. With a 60s TTL
// the CDN could serve that pre-opening data for another minute after
// real intraday prints arrived. 20s puts the worst-case "data in
// Redis → user sees it" gap at ~20s of CDN + 2min of client polling.
// stale-while-revalidate=300 stays for resilience under load.
//
// Math: 30 viewers polling every 2 min = 900 polls/hour. With
// s-maxage=20, the CDN collapses every 20s window to 1 origin call:
// 180 origin calls/hour — comfortably below Upstash limits.
const CACHE_HEADER = "public, s-maxage=20, stale-while-revalidate=300";

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
