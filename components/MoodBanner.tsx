import type { DayMood } from "@/lib/types";

type MoodBannerProps = {
  mood: string;
  avgChangePct: number;
  flash?: boolean;
  /** Active market-wide sweep, if any. Forces the tag tone to match the
   * event and surfaces a gallows-humor line below the AI read. */
  sweep?: DayMood | null;
  /** Stable per-snapshot string (the snapshot's `updatedAt`). Used to
   * pick the sweep line deterministically so SSR and CSR agree — no
   * Math.random / Date.now, no hydration mismatch. Rotates when the data
   * refreshes. */
  seed?: string;
};

// Curated, not random — a hash of the snapshot timestamp picks one, so
// the same render is produced on the server and the client. WSB voice:
// bloodbath leans "everything is fine 🔥🦍🔥", clean-sweep leans
// "tendies for all".
const SWEEP_LINES: Record<DayMood, readonly string[]> = {
  bloodbath: [
    "this is fine. everything is fine. 🔥🦍🔥",
    "red wedding — hodl your tears. 🩸",
    "buy the dip? this IS the dip. 📉",
    "portfolios in the ICU, apes still strong. 🦍",
    "we don't sell. we cope. 💎🙌",
  ],
  "clean-sweep": [
    "green across the board — tendies for all. 🍗",
    "not one red candle. we are so back. 🚀",
    "printer go brrr on every ticker. 🖨️",
    "clean sweep — everybody eats today. 💎",
    "up only. touch grass later. 🌱",
  ],
};

function pickLine(lines: readonly string[], seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return lines[Math.abs(h) % lines.length] ?? lines[0]!;
}

/**
 * The daily AI read — the one human-readable AI sentence, promoted out
 * of the old glowing mood banner into its own hero block directly under
 * the masthead so it leads the above-the-fold descent (brief → featured
 * → grid). Direction (bull / bear / flat) is carried by a small colored
 * tag, not a full-bleed glow. During a market-wide sweep it leans in
 * with a gallows-humor line and locks the tone to the event.
 */
export function MoodBanner({
  mood,
  avgChangePct,
  flash,
  sweep,
  seed,
}: MoodBannerProps) {
  // A sweep pins the tone so the tag agrees with the page skin even if a
  // stray stale stock drags the raw average the other way.
  let tone = "brief-flat";
  if (sweep === "bloodbath") tone = "brief-bear";
  else if (sweep === "clean-sweep") tone = "brief-bull";
  else if (avgChangePct >= 0.4) tone = "brief-bull";
  else if (avgChangePct <= -0.4) tone = "brief-bear";

  const className = ["brief", tone, flash ? "ai-update" : null]
    .filter(Boolean)
    .join(" ");

  const sweepLine = sweep ? pickLine(SWEEP_LINES[sweep], seed ?? "") : null;

  return (
    <section className={className} role="status" aria-label="Today's read">
      <span className="brief-tag" aria-hidden="true">
        TODAY&apos;S READ
      </span>
      <p className="brief-line">{mood}</p>
      {sweepLine && (
        <p className={`brief-sweep brief-sweep-${sweep}`}>{sweepLine}</p>
      )}
    </section>
  );
}
