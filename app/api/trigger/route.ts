import { NextResponse } from "next/server";
import { analyzeStocks } from "@/lib/analyzeStocks";
import {
  generateMorningBrief,
  generateWeeklyChampion,
} from "@/lib/briefs";
import { computeLeaderboard, pickWeekChampion } from "@/lib/leaderboard";
import {
  inEveningBriefWindow,
  inMorningBriefWindow,
  inWeekendWireWindow,
  stockholmDate,
  stockholmMondayOfWeek,
} from "@/lib/dateUtil";
import { fetchPrices } from "@/lib/fetchPrices";
import {
  getDailyResult,
  getLastAttempt,
  getMorningBrief,
  getStockData,
  getWeeklyChampion,
  getWeeklyResult,
  getWeekStartSnapshot,
  getYesterdaySnapshot,
  markAttempt,
  saveStockData,
  setDailyResult,
  setMorningBrief,
  setWeeklyChampion,
  setWeeklyResult,
  setWeekStartSnapshot,
  setYesterdaySnapshot,
} from "@/lib/storage";
import type { StockPrice, StoredData } from "@/lib/types";
import { computeDailyResult } from "@/lib/dailyResult";
import { computeWeeklyResult } from "@/lib/weeklyResult";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Anti-spam guard for manual triggers. Cron fires every 15 min so this
// never blocks scheduled runs; it just prevents a refresh button from
// hammering Finnhub/Avanza.
const COOLDOWN_MS = 60 * 1000; // 1 minute

// AI gating thresholds. Prices refresh on every trigger; the AI only
// runs when something genuinely changed (or enough time has passed).
//
// Floor history:
//   29 → 44 min (May 2026): bumped to cut daily Anthropic spend ~35%
//     ($0.70 → $0.46 weekday baseline).
//   44 → 59 min (May 2026): another ~25-30% cut. Friday spikes back
//     up to $0.67 because the Weekend Wire + Weekly Champion both
//     fire that night; this floor mostly affects Mon-Thu.
//
// 59 (not 60) for jitter margin. Cron ticks at :03 :13 :23 :33 :43 :53
// — so the "60 min since last AI" mark lands EXACTLY when the next
// eligible tick fires. Vercel processing jitter can put `elapsed` at
// 59:59.x and fail the floor check, slipping AI to the +10-min tick
// (effectively giving us a 70-min cadence instead of 60). 59-min floor
// + 10-min cron → reliable triggering at the intended tick.
const AI_FLOOR_MS = 59 * 60 * 1000; // ~60 min with jitter margin
const AI_CEILING_MS = 4 * 60 * 60 * 1000; // 4 hr — re-run AI even on a flat day
// Delta threshold for re-running the AI based on ticker movement since
// the last analysis. Raised 1.0 → 2.0 (May 2026) after observing that
// weekday cost stuck at ~$0.56 even with the 59-min floor: on volatile
// weeks the delta trigger was firing on nearly every 59-min tick
// regardless of floor, because 1pp moves are common. 2pp is rare enough
// to be a real news event but cuts delta-driven AI calls roughly in
// half on choppy days. Quieter days fall back to the 4hr ceiling.
const SIGNIFICANT_DELTA_PCT = 2.0;

