import { defineConfig, devices } from "@playwright/test";

// Points at a deployed environment instead of the local stack — no webServer,
// no DB wipe, no seed. `pnpm e2e:live` (LIVE_BASE_URL overrides the target).
// The specs under e2e/live are read-only by construction; do not add a spec
// here that writes, because the target is a real deployment.

export default defineConfig({
  testDir: "./e2e/live",
  fullyParallel: true,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 3,
  reporter: "list",
  use: {
    baseURL: process.env.LIVE_BASE_URL ?? "https://lyra.vantax.co.za",
    trace: "retain-on-failure",
    reducedMotion: "reduce"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
