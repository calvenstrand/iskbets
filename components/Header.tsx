"use client";

import { useEffect, useState } from "react";

const QUOTES: string[] = [
  "Greed, for lack of a better word, is good.",
  "Money never sleeps, pal.",
  "Lunch is for wimps.",
  "The most valuable commodity I know of is information.",
  "What's worth doing is worth doing for money.",
];

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
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

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatClock(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDate(d: Date): string {
  const day = WEEKDAYS[d.getDay()] ?? "";
  const month = MONTHS[d.getMonth()] ?? "";
  const dom = pad(d.getDate());
  return `${day} ${dom} ${month} ${d.getFullYear()}`;
}

export function Header() {
  const [quoteIdx, setQuoteIdx] = useState(0);
  const [now, setNow] = useState<Date | null>(null);

  // Quote rotation
  useEffect(() => {
    const id = setInterval(() => {
      setQuoteIdx((i) => (i + 1) % QUOTES.length);
    }, 8000);
    return () => clearInterval(id);
  }, []);

  // Live clock — tick once per second
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 px-4 md:px-8 lg:px-12 py-6">
      <div>
        <h1 className="brand">
          I<span className="dollar">$</span>KBETS
        </h1>
        <p key={quoteIdx} className="gekko-quote mt-2">
          — {QUOTES[quoteIdx] ?? QUOTES[0]}
        </p>
      </div>

      <div className="terminal-time" aria-label="current local time">
        <div className="terminal-clock">
          {now ? formatClock(now) : "--:--:--"}
        </div>
        <div className="terminal-date">
          {now ? formatDate(now) : "— — — —"}
        </div>
      </div>
    </header>
  );
}
