// Vitest-only stand-in for "expo-local-authentication" (aliased in
// vitest.config.ts). The real package's entry loads expo-modules-core, which
// reaches for the native `globalThis.expo` bridge object — present only
// inside an actual Expo/React Native runtime, never under plain Node. Every
// test importing biometric-gate.tsx exercises `resolveGate` against an
// injected `BiometricProbe`, never `liveProbe`, so these three functions only
// need to exist as importable names — they are never called.

export async function hasHardwareAsync(): Promise<boolean> {
  return false;
}

export async function isEnrolledAsync(): Promise<boolean> {
  return false;
}

export async function authenticateAsync(): Promise<{ success: boolean }> {
  return { success: false };
}
