import { computeLeaderboard, type LeaderboardEntry } from "@/lib/leaderboard";
import type { StockPrice } from "@/lib/types";

type Props = {
  stocks: StockPrice[];
  weekStartPrices?: Record<string, number>;
};

function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function pctClass(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "leader-flat";
  if (value > 0) return "leader-up";
  if (value < 0) return "leader-down";
  return "leader-flat";
}

function rankBadge(index: number): string {
  if (index === 0) return "#1";
  return `#${index + 1}`;
}

export function Leaderboard({ stocks, weekStartPrices }: Props) {
  const entries = computeLeaderboard(stocks, weekStartPrices);
  if (entries.length === 0) return null;

  const showWtd = entries.some((e) => e.wtdPct !== null);

  return (
    <section className="leaderboard">
      <header className="leaderboard-header">
        <span className="leaderboard-kind">FRIEND LEADERBOARD</span>
        <span className="leaderboard-meta">
          {showWtd ? "TODAY · WEEK-TO-DATE" : "TODAY"}
        </span>
      </header>
      <div className="leaderboard-grid">
        {entries.map((e, i) => (
          <LeaderboardCard key={e.person} entry={e} rank={i} showWtd={showWtd} />
        ))}
      </div>
    </section>
  );
}

function LeaderboardCard({
  entry,
  rank,
  showWtd,
}: {
  entry: LeaderboardEntry;
  rank: number;
  showWtd: boolean;
}) {
  const todayClass = pctClass(entry.todayPct);
  const wtdClass = pctClass(entry.wtdPct);
  return (
    <article className={`leader-card ${rank === 0 ? "leader-top" : ""}`}>
      <div className="leader-row">
        <span className="leader-rank">{rankBadge(rank)}</span>
        <span className="leader-name">{entry.name.toUpperCase()}</span>
        <span className="leader-count">{entry.tickers.length} picks</span>
      </div>
      <div className="leader-stats">
        <div className="leader-stat">
          <span className="leader-stat-label">TODAY</span>
          <span className={`leader-stat-value ${todayClass}`}>
            {formatPct(entry.todayPct)}
          </span>
        </div>
        {showWtd && (
          <div className="leader-stat">
            <span className="leader-stat-label">WTD</span>
            <span className={`leader-stat-value ${wtdClass}`}>
              {formatPct(entry.wtdPct)}
            </span>
          </div>
        )}
      </div>
    </article>
  );
}
