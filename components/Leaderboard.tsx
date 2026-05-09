import {
  computeLeaderboard,
  type LeaderboardEntry,
  type Mover,
} from "@/lib/leaderboard";
import { displayTicker } from "@/lib/tickers";
import type { StockPrice } from "@/lib/types";

type Props = {
  stocks: StockPrice[];
  weekStartPrices?: Record<string, number>;
  /** The friend who was #1 at the time of the last AI run. Used to gate
   * `championLine` — if the live leaderboard's #1 doesn't match, the line
   * is suppressed (we don't want to render Chris's line over Eric's name). */
  championPerson?: string;
  /** WSB one-liner about whoever was champion at AI time. */
  championLine?: string;
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

/** Top + bottom mover row. Renders as "▲ NVDA +6.80%   ▼ DICOT -12.50%".
 * Hides individually when missing; suppresses the bottom slot when it
 * would duplicate the top (a friend with only one owned ticker). */
function ImpactRow({
  topMover,
  bottomMover,
}: {
  topMover?: Mover;
  bottomMover?: Mover;
}) {
  const showBottom =
    bottomMover && (!topMover || bottomMover.ticker !== topMover.ticker);
  if (!topMover && !showBottom) return null;
  return (
    <div className="leader-impact">
      {topMover && (
        <span className={`leader-impact-cell ${pctClass(topMover.pct)}`}>
          ▲ {displayTicker(topMover.ticker)} {formatPct(topMover.pct)}
        </span>
      )}
      {showBottom && bottomMover && (
        <span className={`leader-impact-cell ${pctClass(bottomMover.pct)}`}>
          ▼ {displayTicker(bottomMover.ticker)} {formatPct(bottomMover.pct)}
        </span>
      )}
    </div>
  );
}

export function Leaderboard({
  stocks,
  weekStartPrices,
  championPerson,
  championLine,
}: Props) {
  const entries = computeLeaderboard(stocks, weekStartPrices);
  if (entries.length === 0) return null;

  const showWtd = entries.some((e) => e.wtdPct !== null);
  const champion = entries[0];
  if (!champion) return null;
  const challengers = entries.slice(1);

  // Only show the AI line if the person it was written for is still #1.
  // Otherwise it's stale (Eric overtook Chris between AI runs) — suppress
  // rather than mislead.
  const liveChampionLine =
    championLine && championPerson === champion.person ? championLine : null;

  return (
    <section className="leaderboard">
      <header className="leaderboard-header">
        <span className="leaderboard-kind">FRIEND LEADERBOARD</span>
        <span className="leaderboard-meta">
          {showWtd ? "TODAY · WEEK-TO-DATE" : "TODAY"}
        </span>
      </header>

      <ChampionCard
        entry={champion}
        showWtd={showWtd}
        championLine={liveChampionLine}
      />

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
  championLine,
}: {
  entry: LeaderboardEntry;
  showWtd: boolean;
  championLine: string | null;
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
      <ImpactRow
        topMover={entry.topMover}
        bottomMover={entry.bottomMover}
      />
      {championLine && (
        <p className="leader-champion-quote">&ldquo;{championLine}&rdquo;</p>
      )}
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
      <ImpactRow
        topMover={entry.topMover}
        bottomMover={entry.bottomMover}
      />
    </article>
  );
}
