import { Dashboard } from "@/components/Dashboard";
import { getDashboardData } from "@/lib/storage";
import type { DashboardData } from "@/lib/types";

// Re-render the page at most once per minute. Inside that window the
// HTML is served from the static cache; on first request after 60s
// passes, Next.js regenerates server-side.
export const revalidate = 60;

async function safeGetDashboardData(): Promise<DashboardData | null> {
  try {
    return await getDashboardData();
  } catch (err) {
    // At build time there are no Redis creds, so getDashboardData throws.
    // Treat as "no data" — ISR will replace this with real data on the
    // first runtime request once the deployment is live.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[page] getDashboardData failed: ${msg}`);
    return null;
  }
}

export default async function Home() {
  const data = await safeGetDashboardData();

  if (!data) {
    return (
      <main className="empty-state">
        <div className="signal">NO DATA YET</div>
        <div className="hint">Run a fetch to initialize.</div>
        <div className="blip">▮ AWAITING TRANSMISSION ▮</div>
      </main>
    );
  }

  return (
    <Dashboard
      data={data.snapshot}
      morningBrief={data.morningBrief}
      eveningBrief={data.eveningBrief}
      weekendBrief={data.weekendBrief}
      weeklyChampion={data.weeklyChampion}
      weekStartPrices={data.weekStartPrices}
    />
  );
}
