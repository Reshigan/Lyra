import { Hono } from "hono";
import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { id as newId, schema } from "@lyra/db";
import { actorRef, audit, badRequest, gate, notFound, require_, type Ctx } from "@lyra/core";
import { checkBudget, setLimits, type Message } from "@lyra/model-gateway";
import { body } from "../http.js";
import { executeOrbitToolCalls, orbitToolsFor } from "../engines/orbit-tools.js";
import { embedQuery } from "../engines/vectorize.js";
import { must } from "../rows.js";
import type { App } from "../env.js";

// docs/15. AI is a subsystem with a front door, not a feature bolted onto five
// modules. Everything here goes through the gateway, which means everything is
// budgeted, scrubbed, guardrailed and written to ai_audit_log — there is no
// second path to a model.

export const aiRoutes = new Hono<App>();

const ctxOf = (c: { get(k: "ctx"): Ctx }): Ctx => c.get("ctx");

/* --------------------------------------------------------------- agent runs */

const RunBody = z.object({
  agentKey: z.string().min(1).max(64),
  purpose: z.string().min(1).max(64),
  subjectRef: z.string().max(200).optional(),
  locale: z.enum(["en", "ar"]).optional(),
  input: z.string().min(1).max(20_000),
  /** Extra context the surface already has, so the agent does not re-fetch it. */
  context: z.record(z.string(), z.unknown()).optional(),
  trigger: z.enum(["user", "event", "schedule", "api"]).default("user")
});

/**
 * Run a registered agent. The agent row carries the tier, the autonomy level and
 * the prompt reference, so raising a model or loosening autonomy is a data
 * change with an approval behind it — never a deploy.
 */
