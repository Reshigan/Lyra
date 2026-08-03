import { Hono, type Context } from "hono";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { require_, audit, emit, type Ctx } from "@lyra/core";
import { schema, PolicyJson, toJson, parseJson, id as newId } from "@lyra/db";
import { z } from "zod";
import { body } from "../http.js";
import { generateCreatives } from "../engines/signal-creative.js";
import { runBudgetAutopilot } from "../engines/signal-autopilot.js";
import { demoOnly } from "../auth.js";
import type { App } from "../env.js";

// docs/modules/signal.md §8 clause 1: brief -> N compliant ar/en variants.
// Not generic CRUD (creatives get generated in a batch from a brief, never
// submitted one row at a time) so it is a bespoke route, same idiom as
// orbit.ts's `/renewals/sweep`. The Meta/Google publish half of clause 1 is
// credential-blocked and out of scope (see signal-creative.ts header) —
// this route stops at "review-ready", same as the engine it calls.

export const signalRoutes = new Hono<App>();

const ctxOf = (c: { get(k: "ctx"): Ctx }): Ctx => c.get("ctx");

const GenerateBody = z.object({
  campaignId: z.string().optional(),
  kind: z.enum(["ad", "lp", "email", "social", "video_script"]),
  brief: z.string().min(1).max(4_000),
  variantGroup: z.string().optional(),
  locales: z.array(z.enum(["en", "ar"])).min(1).optional(),
  count: z.number().int().min(1).max(100).optional()
});

signalRoutes.post("/creatives/generate", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "signal:creatives:generate", { tenantId: ctx.tenantId, module: "signal" });
  const input = await body(c, GenerateBody);
  const result = await generateCreatives(ctx, c.get("gateway"), {
    kind: input.kind,
    brief: input.brief,
    campaignId: input.campaignId ?? null,
    variantGroup: input.variantGroup ?? null,
    ...(input.locales !== undefined ? { locales: input.locales } : {}),
    ...(input.count !== undefined ? { count: input.count } : {})
  });
  return c.json(result, 201);
});

// docs/modules/signal.md §8 clause 2: "one-click global pause" — a tenant-wide
// kill switch for the budget autopilot (packages/db/src/json.ts
// signalAutopilotPaused), checked by runBudgetAutopilot before touching any
// campaign. Distinct from a single campaign's own state=paused.
async function setAutopilotPaused(c: Context<App>, paused: boolean) {
  const ctx = ctxOf(c);
  require_(ctx.actor, "signal:autopilot:pause", { tenantId: ctx.tenantId, module: "signal" });

  const [row] = await ctx.db.select().from(schema.tenants).where(eq(schema.tenants.id, ctx.tenantId)).limit(1);
  if (!row) throw new Error("tenant not found");
  const before = parseJson(PolicyJson, row.policyJson);
  const after = { ...before, signalAutopilotPaused: paused };

  await ctx.db
    .update(schema.tenants)
    .set({ policyJson: toJson(PolicyJson, after), updatedAt: ctx.now })
    .where(eq(schema.tenants.id, ctx.tenantId));

  await audit(ctx, {
    action: paused ? "signal.autopilot.paused" : "signal.autopilot.resumed",
    subjectRef: `tenants:${ctx.tenantId}`,
    before: { signalAutopilotPaused: before.signalAutopilotPaused },
    after: { signalAutopilotPaused: paused }
  });
  await emit(ctx, {
    module: "signal",
    type: paused ? "signal.autopilot.paused" : "signal.autopilot.resumed",
    subject: `tenants:${ctx.tenantId}`,
    data: { signalAutopilotPaused: paused }
  });

  return c.json({ signalAutopilotPaused: paused }, 200);
}

signalRoutes.post("/autopilot/pause", (c) => setAutopilotPaused(c, true));
signalRoutes.post("/autopilot/resume", (c) => setAutopilotPaused(c, false));

