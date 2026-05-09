import { NextResponse } from "next/server";
import { analyzeStocks } from "@/lib/analyzeStocks";
import { fetchPrices } from "@/lib/fetchPrices";
import {
  getLastAttempt,
  getStockData,
  markAttempt,
  saveStockData,
} from "@/lib/storage";
import type { StockPrice } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Anti-spam guard for manual triggers. Cron fires every 15 min so this
// never blocks scheduled runs; it just prevents a refresh button from
// hammering Finnhub/Avanza.
const COOLDOWN_MS = 60 * 1000; // 1 minute

// AI gating thresholds. Prices refresh on every trigger; the AI only
// runs when something genuinely changed (or enough time has passed).
const AI_FLOOR_MS = 30 * 60 * 1000; // 30 min — minimum gap between AI runs
const AI_CEILING_MS = 4 * 60 * 60 * 1000; // 4 hr — re-run AI even on a flat day
const SIGNIFICANT_DELTA_PCT = 1.0; // any ticker moved ≥1pp since last AI

function isAuthorized(req: Request): boolean {
  // Manual: ?key=TRIGGER_SECRET
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const triggerSecret = process.env.TRIGGER_SECRET;
  if (triggerSecret && key === triggerSecret) return true;

  // Vercel cron: Authorization: Bearer ${CRON_SECRET}. Vercel signs
  // every cron request with this header automatically once CRON_SECRET
  // is set in the project's env vars.
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;

  return false;
}

type AIDecision = { rerun: boolean; reason: string };

function shouldRerunAI(
  newPrices: StockPrice[],
  baseline: StockPrice[] | undefined,
  analyzedAt: number | undefined,
  now: number,
): AIDecision {
  if (!analyzedAt || !baseline) {
    return { rerun: true, reason: "no prior analysis" };
  }
  const elapsed = now - analyzedAt;
  if (elapsed > AI_CEILING_MS) {
    const hrs = (elapsed / 3_600_000).toFixed(1);
    return { rerun: true, reason: `${hrs}h since last AI (>4h ceiling)` };
  }
  if (elapsed < AI_FLOOR_MS) {
    const min = Math.round(elapsed / 60_000);
    return { rerun: false, reason: `${min}min since last AI (<30min floor)` };
  }
  // Find the biggest absolute change-percent shift across the portfolio.
  const baselineByTicker = new Map(baseline.map((p) => [p.ticker, p]));
  let maxDelta = 0;
  let maxTicker = "";
  for (const newP of newPrices) {
    const oldP = baselineByTicker.get(newP.ticker);
    if (!oldP) {
      return { rerun: true, reason: `new ticker ${newP.ticker}` };
    }
    const delta = Math.abs(
      newP.regularMarketChangePercent - oldP.regularMarketChangePercent,
    );
    if (delta > maxDelta) {
      maxDelta = delta;
      maxTicker = newP.ticker;
    }
  }
  if (maxDelta > SIGNIFICANT_DELTA_PCT) {
    return {
      rerun: true,
      reason: `${maxTicker} moved ${maxDelta.toFixed(2)}pp since last AI`,
    };
  }
  return {
    rerun: false,
    reason: `max delta ${maxDelta.toFixed(2)}pp (<${SIGNIFICANT_DELTA_PCT}pp)`,
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    console.log("[trigger] auth failed");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const lastAttempt = await getLastAttempt();
    const elapsed = Date.now() - lastAttempt;
    if (elapsed < COOLDOWN_MS) {
      const remainingMs = COOLDOWN_MS - elapsed;
      const secondsRemaining = Math.ceil(remainingMs / 1000);
      console.log(`[trigger] cooldown active, ${secondsRemaining}s remaining`);
      return NextResponse.json(
        {
          error: "Too soon, ape",
          nextAllowed: new Date(lastAttempt + COOLDOWN_MS).toISOString(),
          secondsRemaining,
        },
        { status: 429 },
      );
    }

    // Mark the attempt before the pipeline runs — the cooldown applies
    // whether the rest succeeds or fails midway.
    await markAttempt();

    console.log("[trigger] fetching prices");
    const newPrices = await fetchPrices();
    if (newPrices.length === 0) {
      throw new Error("no stocks fetched — every ticker failed");
    }

    const existing = await getStockData();
    const now = Date.now();
    const decision = shouldRerunAI(
      newPrices,
      existing?.pricesAtLastAnalysis,
      existing?.analyzedAt,
      now,
    );

    let analysis = existing?.analysis;
    let analyzedAt = existing?.analyzedAt;
    let pricesAtLastAnalysis = existing?.pricesAtLastAnalysis;

    if (decision.rerun || !analysis) {
      console.log(`[trigger] AI run (${decision.reason})`);
      analysis = await analyzeStocks(newPrices);
      analyzedAt = now;
      pricesAtLastAnalysis = newPrices;
    } else {
      console.log(`[trigger] AI skipped (${decision.reason})`);
    }

    if (!analysis || analyzedAt === undefined || !pricesAtLastAnalysis) {
      // Defensive: only possible if analyzeStocks returned undefined,
      // which the validator there should prevent.
      throw new Error("internal: missing analysis state after gating step");
    }

    const saved = await saveStockData({
      stocks: newPrices,
      analysis,
      analyzedAt,
      pricesAtLastAnalysis,
    });
    console.log("[trigger] pipeline done");
    return NextResponse.json(saved, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[trigger] pipeline failed: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
