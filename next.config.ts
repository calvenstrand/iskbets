import path from "path";
import { fileURLToPath } from "url";
import type { NextConfig } from "next";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Baseline security headers. Applied to every route via the catch-all
// source pattern. CSP intentionally skipped — no inline-script attack
// surface to defend, and CSP on a Next.js app is its own maintenance
// burden (Vercel Analytics + Speed Insights inject runtime scripts that
// would need explicit allowlisting). Revisit if we ever take untrusted
// input or embed third-party iframes.
const SECURITY_HEADERS = [
  // Force HTTPS for 2 years; opt into HSTS preload list. Safe — site
  // has only ever served over HTTPS via Vercel.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Block MIME-sniffing — a defense-in-depth measure against content-type
  // confusion attacks on user-uploaded assets (we have none, but the
  // header has zero downside).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Disallow framing entirely — no clickjacking surface, and we never
  // intentionally embed the dashboard anywhere.
  { key: "X-Frame-Options", value: "DENY" },
  // Send the full origin on same-origin requests but only the origin
  // on cross-origin navigations. Sensible default for a public site
  // with no sensitive query params.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Explicitly deny browser features we don't use. Camera / mic /
  // geolocation requests would all be malicious if they ever appeared.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. Without this, Next.js detects a
  // stray ~/package-lock.json and uses $HOME as the root, which breaks file
  // tracing for serverless deploys.
  outputFileTracingRoot: __dirname,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
