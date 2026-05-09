import { NextResponse } from "next/server";
import { parseMockMode } from "@/lib/mockData";
import { getDashboardData } from "@/lib/storage";

export const runtime = "nodejs";

// Edge-cache the response. Underlying data only mutates when the cron
// fires (every 15 min) so there's no reason every poll should hit
// Upstash directly. With ~5-min client polling, an open dashboard tab
// would otherwise issue 36 Redis-backed requests/hour; an attacker
// could trivially drain the Upstash quota. With s-maxage=60 the CDN
// collapses everything into 1 origin call/min regardless of viewer
// count, and stale-while-revalidate keeps the response instant during
// background refresh.
const CACHE_HEADER = "public, s-maxage=60, stale-while-revalidate=300";

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
