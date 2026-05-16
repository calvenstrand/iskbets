import Anthropic from "@anthropic-ai/sdk";
import type { LeaderboardEntry } from "./leaderboard";
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

const WEEKEND_SYSTEM = `${SHARED_VOICE.replace("3 to 4 sentences.", "3 sentences max.")}

This is the WEEKEND WIRE. NY just closed for the week — you're recapping Monday's open to Friday's close in 3 tight sentences. Lead with the week's biggest printer and worst bagholder by weekChangePercent. Reference the friend group when their picks moved meaningfully over the week. End with a one-beat Monday glance — what to watch or who's ready to YOLO. Don't mention specific dates. No filler — every sentence pulls weight.`;

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

const WEEKLY_CHAMPION_SYSTEM = `You are a degenerate WSB analyst with peak Gordon Gekko energy. You crown the friend who DOMINATED the trading week.

You receive: the week's leader (highest WTD%), their owned tickers and how each performed Monday → Friday, and a snapshot of the rest of the friend leaderboard for context.

WRITE: a 2 to 3 sentence WSB recap celebrating (or roasting, depending on how they got there) the champion. Use their first name. Reference WHICH owned ticker(s) carried the win — call them out by name with the % numbers. Acknowledge the supporting cast or the contrast vs. other friends if it's notable. Slang-heavy (printer, tendies, bagholder, the gang, the syndicate, rekt, diamond hands, moon). End with a one-beat taunt or a "next week we ride" line.

Plain text only — no markdown, no preamble, no JSON. Just the recap. Do NOT explicitly say "leaderboard" or "#1" — the placement makes that obvious.

Examples:
- "Chris ate this week alive — NET +9.4% and SHOP +6.2% printing tendies while everybody else's bag took naps. The syndicate's tech tilt finally paying. Eric's industrials grinded sideways but the gang knows who's wearing the crown until Monday's open."
- "Johan's quantum YOLO finally hit. QBTS +12% and PLTR +9% carried the week single-handedly while the rest of the friends played defense. Insufferable until next week."
- "Eric somehow took the throne on pure industrial discipline — Atlas +4%, Thule +5%, no fireworks just compounding. The Wallenbergs would approve. Tech apes seething.";

Persona: WSB Gordon Gekko, 2 to 3 sentences, slang-heavy, always include the champion's first name.`;

/** Strip down for the champion-recap prompt: champion's owned tickers
 * with their week change, plus a one-line tally of everybody else for
 * comparison context. */
function summarizeChampion(
  champion: LeaderboardEntry,
  today: StoredData,
  weekStart: WeekStartSnapshot,
  others: LeaderboardEntry[],
) {
  const baselineByTicker = new Map(
    weekStart.stocks.map((s) => [s.ticker, s.regularMarketPrice]),
  );
  const priceByTicker = new Map(today.stocks.map((s) => [s.ticker, s]));

  const ownedDetail = champion.tickers.map((t) => {
    const stock = priceByTicker.get(t);
    const baseline = baselineByTicker.get(t);
    if (!stock || !baseline || baseline <= 0) {
      return { ticker: t };
    }
    const weekChange = ((stock.regularMarketPrice - baseline) / baseline) * 100;
    return {
      ticker: t,
      name: stock.name,
      weekChangePct: Number(weekChange.toFixed(2)),
    };
  });

  return {
    champion: {
      name: champion.name,
      person: champion.person,
      wtdPct: Number((champion.wtdPct ?? 0).toFixed(2)),
      ownedThisWeek: ownedDetail,
    },
    leaderboardTally: others.map((e) => ({
      name: e.name,
      wtdPct: e.wtdPct !== null ? Number(e.wtdPct.toFixed(2)) : null,
    })),
  };
}

export async function generateWeeklyChampion(args: {
  champion: LeaderboardEntry;
  others: LeaderboardEntry[];
  today: StoredData;
  weekStart: WeekStartSnapshot;
}): Promise<string> {
  const { champion, others, today, weekStart } = args;
  console.log(
    `[briefs] generating weekly champion recap for ${champion.name} ` +
      `(WTD ${champion.wtdPct?.toFixed(2)}%)`,
  );
  const userMessage = `The week is over. Crown the champion: ${champion.name}.\n\n${JSON.stringify(summarizeChampion(champion, today, weekStart, others), null, 2)}`;
  return callClaude(WEEKLY_CHAMPION_SYSTEM, userMessage);
}
