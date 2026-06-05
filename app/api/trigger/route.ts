import { NextResponse } from "next/server";
import { shouldRerunComments, shouldRerunMood } from "@/lib/aiGating";
import { analyzeStocks } from "@/lib/analyzeStocks";
import { generateWeeklyChampion } from "@/lib/weeklyChampion";
import { generateMood } from "@/lib/generateMood";
import {
  computeLeaderboard,
  pickBiggestWinnerLoser,
  pickWeekChampion,
} from "@/lib/leaderboard";
import {
  inPostCloseWindow,
  inWeeklyArchiveWindow,
  stockholmDate,
  stockholmMondayOfWeek,
} from "@/lib/dateUtil";
import { fetchPrices } from "@/lib/fetchPrices";
import {
  getDailyResult,
  getLastAttempt,
  getStockData,
  getWeeklyChampion,
  getWeeklyResult,
  getWeekStartSnapshot,
  markAttempt,
  saveStockData,
  setDailyResult,
  setWeeklyChampion,
  setWeeklyResult,
  setWeekStartSnapshot,
} from "@/lib/storage";
import type { StoredData } from "@/lib/types";
import { computeDailyResult } from "@/lib/dailyResult";
import { computeWeeklyResult, fridayFromMonday } from "@/lib/weeklyResult";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Anti-spam guard for manual triggers. Cron fires every 10 min so this
// never blocks scheduled runs; it just prevents a refresh button from
// hammering Finnhub/Avanza.
const COOLDOWN_MS = 60 * 1000; // 1 minute

function isAuthorized(req: Request): boolean {
  const triggerSecret = process.env.TRIGGER_SECRET;
  if (!triggerSecret) {
    console.error("[trigger] TRIGGER_SECRET not set — all requests denied");
    return false;
  }
  const headerSecret = req.headers.get("x-trigger-secret");
  return headerSecret === triggerSecret;
}


/**
 * Run the time-windowed post-close work: daily archive (every weekday
 * after market close) and weekly archive + Weekly Champion (Friday
 * after close). All Brief generation (morning / evening / weekend wire)
 * was removed for cost reasons — only the Weekly Champion still uses
 * Anthropic on a recurring schedule, and it's the one AI-generated
 * narrative the dashboard actually surfaces.
 */
async function runPostCloseWork(
  todaySnapshot: StoredData,
  now: Date,
): Promise<void> {
  // Post-close window: 22:00–22:45 STO. Writes the daily archive
  // (captures today's close for long-term history). Idempotent per
  // Stockholm calendar day.
  if (inPostCloseWindow(now)) {
    await maybeArchiveDailyResult(todaySnapshot, now);
  }

  // Weekly archive window: Friday 22:45–23:30 STO. Fires the weekly
  // archive + the Weekly Champion AI call. The Weekend Wire long-form
  // recap that used to fire here was removed for cost reasons (nobody
  // read it after the dashboard hid it during recap mode).
  if (inWeeklyArchiveWindow(now)) {
    // Weekly archive — captures Friday's close. Idempotent per week,
    // so spam-firing this branch after the first archive lands is a
    // no-op. wireText falls through as undefined now that the wire
    // isn't generated; the archive type already allows that.
    await maybeArchiveWeeklyResult(todaySnapshot, now);

    // Weekly champion — separate Anthropic call targeting the WTD
    // leader (not today's #1). Pinned through the weekend until next
    // Friday's call. This is the surviving Friday-night AI call —
    // the user-facing weekly narrative on the dashboard.
    await maybeGenerateWeeklyChampion(todaySnapshot, now);
  }
}

/**
 * Archive today's compact result for long-term history. Same Redis-hash
 * pattern as the weekly archive, finer granularity. Enables future
 * per-stock charts, day-by-day leaderboards, volatility / streak stats,
 * mid-week recaps. ~1.5 KB/day, ~350 KB/year. NOT exposed in /api/data
 * — pull via `listDailyResults` from a future feature.
 *
 * Holiday Mondays archive a duplicate of the previous Friday's close
 * (since cached prices weren't refreshed). That's a downstream
 * concern — filter by detecting all-zero changePct if needed.
 */
async function maybeArchiveDailyResult(
  todaySnapshot: StoredData,
  now: Date,
): Promise<void> {
  const today = stockholmDate(now);
  try {
    const existing = await getDailyResult(today);
    if (existing) {
      // Idempotent — every cron in the post-close window after the first
      // archive is a no-op.
      return;
    }
    const result = computeDailyResult({ snapshot: todaySnapshot, date: today });
    await setDailyResult(result);
    console.log(
      `[trigger] daily result archived for ${today} ` +
        `(${result.stocks.length} stocks, ${result.friends.length} friends)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[trigger] daily archive failed: ${msg}`);
  }
}

