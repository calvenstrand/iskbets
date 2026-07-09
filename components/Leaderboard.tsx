import type { CSSProperties } from "react";
import { deriveSentiment, moodVar } from "@/lib/derive";
import {
  computeLeaderboard,
  type LeaderboardEntry,
  type Mover,
} from "@/lib/leaderboard";
import { displayTicker } from "@/lib/tickers";
import type { StockPrice } from "@/lib/types";

type Scope = "day" | "week";

type Props = {
  stocks: StockPrice[];
  weekStartPrices?: Record<string, number>;
  /** "day" (default) = always-on weekday standings, ranked by today's
   * portfolio move (stale tickers filtered via `now`), champion #1 gets
   * the gold hero. "week" = the recap-window surface (Fri 22:00 → Mon
   * 09:00 STO): ranked by WTD, TODAY column dropped (it would be
   * yesterday's close masquerading as live), no champion hero (the
   * WeeklyChampionCard above already owns that spotlight), movers pivot
   * to week-based, header relabels to WEEK STANDINGS. */
  scope?: Scope;
  /** Server-seeded `now` — required in day scope so the stale filter
   * (and thus first render) matches the server. Ignored in week scope. */
  now?: Date;
  /** When nested inside the card section (day scope below the featured
   * pair), drop the standalone horizontal padding so it lines up with
   * the featured cards + grid instead of double-indenting. */
  inline?: boolean;
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

/** Full 5-tier mood-family color for the payoff line — moon/up/neutral/
 * down/rekt — so the best/worst movers read on the same scale as the
 * stock cards (and re-point under the bloodbath skin). */
function moodTextClass(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "mood-text-flat";
  return `mood-text-${deriveSentiment(value)}`;
}

/** Top + bottom mover row — the "what did this to you" line. Renders as
 * "▲ NVDA +6.80%   ▼ DICOT -12.50%" in mood-family colors. Hides
 * individually when missing; suppresses the bottom slot when it would
 * duplicate the top (a friend with only one owned ticker with data). */
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
        <span className={`leader-impact-cell ${moodTextClass(topMover.pct)}`}>
          ▲ {displayTicker(topMover.ticker)} {formatPct(topMover.pct)}
        </span>
      )}
      {showBottom && bottomMover && (
        <span className={`leader-impact-cell ${moodTextClass(bottomMover.pct)}`}>
          ▼ {displayTicker(bottomMover.ticker)} {formatPct(bottomMover.pct)}
        </span>
      )}
    </div>
  );
}

export function Leaderboard({
  stocks,
  weekStartPrices,
  scope = "day",
  now,
  inline,
}: Props) {
  const isWeek = scope === "week";
  const entries = computeLeaderboard(
    stocks,
    weekStartPrices,
    isWeek ? { sortBy: "wtd" } : { now },
  );
  if (entries.length === 0) return null;

  const showWtd = entries.some((e) => e.wtdPct !== null);

  // Week scope: no champion hero, all entries get the challenger
  // treatment so the gold weekly-champion card above stays the
  // unambiguous "winner spotlight". Day scope: champion hero #1,
  // challengers from #2 onward.
  const championEntry = !isWeek ? entries[0] : undefined;
  const challengerEntries = !isWeek ? entries.slice(1) : entries;
  if (!isWeek && !championEntry) return null;

  const sectionClass = ["leaderboard", inline ? "leaderboard-inline" : null]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={sectionClass}>
      <header className="leaderboard-header">
        <h2 className="leaderboard-kind">
          {isWeek ? "WEEK STANDINGS" : "FRIEND LEADERBOARD"}
        </h2>
        <span className="leaderboard-meta">
          {isWeek
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
              rank={isWeek ? i + 1 : i + 2}
              showWtd={showWtd}
              isWeek={isWeek}
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
  isWeek,
}: {
  entry: LeaderboardEntry;
  rank: number;
  showWtd: boolean;
  isWeek: boolean;
}) {
  const todayClass = pctClass(entry.todayPct);
  const wtdClass = pctClass(entry.wtdPct);
  // In week scope the TODAY column would be Friday's close labelled as
  // live data — drop it, and swap the mover row to week-based.
  const showToday = !isWeek;
  // Left spine tinted by the scope's score so the standings read at a
  // glance — same --mood family + deriveSentiment scale as the stock
  // cards. Null/NaN score → neutral so a friend without data doesn't get
  // a misleading color.
  const score = isWeek ? entry.wtdPct : entry.todayPct;
  const style = {
    "--mood": moodVar(deriveSentiment(score ?? NaN)),
  } as CSSProperties;
  return (
    <article className="leader-card" style={style}>
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
        topMover={isWeek ? entry.topWeekMover : entry.topMover}
        bottomMover={isWeek ? entry.bottomWeekMover : entry.bottomMover}
      />
    </article>
  );
}
