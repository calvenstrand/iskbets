"use client";

import { useEffect, useState } from "react";

type Line = { text: string; ok: boolean };

const LINES: Line[] = [
  { text: "> ISKBETS v4.20 — initializing", ok: false },
  { text: "> connecting to NYSE/NASDAQ ........", ok: true },
  { text: "> connecting to Stockholmsbörsen .....", ok: true },
  { text: "> loading wisdom from /dev/gekko ...", ok: true },
  { text: "> syncing diamond hands ..............", ok: true },
  { text: "> $ greed.enabled = true", ok: false },
  { text: "> $ session ready", ok: false },
];

const STORAGE_KEY = "iskbets:boot:v1";
const BOOTING_CLASS = "booting";
const LINE_DELAY_MS = 240;
const FINAL_HOLD_MS = 700;
const FADE_MS = 500;

type Phase = "idle" | "running" | "fading" | "done";

// Whether the boot animation should play for this visit. Returning
// visitors (sessionStorage flag set) and reduced-motion users skip it.
function shouldBoot(): boolean {
  if (sessionStorage.getItem(STORAGE_KEY) === "1") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    return false;
  return true;
}

export function BootSequence() {
  // The `booting` class on <html> is set server-side in app/layout.tsx, so
  // the dashboard is already hidden behind the overlay on first paint. We
  // either keep it on and animate (first-time visitors) or remove it
  // immediately (returning / reduced-motion).
  const [phase, setPhase] = useState<Phase>("idle");
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (shouldBoot()) {
      setPhase("running");
    } else {
      document.documentElement.classList.remove(BOOTING_CLASS);
      setPhase("done");
    }
  }, []);

  // Stagger the lines while running.
  useEffect(() => {
    if (phase !== "running") return;
    if (shown >= LINES.length) {
      const t = setTimeout(() => setPhase("fading"), FINAL_HOLD_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setShown((s) => s + 1), LINE_DELAY_MS);
    return () => clearTimeout(t);
  }, [phase, shown]);

  // Fading: drop the booting class so the dashboard becomes visible behind
  // the still-opaque overlay, then fade the overlay out, then unmount.
  useEffect(() => {
    if (phase !== "fading") return;
    document.documentElement.classList.remove(BOOTING_CLASS);
    const t = setTimeout(() => {
      sessionStorage.setItem(STORAGE_KEY, "1");
      setPhase("done");
    }, FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // Skip to the end on click / key while running.
  useEffect(() => {
    if (phase !== "running") return;
    const skip = () => setShown(LINES.length);
    window.addEventListener("click", skip);
    window.addEventListener("keydown", skip);
    return () => {
      window.removeEventListener("click", skip);
      window.removeEventListener("keydown", skip);
    };
  }, [phase]);

  if (phase === "done") return null;

  const visibleLines = LINES.slice(0, shown);
  const isTyping = phase === "running" && shown < LINES.length;

  return (
    <div
      className={`boot-overlay${phase === "fading" ? " boot-fading" : ""}`}
      aria-hidden="true"
    >
      <div className="boot-log">
        {visibleLines.map((line, i) => (
          <div key={i} className="boot-line">
            <span>{line.text}</span>
            {line.ok && <span className="boot-ok"> [OK]</span>}
          </div>
        ))}
        {isTyping && <span className="boot-cursor">▮</span>}
      </div>
    </div>
  );
}
