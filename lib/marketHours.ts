export type Status = "OPEN" | "CLOSED" | "PRE-MARKET";

function partsFor(now: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const isWeekend = weekday === "Sat" || weekday === "Sun";
  return { isWeekend, minutes: hour * 60 + minute };
}

export function stockholmStatus(now: Date): Status {
  const { isWeekend, minutes } = partsFor(now, "Europe/Stockholm");
  if (isWeekend) return "CLOSED";
  // 09:00 - 17:30 local time
  if (minutes >= 9 * 60 && minutes < 17 * 60 + 30) return "OPEN";
  return "CLOSED";
}

export function newYorkStatus(now: Date): Status {
  const { isWeekend, minutes } = partsFor(now, "America/New_York");
  if (isWeekend) return "CLOSED";
  // Regular: 09:30 - 16:00 ET
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return "OPEN";
  // Pre-market: 04:00 - 09:30 ET
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "PRE-MARKET";
  return "CLOSED";
}

export function londonStatus(now: Date): Status {
  const { isWeekend, minutes } = partsFor(now, "Europe/London");
  if (isWeekend) return "CLOSED";
  // 08:00 - 16:30 local time
  if (minutes >= 8 * 60 && minutes < 16 * 60 + 30) return "OPEN";
  return "CLOSED";
}

export function tokyoStatus(now: Date): Status {
  const { isWeekend, minutes } = partsFor(now, "Asia/Tokyo");
  if (isWeekend) return "CLOSED";
  // 09:00 - 11:30 morning, 12:30 - 15:00 afternoon (lunch break in between)
  if (minutes >= 9 * 60 && minutes < 11 * 60 + 30) return "OPEN";
  if (minutes >= 12 * 60 + 30 && minutes < 15 * 60) return "OPEN";
  return "CLOSED";
}

export function hongKongStatus(now: Date): Status {
  const { isWeekend, minutes } = partsFor(now, "Asia/Hong_Kong");
  if (isWeekend) return "CLOSED";
  // 09:30 - 12:00 morning, 13:00 - 16:00 afternoon (lunch break in between)
  if (minutes >= 9 * 60 + 30 && minutes < 12 * 60) return "OPEN";
  if (minutes >= 13 * 60 && minutes < 16 * 60) return "OPEN";
  return "CLOSED";
}

/**
 * Whether a market is in its "live data" window — open for trading or
 * within ~30 min of close (so the closing print gets captured by the
 * cron). Outside this window, prices are static and re-fetching just
 * burns API calls. Used by fetchPrices to decide which tickers to skip
 * (and reuse their cached price).
 */
export function isMarketLive(market: "SE" | "US", now: Date): boolean {
  if (market === "SE") {
    const { isWeekend, minutes } = partsFor(now, "Europe/Stockholm");
    if (isWeekend) return false;
    // 09:00 open → 18:00 (= 17:30 close + 30 min buffer)
    return minutes >= 9 * 60 && minutes < 18 * 60;
  }
  // US — Finnhub free returns real-time during regular + pre-market
  const { isWeekend, minutes } = partsFor(now, "America/New_York");
  if (isWeekend) return false;
  // 04:00 pre-market open → 16:30 (= 16:00 close + 30 min buffer)
  return minutes >= 4 * 60 && minutes < 16 * 60 + 30;
}

export function pipClass(s: Status): string {
  if (s === "OPEN") return "market-pip open";
  if (s === "PRE-MARKET") return "market-pip pre";
  return "market-pip closed";
}

export function statusClass(s: Status): string {
  if (s === "OPEN") return "market-status-open";
  if (s === "PRE-MARKET") return "market-status-pre";
  return "market-status-closed";
}