aiRoutes.post("/runs", async (c) => {
  const ctx = ctxOf(c);
  const input = await body(c, RunBody);
  const agent = await agentByKey(ctx, input.agentKey);
  require_(ctx.actor, `${agent.module}:ai:invoke`, { tenantId: ctx.tenantId, module: agent.module });
  if (agent.status !== "active") throw badRequest(`agent ${agent.key} is ${agent.status}`);

  const prompt = await activePrompt(ctx, agent.promptRef);
  const runId = newId("air", ctx.now);
  const started = ctx.now;

  await ctx.db.insert(schema.aiRuns).values({
    id: runId,
    tenantId: ctx.tenantId,
    agentKey: agent.key,
    module: agent.module,
    purpose: input.purpose,
    subjectRef: input.subjectRef ?? null,
    actorRef: actorRef(ctx),
    autonomyLevel: agent.autonomyLevel,
    trigger: input.trigger,
    state: "running",
    inputHash: "",
    startedAt: started
  });

  try {
    // docs/21 ORBIT conversation memory (VEC_CONVO): no reliable conversationId
    // correlates a `/runs` call back to a room (routes/orbit.ts posts turns
    // straight to the AgentRoom DO, never through here) — so recall is scoped
    // to the tenant's ORBIT history, not one conversation.
    const recall =
      agent.module === "orbit"
        ? await embedQuery(ctx, c.get("gateway"), c.env.VEC_CONVO, {
            module: "orbit",
            purpose: "orbit.message.recall",
            text: input.input,
            topK: 5,
            filter: { tenantId: ctx.tenantId }
          })
        : [];

    const messages: Message[] = [
      { role: "system", content: prompt },
      {
        role: "user",
        content: [
          input.context ? `${input.input}\n\ncontext:\n${JSON.stringify(input.context)}` : input.input,
          recall.length
            ? `relevant past messages:\n${recall.map((m) => m.metadata?.role + ": " + m.metadata?.text).join("\n")}`
            : ""
        ]
          .filter(Boolean)
          .join("\n\n")
      }
    ];

    // Tool calling is scoped to ORBIT for now — the registry only knows ORBIT's
    // tools (apps/api/src/engines/orbit-tools.ts). Other modules get no `tools`
    // field, same behaviour as before this wiring existed.
    const first = await c.get("gateway").complete(ctx, {
      module: agent.module,
      purpose: input.purpose,
      tier: agent.tier as "fast" | "standard" | "reasoning",
      ...(input.subjectRef !== undefined ? { subjectRef: input.subjectRef } : {}),
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
      ...(agent.module === "orbit" ? { tools: orbitToolsFor(agent) } : {}),
      messages
    });

    // The model asked for real work: execute each call through the registry
    // (approval gate included — CLAUDE.md rule 4), then let the model react to
    // what actually happened, via a second, separately audited completion.
    const final =
      agent.module === "orbit" && first.toolCalls.length
        ? await c.get("gateway").complete(ctx, {
            module: agent.module,
            purpose: input.purpose,
            tier: agent.tier as "fast" | "standard" | "reasoning",
            ...(input.subjectRef !== undefined ? { subjectRef: input.subjectRef } : {}),
            ...(input.locale !== undefined ? { locale: input.locale } : {}),
            messages: [
              ...messages,
              { role: "assistant", content: first.text },
              ...(await executeOrbitToolCalls(
                ctx,
                runId,
                first.toolCalls,
                new Set(orbitToolsFor(agent).map((t) => t.name))
              ))
            ]
          })
        : first;

    // A refusal is a successful run with a refusal outcome, not an error. The
    // operator needs to see that the guardrail fired, not a 500.
    const refused = final.finishReason === "refusal";
    const usage =
      final === first
        ? final.usage
        : {
            tokensIn: first.usage.tokensIn + final.usage.tokensIn,
            tokensOut: first.usage.tokensOut + final.usage.tokensOut,
            costMicro: first.usage.costMicro + final.usage.costMicro
          };
    const latencyMs = final === first ? final.latencyMs : first.latencyMs + final.latencyMs;

    await ctx.db
      .update(schema.aiRuns)
      .set({
        state: refused ? "refused" : "succeeded",
        inputHash: final.auditId,
        outputRef: final.auditId,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        costMicro: usage.costMicro,
        latencyMs,
        evidenceJson: JSON.stringify({ flags: final.flags, model: final.model, provider: final.provider }),
        endedAt: ctx.now
      })
      .where(and(eq(schema.aiRuns.tenantId, ctx.tenantId), eq(schema.aiRuns.id, runId)));

    return c.json(
      {
        runId,
        text: final.text,
        toolCalls: first.toolCalls,
        model: final.model,
        provider: final.provider,
        tier: final.tier,
        flags: final.flags,
        finishReason: final.finishReason,
        auditId: final.auditId,
        usage
      },
      201
    );
  } catch (err) {
    await ctx.db
      .update(schema.aiRuns)
      .set({
        state: "failed",
        errorCode: err instanceof Error ? err.message.slice(0, 120) : "error",
        endedAt: ctx.now
      })
      .where(and(eq(schema.aiRuns.tenantId, ctx.tenantId), eq(schema.aiRuns.id, runId)));
    throw err;
  }
});

/**
 * Explainability: the run, its model call and the guardrails that fired.
 *
 * Mounted at `/detail`, not at `/runs/:id`. Hand-written routes register before
 * the generated CRUD, so an enriched handler on the bare `:id` path shadows the
 * record endpoint every generic surface reads (record.tsx expects a flat row and
 * renders blank against a wrapper). The wrapper is a second view, so it gets a
 * second path.
 */
aiRoutes.get("/runs/:id/detail", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ai:runs:read", { tenantId: ctx.tenantId, module: "ai" });
  const run = await must(ctx, schema.aiRuns, c.req.param("id"), "ai run");

  const calls = await ctx.db
    .select()
    .from(schema.aiToolCalls)
    .where(and(eq(schema.aiToolCalls.tenantId, ctx.tenantId), eq(schema.aiToolCalls.runId, run.id)))
    .orderBy(schema.aiToolCalls.seq);

  const trail = run.outputRef
    ? (
        await ctx.db
          .select()
          .from(schema.aiAuditLog)
          .where(and(eq(schema.aiAuditLog.tenantId, ctx.tenantId), eq(schema.aiAuditLog.id, run.outputRef)))
          .limit(1)
      )[0]
    : undefined;

  // The audit row holds hashes, not content (docs/12 §7) — an explainability
  // view proves what happened without becoming a second copy of the prompt.
  return c.json({ run, toolCalls: calls, audit: trail ?? null });
});

