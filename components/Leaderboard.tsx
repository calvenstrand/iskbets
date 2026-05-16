import { deriveSentiment } from "@/lib/derive";
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
  /** Fri 22:00 → Mon 09:00 STO. When true the leaderboard becomes a
   * week-recap surface:
   *   - sort by WTD instead of today
   *   - drop the TODAY column (markets are closed, today% would be
   *     yesterday's close masquerading as live data)
   *   - drop the standalone champion hero card — the WeeklyChampionCard
   *     above already owns the "winner spotlight" role, so #1 here
   *     just gets the same challenger treatment as everyone else
   *   - top/bottom mover row pivots to week-based per-friend movers
   *   - header relabels FRIEND LEADERBOARD → WEEK STANDINGS
   */
  recapMode?: boolean;
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

export function Leaderboard({ stocks, weekStartPrices, recapMode }: Props) {
  const entries = computeLeaderboard(
    stocks,
    weekStartPrices,
    recapMode ? { sortBy: "wtd" } : undefined,
  );
  if (entries.length === 0) return null;

  const showWtd = entries.some((e) => e.wtdPct !== null);

  // Recap mode: no champion hero, all entries get the challenger
  // treatment so the gold weekly-champion card above stays the
  // unambiguous "winner spotlight". Outside recap: champion hero #1,
  // challengers from #2 onward.
  const championEntry = !recapMode ? entries[0] : undefined;
  const challengerEntries = !recapMode ? entries.slice(1) : entries;
  if (!recapMode && !championEntry) return null;

  return (
    <section className="leaderboard">
      <header className="leaderboard-header">
        <h2 className="leaderboard-kind">
          {recapMode ? "WEEK STANDINGS" : "FRIEND LEADERBOARD"}
        </h2>
        <span className="leaderboard-meta">
          {recapMode
            ? "WEEK · RANKED"
            : showWtd
              ? "TODAY · WEEK-TO-DATE"
              : "TODAY"}
        </span>
      </header>

      {championEntry && (
        <ChampionCard entry={championEntry} showWtd={showWtd} />
      )}

      {challengerEntries.length > 0 && (
        <div className="leaderboard-grid">
          {challengerEntries.map((e, i) => (
            <ChallengerCard
              key={e.person}
              entry={e}
              rank={recapMode ? i + 1 : i + 2}
              showWtd={showWtd}
              recapMode={recapMode}
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
      <ImpactRow
        topMover={entry.topMover}
        bottomMover={entry.bottomMover}
      />
    </article>
  );
}

function ChallengerCard({
  entry,
  rank,
  showWtd,
  recapMode,
}: {
  entry: LeaderboardEntry;
  rank: number;
  showWtd: boolean;
  recapMode?: boolean;
}) {
  const todayClass = pctClass(entry.todayPct);
  const wtdClass = pctClass(entry.wtdPct);
  // In recap mode the TODAY column would be Friday's close labelled as
  // live data — drop it, and swap the mover row to week-based.
  const showToday = !recapMode;
  // Tint the whole card by WTD performance during the recap window so
  // the standings read at a glance — same 5-tier scale as the stock
  // cards (moon/up/neutral/down/rekt). Reuses the .glow-* classes for
  // visual consistency across the app. Null wtdPct → neutral so cards
  // without a baseline don't get a misleading color.
  const cardClass = recapMode
    ? `leader-card glow-${deriveSentiment(entry.wtdPct ?? 0)}`
    : "leader-card";
  return (
    <article className={cardClass}>
      <div className="leader-row">
        <span className="leader-rank">#{rank}</span>
        <span className="leader-name">{entry.name.toUpperCase()}</span>
        <span className="leader-count">{entry.tickers.length} picks</span>
      </div>
      <div className="leader-stats">
        {showToday && (
          <div className="leader-stat">
            <span className="leader-stat-label">TODAY</span>
            <span className={`leader-stat-value ${todayClass}`}>
              {formatPct(entry.todayPct)}
            </span>
          </div>
        )}
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
        topMover={recapMode ? entry.topWeekMover : entry.topMover}
        bottomMover={recapMode ? entry.bottomWeekMover : entry.bottomMover}
      />
    </article>
  );
}
