import { defineConfig } from "vitest/config";

// ponytail: node environment only — no jsdom, no DOM deps. Source-level assertions.
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts", "src/**/*.test.tsx"] }
});
