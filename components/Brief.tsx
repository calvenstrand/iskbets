import type { Brief } from "@/lib/types";

type Kind = "morning" | "evening" | "weekend";

type Props = {
  morningBrief?: Brief;
  eveningBrief?: Brief;
  weekendBrief?: Brief;
  flash?: boolean;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const weekRangeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
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

/** Weekend-wire date is the Monday of the week — render it as a range:
 * "MON 4 MAY → FRI 8 MAY". */
function formatWeekRange(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const monday = new Date(Date.UTC(y, m - 1, d));
  const friday = new Date(Date.UTC(y, m - 1, d + 4));
  const left = weekRangeFormatter.format(monday).toUpperCase();
  const right = weekRangeFormatter.format(friday).toUpperCase();
  return `WEEK · ${left} → ${right}`;
}

const LABELS: Record<Kind, string> = {
  morning: "MORNING WIRE",
  evening: "EVENING WRAP",
  weekend: "WEEKEND WIRE",
};

export function BriefCard({
  morningBrief,
  eveningBrief,
  weekendBrief,
  flash,
}: Props) {
  const candidates: { kind: Kind; brief: Brief }[] = [];
  if (morningBrief) candidates.push({ kind: "morning", brief: morningBrief });
  if (eveningBrief) candidates.push({ kind: "evening", brief: eveningBrief });
  if (weekendBrief) candidates.push({ kind: "weekend", brief: weekendBrief });
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

  const dateLabel =
    current.kind === "weekend"
      ? formatWeekRange(current.brief.date)
      : formatBriefDate(current.brief.date);

  return (
    <section className={className}>
      <header className="brief-header">
        <h2 className="brief-kind">{LABELS[current.kind]}</h2>
        <span className="brief-date">{dateLabel}</span>
      </header>
      <p className="brief-body">{current.brief.text}</p>
    </section>
  );
}
