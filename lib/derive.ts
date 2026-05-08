import type { Rating, Sentiment } from "./types";

/**
 * Maps today's regularMarketChangePercent to a rating badge. Pure rule-based —
 * no LLM judgment needed for the magnitude-based labels.
 */
export function deriveRating(pct: number): Rating {
  if (!Number.isFinite(pct)) return "⚠️ TURBULENCE";
  if (pct > 5) return "🚀 TO THE MOON";
  if (pct > 2) return "📈 BULLISH AF";
  if (pct > 0.5) return "💎 DIAMOND HANDS";
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
