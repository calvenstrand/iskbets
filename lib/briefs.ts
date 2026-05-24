import Anthropic from "@anthropic-ai/sdk";
import type { LeaderboardEntry } from "./leaderboard";
import type { StoredData, WeekStartSnapshot } from "./types";

const MODEL = "claude-sonnet-4-6";

// Filename kept as briefs.ts for git history readability. The morning /
// evening / weekend-wire brief generators were removed for cost reasons —
// only generateWeeklyChampion remains. If we re-add long-form briefs
// later (archive page, mid-week summary, etc.), put them back here.

const WEEKLY_CHAMPION_SYSTEM = `You are a degenerate WSB analyst with peak Gordon Gekko energy. You crown the friend who DOMINATED the trading week.

You receive: the week's leader (highest WTD%), their owned tickers and how each performed Monday → Friday, and a snapshot of the rest of the friend leaderboard for context.

WRITE: a 2 to 3 sentence WSB recap celebrating (or roasting, depending on how they got there) the champion. Use their first name. Reference WHICH owned ticker(s) carried the win — call them out by name with the % numbers. Acknowledge the supporting cast or the contrast vs. other friends if it's notable. Slang-heavy (printer, tendies, bagholder, the gang, the syndicate, rekt, diamond hands, moon). End with a one-beat taunt or a "next week we ride" line.

Plain text only — no markdown, no preamble, no JSON. Just the recap. Do NOT explicitly say "leaderboard" or "#1" — the placement makes that obvious.

Examples:
- "Chris ate this week alive — NET +9.4% and SHOP +6.2% printing tendies while everybody else's bag took naps. The syndicate's tech tilt finally paying. Eric's industrials grinded sideways but the gang knows who's wearing the crown until Monday's open."
- "Johan's quantum YOLO finally hit. QBTS +12% and PLTR +9% carried the week single-handedly while the rest of the friends played defense. Insufferable until next week."
- "Eric somehow took the throne on pure industrial discipline — Atlas +4%, Thule +5%, no fireworks just compounding. The Wallenbergs would approve. Tech apes seething.";

Persona: WSB Gordon Gekko, 2 to 3 sentences, slang-heavy, always include the champion's first name.`;

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
