import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const data = await getDashboardData();
  if (!data) {
    return NextResponse.json(
      { error: "No data yet, trigger a fetch first" },
      { status: 404 },
    );
  }
  return NextResponse.json(data, { status: 200 });
}
