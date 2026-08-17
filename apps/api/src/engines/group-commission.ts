import { eq } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { actorRef, assertPolicyTransition, audit, badRequest, conflict, emit, isPolicyState, scoped, type Ctx } from "@lyra/core";
import { buildRecipe, runTxn } from "@lyra/ledger";

type PolicyRow = typeof schema.axisPolicies.$inferSelect;

export async function bindGroup(
  ctx: Ctx,
  policy: PolicyRow,
  opts: { channelMinor?: number; terms?: Record<string, unknown> }
) {
  if (!isPolicyState(policy.status)) throw conflict(`policy is in unknown state ${policy.status}`);
  assertPolicyTransition(policy.status, "bound");
  if (policy.currentVersionId) throw conflict("policy already has a version history");
  if (policy.commissionMinor <= 0) throw badRequest("cannot bind-group with no commission: BIND-GROUP posts a commission accrual");
  const channelMinor = Math.min(Math.max(opts.channelMinor ?? 0, 0), policy.commissionMinor);

  const txn = await runTxn(
    ctx,
    {
      type: "BIND-GROUP",
      idempotencyKey: `axis.bind_group:${policy.id}`,
      currency: policy.currency,
      grossMinor: policy.grossMinor,
      subjectRefs: { policy: policy.id }
    },
    {
      recipe: { lines: buildRecipe("BIND-GROUP", { grossMinor: policy.commissionMinor, channelMinor }), currency: policy.currency },
      approvalSubjectRef: `axis_policy:${policy.id}`
    }
  );

  const version = {
    id: newId("pver", ctx.now),
    tenantId: ctx.tenantId,
    policyId: policy.id,
    versionSeq: 1,
    reason: "issue" as const,
    effectiveFrom: policy.startAt,
    effectiveTo: policy.endAt,
    premiumMinor: policy.premiumMinor,
    taxMinor: policy.taxMinor,
    feesMinor: policy.feesMinor,
    commissionMinor: policy.commissionMinor,
    currency: policy.currency,
    premiumDeltaMinor: 0,
    termsJson: JSON.stringify(opts.terms ?? {}),
    quoteResponseId: null,
    txnId: txn.id,
    state: "effective" as const,
    issuedBy: actorRef(ctx),
    issuedAt: ctx.now,
    createdAt: ctx.now,
    updatedAt: ctx.now
  };
  await ctx.db.insert(schema.axisPolicyVersions).values(version);

  const stamp = { status: "bound" as const, currentVersionId: version.id, versionSeq: 1, lastTxnId: txn.id, updatedAt: ctx.now };
  await ctx.db.update(schema.axisPolicies).set(stamp).where(scoped(ctx, schema.axisPolicies, eq(schema.axisPolicies.id, policy.id)));
  const after = { ...policy, ...stamp };

  await audit(ctx, { action: "axis.policy.bind_group", subjectRef: policy.id, before: policy, after });
  await emit(ctx, {
    module: "axis",
    type: "axis.policy.group_issued",
    subject: policy.id,
    data: {
      policyId: policy.id,
      customerId: policy.customerId,
      providerId: policy.providerId,
      premiumMinor: policy.premiumMinor,
      grossMinor: policy.grossMinor,
      currency: policy.currency,
      txnId: txn.id
    }
  });
  return { policy: after, version, txn };
}

export async function brokerFee(ctx: Ctx, policy: PolicyRow, input: { feeMinor: number }) {
  const feeId = newId("bfee", ctx.now);
  const txn = await runTxn(
    ctx,
    {
      type: "FEE-BROK",
      idempotencyKey: `axis.broker_fee:${feeId}`,
      currency: policy.currency,
      grossMinor: input.feeMinor,
      subjectRefs: { policy: policy.id }
    },
    {
      recipe: { lines: buildRecipe("FEE-BROK", { grossMinor: input.feeMinor }), currency: policy.currency }
    }
  );

  await audit(ctx, {
    action: "axis.policy.broker_fee",
    subjectRef: policy.id,
    after: { feeId, txnId: txn.id, feeMinor: input.feeMinor }
  });
  await emit(ctx, {
    module: "axis",
    type: "axis.policy.broker_fee_charged",
    subject: policy.id,
    data: { policyId: policy.id, feeMinor: input.feeMinor, currency: policy.currency, txnId: txn.id }
  });
  return { txn };
}
