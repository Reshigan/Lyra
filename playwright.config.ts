import { defineConfig, devices } from "@playwright/test";
import { API_ORIGIN, API_PORT, FILES_DIR, LIBSQL_URL, WEB_ORIGIN } from "./e2e/env.js";

// docs/13-testing-quality.md §2: "the journey catalogue IS the e2e catalogue".
// DB wipe + migrate + seed live in ./e2e/global-setup.ts, run directly by the
// `e2e` pnpm script before this config is loaded (see package.json) — NOT
// wired as Playwright's own `globalSetup` hook, because playwright's task
// runner always starts webServer before globalSetup ever gets to run.

export default defineConfig({
  testDir: "./e2e",
  // e2e/live points at a deployment (playwright.live.config.ts), not this
  // config's local stack — running it here signs into 127.0.0.1 and fails.
  testIgnore: "live/**",
  fullyParallel: true,
  // The web target here is `vite dev`, which compiles a route's module graph
  // the first time any test reaches it — a first visit to a cold screen costs
  // seconds that a built bundle would not. Playwright's 30s default budgets
  // for the assertions, not for the compiler, so give the whole test twice
  // that. A GitHub runner is two cores shared by both dev servers and two
  // Playwright workers, and 60s was not enough for a cold compile there:
  // J-M3 spent the whole budget in `goto`'s hydration wait without ever
  // reaching an assertion, and J-O3 lost a form round trip to the default 5s
  // assertion budget. The same cold-compile cost lands locally on a first run
  // against a fresh DB — a dozen journeys failed a first assertion on a route
  // the dev server was still compiling, and eleven more ran out of the
  // whole-test budget — so both budgets are the CI numbers everywhere.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The stack under test is one wrangler-dev API process and one libsql file
  // however many cores the machine has, so Playwright's local default (half
  // the cores — ten here) only queues writes behind each other: creates landed
  // more than 20s after the POST and blew the assertion budget in seven
  // journeys that pass alone. Four is the most the single API keeps up with.
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: WEB_ORIGIN,
    trace: "retain-on-failure",
    // Entrances rise, figures tick, the workspace crossfades (docs/15 §3) —
    // all of which move an element Playwright is waiting to become "stable".
    // On a loaded CI runner J-E1's open Select menu never settled inside the
    // 60s budget. The tokens already switch every one of those off under
    // `prefers-reduced-motion` (tokens.css, app.css), so asking for it here
    // tests the same DOM without racing the animation.
    reducedMotion: "reduce"
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
