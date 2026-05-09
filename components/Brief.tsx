import type { Brief } from "@/lib/types";

type Kind = "morning" | "evening";

type Props = {
  morningBrief?: Brief;
  eveningBrief?: Brief;
  flash?: boolean;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatBriefDate(dateStr: string): string {
  // dateStr is YYYY-MM-DD; parse as UTC so the display matches the
  // Stockholm calendar day stored on the brief.
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return dateFormatter
    .format(new Date(Date.UTC(y, m - 1, d)))
    .toUpperCase();
}

const LABELS: Record<Kind, string> = {
  morning: "MORNING WIRE",
  evening: "EVENING WRAP",
};

export function BriefCard({ morningBrief, eveningBrief, flash }: Props) {
  const candidates: { kind: Kind; brief: Brief }[] = [];
  if (morningBrief) candidates.push({ kind: "morning", brief: morningBrief });
  if (eveningBrief) candidates.push({ kind: "evening", brief: eveningBrief });
  if (candidates.length === 0) return null;

  // Show whichever was generated most recently — that's the current narrative.
  candidates.sort((a, b) => b.brief.generatedAt - a.brief.generatedAt);
  const current = candidates[0];
  if (!current) return null;

  const className = [
    "brief",
    `brief-${current.kind}`,
    flash ? "ai-update" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={className}>
      <header className="brief-header">
        <span className="brief-kind">{LABELS[current.kind]}</span>
        <span className="brief-date">{formatBriefDate(current.brief.date)}</span>
      </header>
      <p className="brief-body">{current.brief.text}</p>
    </section>
  );
}
