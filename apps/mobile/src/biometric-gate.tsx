import * as LocalAuthentication from "expo-local-authentication";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, View } from "react-native";
import { Body, Button, Loading, type Chrome } from "./ui";
import { SPACE } from "./theme";

export interface BiometricProbe {
  hasHardware(): Promise<boolean>;
  isEnrolled(): Promise<boolean>;
  authenticate(): Promise<boolean>;
}

const liveProbe: BiometricProbe = {
  hasHardware: () => LocalAuthentication.hasHardwareAsync(),
  isEnrolled: () => LocalAuthentication.isEnrolledAsync(),
  authenticate: async () => (await LocalAuthentication.authenticateAsync()).success
};

export type GateState = "checking" | "open" | "locked";

/**
 * Never silently bypasses when an enrolled method exists (spec: "skip the
 * gate rather than lock the user out" applies only to the no-hardware /
 * not-enrolled cases below, not to a failed challenge).
 */
export async function resolveGate(probe: BiometricProbe): Promise<GateState> {
  if (!(await probe.hasHardware())) return "open";
  if (!(await probe.isEnrolled())) return "open";
  return (await probe.authenticate()) ? "open" : "locked";
}

/**
 * A one-off challenge in front of a consequential action (docs/08 §3: biometric
 * confirm on consequential approve). Same rules as the unlock gate: a device
 * with no hardware, or none enrolled, is not blocked from approving — but a
 * device that has it must pass it.
 */
export async function confirmConsequential(probe: BiometricProbe = liveProbe): Promise<boolean> {
  return (await resolveGate(probe)) === "open";
}

export function BiometricGate({ chrome, children }: { chrome: Chrome; children: ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const checking = useRef(false);

  async function challenge() {
    if (checking.current) return;
    checking.current = true;
    setState("checking");
    setState(await resolveGate(liveProbe));
    checking.current = false;
  }

  useEffect(() => {
    void challenge();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void challenge();
    });
    return () => sub.remove();
  }, []);

  if (state === "checking") return <Loading chrome={chrome} />;
  if (state === "open") return <>{children}</>;

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: SPACE.lg, padding: SPACE.xl }}>
      <Body chrome={chrome}>{chrome.t("auth.biometric.locked")}</Body>
      <Button chrome={chrome} label={chrome.t("auth.biometric.retry")} onPress={() => void challenge()} />
    </View>
  );
}
