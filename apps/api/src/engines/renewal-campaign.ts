import { and, eq } from "drizzle-orm";
import { schema } from "@lyra/db";
import { audit, emit, type Ctx } from "@lyra/core";

// docs/02 §? "Workflows for multi-step, long-horizon jobs (renewal campaign
// over 30 days...)". `sweepRenewals` (renewals.ts) only raises a renewal row —
// nothing previously advanced it past `state: "scheduled"`. RenewalWorkflow
// (renewal-workflow.ts) is the durable driver; these are the plain, testable
// steps it calls at each stage. No pricing/quote generation here — an
// auto_requote strategy only marks intent (docs/modules/orbit.md §8's A/B
// cohort), the actual requote is out of scope until that engine exists
// (ponytail: real gap, not invented — nothing consumes `strategy` today
// either).

const row = (ctx: Ctx, renewalId: string) =>
  ctx.db
    .select()
    .from(schema.orbitRenewals)
    .where(and(eq(schema.orbitRenewals.tenantId, ctx.tenantId), eq(schema.orbitRenewals.id, renewalId)));

/** Decided outside this campaign — a human (or a future auto-requote engine) already moved it on. */
const resolved = (state: string) => state === "accepted" || state === "lost";

/** Day 0: open the renewal for action. `{done: true}` short-circuits the rest of the campaign. */
export async function renewalDay0(ctx: Ctx, renewalId: string): Promise<{ done: boolean }> {
  const [current] = await row(ctx, renewalId);
  if (!current || current.state !== "scheduled") return { done: true };

  const after = { ...current, state: "offered" as const, offeredAt: ctx.now, updatedAt: ctx.now };
  await ctx.db
    .update(schema.orbitRenewals)
    .set({ state: "offered", offeredAt: ctx.now, updatedAt: ctx.now })
    .where(eq(schema.orbitRenewals.id, renewalId));
  await audit(ctx, { action: "orbit.renewal.offered", subjectRef: renewalId, before: current, after });
  await emit(ctx, {
    module: "orbit",
    type: "orbit.renewal.offered",
    subject: renewalId,
    data: { policyRef: current.policyRef, customerId: current.customerId, strategy: current.strategy }
  });
  return { done: false };
}

/** Day 7: nudge if still undecided. */
export async function renewalDay7Followup(ctx: Ctx, renewalId: string): Promise<{ done: boolean }> {
  const [current] = await row(ctx, renewalId);
  if (!current || resolved(current.state)) return { done: true };

  await emit(ctx, {
    module: "orbit",
    type: "orbit.renewal.followup_due",
    subject: renewalId,
    data: { policyRef: current.policyRef, customerId: current.customerId, ownerRef: current.ownerRef }
  });
  return { done: false };
}

/** Day 21: force the human desk — no auto path gets to ride silence all the way to expiry. */
export async function renewalDay21Escalate(ctx: Ctx, renewalId: string): Promise<{ done: boolean }> {
  const [current] = await row(ctx, renewalId);
  if (!current || resolved(current.state)) return { done: true };

  const after = { ...current, strategy: "human" as const, updatedAt: ctx.now };
  await ctx.db
    .update(schema.orbitRenewals)
    .set({ strategy: "human", updatedAt: ctx.now })
    .where(eq(schema.orbitRenewals.id, renewalId));
  await audit(ctx, { action: "orbit.renewal.escalated", subjectRef: renewalId, before: current, after });
  await emit(ctx, {
    module: "orbit",
    type: "orbit.renewal.escalated",
    subject: renewalId,
    data: { policyRef: current.policyRef, customerId: current.customerId }
  });
  return { done: false };
}

/** Day 30: still nobody home — the campaign ends, the queue must not hold a renewal forever. */
export async function renewalExpireIfUndecided(ctx: Ctx, renewalId: string): Promise<void> {
  const [current] = await row(ctx, renewalId);
  if (!current || resolved(current.state)) return;

  const after = {
    ...current,
    state: "lost" as const,
    outcomeReason: "expired_no_response",
    decidedAt: ctx.now,
    updatedAt: ctx.now
  };
  await ctx.db
    .update(schema.orbitRenewals)
    .set({ state: "lost", outcomeReason: "expired_no_response", decidedAt: ctx.now, updatedAt: ctx.now })
    .where(eq(schema.orbitRenewals.id, renewalId));
  await audit(ctx, { action: "orbit.renewal.lost", subjectRef: renewalId, before: current, after });
  await emit(ctx, {
    module: "orbit",
    type: "orbit.renewal.lost",
    subject: renewalId,
    data: { policyRef: current.policyRef, customerId: current.customerId, reason: "expired_no_response" }
  });
}

export interface RenewalWorkflowParams {
  tenantId: string;
  renewalId: string;
}
