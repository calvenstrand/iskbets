import type { Rating, Sentiment } from "./types";

/**
 * Maps today's regularMarketChangePercent to a rating badge. Pure rule-
 * based — no LLM judgment needed for magnitude-based labels.
 *
 * Bands (symmetric 3-tier on each side + a quiet middle):
 *   pct > 5        → 🚀 TO THE MOON
 *   2 < pct ≤ 5    → 📈 BULLISH AF
 *   0.5 < pct ≤ 2  → 💎 DIAMOND HANDS
 *   -0.5 ≤ pct ≤ 0.5 → null (no badge — the change% text says enough)
 *   -2 ≤ pct < -0.5 → ⚠️ TURBULENCE (mild down)
 *   -5 < pct < -2  → 📉 GET REKT
 *   pct ≤ -5       → 💀 LIQUIDATED
 *
 * The null band is intentional: when every card on a quiet day was
 * stamped TURBULENCE, the badge became wallpaper. Now a badge means
 * something when it appears.
 *
 * The LIQUIDATED cutoff (-5%) deliberately aligns with the sentiment
 * scale's rekt threshold in deriveSentiment, so the badge appears
 * on exactly the same cards that get the max-intensity red glow.
 *
 * Non-finite input (NaN, missing data) returns null — we don't want
 * a badge appearing just because data hasn't loaded.
 */
export function deriveRating(pct: number): Rating | null {
  if (!Number.isFinite(pct)) return null;
  if (pct > 5) return "🚀 TO THE MOON";
  if (pct > 2) return "📈 BULLISH AF";
  if (pct > 0.5) return "💎 DIAMOND HANDS";
  if (pct >= -0.5) return null;
  if (pct >= -2) return "⚠️ TURBULENCE";
  if (pct > -5) return "📉 GET REKT";
  return "💀 LIQUIDATED";
}

/**
 * Sentiment scale — drives the colored card glow. Decoupled from rating so
 * a TURBULENCE card can still glow "down" if the move is mildly negative.
 *
 * Naming landmine: Sentiment "rekt" means ≤ -5% here (the 💀 LIQUIDATED
 * band — it fills with --mood-liquidated via moodVar). TickerTier in
 * lib/tickerLines.ts has its own, FINER "rekt" meaning -2..-5% (the
 * 📉 GET REKT rating band). Same word, different cutoffs — check which
 * scale you're on before reusing either.
 */
export function deriveSentiment(pct: number): Sentiment {
  if (!Number.isFinite(pct)) return "neutral";
  if (pct > 5) return "moon";
  if (pct > 0.5) return "up";
  if (pct > -0.5) return "neutral";
  if (pct > -5) return "down";
  return "rekt";
}

/**
 * Maps a sentiment bucket to its --mood-* token (defined in globals.css).
 * rekt (≤ -5%) uses --mood-liquidated — the deepest red — so the worst
 * cards read as more than "mild down". Used for fills / spines (chip
 * backgrounds, card spines). Shared by the stock cards and the friend
 * leaderboard so one move gets one color everywhere.
 */
export function moodVar(sentiment: Sentiment): string {
  switch (sentiment) {
    case "moon":
      return "var(--mood-moon)";
    case "up":
      return "var(--mood-up)";
    case "neutral":
      return "var(--mood-neutral)";
    case "down":
      return "var(--mood-down)";
    case "rekt":
      return "var(--mood-liquidated)";
  }
}

/**
 * Hex equivalents of the --mood-* tokens for surfaces that can't read
 * CSS variables — i.e. the Satori-rendered OG/Twitter image. Exactly the
 * moodVar mapping (sentiment "rekt" ≤ -5% gets the deep liquidated red),
 * so one move gets one color on the site AND the unfurl. MUST stay in
 * sync with the token definitions in app/globals.css :root.
 */
export const SENTIMENT_HEX: Record<Sentiment, string> = {
  moon: "#33f5a0", // --mood-moon
  up: "#53c48e", // --mood-up
  neutral: "#e2c157", // --mood-neutral
  down: "#eb883b", // --mood-down
  rekt: "#b7162d", // --mood-liquidated (see moodVar)
};

/**
 * Dedicated badges for the WEEK'S BIGGEST WINNER / LOSER featured
 * cards during the recap window. Distinct from the regular daily
 * rating set so a card labelled "WEEK'S BIGGEST WINNER" can't end up
 * wearing a 💀 LIQUIDATED badge derived from today's intraday dump
 * (the actual scenario that prompted this).
 *
 * Thresholds are wider than the daily ratings since weekly moves are
 * naturally larger. Winner badges escalate by magnitude; loser badges
 * mirror on the negative side. The < +2% winner band falls through to
 * "LAST APE STANDING" because if the week's BEST stock barely cleared
 * green, the whole portfolio probably had a rough time.
 *
 * Returns null when the slot doesn't deserve a trophy — e.g. the
 * "biggest loser" actually finished positive (everyone won; no real
 * loser to crown).
 */
export function deriveWeekBadge(
  weekPct: number,
  slot: "winner" | "loser",
): string | null {
  if (!Number.isFinite(weekPct)) return null;
  if (slot === "winner") {
    if (weekPct >= 10) return "🏆 WEEK MVP";
    if (weekPct >= 5) return "🚀 WEEK ROCKETSHIP";
    if (weekPct >= 2) return "💎 WEEK DIAMOND";
    // Negative or near-flat "winner" — best of a bad week.
    return "🪖 LAST APE STANDING";
  }
  // slot === "loser"
  if (weekPct <= -15) return "⚰️ WEEK REKT";
  if (weekPct <= -7) return "💀 WEEK BAGHOLDER";
  if (weekPct <= -3) return "📉 ROUGH WEEK";
  if (weekPct <= 0) return "🩹 GRAZED";
  // "Biggest loser" is actually positive — no real loser to crown.
  return null;
}