/* -------------------------------------------------------------- suggestions */

/**
 * The feedback loop behind the ambient grammar (docs/15 §4): a suggestion that
 * is never accepted is a suggestion that should stop being shown.
 */
aiRoutes.post("/suggestions", async (c) => {
  const ctx = ctxOf(c);
  // Suggestion rows are the evidence behind "does this surface earn its place"
  // and behind /suggestions/acceptance. Ungated, any session in the tenant could
  // manufacture that evidence. Same permission the CRUD resource uses for the
  // suggestions table (resources.ts), so there is one answer per actor.
  require_(ctx.actor, "ai:suggestions:read", { tenantId: ctx.tenantId, module: "ai" });
  const input = await body(
    c,
    z.object({
      surface: z.enum(["ghost_text", "chip", "draft", "forecast", "filter"]),
      module: z.string().min(1).max(32),
      runId: z.string().optional(),
      subjectRef: z.string().optional(),
      contentRef: z.string().optional()
    })
  );
  const row = {
    id: newId("sug", ctx.now),
    tenantId: ctx.tenantId,
    userId: ctx.actor.id,
    outcome: "shown",
    shownAt: ctx.now,
    ...input,
    runId: input.runId ?? null,
    subjectRef: input.subjectRef ?? null,
    contentRef: input.contentRef ?? null
  };
  await ctx.db.insert(schema.aiSuggestions).values(row);
  return c.json(row, 201);
});

aiRoutes.post("/suggestions/:id/outcome", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ai:suggestions:read", { tenantId: ctx.tenantId, module: "ai" });
  const input = await body(
    c,
    z.object({
      outcome: z.enum(["accepted", "edited", "dismissed", "expired"]),
      editDistance: z.number().int().min(0).optional()
    })
  );
  await ctx.db
    .update(schema.aiSuggestions)
    .set({
      outcome: input.outcome,
      resolvedAt: ctx.now,
      ...(input.editDistance !== undefined ? { editDistance: input.editDistance } : {})
    })
    .where(
      and(
        eq(schema.aiSuggestions.tenantId, ctx.tenantId),
        eq(schema.aiSuggestions.id, c.req.param("id")),
        eq(schema.aiSuggestions.userId, ctx.actor.id)
      )
    );
  return c.body(null, 204);
});

/** Acceptance rate per surface — the number that decides whether a surface stays. */
aiRoutes.get("/suggestions/acceptance", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ai:runs:read", { tenantId: ctx.tenantId, module: "ai" });
  const sinceDays = Number(c.req.query("days") ?? 30);
  const rows = await ctx.db
    .select({
      surface: schema.aiSuggestions.surface,
      module: schema.aiSuggestions.module,
      outcome: schema.aiSuggestions.outcome
    })
    .from(schema.aiSuggestions)
    .where(
      and(
        eq(schema.aiSuggestions.tenantId, ctx.tenantId),
        gte(schema.aiSuggestions.shownAt, ctx.now - sinceDays * 86_400_000)
      )
    );

  const by = new Map<string, { surface: string; module: string; shown: number; accepted: number; edited: number; dismissed: number }>();
  for (const r of rows) {
    const key = `${r.module}/${r.surface}`;
    const agg = by.get(key) ?? { surface: r.surface, module: r.module, shown: 0, accepted: 0, edited: 0, dismissed: 0 };
    agg.shown += 1;
    if (r.outcome === "accepted") agg.accepted += 1;
    if (r.outcome === "edited") agg.edited += 1;
    if (r.outcome === "dismissed") agg.dismissed += 1;
    by.set(key, agg);
  }
  return c.json({
    data: [...by.values()].map((a) => ({
      ...a,
      // An edit counts as a hit: the user kept the shape and changed the words.
      acceptanceRate: a.shown ? Math.round(((a.accepted + a.edited) / a.shown) * 100) : 0
    }))
  });
});

