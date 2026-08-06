import { eq } from "drizzle-orm";
import { schema, type PolicyJson } from "@lyra/db";
import { AppError, flagEnabled, type Ctx, type FeatureFlag } from "@lyra/core";

// docs/12 §4: "Kill switches: per-agent, per-module, per-tenant, global — all
// one click, all logged, all tested monthly." Per-agent lives on the agent row
// (routes/ai.ts pauses it, POST /v1/ai/runs refuses a non-active agent). The
// other three are enforced here, in front of the only door to a model, so a
// pause covers every caller — runs, rooms, engines and schedulers alike.

/** Platform-wide switch, held by ops in core_feature_flags (ADR-0028). */
export const AI_KILL_SWITCH = "ai.kill_switch";

export type KillTier = "global" | "tenant" | "module";

export interface KillInput {
  policy: PolicyJson;
  module: string;
  tenantId: string;
  /** The `ai.kill_switch` row, if one has ever been created. */
  flag?: FeatureFlag | undefined;
}

/**
 * Which tier stopped this call, widest first. The tier is reported, not just a
 * boolean: a tenant admin who can release their own pause must not be pointed
 * at it when ops is the one holding the switch.
 */
export function killedBy({ policy, module, tenantId, flag }: KillInput): KillTier | null {
  // `enabled` reads as "the kill switch is thrown", the inverse of every other
  // flag — hence the dedicated key and this comment rather than a shared helper.
  if (flag && flagEnabled(flag, tenantId)) return "global";
  if (policy.aiPaused) return "tenant";
  if (policy.aiPausedModules.includes(module)) return "module";
  return null;
}

const RELEASE: Record<KillTier, string> = {
  global: "platform operations",
  tenant: "a tenant administrator",
  module: "a tenant administrator"
};

/** Throws 503 when any tier is engaged; resolves null when the call may proceed. */
export async function assertNotKilled(ctx: Ctx, module: string): Promise<null> {
  const [row] = await ctx.db
    .select()
    .from(schema.featureFlags)
    .where(eq(schema.featureFlags.key, AI_KILL_SWITCH))
    .limit(1);

  const tier = killedBy({
    policy: ctx.policy,
    module,
    tenantId: ctx.tenantId,
    ...(row ? { flag: row as FeatureFlag } : {})
  });
  if (!tier) return null;

  throw new AppError(
    503,
    "ai_paused",
    "AI is paused",
    `${tier} kill switch is engaged; ${RELEASE[tier]} can release it`,
    { tier }
  );
}