/**
 * Archive the week's compact result for long-term history. Designed to
 * accumulate forever (or until we hit ~52 weeks and add a trim job) so
 * future features — historical leaderboards, year-end recap, performance
 * graphs — have a corpus to draw from. NOT exposed in /api/data; a
 * future feature can pull from `listWeeklyResults`.
 */
async function maybeArchiveWeeklyResult(
  todaySnapshot: StoredData,
  now: Date,
): Promise<void> {
  const weekKey = stockholmMondayOfWeek(now);
  try {
    const existing = await getWeeklyResult(weekKey);
    if (existing) {
      console.log(`[trigger] weekly archive already written for ${weekKey}`);
      return;
    }
    const weekStart = await getWeekStartSnapshot();
    if (!weekStart || weekStart.weekStart !== weekKey) {
      console.log(
        "[trigger] weekly archive skipped — week-start missing or stale",
      );
      return;
    }
    const result = computeWeeklyResult({
      fridaySnapshot: todaySnapshot,
      weekStart,
    });
    await setWeeklyResult(result);
    console.log(
      `[trigger] weekly result archived for ${weekKey} ` +
        `(${result.stocks.length} stocks, ${result.friends.length} friends)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[trigger] weekly archive failed: ${msg}`);
  }
}

/**
 * Generate the "champion of the week" recap: a 2–3 sentence WSB piece
 * about whoever has the highest WTD% at end of week. Lives at its own
 * Redis key, pinned through the weekend, overwritten next Friday.
 *
 * Targets the WTD leader, not today's #1 — they can be different
 * people, especially if Friday's session reshuffled things. The
 * champion-of-the-week card on the dashboard always shows the WTD
 * leader (the actual week's winner), independent of today's sort.
 *
 * Idempotent per week: if a champion entry already exists for this
 * week's Monday, skip. Independent try/catch from the wire and archive
 * branches — a champion failure doesn't break either.
 */
