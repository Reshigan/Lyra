/**
 * Run from the repo root (see root package.json's "mutation" script) — the
 * sandbox mirrors whatever the current working directory is, and core.test.ts
 * / commission.test.ts / seed.test.ts read ../../db/migrations, a sibling
 * package. Running from packages/core directly leaves that path dangling.
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  packageManager: "pnpm",
  plugins: ["@stryker-mutator/vitest-runner"],
  testRunner: "vitest",
  reporters: ["html", "clear-text", "progress"],
  coverageAnalysis: "perTest",
  tempDirName: "packages/core/.stryker-tmp",
  ignorePatterns: [
    "apps",
    "packages/agents",
    "packages/config",
    "packages/model-gateway",
    "packages/sdk",
    "packages/ui",
    "packages/db/src",
    "docs",
    "infra",
    "e2e"
  ],
  mutate: [
    "packages/core/src/**/*.ts",
    "!packages/core/src/**/*.test.ts",
    // side-effecting CLI entrypoint, no exported logic to test
    "!packages/core/src/seed-cli.ts",
    // no unit coverage in this package; exercised indirectly via apps/api
    "!packages/core/src/crypto.ts",
    "!packages/core/src/totp.ts",
    "!packages/core/src/onboarding-templates.ts"
  ],
  vitest: { dir: "packages/core" },
  thresholds: { high: 80, low: 70, break: 70 }
};
