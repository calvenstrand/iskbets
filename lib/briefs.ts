import Anthropic from "@anthropic-ai/sdk";
import { PEOPLE, TICKERS } from "./tickers";
import type { StoredData, WeekStartSnapshot } from "./types";

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

const WEEKEND_SYSTEM = `${SHARED_VOICE.replace("3 to 4 sentences.", "4 to 6 sentences.")}

This is the WEEKEND WIRE. NY just closed for the week. You're recapping the WHOLE WEEK — Monday's open to Friday's close. Use the per-stock weekChangePercent values to call out the week's biggest printers and the worst bagholders. Reference the friend group when their picks moved dramatically over the week. End with a glance toward Monday — what to watch, who needs to apologize, who's ready to YOLO again. Don't mention specific dates.`;

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

/** Strip down a snapshot for the weekend recap, including week-over-week
 * percentage change per stock relative to the Monday baseline. */
function summarizeWeek(today: StoredData, weekStart: WeekStartSnapshot) {
  const ownersMap = ownersByTicker();
  const baselineByTicker = new Map(
    weekStart.stocks.map((s) => [s.ticker, s.regularMarketPrice]),
  );
  return {
    weekStart: weekStart.weekStart,
    capturedAt: today.updatedAt,
    overallMood: today.analysis.overallMood,
    stocks: today.stocks.map((s) => {
      const baseline = baselineByTicker.get(s.ticker);
      const weekChangePercent =
        baseline && baseline > 0
          ? ((s.regularMarketPrice - baseline) / baseline) * 100
          : null;
      const owners = ownersMap.get(s.ticker) ?? [];
      return {
        ticker: s.ticker,
        name: s.name,
        currency: s.currency,
        regularMarketPrice: s.regularMarketPrice,
        regularMarketChangePercent: s.regularMarketChangePercent,
        ...(weekChangePercent !== null
          ? { weekChangePercent: Number(weekChangePercent.toFixed(2)) }
          : {}),
        ...(owners.length > 0 ? { owners } : {}),
      };
    }),
  };
}

export async function generateWeekendWire(
  today: StoredData,
  weekStart: WeekStartSnapshot,
): Promise<string> {
  console.log(
    `[briefs] generating weekend wire for week of ${weekStart.weekStart}`,
  );
  const userMessage = `The week is in the books — recap Monday → Friday.\n\n${JSON.stringify(summarizeWeek(today, weekStart), null, 2)}`;
  return callClaude(WEEKEND_SYSTEM, userMessage);
}
