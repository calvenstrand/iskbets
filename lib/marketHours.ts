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
 * Whether a market has opened at any point during the current Stockholm
 * calendar day. Used by the Dashboard's TODAY winner/loser pick — a US
 * stock sitting at +1.8% from Friday's close shouldn't beat a Stockholm
 * stock that's actually moving today.
 *
 * Both checks key off the Stockholm clock so "today" means the same
 * thing as everywhere else in the app. NY's 09:30 ET open is always
 * 15:30 STO regardless of DST (both regions transition the same
 * weekend in the same direction).
 */
export function marketHasOpenedToday(
  market: "SE" | "US",
  now: Date,
): boolean {
  const { isWeekend, minutes } = partsFor(now, "Europe/Stockholm");
  if (isWeekend) return false;
  if (market === "SE") return minutes >= 9 * 60;
  // US opens 09:30 ET = 15:30 STO (winter and summer alike).
  return minutes >= 15 * 60 + 30;
}

/**
 * Strict regular-trading-session check. True only during the official
 * orderbook hours, NOT pre-market or post-market.
 *
 * Used by analyzeStocks to set the `marketLive` flag we pass to Claude.
 * Claude treats marketLive=true as "this number reflects today's
 * intraday move". Pre-market quotes from Finnhub on thin volume can
 * print absurd values (e.g. -23% on a single small order that
 * disappears within minutes) — calling those "today's move" leads to
 * embarrassing AI commentary. Confining marketLive to regular hours
 * means pre-market data falls under the prompt's "frozen from last
 * session" rule and Claude stays appropriately conservative.
 *
 * Distinct from isMarketLive (below) which is intentionally broader so
 * fetchPrices can capture the closing print + any actual pre-market
 * action without trusting it as "today's intraday".
 */
export function isMarketInRegularSession(
  market: "SE" | "US",
  now: Date,
): boolean {
  if (market === "SE") {
    const { isWeekend, minutes } = partsFor(now, "Europe/Stockholm");
    if (isWeekend) return false;
    return minutes >= 9 * 60 && minutes < 17 * 60 + 30;
  }
  const { isWeekend, minutes } = partsFor(now, "America/New_York");
  if (isWeekend) return false;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

/**
 * Whether a market is in its "live data" window — open for trading,
 * including pre-market for US, or within ~30 min of close (so the
 * closing print gets captured by the cron). Outside this window,
 * prices are static and re-fetching just burns API calls. Used by
 * fetchPrices to decide which tickers to skip (and reuse their cached
 * price).
 *
 * NOTE: this is broader than isMarketInRegularSession on purpose. We
 * want to FETCH during pre-market in case a genuine event-driven
 * pre-market move happens, but the analyzer should NOT treat that
 * data as authoritative "today's intraday". See isMarketInRegularSession
 * for the stricter check used in AI commentary.
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
