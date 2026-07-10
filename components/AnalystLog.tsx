import type { CSSProperties } from "react";
import { moodVar } from "@/lib/derive";
import type { AnalystLogEntry } from "@/lib/stockDetail";

/** "2026-07-09" → "JUL 09 · 2026" for the log dateline. */
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

function fmtDate(date: string): string {
  const [y, m, d] = date.split("-");
  const mm = MONTHS[(Number(m) || 0) - 1] ?? "———";
  return `${mm} ${d ?? "--"} · ${y ?? "----"}`;
}

function fmtPct(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * The spine of the detail page: a reverse-chronological feed of dated AI
 * commentary lines, each with its day's mood chip + change %. The oldest
 * row is always the seeded "coverage initiated" marker so a thinly-
 * covered ticker still reads as an honest, intentional log rather than an
 * empty box. Server component — no interaction, pure render.
 */
export function AnalystLog({ entries }: { entries: AnalystLogEntry[] }) {
  return (
    <ol className="sd-log">
      {entries.map((entry, i) => {
        if (entry.kind === "coverage-initiated") {
          return (
            <li key="coverage" className="sd-log-seed">
              <span className="sd-log-seed-mark" aria-hidden="true">
                ▚
              </span>
              ANALYST COVERAGE INITIATED {entry.monthYear}
            </li>
          );
        }
        const style = {
          "--mood": moodVar(entry.sentiment),
        } as CSSProperties;
        return (
          <li key={`${entry.date}-${i}`} className="sd-log-entry" style={style}>
            <div className="sd-log-meta">
              <time className="sd-log-date" dateTime={entry.date}>
                {fmtDate(entry.date)}
              </time>
              <span
                className={`sd-log-move ${
                  entry.changePct > 0
                    ? "sd-up"
                    : entry.changePct < 0
                      ? "sd-down"
                      : "sd-flat"
                }`}
              >
                {fmtPct(entry.changePct)}
              </span>
              {entry.rating && (
                <span className="sd-log-rating">{entry.rating}</span>
              )}
            </div>
            <p className="sd-log-comment">&ldquo;{entry.comment}&rdquo;</p>
          </li>
        );
      })}
    </ol>
  );
}
