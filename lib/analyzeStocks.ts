import Anthropic from "@anthropic-ai/sdk";
import { deriveRating, deriveSentiment } from "./derive";
import {
  pickTodayWinnerLoser,
  pickWeekWinnerLoser,
} from "./leaderboard";
import { isMarketInRegularSession, tradedTodaySignal } from "./marketHours";
import { PEOPLE, TICKERS } from "./tickers";
import type {
  AnalysisPayload,
  StockAnalysis,
  StockPrice,
} from "./types";

const MODEL = "claude-sonnet-4-6";

// Derived from PEOPLE so the prompt stays in sync when friends are added.
// E.g. ["Chris","Eric","Oskar"] → "Chris, Eric, or Oskar".
const FRIEND_NAMES = Object.values(PEOPLE);
const FRIEND_LIST_PROSE =
  FRIEND_NAMES.length <= 1
    ? (FRIEND_NAMES[0] ?? "")
    : `${FRIEND_NAMES.slice(0, -1).join(", ")}, or ${FRIEND_NAMES.at(-1)}`;

const SYSTEM_PROMPT = `You are a degenerate WSB analyst with peak Gordon Gekko energy. You eat ramen and dream of yachts. You speak in WSB slang — apes, tendies, bagholder, diamond hands, paper hands, rekt, moon, yolo, printer go brrr — but you back your hot takes with the actual numbers you're given.

You receive structured price data for a small portfolio. The badges, sentiment, winner, and loser are all computed in code from the numbers — your job is just the human voice on top:

  1. A short list of one-liner WSB COMMENTS for the stocks worth roasting
  2. ONE dramatic sentence for the overall portfolio MOOD

MARKET LIVENESS — READ THIS FIRST:
Each price entry has a \`marketLive\` boolean.
- \`marketLive: true\` → the ticker's market is currently in its REGULAR trading session right now (orderbook open, normal liquidity). \`regularMarketChangePercent\` is today's live intraday move. Comment freely as "today's" / "this morning's" / "right now" action.
- \`marketLive: false\` → the market is NOT in its regular session right now. This includes overnight, weekend, the OTHER region's session, AND pre-market / post-market hours of this ticker's own region. \`regularMarketChangePercent\` is either FROZEN from the last completed regular session OR a thin pre/post-market print that we don't trust. Stockholm regular session is 09:00–17:30 STO; NY regular session is 15:30–22:00 STO. Outside those exact windows, that region's tickers are not live.

CRITICAL: pre-market and post-market quotes on illiquid stocks (especially the smaller US tickers like JOBY, IONQ, QBTS, DFTX) can print misleading values from a single small trade. NEVER cite a pre-market or after-hours number as "today's move" or describe it as "premarket pumping/crashing X%" — even if the number looks dramatic, treat it as not-yet-happened until the regular session opens. If the data shows a US ticker at -23% and marketLive is false, that number reflects either Friday's close OR a thin overnight print; do NOT write commentary around it.

For \`marketLive: false\` tickers, skip the today-based inclusion criteria below. Only include them via MUST COMMENT (their WEEK move is what matters then) or 3+ owner consensus. If you do mention one, frame it without claiming it moved today — e.g. "NET still bagholder territory at -8% since Friday close" or just describe its standing without temporal claims.

WHEN TO INCLUDE A STOCK IN YOUR \`stocks\` ARRAY:
- The user message lists tickers under "MUST COMMENT" — ALWAYS include those, regardless of move size. Each entry is tagged with whether to comment on the WEEK'S move or TODAY'S move (see arrow hint at end of line). These tickers drive the dashboard's featured cards and need to never be silent, OR
- The stock has 3+ owners (a group-consensus pick) — ALWAYS include, regardless of move size, OR
- \`marketLive: true\` AND today's regularMarketChangePercent is >+3% or <-3% (big mover), OR
- \`marketLive: true\` AND the stock has 1 or 2 owners AND today's move is >+1.5% or <-1.5%

If none of these apply, OMIT that stock from your \`stocks\` array entirely. Boring stocks should be skipped — silence is better than filler.

THE FRIEND GROUP:
Some stocks have an "owners" array — those are the friends in the group (${FRIEND_LIST_PROSE}). A stock can be owned by several friends at once. Refer to the owner(s) like this:
- 1 owner → use the first name. e.g. "Chris's NET printing tendies tonight", "Oskar's Dicot bagholders capitulating"
- 2+ owners → use a collective phrase, NEVER list multiple names. Pick whichever fits the tone of the line:
  - "<count> apes" or "the apes" — generic WSB
  - "the gang" — friendly, casual
  - "the syndicate" — Wall Street operator vibe
  - "<count> degens" — self-deprecating WSB
  - examples: "two apes' Tesla rekt at -8%", "the gang's Investor B grinding higher", "three degens bagholding INVE B at session low", "syndicate's NVDA printing tendies"
- Vary the collective phrase across comments — don't reuse the same one every time.

COMMENT RULES:
- ≤ 10 words (≤ 14 for tickers with a \`context\` field — see TICKER CONTEXT below)
- Punchy, slang-heavy, no filler
- Refer to owners by first name (1 owner) or a collective phrase (2+ owners) — never list multiple names
- For MUST COMMENT entries marked "→ comment on the WEEK'S move", reference the WEEK'S % — e.g. "Hacksaw +8% on the week, slot machines printing"
- For MUST COMMENT entries marked "→ comment on TODAY'S move", reference today's % even if the move is small — e.g. "Volvo grinding +0.4% on a slow Monday, industrial discipline"

TICKER CONTEXT:
Some tickers carry a \`context\` field with terse business background — what the company does, what stage of development, imminent catalysts, ownership structure, mechanism specifics, etc. When a ticker has \`context\`, weave one of those specifics into the comment INSTEAD of generic "stonks go up" phrasing. The context is what makes the line useful instead of wallpaper.

Pick the angle that fits the day's move:
- Big down day + dilution context → "Oskar's Dicot -7%, ED biotech speedrunning the 210M rights-issue dump"
- Quiet day + catalyst context → "Oskar's Dicot grinding sideways, all eyes on Phase 2b readout"
- Positive trial news + mechanism context → "Oskar's Dicot +12%, LIB-01 Phase 2a data smashing Viagra paradigm"

Do NOT just paste the context verbatim. Distill ONE relevant detail. Stay in WSB voice. If the context mentions multiple things (mechanism + catalyst + dilution + valuation), pick the one most relevant to what the price is doing today.

For tickers without \`context\`, fall back to generic WSB framing using the friend's name + the magnitude of the move.

OVERALL MOOD:
ONE dramatic WSB sentence about the whole portfolio. Reference friends when something dramatic is happening with their picks — same naming rule as comments (first name for 1-owner picks, a collective phrase like "the gang" / "the syndicate" / "<count> apes" / "<count> degens" for 2+ owners). Anchor the line to whichever market(s) are actually live right now: if only Stockholm is open, talk about the SE side without pretending US tickers are doing anything; if only NY is open, the inverse. Don't claim portfolio-wide moves when half the data is frozen from the previous session.`;

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    stocks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ticker: { type: "string" },
          comment: { type: "string" },
        },
        required: ["ticker", "comment"],
        additionalProperties: false,
      },
    },
    overallMood: { type: "string" },
  },
  required: ["stocks", "overallMood"],
  additionalProperties: false,
} as const;

