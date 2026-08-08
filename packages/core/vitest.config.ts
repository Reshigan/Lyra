import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // ponytail: CI runners are CPU-starved under turbo's cross-package parallelism,
    // which starves the vitest-worker RPC heartbeat and trips "Timeout calling
    // onTaskUpdate" even though every test passes. Single thread sidesteps the
    // contention; revisit if this package's suite gets slow enough to need it.
    pool: "threads",
    poolOptions: { threads: { singleThread: true } }
  }
});
