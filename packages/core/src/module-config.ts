import type { PolicyJson } from "@lyra/db";

// Per-module configuration resolution (docs/05 module independence).
//
// A tenant may run any module standalone or in concert, and each module may
// carry its own autonomy, model tier and on/off switch without disturbing the
// tenant-wide defaults. This is the single reader every module routes through:
// a module asks `moduleSettings(policy, "signal")` and gets the resolved view —
// its own override when set, the tenant default when not. There is no second
// path that reads `policy.moduleConfig` directly, so a new per-module knob
// added here reaches every module at once.

export interface ModuleConfig {
  /** Whether the tenant has switched this module on. */
  enabled: boolean;
  /** The autonomy rung this module runs at — its override or the tenant default. */
  autonomy: PolicyJson["autonomyDefault"];
  /** Model tier override for this module, if one is set. */
  modelTier?: string | undefined;
  /** Free-form per-module settings. */
  settings: Record<string, unknown>;
}

/**
 * Resolve the effective configuration for one module. Falls through to the
 * tenant-wide defaults for anything the module has not overridden.
 */
export function moduleSettings(policy: PolicyJson, module: string): ModuleConfig {
  const own = policy.moduleConfig?.[module];
  return {
    enabled: own?.enabled ?? true,
    autonomy: own?.autonomy ?? policy.autonomyDefault,
    modelTier: own?.modelTier,
    settings: own?.settings ?? {}
  };
}

/** True when the tenant has not switched the module off. */
export function moduleEnabled(policy: PolicyJson, module: string): boolean {
  return moduleSettings(policy, module).enabled;
}
