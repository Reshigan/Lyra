/**
 * Run from the repo root (see root package.json's "mutation" script) — the
 * sandbox mirrors whatever the current working directory is, and
 * gateway.test.ts / budget.test.ts read ../../db/migrations, a sibling
 * package. Running from packages/model-gateway directly leaves that path
 * dangling.
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
import { changedSources } from "../../scripts/stryker-changed.mjs";

const excluded = [
  "!packages/model-gateway/src/**/*.test.ts",
  // never exercised except via stub.ts test double; real network adapters, no unit coverage
  "!packages/model-gateway/src/providers/anthropic.ts",
  "!packages/model-gateway/src/providers/workers-ai.ts",
  "!packages/model-gateway/src/providers/openai-compat.ts"
];

const changed = changedSources("packages/model-gateway/src");

export default {
  packageManager: "pnpm",
  plugins: ["@stryker-mutator/vitest-runner"],
  testRunner: "vitest",
  reporters: ["html", "clear-text", "progress"],
  coverageAnalysis: "perTest",
  tempDirName: "packages/model-gateway/.stryker-tmp",
  ignorePatterns: [
    "apps",
    "packages/agents",
    "packages/config",
    "packages/core",
    "packages/sdk",
    "packages/ui",
    "packages/db/src",
    "docs",
    "infra",
    "e2e",
    // Playwright writes and deletes trace files here while a run is in flight;
    // the sandbox copy races them and dies on ENOENT. Nothing here is mutated.
    "test-results",
    "reports"
  ],
  // See packages/core/stryker.config.mjs: STRYKER_SINCE narrows a CI run to the
  // files a change touched, unset it is the full sweep.
  mutate: changed
    ? [...changed, ...excluded]
    : ["packages/model-gateway/src/**/*.ts", ...excluded],
  vitest: { dir: "packages/model-gateway" },
  thresholds: { high: 80, low: 70, break: 70 },
  allowEmpty: true
};
