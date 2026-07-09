"use client";

import { type CSSProperties, useState } from "react";
import { moodVar } from "@/lib/derive";
import type { MoodCell } from "@/lib/stockDetail";

/** "2026-07-09" → "JUL 09". */
const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  const mm = MONTHS[(Number(m) || 0) - 1] ?? "———";
  return `${mm} ${d ?? "--"}`;
}

function fmtPct(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function cellLabel(cell: MoodCell): string {
  return cell.present
    ? `${shortDate(cell.date)} · ${fmtPct(cell.changePct)}`
    : `${shortDate(cell.date)} · no session`;
}

/**
 * Contribution-graph mood strip: one square per calendar day, colored by
 * that day's mood, honest holes for gap days (weekends / holidays). Hover
 * shows the native tooltip; tap pins a caption below (mobile has no
 * hover). Horizontally scrollable so it scales from 5 days to a year
 * without reflowing the page. No animation → nothing to gate on
 * reduced-motion.
 */
export function MoodStrip({ cells }: { cells: MoodCell[] }) {
  // Default the caption to the most recent present cell so the strip
  // reads without a tap.
  const lastPresent = [...cells].reverse().find((c) => c.present);
  const [selected, setSelected] = useState<MoodCell | null>(
    lastPresent ?? null,
  );

  return (
    <div className="sd-strip-wrap">
      <div className="sd-strip">
        {cells.map((cell) => {
          const style = cell.present
            ? ({ "--mood": moodVar(cell.sentiment) } as CSSProperties)
            : undefined;
          const label = cellLabel(cell);
          return (
            <button
              type="button"
              key={cell.date}
              className={`sd-cell ${cell.present ? "sd-cell-on" : "sd-cell-off"}`}
              style={style}
              title={label}
              aria-label={label}
              aria-pressed={selected?.date === cell.date}
              onClick={() => setSelected(cell)}
            />
          );
        })}
      </div>
      <div className="sd-strip-caption" aria-live="polite">
        {selected ? cellLabel(selected) : "tap a day"}
      </div>
    </div>
  );
}
