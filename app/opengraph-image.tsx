import { ImageResponse } from "next/og";
import { deriveSentiment, SENTIMENT_HEX } from "@/lib/derive";
import { detectTodaySweep, pickTodayWinnerLoser } from "@/lib/leaderboard";
import { getDashboardData } from "@/lib/storage";
import { displayTicker } from "@/lib/tickers";
import type { DayMood } from "@/lib/types";

// Edge is fine: the only data fetch is Upstash (REST/fetch, edge-safe).
export const runtime = "edge";
// NB: no `revalidate` export. On the edge runtime it doesn't drive ISR,
// and setting it makes Next stamp this canonical metadata image
// `immutable, max-age=1yr` — freezing the unfurl on one snapshot. The
// refresh cadence is instead set explicitly via the response
// `cache-control` header in the ImageResponse below.

export const alt = "I$KBETS — the people's terminal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// ── Palette ────────────────────────────────────────────────────────────
// Satori has no oklch, so mood colors come from the shared SENTIMENT_HEX
// table (lib/derive.ts — same 5-tier mapping as the site's moodVar).
// Everything else mirrors the site tokens.
const TEXT = "#d7e6dd"; // --text-0
const TEXT_DIM = "#7c8a83"; // --text-2
const GOLD = "#f5c842"; // --gold
const BORDER = "#252e2a"; // --border
const CHIP_BG = "#0d1110"; // --surface-1
// Sweep accents: readable red (--mood-rekt, not the deep liquidated
// fill) and moon green — text colors, so they follow the site's
// "rekt-for-text" convention (see globals.css .mood-text-rekt).
const ACCENT_RED = "#e9483d"; // --mood-rekt
const ACCENT_GREEN = SENTIMENT_HEX.moon;

// Per-sweep skin: a flat linear-gradient wash (no blur/shadow — Satori
// can't do them) plus an accent + gallows/tendies copy.
const SKIN: Record<
  DayMood | "none",
  { bg: string; accent: string; label: string; copy?: string }
> = {
  bloodbath: {
    // Deep red wash fading to the surface — reads as "the bleeding".
    bg: "linear-gradient(150deg, #2a0810 0%, #12060a 45%, #080b0a 100%)",
    accent: ACCENT_RED,
    label: "🩸 BLOODBATH",
    copy: "everything is fine 🔥🦍🔥",
  },
  "clean-sweep": {
    bg: "linear-gradient(150deg, #06251a 0%, #08140f 45%, #080b0a 100%)",
    accent: ACCENT_GREEN,
    label: "💎 CLEAN SWEEP",
    copy: "green across the board — tendies for all 🍗",
  },
  none: {
    bg: "linear-gradient(150deg, #0c1512 0%, #080b0a 62%)",
    accent: GOLD,
    label: "TODAY'S READ",
  },
};

function fmtPct(pct: number): string {
  if (!Number.isFinite(pct)) return "—";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

// Chip color follows the site's full 5-tier sentiment scale (moodVar /
// SENTIMENT_HEX), so a -1% "biggest loser" is the same caution orange on
// the unfurl as on the grid, and a +0.2% "winner" stays neutral gold —
// the previous 2-tier table painted those red/green.
function chipColor(pct: number): string {
  return SENTIMENT_HEX[deriveSentiment(pct)];
}

// ▲ / ▼ as an inline SVG polygon — the geometric arrow glyphs aren't in
// Bebas Neue or Share Tech Mono (they'd render as tofu in Satori, which
// has no browser fallback) and aren't emoji, and Satori doesn't support
// the CSS border-triangle trick (it fills a square). An SVG polygon
// rasterizes cleanly and takes the mood color.
function arrow(up: boolean, color: string) {
  return (
    <svg width="18" height="15" viewBox="0 0 18 15" style={{ display: "flex" }}>
      <polygon
        points={up ? "9,0 18,15 0,15" : "0,0 18,0 9,15"}
        fill={color}
      />
    </svg>
  );
}

function statChip(opts: {
  label: string;
  ticker: string;
  pct: number;
  up: boolean;
}) {
  const color = chipColor(opts.pct);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 20px",
        border: `1px solid ${BORDER}`,
        borderLeft: `4px solid ${color}`,
        background: CHIP_BG,
        fontSize: 28,
      }}
    >
      <span style={{ display: "flex", color: TEXT_DIM, fontSize: 20 }}>
        {opts.label}
      </span>
      <span style={{ display: "flex", color: TEXT }}>{opts.ticker}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {arrow(opts.up, color)}
        <span style={{ display: "flex", color }}>{fmtPct(opts.pct)}</span>
      </div>
    </div>
  );
}

