import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));

// Node environment on purpose: the tests here cover the pure layers (token
// store, nav mapping, i18n catalogues). Rendering React Native components needs
// jest-expo and a native transform — a cost worth paying when there is a
// component whose logic is not already covered here.
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
  resolve: {
    alias: {
      // "react-native"'s real entry is Flow source (Metro strips it before
      // any JS engine sees it) — unparseable by esbuild/Vite under Node. Src
      // modules import it only for JSX component values never rendered here
      // (see src/test/react-native-stub.ts); the stub exists so importing
      // ui.tsx/biometric-gate.tsx for their pure logic doesn't require
      // jest-expo's native transform.
      "react-native": resolve(here, "src/test/react-native-stub.ts"),
      // Same rationale as the react-native alias above: the real package
      // requires a native Expo runtime bridge that plain Node does not
      // provide, and no test here calls into it (see the stub's header).
      "expo-local-authentication": resolve(here, "src/test/expo-local-authentication-stub.ts")
    }
  }
});
