import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { id as newId, schema } from "@lyra/db";
import {
  APPROVAL_POLICIES,
  actorRef,
  assertClaimTransition,
  audit,
  conflict,
  emit,
  gate,
  isClaimState,
  scoped,
  type Ctx
} from "@lyra/core";
import { runTxn } from "@lyra/ledger";

// docs/specs/gap-axis-design.md §B.2, §C.4. Two things the claims desk does all
// day and neither may be a column write: moving the claim's state, and changing
// what we think it will cost. The first has a machine (packages/core/lifecycle)
// so nobody jumps from reported to settled; the second is a history, because
// reserve adequacy and triangles are questions about what we believed *then*.

type ClaimRow = typeof schema.axisClaims.$inferSelect;
type ReserveRow = typeof schema.axisClaimReserves.$inferSelect;

/* ----------------------------------------------------------------- reserves */

export const RESERVE_HEADS = ["indemnity", "expense", "recovery"] as const;
export const RESERVE_BASES = [
  "ai_recommended",
  "assessor",
  "desk_estimate",
  "insurer_advised",
  "formula",
  "closure"
] as const;

/** Above this, a reserve movement is a decision rather than desk work. */
const RESERVE_THRESHOLD_MINOR = APPROVAL_POLICIES["axis.claim_reserve"]?.defaultThresholdMinor ?? 0;

export const ClaimReserveBody = z.object({
  head: z.enum(RESERVE_HEADS).default("indemnity"),
  /** The reserve *after* this movement, not the movement. Desks think in totals. */
  amountMinor: z.number().int().nonnegative(),
  basis: z.enum(RESERVE_BASES),
  rationale: z.string().max(2000).nullish(),
  evidenceJson: z.string().max(20_000).nullish(),
  /** 0-100, and only meaningful when the basis is `ai_recommended`. */
  confidence: z.number().int().min(0).max(100).nullish(),
  aiAuditId: z.string().max(64).nullish()
});
export type ClaimReserveInput = z.infer<typeof ClaimReserveBody>;

/** Latest movement on each head, which together are the claim's reserve. */
async function headsOf(ctx: Ctx, claimId: string): Promise<Map<string, ReserveRow>> {
  const rows = await ctx.db
    .select()
    .from(schema.axisClaimReserves)
    .where(scoped(ctx, schema.axisClaimReserves, eq(schema.axisClaimReserves.claimId, claimId)))
    .orderBy(schema.axisClaimReserves.seq);
  const latest = new Map<string, ReserveRow>();
  for (const row of rows) latest.set(row.head, row);
  return latest;
}

