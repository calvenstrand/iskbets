// Date helpers all rooted in Stockholm time — that's the reference clock for
// "what day is it" decisions (brief idempotency, market-open windows, etc.).

const stockholmDateFormatter = new Intl.DateTimeFormat("en-CA", {
  // en-CA gives YYYY-MM-DD ISO format from format()
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD in Stockholm time. Used as a stable "today" key for idempotency. */
export function stockholmDate(d: Date): string {
  return stockholmDateFormatter.format(d);
}

const stockholmTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Stockholm",
  weekday: "short",
  hour: "numeric",
  minute: "numeric",
  hour12: false,
});

type Parts = { isWeekend: boolean; weekday: string; minutes: number };

function partsInStockholm(d: Date): Parts {
  const parts = stockholmTimeFormatter.formatToParts(d);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return {
    isWeekend: weekday === "Sat" || weekday === "Sun",
    weekday,
    minutes: hour * 60 + minute,
  };
}

/** Window for the morning brief: 08:30 – 09:00 Stockholm time, weekdays. */
export function inMorningBriefWindow(d: Date): boolean {
  const { isWeekend, minutes } = partsInStockholm(d);
  if (isWeekend) return false;
  return minutes >= 8 * 60 + 30 && minutes < 9 * 60;
}

/** Window for the evening brief: 22:00 – 22:45 Stockholm time, weekdays.
 * NY closes at 22:00 CET (15-min gap to settle), then we have 30+ min to fire. */
export function inEveningBriefWindow(d: Date): boolean {
  const { isWeekend, minutes } = partsInStockholm(d);
  if (isWeekend) return false;
  return minutes >= 22 * 60 && minutes < 22 * 60 + 45;
}

/**
 * "Recap window" — the stretch of the week when looking back at last
 * week's action makes more sense than tracking today's. Spans from
 * Friday's NY close (22:00 STO) through to Monday's Stockholm open
 * (09:00 STO), covering the full Sat/Sun gap.
 *
 * Inside this window: featured cards say "WEEK'S BIGGEST WINNER",
 * the leaderboard + Champion of the Week card render, the WTD column
 * is meaningful.
 *
 * Outside (Mon 09:00 → Fri 22:00 STO): live trading is active
 * somewhere, "today" framing dominates, the leaderboard hides until
 * Friday close, the featured cards switch to "TODAY'S BIGGEST WINNER".
 */
export function inRecapWindow(d: Date): boolean {
  const { weekday, minutes } = partsInStockholm(d);
  if (weekday === "Sat" || weekday === "Sun") return true;
  // Friday after NY close (22:00 STO) — whole portfolio done for the week.
  if (weekday === "Fri" && minutes >= 22 * 60) return true;
  // Monday before Stockholm opens (09:00 STO) — week hasn't started yet.
  if (weekday === "Mon" && minutes < 9 * 60) return true;
  return false;
}

/** Window for the Weekend Wire: Friday 22:45 – 23:30 Stockholm time.
 * Fires immediately after the evening wrap window closes — same "after
 * the bell" energy but for the whole week. Cron runs every 15 min so
 * the window catches multiple fires in both DST modes. */
export function inWeekendWireWindow(d: Date): boolean {
  const { weekday, minutes } = partsInStockholm(d);
  if (weekday !== "Fri") return false;
  return minutes >= 22 * 60 + 45 && minutes < 23 * 60 + 30;
}

/** Returns YYYY-MM-DD of the Monday in the same Stockholm week as `d`.
 * Used as the idempotency key for both the weekStart snapshot and the
 * Weekend Wire — every brief / archive in week W shares the same value. */
export function stockholmMondayOfWeek(d: Date): string {
  // Map Stockholm weekday name → 0=Mon..6=Sun offset.
  const offsetByDay: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  const { weekday } = partsInStockholm(d);
  const offset = offsetByDay[weekday] ?? 0;
  // Subtract whole UTC days. We then re-derive the Stockholm calendar
  // date from the shifted instant — DST shifts of ±1h never push the
  // calendar date past the resulting day boundary in Stockholm, so this
  // is safe across spring-forward / fall-back.
  const shifted = new Date(d.getTime() - offset * 86_400_000);
  return stockholmDate(shifted);
}
