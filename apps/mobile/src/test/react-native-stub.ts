// Vitest-only stand-in for the real "react-native" package (aliased in
// vitest.config.ts). The real package's entry file is Flow source, meant to
// be stripped by Metro's Babel transform before it ever reaches a JS engine —
// esbuild/Vite's Node SSR loader cannot parse it. Every test under this
// project's Node environment imports UI modules for their pure logic only
// (resolveGate, textOf, ...) and never renders a component, so these values
// only need to exist, not behave: nothing here is ever called.

function Noop() {
  return null;
}

export const View = Noop;
export const Text = Noop;
export const TextInput = Noop;
export const Pressable = Noop;
export const ActivityIndicator = Noop;
export const ScrollView = Noop;
export const Image = Noop;

export const StyleSheet = {
  hairlineWidth: 1,
  create: <T>(styles: T) => styles
};

export const AppState = {
  addEventListener: () => ({ remove() {} })
};
