import type { MetadataRoute } from "next";

// Single-page app — only the root URL is worth indexing. Bumping
// changeFrequency to "hourly" because the dashboard data refreshes
// every 15 min via cron.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://www.iskbets.se",
      changeFrequency: "hourly",
      priority: 1,
    },
  ];
}
