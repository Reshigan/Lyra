/** @type {import('jest').Config} */
module.exports = {
  rootDir: "..",
  testMatch: ["<rootDir>/e2e/*.e2e.ts"],
  testTimeout: 120000,
  maxWorkers: 1,
  globalSetup: "detox/runners/jest/globalSetup",
  globalTeardown: "detox/runners/jest/globalTeardown",
  testEnvironment: "detox/runners/jest/testEnvironment",
  testEnvironmentOptions: { globalsContextScript: "detox/runners/jest/globalsContextScript" },
  transform: { "^.+\\.tsx?$": ["ts-jest", { isolatedModules: true }] },
  reporters: ["detox/runners/jest/reporter"],
  verbose: true
};
