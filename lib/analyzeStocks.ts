import Anthropic from "@anthropic-ai/sdk";
import { PERSON_NAMES, TICKERS } from "./tickers";
import {
  RATINGS,
  SENTIMENTS,
  type AnalysisPayload,
  type Rating,
  type Sentiment,
  type StockAnalysis,
  type StockPrice,
} from "./types";

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are a degenerate WSB analyst with peak Gordon Gekko energy. You eat ramen and dream of yachts. You speak in WSB slang — apes, tendies, bagholder, diamond hands, paper hands, rekt, moon, yolo, printer go brrr — but you back your hot takes with the actual numbers you're given.

You will receive structured price data for a small portfolio of stocks. Every stock gets a rating + sentiment. A comment is OPTIONAL — only the worthy stocks get one. Then judge the portfolio as a whole in overallMood.

Rating ↔ sentiment alignment:
- 🚀 TO THE MOON → moon
- 💎 DIAMOND HANDS → up (or neutral if it's a hold-through-pain take)
- 📈 BULLISH AF → up
- ⚠️ TURBULENCE → neutral
- 📉 GET REKT → rekt (or down for milder pain)
- 🔥 YOLO CALL → moon (high conviction, high risk)

Pick biggestWinner / biggestLoser by today's regularMarketChangePercent.

WHEN TO INCLUDE A COMMENT (otherwise OMIT the comment field entirely):
- Today's regularMarketChangePercent is >+3% or <-3% (big move worth roasting)
- The rating is 🚀 TO THE MOON, 📉 GET REKT, or 🔥 YOLO CALL (dramatic call)
- The stock has an "owners" array AND today's move is >+1.5% or <-1.5% (someone we know cares + something to say)

If none of those apply, omit the comment field. The card will display just the rating + price + change. Clean. Better than filler.

THE FRIEND GROUP:
Some stocks have an "owners" array — those are the friends in the group (Chris, Eric, or Oskar). When you DO comment on an owned stock with a dramatic move, weave the owner's first name into the comment or the overallMood. Examples:
- "Chris's NET printing tendies tonight"
- "Oskar's Dicot bagholders capitulating"
- "Eric's industrials grinding higher, atlas copco leading"

Comments are ≤ 10 words, punchy, slang-heavy. No filler. The overallMood is ONE dramatic WSB sentence about the whole portfolio.`;

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    stocks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ticker: { type: "string" },
          rating: { type: "string", enum: [...RATINGS] },
          sentiment: { type: "string", enum: [...SENTIMENTS] },
          comment: { type: "string" },
        },
        required: ["ticker", "rating", "sentiment"],
        additionalProperties: false,
      },
    },
    overallMood: { type: "string" },
    biggestWinner: { type: "string" },
    biggestLoser: { type: "string" },
  },
  required: ["stocks", "overallMood", "biggestWinner", "biggestLoser"],
  additionalProperties: false,
} as const;

function isRating(v: unknown): v is Rating {
  return typeof v === "string" && (RATINGS as readonly string[]).includes(v);
}

function isSentiment(v: unknown): v is Sentiment {
  return typeof v === "string" && (SENTIMENTS as readonly string[]).includes(v);
}

function validatePayload(data: unknown, inputTickers: string[]): AnalysisPayload {
  if (typeof data !== "object" || data === null) {
    throw new Error("analysis response is not an object");
  }
  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.stocks)) {
    throw new Error("analysis.stocks is not an array");
  }
  const tickerSet = new Set(inputTickers);
  const stocks: StockAnalysis[] = obj.stocks.map((s, i) => {
    if (typeof s !== "object" || s === null) {
      throw new Error(`stocks[${i}] is not an object`);
    }
    const r = s as Record<string, unknown>;
    if (typeof r.ticker !== "string" || !tickerSet.has(r.ticker)) {
      throw new Error(`stocks[${i}].ticker is missing or unknown: ${String(r.ticker)}`);
    }
    if (!isRating(r.rating)) {
      throw new Error(`stocks[${i}].rating is invalid: ${String(r.rating)}`);
    }
    if (!isSentiment(r.sentiment)) {
      throw new Error(`stocks[${i}].sentiment is invalid: ${String(r.sentiment)}`);
    }
    if (r.comment !== undefined && typeof r.comment !== "string") {
      throw new Error(`stocks[${i}].comment must be a string when present`);
    }
    return {
      ticker: r.ticker,
      rating: r.rating,
      sentiment: r.sentiment,
      ...(typeof r.comment === "string" ? { comment: r.comment } : {}),
    };
  });

  if (typeof obj.overallMood !== "string") {
    throw new Error("analysis.overallMood is not a string");
  }
  if (typeof obj.biggestWinner !== "string") {
    throw new Error("analysis.biggestWinner is not a string");
  }
  if (typeof obj.biggestLoser !== "string") {
    throw new Error("analysis.biggestLoser is not a string");
  }

  return {
    stocks,
    overallMood: obj.overallMood,
    biggestWinner: obj.biggestWinner,
    biggestLoser: obj.biggestLoser,
  };
}

function ownersByTickerSymbol(): Map<string, string[]> {
  return new Map(
    TICKERS.map((t) => [
      t.symbol,
      (t.owners ?? []).map((p) => PERSON_NAMES[p]),
    ]),
  );
}

export async function analyzeStocks(prices: StockPrice[]): Promise<AnalysisPayload> {
  console.log(`[analyzeStocks] analyzing ${prices.length} stocks with ${MODEL}`);

  const client = new Anthropic();

  // Enrich prices with owner names so Claude can reference the friend
  // when something dramatic happens with their pick.
  const ownersMap = ownersByTickerSymbol();
  const enriched = prices.map((p) => {
    const owners = ownersMap.get(p.ticker) ?? [];
    return owners.length > 0 ? { ...p, owners } : p;
  });

  const userMessage = `Here is today's price data for ${prices.length} stocks. Analyze each one and the portfolio as a whole.\n\n${JSON.stringify(enriched, null, 2)}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    output_config: {
      format: { type: "json_schema", schema: ANALYSIS_SCHEMA },
    },
  });

  if (response.stop_reason === "refusal") {
    const explanation = response.stop_details && "explanation" in response.stop_details
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
  return validatePayload(parsed, inputTickers);
}
