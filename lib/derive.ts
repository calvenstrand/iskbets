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
 */
export function deriveSentiment(pct: number): Sentiment {
  if (!Number.isFinite(pct)) return "neutral";
  if (pct > 5) return "moon";
  if (pct > 0.5) return "up";
  if (pct > -0.5) return "neutral";
  if (pct > -5) return "down";
  return "rekt";
}
