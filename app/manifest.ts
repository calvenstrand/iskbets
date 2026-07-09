import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ISKBets",
    short_name: "ISKBets",
    description: "WSB-flavored stock tracker. Greed is good.",
    start_url: "/",
    display: "standalone",
    background_color: "#080b0a",
    // The design-system green (--green). Was the legacy #00ff41 neon —
    // the token migration unified on #00e676, so match it here (a
    // manifest can't read a CSS var).
    theme_color: "#00e676",
    icons: [
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