async function maybeGenerateWeeklyChampion(
  todaySnapshot: StoredData,
  now: Date,
): Promise<void> {
  const weekKey = stockholmMondayOfWeek(now);
  try {
    const existing = await getWeeklyChampion();
    if (existing?.weekStart === weekKey) {
      console.log(
        "[trigger] weekly champion already generated this week",
      );
      return;
    }
    const weekStart = await getWeekStartSnapshot();
    if (!weekStart || weekStart.weekStart !== weekKey) {
      console.log(
        "[trigger] weekly champion skipped — week-start missing or stale",
      );
      return;
    }
    const weekStartPrices = Object.fromEntries(
      weekStart.stocks.map((s) => [s.ticker, s.regularMarketPrice]),
    );
    const champion = pickWeekChampion(todaySnapshot.stocks, weekStartPrices);
    if (!champion) {
      console.log(
        "[trigger] weekly champion skipped — no friend has WTD data",
      );
      return;
    }
    // Build the "others" list for context in the prompt.
    const everyone = computeLeaderboard(todaySnapshot.stocks, weekStartPrices);
    const others = everyone.filter((e) => e.person !== champion.person);

    const line = await generateWeeklyChampion({
      champion,
      others,
      today: todaySnapshot,
      weekStart,
    });

    const weekEnd = fridayFromMonday(weekKey);

    await setWeeklyChampion({
      weekStart: weekKey,
      weekEnd,
      person: champion.person,
      name: champion.name,
      wtdPct: Number((champion.wtdPct ?? 0).toFixed(2)),
      line,
      generatedAt: Date.now(),
    });
    console.log(
      `[trigger] weekly champion ${champion.name} (WTD ` +
        `${champion.wtdPct?.toFixed(2)}%) saved`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[trigger] weekly champion failed: ${msg}`);
  }
}

/**
 * Archive the snapshot as this week's baseline if we don't already have
 * one for the current Stockholm-week's Monday. Used by the leaderboard's
 * WTD column and the Weekend Wire's week-over-week recap.
 *
 * Fires on the FIRST trigger of the week that doesn't have a current
 * baseline — typically Monday morning, but resilient to:
 *   - Monday being a Swedish public holiday (cron still fires; cached
 *     Friday-close prices get archived as the baseline — semantically
 *     correct since Friday's close IS the start of the trading week)
 *   - Cron failing entirely on Monday (Tuesday morning's first trigger
 *     backfills with whatever the snapshot then holds — typically still
 *     Friday's close if Tuesday morning is pre-open)
 *   - A new feature being deployed mid-week and needing a baseline
 *     before next Monday (today's situation: deployed Saturday, the
 *     next weekday trigger backfills)
 *
 * Idempotent — once a row exists for `stockholmMondayOfWeek(now)`,
 * subsequent triggers in the same week no-op.
 */
async function maybeArchiveWeekStart(
  snapshot: StoredData,
  now: Date,
): Promise<void> {
  const weekKey = stockholmMondayOfWeek(now);
  try {
    const existing = await getWeekStartSnapshot();
    if (existing?.weekStart === weekKey) {
      // Already have this week's baseline. Subsequent triggers no-op.
      return;
    }
    await setWeekStartSnapshot({
      weekStart: weekKey,
      stocks: snapshot.stocks,
    });
    console.log(`[trigger] week-start snapshot archived for ${weekKey}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[trigger] week-start archive failed: ${msg}`);
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

    // Read existing snapshot first so fetchPrices can reuse cached prices
    // for markets that are currently closed (no live data to update).
    const existing = await getStockData();

    console.log("[trigger] fetching prices");
    const newPrices = await fetchPrices(existing?.stocks);
    if (newPrices.length === 0) {
      throw new Error("no stocks fetched — every ticker failed");
    }

    const now = Date.now();
    const commentsDecision = shouldRerunComments(
      newPrices,
      existing?.pricesAtLastAnalysis,
      existing?.analyzedAt,
      now,
    );
    const moodDecision = shouldRerunMood(
      newPrices,
      existing?.pricesAtLastMood,
      existing?.moodGeneratedAt,
      now,
    );

    // Start with whatever was cached (or empty defaults on first run).
    // Each AI path below replaces its slice of the payload when it fires.
    let stocksAnalysis = existing?.analysis?.stocks ?? [];
    let overallMood = existing?.analysis?.overallMood ?? "";
    let analyzedAt = existing?.analyzedAt ?? now;
    let pricesAtLastAnalysis = existing?.pricesAtLastAnalysis ?? newPrices;
    let moodGeneratedAt = existing?.moodGeneratedAt;
    let pricesAtLastMood = existing?.pricesAtLastMood;

    // Hand both AI paths the week-start baseline so the comments call
    // can force-comment the week's biggest mover/dragger (featured cards
    // must never be silent) and the mood can reference the week story
    // when relevant. Falls back to undefined on a fresh deploy / stale
    // baseline; both calls handle that.
    const thisMonday = stockholmMondayOfWeek(new Date(now));
    const weekStartSnapshot =
      commentsDecision.rerun || moodDecision.rerun || !existing?.analysis
        ? await getWeekStartSnapshot()
        : undefined;
    const weekStartPrices =
      weekStartSnapshot && weekStartSnapshot.weekStart === thisMonday
        ? Object.fromEntries(
            weekStartSnapshot.stocks.map((s) => [
              s.ticker,
              s.regularMarketPrice,
            ]),
          )
        : undefined;

    if (commentsDecision.rerun || !existing?.analysis) {
      console.log(
        `[trigger] comments run (${commentsDecision.reason})${weekStartPrices ? " + week-baseline" : ""}`,
      );
      stocksAnalysis = await analyzeStocks(newPrices, weekStartPrices);
      analyzedAt = now;
      pricesAtLastAnalysis = newPrices;
    } else {
      console.log(`[trigger] comments skipped (${commentsDecision.reason})`);
    }

    if (moodDecision.rerun) {
      console.log(`[trigger] mood run (${moodDecision.reason})`);
      overallMood = await generateMood(newPrices);
      moodGeneratedAt = now;
      pricesAtLastMood = newPrices;
    } else {
      console.log(`[trigger] mood skipped (${moodDecision.reason})`);
    }

    // biggestWinner/Loser are computed in code (not by the AI), so they
    // refresh every tick from current prices regardless of whether
    // either AI path fired. Keeps the snapshot's pointers fresh for the
    // dashboard's featured cards.
    const { biggestWinner, biggestLoser } = pickBiggestWinnerLoser(newPrices);

    const analysis = {
      stocks: stocksAnalysis,
      overallMood,
      biggestWinner,
      biggestLoser,
    };

    const saved = await saveStockData({
      stocks: newPrices,
      analysis,
      analyzedAt,
      pricesAtLastAnalysis,
      ...(moodGeneratedAt !== undefined ? { moodGeneratedAt } : {}),
      ...(pricesAtLastMood !== undefined ? { pricesAtLastMood } : {}),
    });

    const triggerNow = new Date();

    // Archive the Monday baseline once per week (no-op other days, or
    // on subsequent Monday triggers after the first one this week).
    // Runs BEFORE post-close work so the Weekly Champion sees a fresh baseline.
    await maybeArchiveWeekStart(saved, triggerNow);

    // Post-close work: daily archive (every weekday after market close)
    // and weekly archive + Weekly Champion AI call (Friday after close).
    // All idempotent; cron fires every 10 min so each window catches
    // multiple ticks but only the first one does work.
    await runPostCloseWork(saved, triggerNow);

    console.log("[trigger] pipeline done");
    return NextResponse.json(saved, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[trigger] pipeline failed: ${msg}`);
    // Don't echo provider error text back — it can include URLs, request
    // IDs, or implementation hints from Anthropic / Finnhub / Upstash.
    // The detail is in the server log.
    return NextResponse.json({ error: "pipeline failed" }, { status: 500 });
  }
}
