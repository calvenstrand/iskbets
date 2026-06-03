import { buildOwnersByPerson, PEOPLE, type Person } from "./tickers";
import type { StoredData, WeeklyResult, WeekStartSnapshot } from "./types";

/** Add 4 days to a Stockholm-date YYYY-MM-DD to get that week's Friday. */
export function fridayFromMonday(monday: string): string {
  const [y, m, d] = monday.split("-").map(Number);
  if (!y || !m || !d) return monday;
  // Construct as UTC date (date-only, no tz drama), add 4 days, format back.
  const friday = new Date(Date.UTC(y, m - 1, d + 4));
  const yy = friday.getUTCFullYear();
  const mm = String(friday.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(friday.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Project Friday's snapshot + Monday's baseline into a compact, archival
 * shape. Same per-stock weekChange math the Weekly Champion call feeds
 * into Claude + the same per-friend WTD math the leaderboard renders,
 * frozen for the historical record.
 */
export function computeWeeklyResult(args: {
  fridaySnapshot: StoredData;
  weekStart: WeekStartSnapshot;
}): WeeklyResult {
  const { fridaySnapshot, weekStart } = args;

  const baselineByTicker = new Map(
    weekStart.stocks.map((s) => [s.ticker, s.regularMarketPrice]),
  );

  const stocks = fridaySnapshot.stocks
    .map((s) => {
      const baseline = baselineByTicker.get(s.ticker);
      if (!baseline || baseline <= 0) return null;
      return {
        ticker: s.ticker,
        name: s.name,
        currency: s.currency,
        fridayClose: s.regularMarketPrice,
        weekChangePct: Number(
          (((s.regularMarketPrice - baseline) / baseline) * 100).toFixed(2),
        ),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const ownersByPerson = buildOwnersByPerson();

  const stockWeekChange = new Map(
    stocks.map((s) => [s.ticker, s.weekChangePct]),
  );

  const friends: WeeklyResult["friends"] = [];
  for (const [person, name] of Object.entries(PEOPLE) as [Person, string][]) {
    const tickers = ownersByPerson.get(person) ?? [];
    if (tickers.length === 0) continue;
    let sum = 0;
    let count = 0;
    for (const ticker of tickers) {
      const change = stockWeekChange.get(ticker);
      if (change === undefined) continue;
      sum += change;
      count++;
    }
    if (count === 0) continue;
    friends.push({
      person,
      name,
      tickers,
      wtdPct: Number((sum / count).toFixed(2)),
    });
  }

  return {
    weekStart: weekStart.weekStart,
    weekEnd: fridayFromMonday(weekStart.weekStart),
    capturedAt: Date.now(),
    stocks,
    friends,
    overallMood: fridaySnapshot.analysis.overallMood,
  };
}
