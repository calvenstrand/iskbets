import Link from "next/link";
import type { CSSProperties } from "react";
import {
  deriveRating,
  deriveSentiment,
  deriveWeekBadge,
  moodVar,
} from "@/lib/derive";
import { displayTicker, primaryOwnerName } from "@/lib/tickers";
import { deriveTickerTier, tickerLine } from "@/lib/tickerLines";
import type { Sentiment, StockAnalysis, StockPrice } from "@/lib/types";

type Featured = "winner" | "loser";
type FeaturedScope = "week" | "day";

type StockCardProps = {
  stock: StockPrice;
  analysis: StockAnalysis | undefined;
  index: number;
  featured?: Featured;
  /** Whether the featured pick was selected based on week-over-week
   * performance (default) or just today's intraday move (fallback when
   * no Monday baseline exists yet). Drives the badge label. */
  featuredScope?: FeaturedScope;
  /** Week-over-week % to show as the headline number under the
   * BIGGEST WINNER / LOSER badge on featured cards. */
  featuredWeekChangePct?: number;
  /** When provided, the change row swaps from today's intraday move to
   * this week's % (Monday baseline → now). Used on regular grid cards
   * during the recap window (Fri 22:30 → Mon 09:00 STO) so the visible
   * number matches the week-recap framing instead of stranding viewers
   * on Friday's intraday print. Sentiment glow + arrow follow the week
   * sign; today-based rating badge is hidden since its thresholds are
   * tuned to intraday moves. */
  weekChangePct?: number;
  /** Set true momentarily when the AI comment for this stock just changed.
   * Triggers a one-shot glow animation on the card. */
  flashing?: boolean;
  /** True when this ticker's market hasn't opened in the current
   * Stockholm calendar day. Drives the dimmed "market-closed" treatment
   * — gray border, neutral bg, reduced opacity — so live cards stand
   * out against the stale ones. */
  marketStale?: boolean;
  /** Stockholm calendar day (YYYY-MM-DD). Seeds the per-ticker fallback
   * line so it's stable per stock per day (SSR-safe, no hydration drift). */
  date: string;
};

function formatPrice(value: number, currency: string): string {
  if (!Number.isFinite(value)) return "N/A";
  // Use a stable, locale-independent format to avoid SSR/CSR drift.
  const fixed = value >= 100 ? value.toFixed(2) : value.toFixed(value >= 1 ? 2 : 4);
  return currency ? `${fixed}` : fixed;
}

