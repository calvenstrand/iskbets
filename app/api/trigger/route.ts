import { NextResponse } from "next/server";
import { analyzeStocks } from "@/lib/analyzeStocks";
import { generateEveningBrief, generateMorningBrief } from "@/lib/briefs";
import {
  inEveningBriefWindow,
  inMorningBriefWindow,
  stockholmDate,
} from "@/lib/dateUtil";
import { fetchPrices } from "@/lib/fetchPrices";
import {
  getEveningBrief,
  getLastAttempt,
  getMorningBrief,
  getStockData,
  getYesterdaySnapshot,
  markAttempt,
  saveStockData,
  setEveningBrief,
  setMorningBrief,
  setYesterdaySnapshot,
} from "@/lib/storage";
import type { StockPrice, StoredData } from "@/lib/types";

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

/**
 * Generate and persist the morning/evening brief if we're in the right
 * window AND today's brief hasn't been generated yet. Failures here are
 * caught and logged — they don't fail the trigger response.
 */
async function maybeGenerateBriefs(
  todaySnapshot: StoredData,
  now: Date,
): Promise<void> {
  const today = stockholmDate(now);

  // Morning brief: 08:30–09:00 Stockholm. Reads yesterday's archived snapshot.
  if (inMorningBriefWindow(now)) {
    try {
      const existing = await getMorningBrief();
      if (existing?.date === today) {
        console.log("[trigger] morning brief already generated for today");
      } else {
        const yesterday = await getYesterdaySnapshot();
        if (!yesterday) {
          console.log(
            "[trigger] morning brief skipped — no yesterday snapshot yet",
          );
        } else {
          const text = await generateMorningBrief(yesterday);
          await setMorningBrief({
            date: today,
            text,
            generatedAt: Date.now(),
          });
          console.log("[trigger] morning brief generated");
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[trigger] morning brief failed: ${msg}`);
    }
  }

  // Evening brief: 22:00–22:45 Stockholm. Also archives today's snapshot
  // as "yesterday" for tomorrow's morning brief.
  if (inEveningBriefWindow(now)) {
    try {
      const existing = await getEveningBrief();
      if (existing?.date === today) {
        console.log("[trigger] evening brief already generated for today");
      } else {
        const text = await generateEveningBrief(todaySnapshot);
        await setEveningBrief({
          date: today,
          text,
          generatedAt: Date.now(),
        });
        // Archive today's snapshot for tomorrow morning's brief.
        await setYesterdaySnapshot(todaySnapshot);
        console.log("[trigger] evening brief generated + yesterday archived");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[trigger] evening brief failed: ${msg}`);
    }
  }
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

    // Brief generation runs alongside the regular pipeline. Idempotent —
    // each brief stores a `date` (Stockholm tz) and won't regenerate if
    // today's already exists. Cron fires every 15 min in the brief windows
    // so this typically lands once per window per day.
    await maybeGenerateBriefs(saved, new Date());

    console.log("[trigger] pipeline done");
    return NextResponse.json(saved, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[trigger] pipeline failed: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
