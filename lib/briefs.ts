import Anthropic from "@anthropic-ai/sdk";
import { PEOPLE, TICKERS } from "./tickers";
import type { StoredData } from "./types";

const MODEL = "claude-sonnet-4-6";

const FRIEND_NAMES = Object.values(PEOPLE);
const FRIEND_LIST_PROSE =
  FRIEND_NAMES.length <= 1
    ? (FRIEND_NAMES[0] ?? "")
    : `${FRIEND_NAMES.slice(0, -1).join(", ")}, or ${FRIEND_NAMES.at(-1)}`;

const SHARED_VOICE = `You are a degenerate WSB analyst writing for a small group of friends (${FRIEND_LIST_PROSE}) who track a curated portfolio together. Voice: WSB Gordon Gekko, slang-heavy (apes, tendies, bagholders, diamond hands, paper hands, rekt, moon, yolo, printer go brrr). 3 to 4 sentences. Punchy, playful, no filler.

THE FRIEND GROUP:
Some stocks have an "owners" array. When their picks moved meaningfully, weave the owner's first name in. When 2+ friends share a pick and it's notable, use a collective phrase (the gang, the syndicate, "the apes", "<count> degens") — never list multiple names. Vary the phrase across sentences.

OUTPUT: plain text only — no JSON, no markdown, no preamble. Just the brief.`;

const MORNING_SYSTEM = `${SHARED_VOICE}

This is the MORNING WIRE. Stockholm opens in ~30 minutes. You're reflecting on yesterday's close and setting the tone for today. Reference yesterday's biggest movers, the friend group's wins/losses, and (if it fits) what to watch today. Slightly ominous, anticipatory.`;

const EVENING_SYSTEM = `${SHARED_VOICE}

This is the EVENING WRAP. The NY closing bell just rang. You're delivering today's verdict — what happened, who won, who got rekt. Decisive, sometimes gloating, sometimes mournful. End with a one-beat "tomorrow" note or a sleep-tight goodnight to the bagholders.`;

function ownersByTicker(): Map<string, string[]> {
  return new Map(
    TICKERS.map((t) => [
      t.symbol,
      (t.owners ?? []).map((p) => PEOPLE[p]),
    ]),
  );
}

/** Strip down a snapshot to the fields Claude needs — keeps the prompt small. */
function summarize(snapshot: StoredData) {
  const ownersMap = ownersByTicker();
  return {
    overallMood: snapshot.analysis.overallMood,
    biggestWinner: snapshot.analysis.biggestWinner,
    biggestLoser: snapshot.analysis.biggestLoser,
    capturedAt: snapshot.updatedAt,
    stocks: snapshot.stocks.map((s) => {
      const owners = ownersMap.get(s.ticker) ?? [];
      return {
        ticker: s.ticker,
        name: s.name,
        currency: s.currency,
        regularMarketPrice: s.regularMarketPrice,
        regularMarketChangePercent: s.regularMarketChangePercent,
        ...(owners.length > 0 ? { owners } : {}),
      };
    }),
  };
}

async function callClaude(system: string, user: string): Promise<string> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system,
    messages: [{ role: "user", content: user }],
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
    `[briefs] tokens in=${response.usage.input_tokens} out=${response.usage.output_tokens}`,
  );

  return textBlock.text.trim();
}

export async function generateMorningBrief(
  yesterday: StoredData,
): Promise<string> {
  console.log(`[briefs] generating morning brief from ${yesterday.updatedAt}`);
  const userMessage = `Yesterday's close — reflect on it and set up today.\n\n${JSON.stringify(summarize(yesterday), null, 2)}`;
  return callClaude(MORNING_SYSTEM, userMessage);
}

export async function generateEveningBrief(
  today: StoredData,
): Promise<string> {
  console.log(`[briefs] generating evening brief for ${today.updatedAt}`);
  const userMessage = `Today's close — wrap it up.\n\n${JSON.stringify(summarize(today), null, 2)}`;
  return callClaude(EVENING_SYSTEM, userMessage);
}
