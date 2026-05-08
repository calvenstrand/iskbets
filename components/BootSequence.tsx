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
const LINE_DELAY_MS = 160;
const FINAL_HOLD_MS = 550;
const FADE_MS = 420;

type Phase = "checking" | "running" | "fading" | "done";

export function BootSequence() {
  // SSR-safe default: cover the screen until JS decides what to do. Returning
  // visitors get a brief dark flash; first-time visitors see the boot log.
  const [phase, setPhase] = useState<Phase>("checking");
  const [shown, setShown] = useState(0);

  // Decide whether to play, skip (already seen), or skip (reduced motion).
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;
    const seen = sessionStorage.getItem(STORAGE_KEY) === "1";
    if (reduced || seen) {
      setPhase("done");
      return;
    }
    setPhase("running");
  }, []);

  // Stagger the lines while running.
  useEffect(() => {
    if (phase !== "running") return;
    if (shown >= LINES.length) {
      const finishTimer = setTimeout(() => setPhase("fading"), FINAL_HOLD_MS);
      return () => clearTimeout(finishTimer);
    }
    const t = setTimeout(() => setShown((s) => s + 1), LINE_DELAY_MS);
    return () => clearTimeout(t);
  }, [phase, shown]);

  // Finalize: persist the seen flag, unmount.
  useEffect(() => {
    if (phase !== "fading") return;
    const t = setTimeout(() => {
      sessionStorage.setItem(STORAGE_KEY, "1");
      setPhase("done");
    }, FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // Skip on any click / key while running.
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
