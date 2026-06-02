import type { StockPrice } from "./types";

export type AIDecision = { rerun: boolean; reason: string };

// ============== Per-ticker COMMENTS gating (Haiku) ==============
//
// Prices refresh on every trigger; the comments call only runs when
// something genuinely changed (or enough time has passed).
//
// Floor history:
//   29 → 44 min (May 2026): bumped to cut daily Anthropic spend ~35%
//     ($0.70 → $0.46 weekday baseline).
//   44 → 59 min (May 2026): another ~25-30% cut. Friday spikes back up
//     because the Weekend Wire + Weekly Champion both fire that night;
//     this floor mostly affects Mon-Thu.
//
// 59 (not 60) for jitter margin. Cron ticks at :03 :13 :23 :33 :43 :53
// — so the "60 min since last AI" mark lands EXACTLY when the next
// eligible tick fires. Vercel processing jitter can put `elapsed` at
// 59:59.x and fail the floor check, slipping AI to the +10-min tick
// (effectively giving us a 70-min cadence). 59-min floor + 10-min cron
// → reliable triggering at the intended tick.
const AI_FLOOR_MS = 59 * 60 * 1000;
const AI_CEILING_MS = 4 * 60 * 60 * 1000;
// Delta threshold raised 1.0 → 2.0 (May 2026) after observing weekday
// cost stuck at ~$0.56 even with the 59-min floor: on volatile weeks
// the delta trigger fired on nearly every 59-min tick because 1pp
// moves are common. 2pp is rare enough to be a real news event but
// cuts delta-driven calls roughly in half on choppy days.
const SIGNIFICANT_DELTA_PCT = 2.0;

/**
 * Should the per-ticker COMMENTS call (Haiku) fire this trigger?
 * Renamed from the old shouldRerunAI when the mood line split out into
 * a separate Sonnet call (lib/generateMood.ts) with its own cadence.
 */
export function shouldRerunComments(
  newPrices: StockPrice[],
  baseline: StockPrice[] | undefined,
  analyzedAt: number | undefined,
  now: number,
): AIDecision {
  if (!analyzedAt || !baseline) {
    return { rerun: true, reason: "no prior comments" };
  }
  const elapsed = now - analyzedAt;
  if (elapsed > AI_CEILING_MS) {
    const hrs = (elapsed / 3_600_000).toFixed(1);
    return { rerun: true, reason: `${hrs}h since last comments (>4h ceiling)` };
  }
  if (elapsed < AI_FLOOR_MS) {
    const min = Math.round(elapsed / 60_000);
    const floorMin = Math.round(AI_FLOOR_MS / 60_000);
    return {
      rerun: false,
      reason: `${min}min since last comments (<${floorMin}min floor)`,
    };
  }
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
      reason: `${maxTicker} moved ${maxDelta.toFixed(2)}pp since last comments`,
    };
  }
  return {
    rerun: false,
    reason: `max delta ${maxDelta.toFixed(2)}pp (<${SIGNIFICANT_DELTA_PCT}pp)`,
  };
}

// ============== MOOD gating (Sonnet) ==============
//
// Mood-only gating thresholds. The mood line refreshes less often than
// per-ticker comments — it's a portfolio-wide vibe, not per-ticker
// commentary, so its cadence is event-driven (Stockholm checkpoints)
// rather than tick-driven. Sonnet is pricier than Haiku, so this also
// keeps the cost dimension small.
const MOOD_FLOOR_MS = 89 * 60 * 1000; // ~90 min (jitter margin like AI_FLOOR_MS)
const MOOD_DELTA_PCT = 4.0; // bigger move required than comments (2pp)
// No freshness ceiling for the mood — the daily Stockholm checkpoints
// (below) already cap the longest in-day stretch at ~6.5h (09:30 →
// 16:00). Overnight (22:00 → next morning) the mood describes
// yesterday's close, which is appropriate framing until the next
// 09:30 checkpoint fires. A ceiling would just pre-empt those
// checkpoints with a duplicate Sonnet call.

// Stockholm-time daily mood checkpoints, expressed as minutes-of-day.
// On each cron tick (weekday only) we check whether the current STO
// time has crossed one of these since the last mood was generated — if
// so, refresh. Filters out opening-auction noise (SE opens 09:00 but
// we wait 30 min for it to settle) and ties the mood cadence to the
// moments the framing genuinely shifts.
//   09:30 STO — SE settled; first mood of the day.
//   16:00 STO — NY settled (opens 15:30 + 30 min); framing flips to "both live".
//   22:00 STO — NY close; end-of-day mood captures the close.
export const MOOD_CHECKPOINTS_STO_MIN = [
  9 * 60 + 30,
  16 * 60,
  22 * 60,
] as const;

