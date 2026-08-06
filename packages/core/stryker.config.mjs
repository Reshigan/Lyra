/**
 * Run from the repo root (see root package.json's "mutation" script) — the
 * sandbox mirrors whatever the current working directory is, and core.test.ts
 * / commission.test.ts / seed.test.ts read ../../db/migrations, a sibling
 * package. Running from packages/core directly leaves that path dangling.
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
import { changedSources } from "../../scripts/stryker-changed.mjs";

// Never mutated, whether the run is whole-tree or diff-scoped.
const excluded = [
  "!packages/core/src/**/*.test.ts",
  // side-effecting CLI entrypoint, no exported logic to test
  "!packages/core/src/seed-cli.ts",
  // no unit coverage in this package; exercised indirectly via apps/api
  "!packages/core/src/crypto.ts",
  "!packages/core/src/totp.ts",
  "!packages/core/src/onboarding-templates.ts"
];

const changed = changedSources("packages/core/src");

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
  // A whole-tree run is 14,277 mutants — ~10h on a CI runner, past the job
  // ceiling, so the gate was killed every time and reported nothing. With
  // STRYKER_SINCE set (the `mutation` job in .github/workflows/ci.yml) the run
  // covers only the files a change touched; unset, it is still the full sweep.
  mutate: changed ? [...changed, ...excluded] : ["packages/core/src/**/*.ts", ...excluded],
  vitest: { dir: "packages/core" },
  thresholds: { high: 80, low: 70, break: 70 },
  // A commit that touches no source in this package has nothing to mutate.
  allowEmpty: true
};
