"use client";

import { useEffect, useState } from "react";

type Props = {
  updatedAt: string;
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // 24-hour HH:MM, no locale variance
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function UpdatedFooter({ updatedAt }: Props) {
  // Render the raw ISO during SSR, swap to local-formatted HH:MM after mount.
  const [pretty, setPretty] = useState<string | null>(null);

  useEffect(() => {
    setPretty(formatTime(updatedAt));
  }, [updatedAt]);

  const display = pretty ?? updatedAt;

  return (
    <footer className="terminal-footer">
      LAST UPDATED: {display} · DATA MAY BE DELAYED · NOT FINANCIAL ADVICE{" "}
      <span className="ape">🦍</span>
    </footer>
  );
}
