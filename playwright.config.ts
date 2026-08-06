import { defineConfig, devices } from "@playwright/test";
import { API_ORIGIN, API_PORT, FILES_DIR, LIBSQL_URL, WEB_ORIGIN } from "./e2e/env.js";

// docs/13-testing-quality.md §2: "the journey catalogue IS the e2e catalogue".
// DB wipe + migrate + seed live in ./e2e/global-setup.ts, run directly by the
// `e2e` pnpm script before this config is loaded (see package.json) — NOT
// wired as Playwright's own `globalSetup` hook, because playwright's task
// runner always starts webServer before globalSetup ever gets to run.

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // The web target here is `vite dev`, which compiles a route's module graph
  // the first time any test reaches it — a first visit to a cold screen costs
  // seconds that a built bundle would not. Playwright's 30s default budgets
  // for the assertions, not for the compiler, so give the whole test twice
  // that; the per-assertion timeout stays at its default, so a genuinely
  // broken expectation still fails fast.
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: WEB_ORIGIN,
    trace: "retain-on-failure"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @lyra/api start",
      url: API_ORIGIN,
      env: {
        LIBSQL_URL,
        FILES_DIR,
        PORT: String(API_PORT),
        APP_ORIGIN: WEB_ORIGIN,
        SESSION_COOKIE: "lyra_session",
        ENVIRONMENT: "local"
      },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: "pipe"
    },
    {
      command: "pnpm --filter @lyra/web dev",
      url: WEB_ORIGIN,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe"
    }
  ]
});