/* ------------------------------------------------------------------ budget */

aiRoutes.get("/budget", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ai:budgets:read", { tenantId: ctx.tenantId, module: "ai" });
  return c.json(await checkBudget(ctx, c.req.query("module") ?? "*"));
});

aiRoutes.post("/budget/limits", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ai:budgets:write", { tenantId: ctx.tenantId, module: "ai" });
  const input = await body(
    c,
    z.object({
      module: z.string().default("*"),
      tokensLimit: z.number().int().nonnegative().optional(),
      costMicroLimit: z.number().int().nonnegative().optional()
    })
  );
  // Raising a budget spends real money, so it goes through the same gate as
  // any other spending decision.
  await gate(ctx, {
    policyKey: "ai.budget_raise",
    subjectRef: `ai_budget:${input.module}`,
    ...(input.costMicroLimit !== undefined ? { amountMinor: Math.round(input.costMicroLimit / 10_000) } : {}),
    context: input
  });
  const { module, ...limits } = input;
  return c.json(await setLimits(ctx, limits, module));
});

/* ------------------------------------------------------------------- agents */

/** The kill switch. One row, immediate, audited — docs/15 §7 requires it reachable. */
aiRoutes.post("/agents/:key/pause", async (c) => {
  const ctx = ctxOf(c);
  // Stopping an agent is the killswitch, not an edit: compliance holds
  // `ai:agents:pause` precisely so they can pull it mid-incident without also
  // holding the write permission that would let them reconfigure the agent.
  require_(ctx.actor, "ai:agents:pause", { tenantId: ctx.tenantId, module: "ai" });
  const input = await body(c, z.object({ reason: z.string().min(3).max(500) }));
  const agent = await agentByKey(ctx, c.req.param("key"));
  await ctx.db
    .update(schema.aiAgents)
    .set({ status: "paused", pausedBy: actorRef(ctx), pausedReason: input.reason, updatedAt: ctx.now })
    .where(and(eq(schema.aiAgents.tenantId, ctx.tenantId), eq(schema.aiAgents.id, agent.id)));
  await audit(ctx, { action: "ai.agent.pause", subjectRef: agent.id, before: agent, after: input });
  return c.body(null, 204);
});

aiRoutes.post("/agents/:key/resume", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ai:agents:write", { tenantId: ctx.tenantId, module: "ai" });
  const agent = await agentByKey(ctx, c.req.param("key"));
  await ctx.db
    .update(schema.aiAgents)
    .set({ status: "active", pausedBy: null, pausedReason: null, updatedAt: ctx.now })
    .where(and(eq(schema.aiAgents.tenantId, ctx.tenantId), eq(schema.aiAgents.id, agent.id)));
  await audit(ctx, { action: "ai.agent.resume", subjectRef: agent.id, before: agent });
  return c.body(null, 204);
});

/**
 * Raising an agent's autonomy is the one AI change that can never be
 * self-service: it widens what the agent may do without asking (docs/15 §3).
 */
aiRoutes.post("/agents/:key/autonomy", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ai:agents:write", { tenantId: ctx.tenantId, module: "ai" });
  const input = await body(
    c,
    z.object({
      autonomyLevel: z.enum(["suggest", "act_with_approval", "act_within_limits", "autonomous"]),
      reason: z.string().min(3).max(500)
    })
  );
  const agent = await agentByKey(ctx, c.req.param("key"));
  const approval = await gate(ctx, {
    policyKey: "ai.autonomy_raise",
    subjectRef: agent.id,
    context: { from: agent.autonomyLevel, to: input.autonomyLevel, reason: input.reason }
  });
  if (approval && approval.decision !== "approved") return c.json({ approval }, 202);

  await ctx.db
    .update(schema.aiAgents)
    .set({ autonomyLevel: input.autonomyLevel, updatedAt: ctx.now })
    .where(and(eq(schema.aiAgents.tenantId, ctx.tenantId), eq(schema.aiAgents.id, agent.id)));
  await audit(ctx, { action: "ai.agent.autonomy", subjectRef: agent.id, before: agent, after: input });
  return c.json({ ...agent, autonomyLevel: input.autonomyLevel });
});