// Shown in the slot with no real counterpart — a clean sweep has no
// loser, a bloodbath no winner — carrying the day-mood wording instead
// of an empty chip.
function badgeChip(label: string, accent: string) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "12px 22px",
        border: `1px solid ${BORDER}`,
        borderLeft: `4px solid ${accent}`,
        background: CHIP_BG,
        fontSize: 26,
        letterSpacing: 5,
        color: accent,
      }}
    >
      {label}
    </div>
  );
}

function dateline(now: Date): string {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Stockholm",
    weekday: "short",
  })
    .format(now)
    .toUpperCase();
  const md = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Stockholm",
    month: "short",
    day: "numeric",
  })
    .format(now)
    .toUpperCase();
  // Issue number = days since launch, matching the masthead (Header.tsx).
  const issue = Math.max(
    1,
    Math.floor((now.getTime() - Date.UTC(2025, 5, 1)) / 86_400_000),
  );
  return `${wd} ${md} · №${issue}`;
}

type Chip = { ticker: string; pct: number };
type Card = {
  mood: DayMood | null;
  headline: string;
  winner?: Chip;
  loser?: Chip;
  dateline: string;
};

/**
 * Assemble the card model from the same snapshot the dashboard reads.
 * Never throws — a broken unfurl is worse than a generic one, so any
 * data/Redis failure falls through to a branded static card.
 */
async function gather(now: Date): Promise<Card> {
  const fallback: Card = {
    mood: null,
    headline: "Greed is good. The people's terminal is warming up.",
    dateline: dateline(now),
  };
  try {
    const data = await getDashboardData();
    if (!data) return fallback;
    const { snapshot } = data;

    // Same day-framing eligibility the dashboard uses for the sweep and
    // the featured pair (shared detectTodaySweep): only stocks whose
    // market has actually traded today, so a frozen US ticker can't fake
    // a bloodbath/clean-sweep or win the card on a Monday morning.
    const sweep = detectTodaySweep(snapshot.stocks, now);

    const movers = pickTodayWinnerLoser(snapshot.stocks, now);
    const toChip = (ticker: string): Chip | undefined => {
      const s = snapshot.stocks.find((x) => x.ticker === ticker);
      return s && Number.isFinite(s.regularMarketChangePercent)
        ? { ticker: displayTicker(s.ticker), pct: s.regularMarketChangePercent }
        : undefined;
    };
    const winner = toChip(
      movers.winner?.ticker ?? snapshot.analysis.biggestWinner,
    );
    const loser = toChip(movers.loser?.ticker ?? snapshot.analysis.biggestLoser);

    return {
      mood: sweep.type,
      headline: snapshot.analysis.overallMood || fallback.headline,
      ...(winner ? { winner } : {}),
      ...(loser ? { loser } : {}),
      dateline: dateline(now),
    };
  } catch {
    return fallback;
  }
}

