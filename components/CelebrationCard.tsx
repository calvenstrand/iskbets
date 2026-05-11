type CelebrationKind = "clean-sweep" | "bloodbath";
type Scope = "day" | "week";

type Props = {
  kind: CelebrationKind;
  /** Total opened-today (or week-baseline-eligible) stocks counted. */
  count: number;
  /** Mean change% across the counted stocks. Sign matches `kind`:
   * positive for clean-sweep, negative for bloodbath. */
  avgPct: number;
  /** Drives the headline timeframe text. */
  scope: Scope;
};

const KIND_LABEL: Record<CelebrationKind, string> = {
  "clean-sweep": "💎 CLEAN SWEEP",
  bloodbath: "🩸 BLOODBATH",
};

const KIND_HEADLINE: Record<CelebrationKind, string> = {
  "clean-sweep": "0 RED CARDS",
  bloodbath: "0 GREEN CARDS",
};

const KIND_SUBTITLE: Record<CelebrationKind, string> = {
  "clean-sweep": "Diamond hands across the portfolio. Everybody eats.",
  bloodbath: "Every card bleeding. No survivors.",
};

function formatAvg(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * Drop-in replacement for a featured StockCard slot when there's no
 * actual loser to show (or no winner to show, in the inverse case).
 * Sits in the .stock-grid-featured grid so it occupies the same
 * footprint as the StockCard it's replacing.
 *
 * Triggers — see `detectSweep` in lib/leaderboard.ts:
 *   clean-sweep: every opened-today stock is positive → swap the
 *                LOSER slot for this card.
 *   bloodbath:   every opened-today stock is negative → swap the
 *                WINNER slot for this card.
 *
 * During the recap window (Fri 22:00 → Mon 09:00 STO), the
 * Dashboard passes scope="week" and uses week-over-week % for the
 * sweep detection — "0 RED CARDS THIS WEEK".
 */
export function CelebrationCard({ kind, count, avgPct, scope }: Props) {
  const timeframe = scope === "week" ? "THIS WEEK" : "TODAY";
  const avgLabel = scope === "week" ? "AVG WTD" : "AVG TODAY";
  const allLabel = kind === "clean-sweep" ? "GREEN" : "RED";
  return (
    <article className={`celebration-card celebration-${kind}`}>
      <div className="celebration-badge">{KIND_LABEL[kind]}</div>
      <div className="celebration-headline">
        {KIND_HEADLINE[kind]} {timeframe}
      </div>
      <div className="celebration-stat">
        {avgLabel} {formatAvg(avgPct)} · ALL {count} STOCKS {allLabel}
      </div>
      <p className="celebration-subtitle">{KIND_SUBTITLE[kind]}</p>
    </article>
  );
}
