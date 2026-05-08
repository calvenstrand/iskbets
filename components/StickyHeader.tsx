"use client";

import { useEffect, useState } from "react";
import {
  newYorkStatus,
  pipClass,
  stockholmStatus,
} from "@/lib/marketHours";

const SHOW_THRESHOLD_PX = 220;

export function StickyHeader() {
  const [visible, setVisible] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > SHOW_THRESHOLD_PX);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const se = now ? stockholmStatus(now) : null;
  const ny = now ? newYorkStatus(now) : null;

  return (
    <div
      className={`sticky-header ${visible ? "visible" : ""}`}
      aria-hidden={!visible}
    >
      <div className="sticky-header-inner px-4 md:px-8 lg:px-12">
        <span className="sticky-brand">
          I<span className="dollar">$</span>KBETS
        </span>
        <span className="sticky-pips">
          {se && (
            <span title={`Stockholm ${se}`}>
              <span className={pipClass(se)} />
              <span className="sticky-pip-label">SE</span>
            </span>
          )}
          {ny && (
            <span title={`New York ${ny}`}>
              <span className={pipClass(ny)} />
              <span className="sticky-pip-label">NY</span>
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
