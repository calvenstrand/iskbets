import { NextResponse } from "next/server";
import { analyzeStocks } from "@/lib/analyzeStocks";
import { fetchPrices } from "@/lib/fetchPrices";
import {
  getLastAttempt,
  markAttempt,
  saveStockData,
} from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COOLDOWN_MS = 30 * 60 * 1000;

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const expected = process.env.TRIGGER_SECRET;

  if (!expected || key !== expected) {
    console.log("[trigger] auth failed");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const lastAttempt = await getLastAttempt();
    const elapsed = Date.now() - lastAttempt;
    if (elapsed < COOLDOWN_MS) {
      const remainingMs = COOLDOWN_MS - elapsed;
      const minutesRemaining = Math.ceil(remainingMs / 60000);
      const nextAllowed = new Date(lastAttempt + COOLDOWN_MS).toISOString();
      console.log(`[trigger] cooldown active, ${minutesRemaining} min remaining`);
      return NextResponse.json(
        {
          error: "Too soon, ape",
          nextAllowed,
          minutesRemaining,
        },
        { status: 429 },
      );
    }

    // Mark the attempt BEFORE running the pipeline. The cooldown applies
    // whether the pipeline succeeds or blows up midway, so a flaky Yahoo or
    // a Claude rate-limit can't be hammered.
    await markAttempt();

    console.log("[trigger] running pipeline");
    const stocks = await fetchPrices();
    if (stocks.length === 0) {
      throw new Error("no stocks fetched — every ticker failed");
    }
    const analysis = await analyzeStocks(stocks);
    const saved = await saveStockData({ stocks, analysis });
    console.log("[trigger] pipeline done");
    return NextResponse.json(saved, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[trigger] pipeline failed: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
