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

type Parts = { isWeekend: boolean; minutes: number };

function partsInStockholm(d: Date): Parts {
  const parts = stockholmTimeFormatter.formatToParts(d);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return {
    isWeekend: weekday === "Sat" || weekday === "Sun",
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
