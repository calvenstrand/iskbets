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
