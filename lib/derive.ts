import type { Rating, Sentiment } from "./types";

/**
 * Maps today's regularMarketChangePercent to a rating badge. Pure rule-
 * based — no LLM judgment needed for magnitude-based labels.
 *
 * Bands:
 *   pct > 5      → 🚀 TO THE MOON
 *   2 < pct ≤ 5  → 📈 BULLISH AF
 *   0.5 < pct ≤ 2 → 💎 DIAMOND HANDS
 *   -0.5 ≤ pct ≤ 0.5 → null (no badge — the change% text says enough)
 *   -2 ≤ pct < -0.5 → ⚠️ TURBULENCE (mild down)
 *   pct < -2     → 📉 GET REKT
 *
 * The null band is intentional: when every card on a quiet day was
 * stamped TURBULENCE, the badge became wallpaper and signaled nothing.
 * Now a badge actually means something when it appears.
 *
 * Non-finite input (NaN, missing data) also returns null — we don't
 * want a TURBULENCE badge appearing on cards just because their data
 * hasn't loaded.
 */
export function deriveRating(pct: number): Rating | null {
  if (!Number.isFinite(pct)) return null;
  if (pct > 5) return "🚀 TO THE MOON";
  if (pct > 2) return "📈 BULLISH AF";
  if (pct > 0.5) return "💎 DIAMOND HANDS";
  if (pct >= -0.5) return null; // flat band — quiet, no badge
  if (pct >= -2) return "⚠️ TURBULENCE";
  return "📉 GET REKT";
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