function stockholmMinutesOfDay(d: Date): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

function stockholmDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
  }).format(d);
}

function stockholmIsWeekday(d: Date): boolean {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Stockholm",
    weekday: "short",
  }).format(d);
  return wd !== "Sat" && wd !== "Sun";
}

/**
 * Should the MOOD call (Sonnet) fire this trigger? Mood updates less
 * often than per-ticker comments — its job is the portfolio headline,
 * which doesn't usefully change every hour on a flat day.
 *
 * Triggers, in priority order:
 *  1. First-ever mood, gated to past the 09:30 STO weekday checkpoint
 *     so the very first mood of a deploy isn't from a pre-market thin
 *     print.
 *  2. Skip outright on weekends — the dashboard hides the mood banner
 *     during the recap window (Fri 22:00 → Mon 09:00 STO), so a fresh
 *     mood would never render. Mood from Friday persists.
 *  3. < 90min since last mood (floor — prevents rapid-fire refreshes
 *     even on a volatile day).
 *  4. Crossed a daily Stockholm checkpoint (09:30 / 16:00 / 22:00) we
 *     haven't already covered — these are the moments the mood framing
 *     genuinely shifts (SE just settled / NY just settled / NY close).
 *  5. Backstop: > 4pp single-ticker delta since the mood baseline
 *     captured the portfolio.
 */
export function shouldRerunMood(
  newPrices: StockPrice[],
  baseline: StockPrice[] | undefined,
  moodGeneratedAt: number | undefined,
  now: number,
): AIDecision {
  const nowD = new Date(now);
  const isWeekday = stockholmIsWeekday(nowD);

  // First-ever mood: gate to past the first daily checkpoint on a weekday.
  if (!moodGeneratedAt || !baseline) {
    if (!isWeekday) {
      return {
        rerun: false,
        reason: "weekend — no first mood yet, wait for Mon",
      };
    }
    if (stockholmMinutesOfDay(nowD) < MOOD_CHECKPOINTS_STO_MIN[0]) {
      return {
        rerun: false,
        reason: "before 09:30 STO — wait for SE to settle",
      };
    }
    return {
      rerun: true,
      reason: "no prior mood (past first daily checkpoint)",
    };
  }

  // Weekends: never refresh mood. Friday's last mood carries through
  // the recap window; the dashboard hides the banner anyway.
  if (!isWeekday) {
    return { rerun: false, reason: "weekend — mood banner hidden, no refresh" };
  }

  const elapsed = now - moodGeneratedAt;
  if (elapsed < MOOD_FLOOR_MS) {
    const min = Math.round(elapsed / 60_000);
    return { rerun: false, reason: `${min}min since last mood (<90min floor)` };
  }

  // Crossed a daily checkpoint?
  const lastD = new Date(moodGeneratedAt);
  const nowMin = stockholmMinutesOfDay(nowD);
  const lastMin = stockholmMinutesOfDay(lastD);
  const sameDay = stockholmDateKey(nowD) === stockholmDateKey(lastD);
  if (!sameDay) {
    // New STO day — fire if past the first checkpoint, regardless of delta.
    if (nowMin >= MOOD_CHECKPOINTS_STO_MIN[0]) {
      return { rerun: true, reason: "first 09:30 STO checkpoint of a new day" };
    }
  } else {
    for (const cp of MOOD_CHECKPOINTS_STO_MIN) {
      if (lastMin < cp && nowMin >= cp) {
        const hh = Math.floor(cp / 60).toString().padStart(2, "0");
        const mm = (cp % 60).toString().padStart(2, "0");
        return { rerun: true, reason: `crossed ${hh}:${mm} STO checkpoint` };
      }
    }
  }

  // Delta backstop: a big intraday move overrides the checkpoint cadence.
  const baselineByTicker = new Map(baseline.map((p) => [p.ticker, p]));
  let maxDelta = 0;
  let maxTicker = "";
  for (const newP of newPrices) {
    const oldP = baselineByTicker.get(newP.ticker);
    if (!oldP) continue;
    const delta = Math.abs(
      newP.regularMarketChangePercent - oldP.regularMarketChangePercent,
    );
    if (delta > maxDelta) {
      maxDelta = delta;
      maxTicker = newP.ticker;
    }
  }
  if (maxDelta > MOOD_DELTA_PCT) {
    return {
      rerun: true,
      reason: `${maxTicker} moved ${maxDelta.toFixed(2)}pp since last mood (>${MOOD_DELTA_PCT}pp)`,
    };
  }

  return {
    rerun: false,
    reason: `no checkpoint crossed, max delta ${maxDelta.toFixed(2)}pp`,
  };
}
