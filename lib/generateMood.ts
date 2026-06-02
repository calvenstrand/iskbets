import Anthropic from "@anthropic-ai/sdk";
import { isMarketInRegularSession, tradedTodaySignal } from "./marketHours";
import { buildMarketsHeader } from "./marketState";
import { PEOPLE, TICKERS } from "./tickers";
import type { StockPrice } from "./types";

// Sonnet 4.6 for the mood headline. Split out from the per-ticker
// analyzer (lib/analyzeStocks.ts, on Haiku) because the mood needs
// tighter, punchier prose than Haiku reliably produces — Haiku tended
// to enumerate every ticker into one long sentence. This call fires on
// its own stricter cadence (see shouldRerunMood in the trigger route),
// so day-baseline is ~$0.03-0.05 — small fraction of total AI spend.
const MODEL = "claude-sonnet-4-6";

const FRIEND_NAMES = Object.values(PEOPLE);
const FRIEND_LIST_PROSE =
  FRIEND_NAMES.length <= 1
    ? (FRIEND_NAMES[0] ?? "")
    : `${FRIEND_NAMES.slice(0, -1).join(", ")}, or ${FRIEND_NAMES.at(-1)}`;

const SYSTEM_PROMPT = `You are a degenerate WSB analyst with peak Gordon Gekko energy. You speak in WSB slang — apes, tendies, bagholder, diamond hands, paper hands, rekt, moon, yolo, printer go brrr — but you back hot takes with the actual numbers.

YOUR ONLY JOB IS THE OVERALL MOOD LINE — one tight WSB sentence about the whole portfolio. Per-ticker comments are handled by a separate call; do NOT write per-ticker commentary here.

HARD RULES FOR THE MOOD LINE:
- ≤ 25 words. Hard cap. If you're tempted to add a third clause, cut.
- Cite AT MOST 2-3 tickers, not the whole portfolio. Pick the strongest thread; don't enumerate.
- Em-dash is fine for ONE twist, but the line should read as a single thought — not a list with conjunctions.
- Reference friends when something dramatic is happening with their picks. Naming: first name for 1-owner picks (e.g. "Oskar's Dicot"), a collective phrase for 2+ owners — "the gang" / "the syndicate" / "<count> apes" / "<count> degens". The friend group is ${FRIEND_LIST_PROSE}.

MARKET TIMING — READ THE MARKETS RIGHT NOW HEADER FIRST:
The user message starts with a header classifying SE and US as LIVE, FRESH-FROZEN, or STALE-FROZEN. Apply STRICTLY:
- The mood headline comes from TODAY'S story. LIVE and FRESH-FROZEN sides both count as "today" — a market that closed today still owns today's story until midnight STO. Pick whichever side has the bigger story (largest moves, owner-pick drama, sweep), regardless of which side is technically open right now.
- A STALE-FROZEN side is "yesterday." Do NOT lead the mood with a STALE-FROZEN ticker's number even if it looks dramatic — that move already happened. A STALE-FROZEN side MAY be referenced as background context if directly relevant (e.g. "the gang shrugging off yesterday's NVDA crash, Stockholm holding steady"), never as the headline.
- If BOTH sides are STALE-FROZEN (overnight before any market opens), describe the portfolio's standing without "today" claims.

EXAMPLES:
GOOD (tight, one thread, ≤25 words):
  "Oskar's ACCON +14% lighting the SE board — the gang eating Wallenberg tendies."
  "PLTR -5% and MSTR's -13% WTD spiral dragging the syndicate; ATCO holding the line."
  "Stockholm grinding green into the close, the gang stacking small wins ahead of NY open."

BAD (cramming, list-with-conjunctions, multi-clause):
  "NVDA +3%, ATCO +4%, VOLV +3% pumping NASDAQ tech/industrial, but PLTR -5%, DDOG -6%, SHOP -4.5%, COIN -4% and MSTR -13% WTD dragging the vibe — Oskar's small-cap bets adding chaos."

Return just the mood line, nothing else.`;

const SCHEMA = {
  type: "object",
  properties: {
    overallMood: { type: "string" },
  },
  required: ["overallMood"],
  additionalProperties: false,
} as const;

function ownersByTickerSymbol(): Map<string, string[]> {
  return new Map(
    TICKERS.map((t) => [t.symbol, (t.owners ?? []).map((p) => PEOPLE[p])]),
  );
}

/**
 * Generate ONE WSB-style mood sentence about the whole portfolio.
 * Called on its own stricter cadence (see shouldRerunMood in the
 * trigger route): three daily Stockholm checkpoints (09:30, 16:00,
 * 22:00) plus big-delta and 6h-freshness backstops.
 */
export async function generateMood(prices: StockPrice[]): Promise<string> {
  console.log(
    `[generateMood] generating mood for ${prices.length} stocks with ${MODEL}`,
  );

  const client = new Anthropic();

  // Same enrichment as the comments call: owners + marketLive so the
  // model knows which numbers are today vs frozen at the per-ticker
  // level, on top of the per-market state in the MARKETS RIGHT NOW
  // header. Context blurbs are omitted — they're for per-ticker
  // commentary, not the headline mood.
  const ownersMap = ownersByTickerSymbol();
  const tickerMeta = new Map(TICKERS.map((t) => [t.symbol, t]));
  const now = new Date();
  const enriched = prices.map((p) => {
    const meta = tickerMeta.get(p.ticker);
    const marketLive = meta
      ? isMarketInRegularSession(meta.market, now) &&
        tradedTodaySignal(p.lastTradeAt, now)
      : false;
    const owners = ownersMap.get(p.ticker) ?? [];
    return {
      ticker: p.ticker,
      name: p.name,
      regularMarketChangePercent: p.regularMarketChangePercent,
      marketLive,
      ...(owners.length > 0 ? { owners } : {}),
    };
  });

  const marketsHeader = buildMarketsHeader(prices, now);
  const userMessage = `${marketsHeader}Write ONE mood line per the rules above. Portfolio:\n${JSON.stringify(enriched, null, 2)}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    output_config: {
      format: { type: "json_schema", schema: SCHEMA },
    },
  });

  if (response.stop_reason === "refusal") {
    const explanation =
      response.stop_details && "explanation" in response.stop_details
        ? response.stop_details.explanation
        : "no explanation";
    throw new Error(`anthropic refused: ${explanation}`);
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("anthropic response has no text block");
  }

  console.log(
    `[generateMood] tokens in=${response.usage.input_tokens} out=${response.usage.output_tokens}`,
  );

  const parsed: unknown = JSON.parse(textBlock.text);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("mood response is not an object");
  }
  const mood = (parsed as Record<string, unknown>).overallMood;
  if (typeof mood !== "string") {
    throw new Error("mood response missing overallMood string");
  }
  return mood;
}
