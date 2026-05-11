import { Dashboard } from "@/components/Dashboard";
import { inRecapWindow } from "@/lib/dateUtil";
import { pickTodayWinnerLoser } from "@/lib/leaderboard";
import { type MockMode, parseMockMode } from "@/lib/mockData";
import { getDashboardData } from "@/lib/storage";
import type { DashboardData } from "@/lib/types";

// Re-render the page at most once per minute. Inside that window the
// HTML is served from the static cache; on first request after 60s
// passes, Next.js regenerates server-side.
export const revalidate = 60;

async function safeGetDashboardData(
  mode: MockMode,
): Promise<DashboardData | null> {
  try {
    return await getDashboardData({ mode });
  } catch (err) {
    // At build time there are no Redis creds, so getDashboardData throws.
    // Treat as "no data" — ISR will replace this with real data on the
    // first runtime request once the deployment is live.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[page] getDashboardData failed: ${msg}`);
    return null;
  }
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const mode = parseMockMode(params.mode);
  const data = await safeGetDashboardData(mode);

  if (!data) {
    return (
      <main className="empty-state">
        <div className="signal">NO DATA YET</div>
        <div className="hint">Run a fetch to initialize.</div>
        <div className="blip">▮ AWAITING TRANSMISSION ▮</div>
      </main>
    );
  }

  // Time-dependent state computed server-side at render time, then
  // re-checked client-side every minute by Dashboard so the UI flips
  // automatically without a page reload.
  const now = new Date();
  const inRecap = inRecapWindow(now);
  const todayMovers = pickTodayWinnerLoser(data.snapshot.stocks, now);

  return (
    <Dashboard
      data={data.snapshot}
      morningBrief={data.morningBrief}
      eveningBrief={data.eveningBrief}
      weekendBrief={data.weekendBrief}
      weeklyChampion={data.weeklyChampion}
      weekStartPrices={data.weekStartPrices}
      initialInRecap={inRecap}
      initialTodayWinner={todayMovers.winner?.ticker}
      initialTodayLoser={todayMovers.loser?.ticker}
    />
  );
}