export default async function Image() {
  const now = new Date();
  const [card, bebas, mono] = await Promise.all([
    gather(now),
    fetch(new URL("./_fonts/BebasNeue-Regular.ttf", import.meta.url)).then((r) =>
      r.arrayBuffer(),
    ),
    fetch(
      new URL("./_fonts/ShareTechMono-Regular.ttf", import.meta.url),
    ).then((r) => r.arrayBuffer()),
  ]);

  const skin = SKIN[card.mood ?? "none"];
  // Keep the mood sentence from overrunning the card on wordy days.
  const headline =
    card.headline.length > 150
      ? `${card.headline.slice(0, 147).trimEnd()}…`
      : card.headline;

  // Winner + loser pair, mirroring the site's featured cards. A clean
  // sweep has no real loser and a bloodbath no real winner, so that slot
  // shows the day-mood badge instead of a bogus chip.
  const winnerSlot =
    card.mood === "bloodbath"
      ? badgeChip("BLOODBATH", skin.accent)
      : card.winner
        ? statChip({
            label: "BIGGEST WINNER",
            ticker: card.winner.ticker,
            pct: card.winner.pct,
            up: true,
          })
        : null;
  const loserSlot =
    card.mood === "clean-sweep"
      ? badgeChip("CLEAN SWEEP", skin.accent)
      : card.loser
        ? statChip({
            label: "BIGGEST LOSER",
            ticker: card.loser.ticker,
            pct: card.loser.pct,
            up: false,
          })
        : null;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          background: skin.bg,
          padding: "44px 64px",
          fontFamily: "Share Tech Mono",
          color: TEXT,
        }}
      >
        {/* ── Masthead ─────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
            }}
          >
            <div
              style={{
                display: "flex",
                fontFamily: "Bebas Neue",
                fontSize: 104,
                lineHeight: 1,
                letterSpacing: 4,
              }}
            >
              <span style={{ display: "flex" }}>I</span>
              <span style={{ display: "flex", color: GOLD }}>$</span>
              <span style={{ display: "flex" }}>KBETS</span>
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 24,
                letterSpacing: 3,
                color: TEXT_DIM,
                paddingBottom: 12,
              }}
            >
              {card.dateline}
            </div>
          </div>
          {/* Gold rule under the wordmark, echoing the masthead. */}
          <div
            style={{
              display: "flex",
              height: 3,
              marginTop: 18,
              background: `linear-gradient(90deg, transparent 0%, ${GOLD} 20%, ${GOLD} 80%, transparent 100%)`,
            }}
          />
        </div>

        {/* ── The read ─────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            justifyContent: "center",
            gap: 18,
            paddingTop: 6,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 26,
              letterSpacing: 8,
              color: skin.accent,
            }}
          >
            {skin.label}
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "Bebas Neue",
              fontSize: 56,
              lineHeight: 1.06,
              letterSpacing: 1,
              color: TEXT,
            }}
          >
            {headline}
          </div>
          {skin.copy && (
            <div style={{ display: "flex", fontSize: 30, color: skin.accent }}>
              {skin.copy}
            </div>
          )}
        </div>

        {/* ── Featured pair + footer ───────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {winnerSlot}
            {loserSlot}
          </div>
          <div style={{ display: "flex", fontSize: 22, color: TEXT_DIM }}>
            THE PEOPLE&apos;S TERMINAL · not financial advice 🦍
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      // Emoji (footer 🦍, sweep label/copy) render via twemoji SVGs; the
      // arrows in the chips are CSS triangles, not emoji, so they don't
      // depend on it.
      emoji: "twemoji",
      fonts: [
        { name: "Bebas Neue", data: bebas, style: "normal", weight: 400 },
        { name: "Share Tech Mono", data: mono, style: "normal", weight: 400 },
      ],
      // Refresh with the data, not per-request. On the edge runtime the
      // `revalidate` export doesn't drive ISR (edge disables static
      // generation), and Next otherwise stamps metadata images
      // `immutable, max-age=1yr` — which would freeze the unfurl on one
      // snapshot forever. Set the CDN cache window explicitly so the card
      // tracks the dashboard's cadence: served from cache for 60s, then
      // regenerated, serving stale while it does.
      headers: {
        "cache-control":
          "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