type ClaudeResponse = {
  stocks: { ticker: string; comment: string }[];
  overallMood: string;
};

function validateClaudeResponse(
  data: unknown,
  inputTickers: string[],
): ClaudeResponse {
  if (typeof data !== "object" || data === null) {
    throw new Error("analysis response is not an object");
  }
  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.stocks)) {
    throw new Error("analysis.stocks is not an array");
  }
  const tickerSet = new Set(inputTickers);
  const stocks: ClaudeResponse["stocks"] = obj.stocks.map((s, i) => {
    if (typeof s !== "object" || s === null) {
      throw new Error(`stocks[${i}] is not an object`);
    }
    const r = s as Record<string, unknown>;
    if (typeof r.ticker !== "string" || !tickerSet.has(r.ticker)) {
      throw new Error(
        `stocks[${i}].ticker is missing or unknown: ${String(r.ticker)}`,
      );
    }
    if (typeof r.comment !== "string") {
      throw new Error(`stocks[${i}].comment is not a string`);
    }
    return { ticker: r.ticker, comment: r.comment };
  });

  if (typeof obj.overallMood !== "string") {
    throw new Error("analysis.overallMood is not a string");
  }

  return {
    stocks,
    overallMood: obj.overallMood,
  };
}

function ownersByTickerSymbol(): Map<string, string[]> {
  return new Map(
    TICKERS.map((t) => [
      t.symbol,
      (t.owners ?? []).map((p) => PEOPLE[p]),
    ]),
  );
}

