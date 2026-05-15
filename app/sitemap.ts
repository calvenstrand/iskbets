import type { MetadataRoute } from "next";
import { getStockData } from "@/lib/storage";

// Single-page app — only the root URL is worth indexing. The dashboard
// data refreshes every 10 min via the cron, so `lastModified` is wired
// to the snapshot's `updatedAt` so Google sees the page actually changes
// (without it, the `changeFrequency: "hourly"` hint is just a claim with
// no evidence). Falls back to "now" if Redis is unreachable so the
// sitemap still returns valid XML.
//
// Sitemap renders dynamically — Next will request a fresh copy on every
// crawl, but `revalidate` caps the underlying read so we don't hammer
// Upstash if Google starts polling aggressively.
export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let lastModified = new Date();
  try {
    const snapshot = await getStockData();
    if (snapshot?.updatedAt) {
      lastModified = new Date(snapshot.updatedAt);
    }
  } catch {
    // Sitemap must always render — fall back to "now" if storage is down.
  }

  return [
    {
      url: "https://www.iskbets.se",
      lastModified,
      changeFrequency: "hourly",
      priority: 1,
    },
  ];
}
