"use client";

import { useEffect, useState } from "react";

const QUOTES: string[] = [
  "Greed, for lack of a better word, is good.",
  "Money never sleeps, pal.",
  "Lunch is for wimps.",
  "The most valuable commodity I know of is information.",
  "What's worth doing is worth doing for money.",
];

export function Header() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % QUOTES.length);
    }, 8000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 px-4 md:px-8 lg:px-12 py-6">
      <h1 className="brand">
        WALL<span className="dollar">$</span>TREET BETS
      </h1>
      <p key={idx} className="gekko-quote">
        — {QUOTES[idx] ?? QUOTES[0]}
      </p>
    </header>
  );
}
