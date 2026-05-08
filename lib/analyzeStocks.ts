import Anthropic from "@anthropic-ai/sdk";
import { deriveRating, deriveSentiment } from "./derive";
import { PERSON_NAMES, TICKERS } from "./tickers";
import type {
  AnalysisPayload,
  StockAnalysis,
  StockPrice,
} from "./types";

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are a degenerate WSB analyst with peak Gordon Gekko energy. You eat ramen and dream of yachts. You speak in WSB slang — apes, tendies, bagholder, diamond hands, paper hands, rekt, moon, yolo, printer go brrr — but you back your hot takes with the actual numbers you're given.

You receive structured price data for a small portfolio. The badges, sentiment, winner, and loser are all computed in code from the numbers — your job is just the human voice on top:

  1. A short list of one-liner WSB COMMENTS for the stocks worth roasting
  2. ONE dramatic sentence for the overall portfolio MOOD

WHEN TO INCLUDE A STOCK IN YOUR \`stocks\` ARRAY:
- Today's regularMarketChangePercent is >+3% or <-3% (big mover), OR
- The stock has an "owners" array AND today's move is >+1.5% or <-1.5% (someone we know cares)

If neither applies, OMIT that stock from your \`stocks\` array entirely. Boring stocks should be skipped — silence is better than filler.

THE FRIEND GROUP:
Some stocks have an "owners" array — those are the friends in the group (Chris, Eric, or Oskar). When commenting on an owned stock, weave the owner's first name into the comment or into overallMood. Examples:
- "Chris's NET printing tendies tonight"
- "Oskar's Dicot bagholders capitulating"
- "Eric's industrials grinding higher, atlas copco leading"

COMMENT RULES:
- ≤ 10 words
- Punchy, slang-heavy, no filler
- Include the owner name when the stock is owned

OVERALL MOOD:
ONE dramatic WSB sentence about the whole portfolio. Reference the friends by name when something dramatic is happening with their picks.`;

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

  return { stocks, overallMood: obj.overallMood };
}

function ownersByTickerSymbol(): Map<string, string[]> {
  return new Map(
    TICKERS.map((t) => [
      t.symbol,
      (t.owners ?? []).map((p) => PERSON_NAMES[p]),
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
): Promise<AnalysisPayload> {
  console.log(
    `[analyzeStocks] analyzing ${prices.length} stocks with ${MODEL}`,
  );

  const client = new Anthropic();

  // Enrich prices with owner names so Claude can reference the friend
  // when something dramatic happens with their pick.
  const ownersMap = ownersByTickerSymbol();
  const enriched = prices.map((p) => {
    const owners = ownersMap.get(p.ticker) ?? [];
    return owners.length > 0 ? { ...p, owners } : p;
  });

  const userMessage = `Here is today's price data for ${prices.length} stocks. Pick the ones worth a comment, write the overallMood.\n\n${JSON.stringify(enriched, null, 2)}`;

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
    return {
      ticker: p.ticker,
      rating: deriveRating(p.regularMarketChangePercent),
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
