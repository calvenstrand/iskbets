import path from "path";
import { fileURLToPath } from "url";
import type { NextConfig } from "next";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. Without this, Next.js detects the
  // stray ~/package-lock.json and uses $HOME as the root, which breaks file
  // tracing for serverless deploys.
  outputFileTracingRoot: __dirname,

  // yahoo-finance2 v2.14 ships Deno-only test files in its esm dist; bundling
  // them with webpack fails. Marking it external lets Node require() it at
  // runtime so those code paths stay lazy.
  serverExternalPackages: ["yahoo-finance2"],
};

export default nextConfig;
