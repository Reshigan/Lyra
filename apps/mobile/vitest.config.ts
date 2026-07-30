import { defineConfig } from "vitest/config";

// Node environment on purpose: the tests here cover the pure layers (token
// store, nav mapping, i18n catalogues). Rendering React Native components needs
// jest-expo and a native transform — a cost worth paying when there is a
// component whose logic is not already covered here.
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] }
});
