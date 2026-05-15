import type { WeeklyChampion as WeeklyChampionData } from "@/lib/types";

type Props = {
  champion: WeeklyChampionData;
};

const dateRangeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

function formatDateRange(weekStart: string, weekEnd: string): string {
  const fmt = (s: string): string | null => {
    const [y, m, d] = s.split("-").map(Number);
    if (!y || !m || !d) return null;
    return dateRangeFormatter
      .format(new Date(Date.UTC(y, m - 1, d)))
      .toUpperCase();
  };
  const left = fmt(weekStart);
  const right = fmt(weekEnd);
  if (!left || !right) return `${weekStart} → ${weekEnd}`;
  return `${left} → ${right}`;
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function WeeklyChampionCard({ champion }: Props) {
  return (
    <section className="weekly-champion">
      <header className="weekly-champion-header">
        <h2 className="weekly-champion-kind">👑 CHAMPION OF THE WEEK</h2>
        <span className="weekly-champion-range">
          {formatDateRange(champion.weekStart, champion.weekEnd)}
        </span>
      </header>
      <div className="weekly-champion-row">
        <div className="weekly-champion-identity">
          <span className="weekly-champion-name">
            {champion.name.toUpperCase()}
          </span>
          <span className="weekly-champion-wtd">
            {formatPct(champion.wtdPct)} WTD
          </span>
        </div>
      </div>
      <p className="weekly-champion-line">{champion.line}</p>
    </section>
  );
}