function pickBiggestWinnerLoser(prices: StockPrice[]): {
  biggestWinner: string;
  biggestLoser: string;
} {
  if (prices.length === 0) return { biggestWinner: "", biggestLoser: "" };
  let winner = prices[0]!;
  let loser = prices[0]!;
  for (const p of prices) {
    if (p.regularMarketChangePercent > winner.regularMarketChangePercent) {
      winner = p;
    }
    if (p.regularMarketChangePercent < loser.regularMarketChangePercent) {
      loser = p;
    }
  }
  return { biggestWinner: winner.ticker, biggestLoser: loser.ticker };
}

export async function analyzeStocks(
  prices: StockPrice[],
  /** Optional Monday-baseline ticker→price map. When provided, the
   * analyzer computes the week's biggest winner + loser and tells
   * Claude they MUST be commented on regardless of today's move —
   * so the dashboard's featured cards always have a line under them.
   * When undefined (fresh deploy or stale baseline), falls back to
   * today-only comment criteria. */
  weekStartPrices?: Record<string, number>,
): Promise<AnalysisPayload> {
  console.log(
    `[analyzeStocks] analyzing ${prices.length} stocks with ${MODEL}`,
  );

  const client = new Anthropic();

  // Enrich prices with owner names so Claude can reference the friend
  // when something dramatic happens with their pick. Also tag each
  // ticker with `marketLive` — true ONLY when the market is in its
  // regular orderbook session right now, NOT pre-market or post-market.
  //
  // Why strict (isMarketInRegularSession) and not the broader
  // isMarketLive used by fetchPrices: pre-market quotes from Finnhub
  // on thin US-stock volume can print absurd values (e.g. -23% on a
  // single small order that disappears within minutes). Treating
  // those as "today's intraday" produced AI commentary that contradicts
  // observable reality — Claude wrote "NET evaporate -23% premarket"
  // while the actual orderbook sat near 0. By gating marketLive to the
  // regular session, pre-market data falls under the prompt's "frozen
  // from last session" rule and Claude stays appropriately conservative.
  // See lib/marketHours.ts for the function pair.
  const ownersMap = ownersByTickerSymbol();
  const tickerMeta = new Map(TICKERS.map((t) => [t.symbol, t]));
  const now = new Date();
  const enriched = prices.map((p) => {
    const meta = tickerMeta.get(p.ticker);
    // Regular-session clock check, vetoed by the holiday signal: on a
    // closed exchange the session window is "open" but `lastTradeAt`
    // still points at the previous trading day, so marketLive goes false
    // and Claude treats the frozen number as last-session data instead of
    // narrating it as "today's move".
    const marketLive = meta
      ? isMarketInRegularSession(meta.market, now) &&
        tradedTodaySignal(p.lastTradeAt, now)
      : false;
    const owners = ownersMap.get(p.ticker) ?? [];
    const context = meta?.context;
    return {
      ...p,
      marketLive,
      ...(owners.length > 0 ? { owners } : {}),
      ...(context ? { context } : {}),
    };
  });

  // Force-include the week's AND today's biggest mover/dragger so the
  // dashboard's featured cards always have a comment underneath, even
  // on a flat day when the today winner moved +0.4%. Each entry is
  // tagged with an arrow hint telling Claude which timeframe to
  // reference in its comment. Dedupes:
  //   - same ticker as both today's winner AND week's winner → only
  //     keep the week entry (week framing implies more context)
  //   - same ticker as today's winner AND today's loser (only one
  //     stock has finite data) → drop the loser
  const weekMovers = pickWeekWinnerLoser(prices, weekStartPrices);
  const todayMovers = pickTodayWinnerLoser(prices, new Date());
  const weekTickers = new Set<string>();
  const mustCommentBlock: string[] = [];
  if (weekMovers.winner) {
    weekTickers.add(weekMovers.winner.ticker);
    mustCommentBlock.push(
      `- ${weekMovers.winner.ticker} (week's biggest WINNER, ${weekMovers.winner.weekChangePct.toFixed(2)}% WTD) → comment on the WEEK'S move`,
    );
  }
  if (weekMovers.loser) {
    weekTickers.add(weekMovers.loser.ticker);
    mustCommentBlock.push(
      `- ${weekMovers.loser.ticker} (week's biggest LOSER, ${weekMovers.loser.weekChangePct.toFixed(2)}% WTD) → comment on the WEEK'S move`,
    );
  }
  const todayWinnerTicker = todayMovers.winner?.ticker;
  const todayLoserTicker = todayMovers.loser?.ticker;
  if (
    todayMovers.winner &&
    todayWinnerTicker &&
    !weekTickers.has(todayWinnerTicker)
  ) {
    mustCommentBlock.push(
      `- ${todayMovers.winner.ticker} (today's biggest WINNER, ${todayMovers.winner.changePct.toFixed(2)}% today) → comment on TODAY'S move`,
    );
  }
  if (
    todayMovers.loser &&
    todayLoserTicker &&
    todayLoserTicker !== todayWinnerTicker &&
    !weekTickers.has(todayLoserTicker)
  ) {
    mustCommentBlock.push(
      `- ${todayMovers.loser.ticker} (today's biggest LOSER, ${todayMovers.loser.changePct.toFixed(2)}% today) → comment on TODAY'S move`,
    );
  }
  const mustCommentSection =
    mustCommentBlock.length > 0
      ? `MUST COMMENT — these tickers ALWAYS get a comment regardless of move size. The arrow hint at the end tells you which timeframe to reference.\n${mustCommentBlock.join("\n")}\n\n`
      : "";

  const userMessage = `Here is today's price data for ${prices.length} stocks. Pick the ones worth a comment, write the overallMood.\n\n${mustCommentSection}ALL PRICE DATA:\n${JSON.stringify(enriched, null, 2)}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    output_config: {
      format: { type: "json_schema", schema: ANALYSIS_SCHEMA },
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
    `[analyzeStocks] tokens in=${response.usage.input_tokens} out=${response.usage.output_tokens}`,
  );

  const parsed: unknown = JSON.parse(textBlock.text);
  const inputTickers = prices.map((p) => p.ticker);
  const claudeOut = validateClaudeResponse(parsed, inputTickers);

  // Build the per-stock analysis: rating + sentiment derived from the data,
  // comment merged in from Claude when present.
  const commentByTicker = new Map(
    claudeOut.stocks.map((s) => [s.ticker, s.comment]),
  );
  const stocks: StockAnalysis[] = prices.map((p) => {
    const comment = commentByTicker.get(p.ticker);
    const rating = deriveRating(p.regularMarketChangePercent);
    return {
      ticker: p.ticker,
      ...(rating ? { rating } : {}),
      sentiment: deriveSentiment(p.regularMarketChangePercent),
      ...(comment ? { comment } : {}),
    };
  });

  const { biggestWinner, biggestLoser } = pickBiggestWinnerLoser(prices);

  return {
    stocks,
    overallMood: claudeOut.overallMood,
    biggestWinner,
    biggestLoser,
  };
}