// Manual trigger, same idiom as orbit.ts's /renewals/sweep — RBAC-gated
// rather than environment-gated, so it also serves the 30-day compressed
// simulation (docs/24 sim plan) to see a budget decision's effect same-day.
signalRoutes.post("/autopilot/run", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "signal:autopilot:run", { tenantId: ctx.tenantId, module: "signal" });
  return c.json({ adjusted: await runBudgetAutopilot(ctx) });
});

const DAY_MS = 86_400_000;

/**
 * Demo-only, temporary (same idiom as auth.ts's demoOnly() routes — remove
 * once the 30-day sim exercise is done). No production spend-ingestion API
 * exists yet (a real one is its own feature); the sim's day-driver needs
 * *some* way to keep signal_spend inside signal-autopilot.ts's trailing
 * 7-day CAC window as the virtual clock advances, or every campaign's window
 * goes empty and the autopilot can only ever decide "no_action". This ticks
 * one new spend row per existing channel per live campaign, each virtual
 * day, so the autopilot actually gets exercised with real decision variety.
 */
async function tickDemoSpend(ctx: Ctx): Promise<{ inserted: number }> {
  const campaigns = await ctx.db
    .select({ id: schema.signalCampaigns.id })
    .from(schema.signalCampaigns)
    .where(
      and(
        eq(schema.signalCampaigns.tenantId, ctx.tenantId),
        eq(schema.signalCampaigns.state, "live"),
        inArray(schema.signalCampaigns.autonomyLevel, ["act", "act_with_approval"]),
        isNull(schema.signalCampaigns.deletedAt)
      )
    );

  const dayIndex = Math.floor(ctx.now / DAY_MS);
  const today = new Date(ctx.now).toISOString().slice(0, 10);
  let inserted = 0;

  for (const campaign of campaigns) {
    const history = await ctx.db
      .select({
        channel: schema.signalSpend.channel,
        amountMinor: schema.signalSpend.amountMinor,
        conversions: schema.signalSpend.conversions,
        currency: schema.signalSpend.currency
      })
      .from(schema.signalSpend)
      .where(and(eq(schema.signalSpend.tenantId, ctx.tenantId), eq(schema.signalSpend.campaignId, campaign.id)));
    if (!history.length) continue;

    const byChannel = new Map<string, { amountMinor: number; conversions: number; currency: string; n: number }>();
    for (const row of history) {
      const e = byChannel.get(row.channel) ?? { amountMinor: 0, conversions: 0, currency: row.currency, n: 0 };
      e.amountMinor += row.amountMinor;
      e.conversions += row.conversions;
      e.n++;
      byChannel.set(row.channel, e);
    }

    let channelIndex = 0;
    for (const [channel, e] of byChannel) {
      // ponytail: deterministic wobble keyed off virtual day + channel order —
      // not a real efficiency model, just enough CAC swing across channels
      // that the autopilot's act/anomaly paths get exercised on some ticks
      // instead of the gap always landing under MIN_GAP_BPS.
      const wobble = (dayIndex + channelIndex) % 3 === 0 ? 0.7 : 1.15;
      const conversions = Math.max(1, Math.round((e.conversions / e.n) * wobble));
      await ctx.db.insert(schema.signalSpend).values({
        id: newId("spd", ctx.now + channelIndex),
        tenantId: ctx.tenantId,
        campaignId: campaign.id,
        channel,
        day: today,
        amountMinor: Math.round(e.amountMinor / e.n),
        currency: e.currency,
        conversions,
        source: "manual",
        ts: ctx.now
      });
      inserted++;
      channelIndex++;
    }
  }
  return { inserted };
}

signalRoutes.post("/demo/spend-tick", async (c) => {
  demoOnly(c.env);
  const ctx = ctxOf(c);
  require_(ctx.actor, "signal:autopilot:run", { tenantId: ctx.tenantId, module: "signal" });
  return c.json(await tickDemoSpend(ctx));
});
