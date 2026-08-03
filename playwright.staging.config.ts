import { defineConfig, devices } from "@playwright/test";
import { STAGING_WEB_ORIGIN } from "./e2e/sim/env.js";

// docs/24 sim plan §3: 30-day compressed simulation runs against real
// Cloudflare staging — no webServer, no DB wipe. Staging's DB persists and
// accumulates across virtual days, unlike playwright.config.ts's local harness.
export default defineConfig({
  testDir: "./e2e/sim",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: STAGING_WEB_ORIGIN,
    trace: "retain-on-failure"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
