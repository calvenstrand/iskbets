import { NextResponse } from "next/server";
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

export async function GET(): Promise<NextResponse> {
  const data = await getDashboardData();
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