export async function appendReserve(ctx: Ctx, claim: ClaimRow, input: ClaimReserveInput) {
  if (claim.status === "closed" || claim.status === "withdrawn") {
    throw conflict(`claim ${claim.id} is ${claim.status} and carries no reserve`);
  }
  if (input.basis === "ai_recommended" && input.confidence == null) {
    // docs/15 §4: an AI number with no stated confidence cannot be weighed by
    // the person who has to accept or reject it.
    throw conflict("an AI-recommended reserve must state its confidence");
  }

  const latest = await headsOf(ctx, claim.id);
  const previous = latest.get(input.head);
  const previousMinor = previous?.amountMinor ?? 0;
  if (input.amountMinor === previousMinor) {
    throw conflict(`the ${input.head} reserve is already ${previousMinor}`);
  }

  // The spec's own line (§ approvals): "reserve movements at or below threshold"
  // are not consequential. A handler re-estimating a windscreen claim all
  // morning is the job; the six-figure move is the decision.
  //
  // Gated before the transaction so a refused movement leaves nothing behind —
  // no row for the trigger to protect, no txn for someone to finish later.
  const subjectRef = `axis_claim_reserve:${claim.id}:${input.head}`;
  const approval =
    input.amountMinor > RESERVE_THRESHOLD_MINOR
      ? await gate(ctx, {
          policyKey: "axis.claim_reserve",
          subjectRef,
          amountMinor: input.amountMinor,
          context: { claimId: claim.id, head: input.head, previousMinor, basis: input.basis }
        })
      : null;

  const reserveId = newId("clmr", ctx.now);
  const txn = await runTxn(
    ctx,
    {
      // A reserve is an opinion about future money, not money: no journal, but
      // still a transaction so it is auditable and reversible like everything
      // else that changes what the business believes it owes.
      type: "CLAIM-RESERVE",
      idempotencyKey: `axis.claim_reserve:${reserveId}`,
      currency: claim.currency,
      grossMinor: input.amountMinor,
      subjectRefs: { policy: claim.policyId, claim: claim.id, reserve: reserveId }
    },
    { approvalSubjectRef: subjectRef, preApproved: true }
  );

  const row: ReserveRow = {
    id: reserveId,
    tenantId: ctx.tenantId,
    claimId: claim.id,
    seq: (previous?.seq ?? 0) + 1,
    head: input.head,
    amountMinor: input.amountMinor,
    previousMinor,
    deltaMinor: input.amountMinor - previousMinor,
    currency: claim.currency,
    basis: input.basis,
    rationale: input.rationale ?? null,
    evidenceJson: input.evidenceJson ?? null,
    confidence: input.confidence ?? null,
    aiAuditId: input.aiAuditId ?? null,
    approvalId: approval?.id ?? null,
    txnId: txn.id,
    setBy: actorRef(ctx),
    setAt: ctx.now,
    createdAt: ctx.now
  };
  await ctx.db.insert(schema.axisClaimReserves).values(row);

  // The head column is a denormalised sum of the histories, never the source of
  // truth — packages/db/src/claim-reserves.ts property-tests the two agreeing.
  latest.set(input.head, row);
  const reserveMinor = [...latest.values()].reduce((n, r) => n + r.amountMinor, 0);
  const after = { ...claim, reserveMinor, lastTxnId: txn.id, updatedAt: ctx.now };
  await ctx.db
    .update(schema.axisClaims)
    .set({ reserveMinor, lastTxnId: txn.id, updatedAt: ctx.now })
    .where(scoped(ctx, schema.axisClaims, eq(schema.axisClaims.id, claim.id)));

  await audit(ctx, { action: "axis.claim.reserve_set", subjectRef: claim.id, before: claim, after });
  await emit(ctx, {
    module: "axis",
    type: "axis.claim.reserve_set",
    subject: claim.id,
    data: {
      claimId: claim.id,
      policyId: claim.policyId,
      reserveId,
      head: input.head,
      amountMinor: input.amountMinor,
      previousMinor,
      deltaMinor: row.deltaMinor,
      basis: input.basis,
      currency: claim.currency,
      reserveMinor
    }
  });
  return { reserve: row, txn, claim: after };
}

/** The reserve history, newest first — what §D.3 draws under the control. */
export async function listReserves(ctx: Ctx, claimId: string): Promise<ReserveRow[]> {
  return ctx.db
    .select()
    .from(schema.axisClaimReserves)
    .where(scoped(ctx, schema.axisClaimReserves, eq(schema.axisClaimReserves.claimId, claimId)))
    .orderBy(desc(schema.axisClaimReserves.setAt), desc(schema.axisClaimReserves.seq));
}

/* --------------------------------------------------------------- transitions */

/**
 * Which transaction a hop posts. Everything absent here is bookkeeping on the
 * file rather than a decision about the claim, and posts CLAIM-SYNC.
 */
const TXN_FOR: Record<string, string> = {
  approved: "CLAIM-APPROVE",
  rejected: "CLAIM-DECLINE",
  closed: "CLAIM-CLOSE",
  reopened: "CLAIM-REOPEN"
};

