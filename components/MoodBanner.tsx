type MoodBannerProps = {
  mood: string;
  avgChangePct: number;
  flash?: boolean;
};

export function MoodBanner({ mood, avgChangePct, flash }: MoodBannerProps) {
  let tone = "mood-flat";
  if (avgChangePct >= 0.4) tone = "mood-bull";
  else if (avgChangePct <= -0.4) tone = "mood-bear";

  const className = ["mood-banner", tone, flash ? "ai-update" : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} role="status">
      {mood}
    </div>
  );
}
