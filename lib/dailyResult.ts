import { buildOwnersByPerson, PEOPLE, type Person } from "./tickers";
import type { DailyResult, StoredData } from "./types";

/**
 * Project today's snapshot down into the compact daily-archive shape.
 * Same simple-mean rule the live leaderboard uses for per-friend %.
 */
export function computeDailyResult(args: {
  snapshot: StoredData;
  date: string;
}): DailyResult {
  const { snapshot, date } = args;

  const stocks = snapshot.stocks
    .filter((s) => Number.isFinite(s.regularMarketPrice))
    .map((s) => ({
      ticker: s.ticker,
      name: s.name,
      currency: s.currency,
      close: s.regularMarketPrice,
      changePct: Number(s.regularMarketChangePercent.toFixed(2)),
    }));

  const ownersByPerson = buildOwnersByPerson();
  const stockChange = new Map(stocks.map((s) => [s.ticker, s.changePct]));

  const friends: DailyResult["friends"] = [];
  for (const [person, name] of Object.entries(PEOPLE) as [Person, string][]) {
    const tickers = ownersByPerson.get(person) ?? [];
    if (tickers.length === 0) continue;
    let sum = 0;
    let count = 0;
    for (const ticker of tickers) {
      const change = stockChange.get(ticker);
      if (change === undefined) continue;
      sum += change;
      count++;
    }
    if (count === 0) continue;
    friends.push({
      person,
      name,
      dayPct: Number((sum / count).toFixed(2)),
    });
  }

  return {
    date,
    capturedAt: Date.now(),
    stocks,
    friends,
    overallMood: snapshot.analysis.overallMood,
  };
}