/** What you must hold to take the hop. Absent means the generic update right. */
const PERM_FOR: Record<string, string> = {
  triage: "axis:claims:triage",
  approved: "axis:claims:approve",
  rejected: "axis:claims:approve",
  closed: "axis:claims:close",
  reopened: "axis:claims:reopen",
  recovering: "axis:claims:recover"
};

export function permissionForClaimTransition(to: string): string {
  return PERM_FOR[to] ?? "axis:claims:update";
}

export const ClaimTransitionBody = z.object({
  to: z.string().min(1).max(32),
  reasonCode: z.string().max(64).nullish(),
  reason: z.string().max(2000).nullish()
});
export type ClaimTransitionInput = z.infer<typeof ClaimTransitionBody>;

export async function transitionClaim(ctx: Ctx, claim: ClaimRow, input: ClaimTransitionInput) {
  if (!isClaimState(input.to)) throw conflict(`${input.to} is not a claim state`);
  // `settling` is not a hop anyone takes by hand: it is what requesting a
  // payment does, so that no claim can be marked as paying without a payment.
  if (input.to === "settling" || input.to === "settled") {
    throw conflict(`move a claim to ${input.to} by requesting a payment, not by transition`);
  }
  assertClaimTransition(claim.status as never, input.to);

  // Approving or declining a claim, and reopening a settled one, are all the
  // same decision seen from different sides — and none is taken alone.
  const decision = ["approved", "rejected", "reopened"].includes(input.to);
  const subjectRef = `axis_claim_settlement:${claim.id}:${input.to}`;
  const approval = decision
    ? await gate(ctx, {
        policyKey: "axis.claim_settlement",
        subjectRef,
        amountMinor: claim.reserveMinor || claim.amountMinor || 0,
        context: { claimId: claim.id, from: claim.status, to: input.to, reasonCode: input.reasonCode ?? null }
      })
    : null;

  const txn = await runTxn(
    ctx,
    {
      type: TXN_FOR[input.to] ?? "CLAIM-SYNC",
      idempotencyKey: `axis.claim_state:${newId("clmt", ctx.now)}`,
      currency: claim.currency,
      subjectRefs: { policy: claim.policyId, claim: claim.id }
    },
    decision ? { approvalSubjectRef: subjectRef, preApproved: true } : undefined
  );

  const after: ClaimRow = {
    ...claim,
    status: input.to,
    ...(input.to === "closed" ? { closedAt: ctx.now } : {}),
    ...(input.to === "reopened" ? { reopenedAt: ctx.now, closedAt: null } : {}),
    lastTxnId: txn.id,
    updatedAt: ctx.now
  };
  await ctx.db
    .update(schema.axisClaims)
    .set({
      status: after.status,
      closedAt: after.closedAt,
      reopenedAt: after.reopenedAt,
      lastTxnId: txn.id,
      updatedAt: ctx.now
    })
    .where(scoped(ctx, schema.axisClaims, eq(schema.axisClaims.id, claim.id)));

  await audit(ctx, { action: `axis.claim.${input.to}`, subjectRef: claim.id, before: claim, after });
  await emit(ctx, {
    module: "axis",
    type: EVENT_FOR[input.to] ?? "axis.claim.state_changed",
    subject: claim.id,
    data: {
      claimId: claim.id,
      policyId: claim.policyId,
      customerId: claim.customerId,
      from: claim.status,
      to: input.to,
      reasonCode: input.reasonCode ?? null,
      approvalId: approval?.id ?? null
    }
  });
  return { claim: after, txn };
}

/**
 * Past tense, because a subscriber reacts to something that happened. Absent
 * states fall back to `axis.claim.state_changed` — a subscriber that cares
 * about `awaiting_docs` can read `to` off the envelope.
 */
const EVENT_FOR: Record<string, string> = {
  triage: "axis.claim.triaged",
  assessing: "axis.claim.assessing",
  approved: "axis.claim.approved",
  rejected: "axis.claim.rejected",
  closed: "axis.claim.closed",
  reopened: "axis.claim.reopened",
  withdrawn: "axis.claim.withdrawn"
};
