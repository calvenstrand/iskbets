"use client";

import { useEffect, useState } from "react";

type Props = {
  updatedAt: string;
};

type Liveness = "fresh" | "stale" | "dead";

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // 24-hour HH:MM, no locale variance
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
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
  // time + liveness pip.
  const display = now === null ? updatedAt : formatTime(updatedAt);
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
