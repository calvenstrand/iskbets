import type { CSSProperties } from "react";
import { moodVar } from "@/lib/derive";
import type { Sentiment } from "@/lib/types";

/** One slot in the ribbon. `sentiment` is null for a day this strip has
 * no record for (e.g. a ticker with no finite price that day) — those
 * are simply not counted as filled, never faked. */
type MoodCell = { date: string; sentiment: Sentiment | null };

type Props = {
  /** Oldest→newest. Filter/mapping is the caller's job (overall vs
   * per-ticker); this component only draws what it's given. */
  history: MoodCell[];
  /** Window width in cells (right edge = today). Default 30. */
  days?: number;
  /** Optional heading above the ribbon. */
  label?: string;
};

// WSB-voiced mood names for the hover/tap title on each filled cell.
const MOOD_LABEL: Record<Sentiment, string> = {
  moon: "TO THE MOON",
  up: "BULLISH",
  neutral: "CRABBING",
  down: "TURBULENCE",
  rekt: "GET REKT",
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// The date string is already a Stockholm calendar day (YYYY-MM-DD) — parse
// the parts directly so there's no timezone re-interpretation.
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}`;
}

export function MoodStrip({ history, days = 30, label }: Props) {
  // Only days that actually carry a sentiment count as filled; the rest
  // of the window is placeholder. Right-align to today: take the most
  // recent `days` filled cells, pad the left with empties.
  const filled = history.filter(
    (c): c is { date: string; sentiment: Sentiment } => c.sentiment !== null,
  );
  const recent = filled.slice(-days);
  const placeholders = Math.max(0, days - recent.length);
  // Too few days to read as a trend — say so instead of showing an almost
  // blank ribbon.
  const building = recent.length < 3;

  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))`,
  };

  return (
    <section
      className="mood-strip"
      aria-label={label ? `${label} — daily mood, last ${days} days` : "Daily mood history"}
    >
      {label && <div className="mood-strip-label">{label}</div>}

      <div className="mood-strip-grid" style={gridStyle}>
        {Array.from({ length: placeholders }, (_, i) => (
          <div key={`ph-${i}`} className="mood-cell mood-cell-empty" />
        ))}
        {recent.map((c) => {
          const name = MOOD_LABEL[c.sentiment];
          const title = `${shortDate(c.date)} · ${name}`;
          return (
            <div
              key={c.date}
              className="mood-cell"
              style={{ background: moodVar(c.sentiment) }}
              title={title}
              aria-label={title}
            />
          );
        })}
      </div>

      <div className="mood-strip-ends" aria-hidden="true">
        <span>{days}d ago</span>
        {building && <span className="mood-strip-building">building history…</span>}
        <span>today</span>
      </div>
    </section>
  );
}
