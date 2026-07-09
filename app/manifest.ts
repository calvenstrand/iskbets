import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ISKBets",
    short_name: "ISKBets",
    description: "WSB-flavored stock tracker. Greed is good.",
    start_url: "/",
    display: "standalone",
    background_color: "#080b0a",
    theme_color: "#00ff41",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      // Same raster flagged maskable so Android can mask it into the
      // platform shape. Next's Manifest type only accepts a single
      // purpose per entry, so "any maskable" is split into two entries.
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
