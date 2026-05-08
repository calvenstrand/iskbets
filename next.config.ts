import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // yahoo-finance2 v2.14 ships Deno-only test files in its esm dist; bundling
  // them with webpack fails. Marking it external lets Node require() it at
  // runtime so those code paths stay lazy.
  serverExternalPackages: ["yahoo-finance2"],
};

export default nextConfig;
