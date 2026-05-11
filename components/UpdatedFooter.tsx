"use client";

import { useEffect, useState } from "react";

type Props = {
  updatedAt: string;
};

type Liveness = "fresh" | "stale" | "dead";

// Month abbreviations match the masthead's date style ("MAY 9").
const MONTH_ABBR = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
] as const;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // 24-hour, locale-independent. Comma between date and time so the
  // separator stays distinct from the outer bullet (·) characters in
  // the footer line — otherwise "MAY 11 · 14:32 · DATA MAY..."
  // reads as 3 equal-weight items instead of "date, then advisory".
  const month = MONTH_ABBR[d.getMonth()];
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${month} ${day}, ${hh}:${mm}`;
}

function liveness(updatedAt: string, now: number): Liveness {
  const ts = new Date(updatedAt).getTime();
  if (Number.isNaN(ts)) return "dead";
  const ageMin = (now - ts) / 60_000;
  if (ageMin < 5) return "fresh";
  if (ageMin < 30) return "stale";
  return "dead";
}

const LIVE_LABEL: Record<Liveness, string> = {
  fresh: "data fresh",
  stale: "data stale",
  dead: "data may be outdated",
};

export function UpdatedFooter({ updatedAt }: Props) {
  // Tick every 30s so liveness/time stay current without a remount.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // SSR: render the raw ISO + no pip. After mount, swap to formatted
  // date+time + liveness pip.
  const display = now === null ? updatedAt : formatDateTime(updatedAt);
  const live = now === null ? null : liveness(updatedAt, now);

  return (
    <footer className="terminal-footer">
      {live && (
        <span
          className={`live-pip ${live}`}
          aria-label={LIVE_LABEL[live]}
          role="img"
        />
      )}
      LAST UPDATED: {display} · DATA MAY BE DELAYED · NOT FINANCIAL ADVICE{" "}
      <span className="ape">🦍</span>
    </footer>
  );
}
