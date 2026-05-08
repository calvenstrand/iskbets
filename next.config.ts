import path from "path";
import { fileURLToPath } from "url";
import type { NextConfig } from "next";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. Without this, Next.js detects a
  // stray ~/package-lock.json and uses $HOME as the root, which breaks file
  // tracing for serverless deploys.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