function formatChangeAmount(value: number): string {
  if (!Number.isFinite(value)) return "N/A";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

function formatChangePct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function changeClass(value: number): string {
  if (!Number.isFinite(value)) return "change-neutral";
  if (value > 0) return "change-up";
  if (value < 0) return "change-down";
  return "change-neutral";
}

function changeArrow(value: number): string {
  if (!Number.isFinite(value)) return "·";
  if (value > 0) return "▲";
  if (value < 0) return "▼";
  return "·";
}

// The chip fills SOLID only at the extremes — a moon-tier ripper or a
// liquidated bagholder. Mild tiers get the outlined/tinted chip so the
// grid doesn't turn into a wall of solid blocks.
function isExtreme(sentiment: Sentiment): boolean {
  return sentiment === "moon" || sentiment === "rekt";
}

function fromGlory(price: number, high: number): string | null {
  if (!Number.isFinite(price) || !Number.isFinite(high) || high <= 0) return null;
  const pct = ((high - price) / high) * 100;
  if (pct < 0) return "ALL TIME HIGH";
  return `${pct.toFixed(1)}% FROM GLORY`;
}

export function StockCard({
  stock,
  analysis,
  index,
  featured,
  featuredScope = "week",
  featuredWeekChangePct,
  weekChangePct,
  flashing,
  marketStale,
  date,
}: StockCardProps) {
  // Week-framing mode: regular grid cards during the recap window. The
  // headline change row + sentiment glow follow the week change instead
  // of today's intraday print (which is Friday's close on Sat/Sun and
  // misleading next to a week-recap layout). Featured cards do their
  // own thing via featured/featuredScope/featuredWeekChangePct and are
  // unaffected by this flag.
  const useWeekFraming = !featured && weekChangePct !== undefined;
  const displayPct = useWeekFraming
    ? (weekChangePct as number)
    : stock.regularMarketChangePercent;

  // Rating + sentiment are pure functions of the visible pct — recompute
  // LIVE from the current snapshot price instead of using analysis.rating
  // / analysis.sentiment from cache. Otherwise these get frozen at the
  // value derived during the last AI run (~every 45 min) and drift out
  // of sync as prices refresh every 10 min via the cron: a card whose
  // live change% is -0.5% can end up tagged DIAMOND HANDS with a green
  // border because that's what it was 30 min ago when the AI last ran.
  const liveRating = deriveRating(stock.regularMarketChangePercent);
  const liveSentiment = deriveSentiment(displayPct);
  const mood = moodVar(liveSentiment);
  const solidChip = isExtreme(liveSentiment);

  // Featured cards during a week-scoped recap get a dedicated week
  // badge instead of the live daily rating — otherwise a card labelled
  // "WEEK'S BIGGEST WINNER +5.5%" can end up wearing 💀 LIQUIDATED
  // because today's intraday print happened to dump. Falls back to the
  // live daily rating outside the recap window or when the week change
  // isn't available.
  const weekBadge =
    featured && featuredScope === "week" && featuredWeekChangePct !== undefined
      ? deriveWeekBadge(featuredWeekChangePct, featured)
      : null;
  // Grid cards in week framing hide the rating badge — daily thresholds
  // (DIAMOND HANDS at +0.5%, TO THE MOON at +5%) don't translate to
  // weekly moves where +5% is just "a decent week". Featured weekBadge
  // already uses week-tuned thresholds and is unaffected.
  const displayRating = weekBadge ?? (useWeekFraming ? null : liveRating);
  const featuredClass = featured ? `featured ${featured}` : "";
  const cardClass = [
    "stock-card",
    featuredClass,
    // Extreme movers keep a static mood glow (via --glow-mood) so a
    // moon-tier ripper / liquidated bagholder still pops out of the grid
    // without every card glowing.
    !featured && solidChip ? "mood-extreme" : null,
    flashing ? "ai-update" : null,
    // Stale-market wins over the sentiment treatment visually because
    // its CSS rule has 2-class specificity (.stock-card.market-closed).
    marketStale ? "market-closed" : null,
  ]
    .filter(Boolean)
    .join(" ");

  // --mood drives the left spine, the chip, and the comment accent.
  // --mood-ink is the text color that sits on a SOLID chip: dark ink on
  // the bright moon green, light ink on the deep liquidated red.
  const style = {
    animationDelay: `${index * 60}ms`,
    "--mood": mood,
    "--mood-ink":
      liveSentiment === "moon" ? "var(--surface-0)" : "var(--text-0)",
  } as CSSProperties;

  const hasPrice = Number.isFinite(stock.regularMarketPrice);
  const glory = fromGlory(stock.regularMarketPrice, stock.fiftyTwoWeekHigh);

  // Fallback take line for when there's no AI comment — a per-ticker
  // one-liner keyed to this stock's own tier (stale → notTraded), stable
  // per stock per day, with the owner tag filled in when there is one.
  const lineTier = deriveTickerTier(displayPct, !marketStale);
  const fallbackLine = tickerLine(
    stock.ticker,
    date,
    lineTier,
    primaryOwnerName(stock.ticker),
  );

  const scopeLabel = featuredScope === "week" ? "WEEK" : "TODAY";
  const hasWeekChange =
    featured && Number.isFinite(featuredWeekChangePct ?? NaN);

  return (
    <Link
      href={`/stock/${encodeURIComponent(stock.ticker)}`}
      className="stock-card-link"
      aria-label={`${stock.name} detail`}
    >
    <article className={cardClass} style={style}>
      {featured === "winner" && (
        <div className="featured-label win">
          ▲ {scopeLabel}&apos;S BIGGEST WINNER 🚀
        </div>
      )}
      {featured === "loser" && (
        <div className="featured-label lose">
          ▼ {scopeLabel}&apos;S BIGGEST LOSER 📉
        </div>
      )}
      {hasWeekChange && (
        <div
          className={`featured-week ${changeClass(featuredWeekChangePct ?? 0)}`}
        >
          {formatChangePct(featuredWeekChangePct ?? 0)} this week
        </div>
      )}

      <div className="card-header flex items-start justify-between gap-3">
        <div>
          <div className="name">{stock.name}</div>
          <div className="ticker">{displayTicker(stock.ticker)}</div>
        </div>
        {displayRating && (
          <div className={`rating ${solidChip ? "rating-solid" : ""}`}>
            {displayRating}
          </div>
        )}
      </div>

      <div className="price-row">
        <span className={`price ${hasPrice ? "" : "na"}`}>
          {hasPrice ? formatPrice(stock.regularMarketPrice, stock.currency) : "N/A"}
        </span>
        {hasPrice && stock.currency && (
          <span className="currency">{stock.currency}</span>
        )}
        {useWeekFraming ? (
          <span className={`change ${changeClass(displayPct)}`}>
            {changeArrow(displayPct)} WEEK {formatChangePct(displayPct)}
          </span>
        ) : (
          <span className={`change ${changeClass(stock.regularMarketChangePercent)}`}>
            {changeArrow(stock.regularMarketChangePercent)}{" "}
            {formatChangeAmount(stock.regularMarketChange)}{" "}
            ({formatChangePct(stock.regularMarketChangePercent)})
          </span>
        )}
      </div>

      {/* Divided info strip. The take slot always renders — a quiet
          card gets a mood-tinted rule-based line so its height and
          rhythm match a card with a real analyst comment, instead of
          collapsing to a shorter, broken-looking card. */}
      <div className="card-strip">
        {analysis?.comment ? (
          <p className="comment">&ldquo;{analysis.comment}&rdquo;</p>
        ) : (
          <p className="comment comment-empty">{`// ${fallbackLine}`}</p>
        )}
        {glory && <p className="meta">{glory}</p>}
      </div>
    </article>
    </Link>
  );
}