function isAuthorized(req: Request): boolean {
  const triggerSecret = process.env.TRIGGER_SECRET;
  if (!triggerSecret) return false;

  // Preferred: header — never logged in Vercel access logs, never in
  // browser history, never leaked via Referer. The GitHub Actions cron
  // workflow uses this path.
  const headerSecret = req.headers.get("x-trigger-secret");
  if (headerSecret && headerSecret === triggerSecret) return true;

  // Legacy: ?key=TRIGGER_SECRET. Kept for backward compat with any
  // bookmarked manual-trigger URLs. Avoid for new integrations — the
  // value lands in access logs and Referer headers.
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (key && key === triggerSecret) return true;

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
    const floorMin = Math.round(AI_FLOOR_MS / 60_000);
    return { rerun: false, reason: `${min}min since last AI (<${floorMin}min floor)` };
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
 * Generate and persist the morning / evening / weekend-wire briefs if
 * we're in the right window AND that brief hasn't been generated for
 * its target period yet. Failures here are caught and logged — they
 * don't fail the trigger response.
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

  // Market-close window: 22:00–22:45 Stockholm. Archives today's
  // snapshot as "yesterday" for tomorrow's morning brief + writes the
  // daily archive. The Evening Wrap AI brief that used to fire here
  // was removed — nobody read the after-close paragraph and the AI
  // call was ~$0.10/week with no observed engagement.
  if (inEveningBriefWindow(now)) {
    try {
      // Idempotency: yesterday's snapshot already reflects today's
      // STO date → first cron in the window already did it, skip the
      // rest. Compares Stockholm calendar day, not raw ISO equality,
      // because subsequent cron ticks in the window have slightly
      // newer updatedAt values but represent the same trading day.
      const existing = await getYesterdaySnapshot();
      const existingDate = existing?.updatedAt
        ? stockholmDate(new Date(existing.updatedAt))
        : null;
      if (existingDate === today) {
        // Already archived this evening — silent no-op.
      } else {
        await setYesterdaySnapshot(todaySnapshot);
        console.log(`[trigger] yesterday snapshot archived for ${today}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[trigger] yesterday archive failed: ${msg}`);
    }

    // Daily archive — runs in the same window so it captures today's
    // close. Independent of brief success: if Claude refused, we still
    // store the numbers. Idempotent per Stockholm calendar day.
    await maybeArchiveDailyResult(todaySnapshot, now);
  }

  // Weekend wire window: Friday 22:45–23:30 Stockholm. Fires the weekly
  // archive + the Weekly Champion AI call. The Weekend Wire itself
  // (paragraph-length recap) is no longer generated — the dashboard
  // hides it during the recap window in favor of the Champion card,
  // and that's the only surface that ever displayed it. Skipping the
  // wire AI call saves ~$0.40/month. If a future feature wants the
  // long-form wire back (e.g., archive page), re-enable by restoring
  // the generateWeekendWire() block here.
  if (inWeekendWireWindow(now)) {
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
      // Idempotent — every cron in the evening window after the first
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
    // wireText is intentionally omitted — the Weekend Wire AI call was
    // dropped for cost reasons (the dashboard never displayed it after
    // the recap-window hide). Archive shape allows wireText to be
    // undefined; future archive surfaces just won't have the long-form
    // recap field. If you re-enable the wire, restore the read here.
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

    // Friday from the Monday: add 4 days. Same trick used in lib/weeklyResult.
    const [yy, mm, dd] = weekKey.split("-").map(Number);
    const weekEnd =
      yy && mm && dd
        ? (() => {
            const friday = new Date(Date.UTC(yy, mm - 1, dd + 4));
            const y = friday.getUTCFullYear();
            const m = String(friday.getUTCMonth() + 1).padStart(2, "0");
            const d = String(friday.getUTCDate()).padStart(2, "0");
            return `${y}-${m}-${d}`;
          })()
        : weekKey;

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
      // Hand the week-start baseline to the analyzer so it can compute
      // the week's biggest mover/dragger and force-comment on them.
      // Without this the featured cards (which are picked by week
      // change) can sit silent when their big move was earlier in the
      // week. Falls back to today-only commenting when the baseline is
      // missing or stale.
      const thisMonday = stockholmMondayOfWeek(new Date(now));
      const weekStartSnapshot = await getWeekStartSnapshot();
      const weekStartPrices =
        weekStartSnapshot && weekStartSnapshot.weekStart === thisMonday
          ? Object.fromEntries(
              weekStartSnapshot.stocks.map((s) => [
                s.ticker,
                s.regularMarketPrice,
              ]),
            )
          : undefined;

      console.log(
        `[trigger] AI run (${decision.reason})${weekStartPrices ? " + week-baseline" : ""}`,
      );
      analysis = await analyzeStocks(newPrices, weekStartPrices);
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

    const triggerNow = new Date();

    // Archive the Monday baseline once per week (no-op other days, or
    // on subsequent Monday triggers after the first one this week).
    // Runs BEFORE the briefs so a same-trigger morning brief on Monday
    // sees the baseline as fresh.
    await maybeArchiveWeekStart(saved, triggerNow);

    // Brief generation runs alongside the regular pipeline. Idempotent —
    // each brief stores a `date` (Stockholm tz) and won't regenerate if
    // today's already exists. Cron fires every 15 min in the brief windows
    // so this typically lands once per window per day.
    await maybeGenerateBriefs(saved, triggerNow);

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
