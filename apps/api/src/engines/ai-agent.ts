import { and, desc, eq } from "drizzle-orm";
import { schema } from "@lyra/db";
import { badRequest, notFound, type Ctx } from "@lyra/core";

// The two lookups every caller of the agent runtime needs: which agent, and
// which version of its prompt. They live here rather than in routes/ai.ts
// because background sweeps run agents too (engines/orbit-draft.ts), and a
// scheduled tick has no request to hang a route helper off.

export type AiAgent = typeof schema.aiAgents.$inferSelect;

/** null when the tenant has no agent under this key — the shape a sweep wants,
 *  since a tenant seeded before the agent existed should be skipped, not 404'd. */
export async function findAgent(ctx: Ctx, key: string): Promise<AiAgent | null> {
  const rows = await ctx.db
    .select()
    .from(schema.aiAgents)
    .where(and(eq(schema.aiAgents.tenantId, ctx.tenantId), eq(schema.aiAgents.key, key)))
    .limit(1);
  return rows[0] ?? null;
}

export async function agentByKey(ctx: Ctx, key: string): Promise<AiAgent> {
  const agent = await findAgent(ctx, key);
  if (!agent) throw notFound(`ai agent ${key}`);
  return agent;
}

/**
 * Prompts live in `ai_prompts`, versioned. An inline prompt in application code
 * cannot be reviewed, diffed against the version that produced a bad answer, or
 * translated — so the agent row points at a key and this resolves it.
 */
export async function activePrompt(ctx: Ctx, promptRef: string | null): Promise<string> {
  if (!promptRef) throw badRequest("agent has no prompt_ref");
  const rows = await ctx.db
    .select()
    .from(schema.aiPrompts)
    .where(
      and(
        eq(schema.aiPrompts.tenantId, ctx.tenantId),
        eq(schema.aiPrompts.key, promptRef),
        eq(schema.aiPrompts.status, "active"),
        eq(schema.aiPrompts.locale, ctx.locale)
      )
    )
    .orderBy(desc(schema.aiPrompts.version))
    .limit(1);
  const found =
    rows[0] ??
    (
      await ctx.db
        .select()
        .from(schema.aiPrompts)
        .where(
          and(
            eq(schema.aiPrompts.tenantId, ctx.tenantId),
            eq(schema.aiPrompts.key, promptRef),
            eq(schema.aiPrompts.status, "active"),
            eq(schema.aiPrompts.locale, "en")
          )
        )
        .orderBy(desc(schema.aiPrompts.version))
        .limit(1)
    )[0];
  if (!found) throw notFound(`ai prompt ${promptRef}`);
  return found.body;
}
