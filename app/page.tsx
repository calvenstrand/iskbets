import { Dashboard } from "@/components/Dashboard";
import { getStockData } from "@/lib/storage";
import type { StoredData } from "@/lib/types";

// Re-render the page at most once per minute. Inside that window the
// HTML is served from the static cache; on first request after 60s
// passes, Next.js regenerates server-side.
export const revalidate = 60;

async function safeGetStockData(): Promise<StoredData | null> {
  try {
    return await getStockData();
  } catch (err) {
    // At build time there are no Redis creds, so getStockData throws.
    // Treat as "no data" — ISR will replace this with real data on the
    // first runtime request once the deployment is live.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[page] getStockData failed: ${msg}`);
    return null;
  }
}

export default async function Home() {
  const data = await safeGetStockData();

  if (!data) {
    return (
      <main className="empty-state">
        <div className="signal">NO DATA YET</div>
        <div className="hint">Run a fetch to initialize.</div>
        <div className="blip">▮ AWAITING TRANSMISSION ▮</div>
      </main>
    );
  }

  return <Dashboard data={data} />;
}
