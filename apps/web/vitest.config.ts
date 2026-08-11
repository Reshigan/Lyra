import { defineConfig } from "vitest/config";

// Deliberately plugin-free: the shell's unit tests are DOM-free by design
// (route/nav/catalogue invariants), so they must not pay for the RR7 + workerd
// pipeline. Rendering tests arrive with the module screens, in Playwright.
export default defineConfig({
  test: { include: ["app/**/*.test.ts", "app/**/*.test.tsx"], environment: "node" }
});
