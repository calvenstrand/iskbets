type MoodBannerProps = {
  mood: string;
  avgChangePct: number;
  flash?: boolean;
};

/**
 * The daily AI read — the one human-readable sentence the dashboard
 * generates. Promoted out of the old glowing mood banner into its own
 * hero block directly under the masthead so it leads the above-the-fold
 * descent (brief → featured → grid) instead of competing with it. The
 * direction (bull / bear / flat) is carried by a small colored tag, not
 * a full-bleed glow.
 */
export function MoodBanner({ mood, avgChangePct, flash }: MoodBannerProps) {
  let tone = "brief-flat";
  if (avgChangePct >= 0.4) tone = "brief-bull";
  else if (avgChangePct <= -0.4) tone = "brief-bear";

  const className = ["brief", tone, flash ? "ai-update" : null]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={className} role="status" aria-label="Today's read">
      <span className="brief-tag" aria-hidden="true">
        TODAY&apos;S READ
      </span>
      <p className="brief-line">{mood}</p>
    </section>
  );
}
