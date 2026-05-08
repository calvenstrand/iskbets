type MoodBannerProps = {
  mood: string;
  avgChangePct: number;
};

export function MoodBanner({ mood, avgChangePct }: MoodBannerProps) {
  let cls = "mood-flat";
  if (avgChangePct >= 0.4) cls = "mood-bull";
  else if (avgChangePct <= -0.4) cls = "mood-bear";

  return (
    <div className={`mood-banner ${cls}`} role="status">
      {mood}
    </div>
  );
}
