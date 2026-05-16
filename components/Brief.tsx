import type { Brief } from "@/lib/types";

type Kind = "morning" | "evening" | "weekend";

type Props = {
  morningBrief?: Brief;
  eveningBrief?: Brief;
  weekendBrief?: Brief;
  flash?: boolean;
  /** Fri 22:00 → Mon 09:00 STO. When true and the most-recent brief is
   * the Weekend Wire, hide the card entirely — the Champion of the
   * Week recap already owns the weekend narrative, and the long wire
   * paragraph below it was redundant. Morning + Friday-evening briefs
   * still surface during their natural windows even when this is true. */
  inRecap?: boolean;
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

/** Build a NewsArticle JSON-LD payload for the currently-displayed brief.
 * Real fresh content with a timestamp + an author — this is the kind of
 * thing Google's freshness ranking actually rewards on a single-page
 * site. Keep fields minimal but accurate.
 *
 * `brief.text` is AI-generated, so the JSON output is escaped through
 * `safeJsonForScript` to defend against `</script>` injection — even
 * though Claude has no reason to produce that string, defense-in-depth
 * for any value embedded in a <script> tag. */
function buildBriefStructuredData(kind: Kind, brief: Brief): string {
  const headline = `ISKBets ${LABELS[kind]} — ${formatBriefDate(brief.date)}`;
  const datePublished = new Date(brief.generatedAt).toISOString();
  return safeJsonForScript({
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline,
    datePublished,
    dateModified: datePublished,
    inLanguage: "en",
    articleBody: brief.text,
    isPartOf: { "@id": "https://www.iskbets.se/#website" },
    mainEntityOfPage: "https://www.iskbets.se",
    author: {
      "@type": "Organization",
      name: "ISKBets",
      url: "https://www.iskbets.se",
    },
    publisher: {
      "@type": "Organization",
      name: "ISKBets",
      url: "https://www.iskbets.se",
    },
  });
}

/** JSON.stringify + escape `<` so an embedded `</script>` (or `<!--`)
 * in any string value can't break out of the surrounding `<script>` tag.
 * The HTML parser only treats `</script` as a tag-end inside a raw-text
 * script element, so escaping `<` is sufficient — `>` and `&` don't
 * need it because they're harmless inside script context. */
function safeJsonForScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function BriefCard({
  morningBrief,
  eveningBrief,
  weekendBrief,
  flash,
  inRecap,
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

  // Recap window + weekend wire = hide. Champion of the Week card above
  // covers the same ground in tighter form. Wire still generates server-
  // side so it lives in /api/data + future archive surfaces. We DON'T
  // fall back to the next-most-recent (Friday evening wrap) here — by
  // Saturday that's stale and a fallback would just defeat the hide.
  if (inRecap && current.kind === "weekend") return null;

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
      {/* NewsArticle JSON-LD for the active brief. React 19 hoists this
          script tag into <head> at render. Inlined via dangerouslySet…
          because React escapes characters inside <script> children. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: buildBriefStructuredData(current.kind, current.brief),
        }}
      />
      <header className="brief-header">
        <h2 className="brief-kind">{LABELS[current.kind]}</h2>
        <span className="brief-date">{dateLabel}</span>
      </header>
      <p className="brief-body">{current.brief.text}</p>
    </section>
  );
}
