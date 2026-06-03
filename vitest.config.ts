import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Pure logic only for now — no DOM. Node environment keeps the run
    // fast and matches where lib/ code actually executes (server-side).
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    // Mirror the tsconfig "@/*" path alias so tests can import the same
    // way the app does once we start testing modules with cross-imports.
    alias: { "@": dirname },
  },
});
