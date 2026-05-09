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

export function Leaderboard({ stocks, weekStartPrices }: Props) {
  const entries = computeLeaderboard(stocks, weekStartPrices);
  if (entries.length === 0) return null;

  const showWtd = entries.some((e) => e.wtdPct !== null);
  const champion = entries[0];
  if (!champion) return null;
  const challengers = entries.slice(1);

  return (
    <section className="leaderboard">
      <header className="leaderboard-header">
        <span className="leaderboard-kind">FRIEND LEADERBOARD</span>
        <span className="leaderboard-meta">
          {showWtd ? "TODAY · WEEK-TO-DATE" : "TODAY"}
        </span>
      </header>

      <ChampionCard entry={champion} showWtd={showWtd} />

      {challengers.length > 0 && (
        <div className="leaderboard-grid">
          {challengers.map((e, i) => (
            <ChallengerCard
              key={e.person}
              entry={e}
              rank={i + 2}
              showWtd={showWtd}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ChampionCard({
  entry,
  showWtd,
}: {
  entry: LeaderboardEntry;
  showWtd: boolean;
}) {
  const todayClass = pctClass(entry.todayPct);
  const wtdClass = pctClass(entry.wtdPct);
  return (
    <article className="leader-champion">
      <div className="leader-champion-badge">👑 LEADER</div>
      <div className="leader-champion-row">
        <div className="leader-champion-identity">
          <span className="leader-champion-rank">#1</span>
          <span className="leader-champion-name">
            {entry.name.toUpperCase()}
          </span>
          <span className="leader-champion-count">
            {entry.tickers.length} picks
          </span>
        </div>
        <div className="leader-champion-stats">
          <div className="leader-champion-stat">
            <span className="leader-stat-label">TODAY</span>
            <span className={`leader-champion-value ${todayClass}`}>
              {formatPct(entry.todayPct)}
            </span>
          </div>
          {showWtd && (
            <div className="leader-champion-stat">
              <span className="leader-stat-label">WTD</span>
              <span className={`leader-champion-value ${wtdClass}`}>
                {formatPct(entry.wtdPct)}
              </span>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function ChallengerCard({
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
    <article className="leader-card">
      <div className="leader-row">
        <span className="leader-rank">#{rank}</span>
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
