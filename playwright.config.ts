import { defineConfig, devices } from "@playwright/test";
import { API_ORIGIN, API_PORT, FILES_DIR, LIBSQL_URL, WEB_ORIGIN, WEB_PORT } from "./e2e/env.js";

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
  // The local web target is `vite dev` (CI builds instead — see webServer),
  // which compiles a route's module graph
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
  // journeys that pass alone. Four was not low enough either: a full local run
  // at four lost the same seven journeys to 120s timeouts in 13.3m, and those
  // exact seven passed in 47.8s on a `--last-failed --workers=2` re-run. Two
  // everywhere — a flaky suite is Sev-2 (CLAUDE.md), and the wall-clock the
  // extra pair buys is spent on retries anyway.
  workers: 2,
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
    // Locally this is the dev server, for HMR and a fast edit loop. On CI it is
    // the built worker — the same artefact `pnpm deploy:staging` ships. `vite
    // dev` compiles a route's module graph on first reach, and on a two-core
    // runner already carrying the API and two Playwright workers that cost
    // showed up as navigations that began — nav progress bar up,
    // `navigation.state` stuck off idle — and then issued no network at all
    // for the whole test budget (J-O1, J-O2, neither reproducible locally).
    // The built server has no compile step in the request path: the same two
    // journeys run in 4.0s/5.4s against it, against 11.0s/15.3s under `vite
    // dev`.
    //
    // The built worker is served by `vite preview`, not `wrangler dev`.
    // wrangler 4.x fronts the user worker with a ProxyWorker on a second
    // workerd socket, and its ProxyController promotes *any* rejected
    // proxy→worker fetch to a session-fatal error that tears the whole dev
    // session down. One `Network connection lost` — an aborted navigation, a
    // relay to an API that blipped — killed the server mid-suite and every
    // spec after it failed `ERR_CONNECTION_REFUSED`, including on retry, with
    // an `✘ [ERROR]` carrying no message (the fatal event's `cause` is empty).
    // The worker itself was healthy: it kept answering 200s for 300ms after
    // the "fatal". `vite preview` runs the identical build under miniflare
    // with no proxy layer — one workerd process, so a request-level failure
    // stays a 500 on that request. `--strictPort` so a busy 5173 fails here
    // instead of drifting to 5174 and timing out on `url`. API_ORIGIN reaches
    // it through the `.dev.vars` that e2e/global-setup.ts writes on every run
    // and the build copies to build/server/, so no `--var` is needed.
    {
      command: process.env.CI
        ? `pnpm --filter @lyra/web build && pnpm --filter @lyra/web exec vite preview --port ${WEB_PORT} --host 127.0.0.1 --strictPort`
        : "pnpm --filter @lyra/web dev",
      url: WEB_ORIGIN,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      stdout: "pipe"
    }
  ]
});