/* -------------------------------------------------------------------- audit */

/** The AI audit trail, filterable. Hashes only — the content never lands here. */
aiRoutes.get("/audit", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ai:audit:read", { tenantId: ctx.tenantId, module: "ai" });
  const module = c.req.query("module");
  const since = c.req.query("since") ? Number(c.req.query("since")) : ctx.now - 7 * 86_400_000;
  const rows = await ctx.db
    .select()
    .from(schema.aiAuditLog)
    .where(
      and(
        eq(schema.aiAuditLog.tenantId, ctx.tenantId),
        gte(schema.aiAuditLog.ts, since),
        ...(module ? [eq(schema.aiAuditLog.module, module)] : [])
      )
    )
    .orderBy(desc(schema.aiAuditLog.ts))
    .limit(Math.min(Number(c.req.query("limit") ?? 100), 500));
  return c.json({ data: rows });
});

/** Spend by module and purpose — what the BudgetMeter drills into. */
aiRoutes.get("/audit/spend", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ai:budgets:read", { tenantId: ctx.tenantId, module: "ai" });
  const since = ctx.now - Number(c.req.query("days") ?? 30) * 86_400_000;
  const rows = await ctx.db
    .select({
      module: schema.aiAuditLog.module,
      purpose: schema.aiAuditLog.purpose,
      model: schema.aiAuditLog.model,
      tokensIn: schema.aiAuditLog.tokensIn,
      tokensOut: schema.aiAuditLog.tokensOut,
      costMicro: schema.aiAuditLog.costMicro,
      outcome: schema.aiAuditLog.outcome
    })
    .from(schema.aiAuditLog)
    .where(and(eq(schema.aiAuditLog.tenantId, ctx.tenantId), gte(schema.aiAuditLog.ts, since)));

  const by = new Map<string, { module: string; purpose: string; calls: number; tokens: number; costMicro: number; errors: number }>();
  for (const r of rows) {
    const key = `${r.module}/${r.purpose}`;
    const agg = by.get(key) ?? { module: r.module, purpose: r.purpose, calls: 0, tokens: 0, costMicro: 0, errors: 0 };
    agg.calls += 1;
    agg.tokens += r.tokensIn + r.tokensOut;
    agg.costMicro += r.costMicro;
    if (r.outcome !== "ok") agg.errors += 1;
    by.set(key, agg);
  }
  const data = [...by.values()].sort((a, b) => b.costMicro - a.costMicro);
  return c.json({ data, totals: data.reduce((t, r) => ({ calls: t.calls + r.calls, tokens: t.tokens + r.tokens, costMicro: t.costMicro + r.costMicro }), { calls: 0, tokens: 0, costMicro: 0 }) });
});

/* ------------------------------------------------------------------ helpers */

async function agentByKey(ctx: Ctx, key: string): Promise<typeof schema.aiAgents.$inferSelect> {
  const rows = await ctx.db
    .select()
    .from(schema.aiAgents)
    .where(and(eq(schema.aiAgents.tenantId, ctx.tenantId), eq(schema.aiAgents.key, key)))
    .limit(1);
  const agent = rows[0];
  if (!agent) throw notFound(`ai agent ${key}`);
  return agent;
}

/**
 * Prompts live in `ai_prompts`, versioned. An inline prompt in application code
 * cannot be reviewed, diffed against the version that produced a bad answer, or
 * translated — so the agent row points at a key and this resolves it.
 */
async function activePrompt(ctx: Ctx, promptRef: string | null): Promise<string> {
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
