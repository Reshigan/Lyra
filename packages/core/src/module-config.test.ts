import { describe, expect, test } from "vitest";
import { PolicyJson } from "@lyra/db";
import { moduleEnabled, moduleSettings } from "./module-config";

// Per-module configuration (docs/05 module independence). The resolver is the
// single reader every module routes through, so its fall-through behaviour is
// what keeps "standalone or together" true: a module with no override must
// behave exactly as it did before this field existed.

const base = PolicyJson.parse({});

describe("moduleSettings", () => {
  test("falls through to tenant defaults when the module has no config", () => {
    const cfg = moduleSettings(base, "signal");
    expect(cfg).toEqual({
      enabled: true,
      autonomy: base.autonomyDefault,
      modelTier: undefined,
      settings: {}
    });
  });

  test("honours a per-module autonomy override", () => {
    const policy = PolicyJson.parse({
      moduleConfig: { signal: { autonomy: "act" } }
    });
    expect(moduleSettings(policy, "signal").autonomy).toBe("act");
    // Another module still reads the tenant default.
    expect(moduleSettings(policy, "axis").autonomy).toBe(base.autonomyDefault);
  });

  test("carries per-module settings and model tier", () => {
    const policy = PolicyJson.parse({
      moduleConfig: { signal: { modelTier: "fast", settings: { dailyBudgetCapMinor: 500_000 } } }
    });
    const cfg = moduleSettings(policy, "signal");
    expect(cfg.modelTier).toBe("fast");
    expect(cfg.settings.dailyBudgetCapMinor).toBe(500_000);
  });

  test("a stored row without moduleConfig still parses", () => {
    const policy = PolicyJson.parse({ autoApprove: ["signal.campaign_launch"] });
    expect(policy.moduleConfig).toEqual({});
    expect(moduleEnabled(policy, "axis")).toBe(true);
  });
});

describe("moduleEnabled", () => {
  test("is false only when the tenant switched the module off", () => {
    const policy = PolicyJson.parse({
      moduleConfig: { scout: { enabled: false } }
    });
    expect(moduleEnabled(policy, "scout")).toBe(false);
    expect(moduleEnabled(policy, "signal")).toBe(true);
  });
});
