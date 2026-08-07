import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { id as newId, schema } from "@lyra/db";
import {
  actorRef,
  audit,
  badRequest,
  conflict,
  emit,
  gate,
  quoteEndorsement,
  scoped,
  sha256Hex,
  type Ctx
} from "@lyra/core";
import { autoApprovable, buildRecipe, runTxn } from "@lyra/ledger";

type PolicyRow = typeof schema.axisPolicies.$inferSelect;

/* ------------------------------------------------------------ endorsement */
// docs/27 F5 / docs/specs/gap-axis-design.md §B.1. Mid-term change is not a
// status hop: the contract stays where it is and grows a version. §C.2's
// interval invariants mean version 1 must be truncated at the endorsement date,
// so the two writes are one unit — never a new version left overlapping the old.

export const EndorseBody = z.object({
  effectiveFrom: z.number().int().optional(),
  changes: z.record(z.string(), z.unknown()),
  reason: z.string().nullish(),
  /** New full-term premium. Absent means the change carries no price. */
  premiumMinor: z.number().int().nonnegative().optional()
});
export type EndorseInput = z.infer<typeof EndorseBody>;

/** Everything the preview endpoint returns and the write endpoint acts on. */
export async function priceEndorsement(ctx: Ctx, policy: PolicyRow, input: EndorseInput) {
  if (policy.status !== "bound" && policy.status !== "active") {
    throw conflict("this cover is not on risk; endorsement is unavailable");
  }
  const [current] = await ctx.db
    .select()
    .from(schema.axisPolicyVersions)
    .where(
      scoped(
        ctx,
        schema.axisPolicyVersions,
        and(eq(schema.axisPolicyVersions.policyId, policy.id), eq(schema.axisPolicyVersions.state, "effective"))
      )
    );
  if (!current) throw conflict("policy has no effective version to endorse");

  const effectiveFrom = input.effectiveFrom ?? ctx.now;
  if (effectiveFrom < current.effectiveFrom || effectiveFrom >= policy.endAt) {
    throw badRequest("effectiveFrom must fall inside the remaining term");
  }

  const quote = quoteEndorsement({
    current: { premiumMinor: current.premiumMinor, taxMinor: current.taxMinor, commissionMinor: current.commissionMinor },
    term: { startAt: policy.startAt, endAt: policy.endAt },
    effectiveFrom,
    ...(input.premiumMinor !== undefined ? { premiumMinor: input.premiumMinor } : {})
  });

  // §D.4's `allowedChanges` comes from what the product declares it prices on.
  // `pricingInputsJson` is that declaration (horizon seam H6); a product that
  // declares nothing constrains nothing, so there is nothing to refer.
  const product = policy.productId
    ? (
        await ctx.db
          .select()
          .from(schema.products)
          .where(scoped(ctx, schema.products, eq(schema.products.id, policy.productId)))
      )[0]
    : undefined;
  const declared = product?.pricingInputsJson ? Object.keys(JSON.parse(product.pricingInputsJson)) : null;
  const needsReferral = declared ? Object.keys(input.changes).some((k) => !declared.includes(k)) : false;

  return {
    current,
    effectiveFrom,
    quote,
    needsReferral,
    // The change moves money, so it is consequential (§A.4) and passes the
    // approval gate. Whether the tenant's allowlist satisfies that gate without
    // a human is a tenant setting, not a property of the change.
    needsApproval: quote.chargeMinor !== 0,
    changeSetHash: await sha256Hex(JSON.stringify({ changes: input.changes, reason: input.reason ?? null }))
  };
}

export async function endorsePolicy(ctx: Ctx, policy: PolicyRow, input: EndorseInput) {
  const { current, effectiveFrom, quote, needsReferral, changeSetHash } = await priceEndorsement(ctx, policy, input);
  if (needsReferral) throw badRequest("this change is outside the product's rating inputs and needs referral");

  const subjectRef = `axis_endorse:${policy.id}:${changeSetHash}`;
  const refundMinor = quote.refundMinor;

  // Both gates run before the first write. Settling the commission move and
  // then failing the refund approval would leave money posted against a
  // contract that never grew a version.
  // ponytail: a refused refund has already consumed the endorse approval, so
  // the retry needs it re-granted. Chaining the two into one approval record is
  // the fix if desks feel it.
  if (quote.chargeMinor !== 0) {
    await gate(ctx, { policyKey: "axis.endorse", subjectRef, amountMinor: Math.abs(quote.chargeMinor) });
  }
  if (refundMinor > 0) {
    if (!autoApprovable("REFUND-ISSUE") && ctx.policy.autoApprove.includes("ledger.refund")) {
      throw conflict("REFUND-ISSUE may not be auto-approved (docs/19 §7)");
    }
    await gate(ctx, { policyKey: "ledger.refund", subjectRef: `${subjectRef}:refund`, amountMinor: refundMinor });
  }

  // ponytail: a change that moves no commission posts no journal — a zero-value
  // batch is not a fact about the business, and `buildRecipe` would refuse it.
  const cmsn = quote.commissionChargeMinor;
  let txn = null;
  if (cmsn !== 0) {
    const channelMinor = 0;
    txn = await runTxn(
      ctx,
      {
        type: "ENDORSE",
        idempotencyKey: `axis.endorse:${policy.id}:${changeSetHash}`,
        currency: policy.currency,
        grossMinor: Math.abs(quote.chargeMinor),
        subjectRefs: { policy: policy.id }
      },
      {
        recipe: {
          // A negative delta gives commission back. That is the clawback recipe,
          // under the ENDORSE type — the transaction is still an endorsement.
          lines:
            cmsn > 0
              ? buildRecipe("ENDORSE", { grossMinor: cmsn, channelMinor })
              : buildRecipe("CMSN-CLAWBACK", { amountMinor: -cmsn, channelMinor }),
          currency: policy.currency
        },
        approvalSubjectRef: subjectRef,
        preApproved: true
      }
    );
  }
  if (refundMinor > 0) {
    await runTxn(
      ctx,
      {
        type: "REFUND-ISSUE",
        idempotencyKey: `axis.endorse.refund:${policy.id}:${changeSetHash}`,
        currency: policy.currency,
        grossMinor: refundMinor,
        ...(txn ? { parentTxnId: txn.id } : {}),
        subjectRefs: { policy: policy.id }
      },
      {
        recipe: { lines: buildRecipe("REFUND-ISSUE", { amountMinor: refundMinor }), currency: policy.currency },
        approvalSubjectRef: `${subjectRef}:refund`,
        preApproved: true
      }
    );
  }

  await ctx.db
    .update(schema.axisPolicyVersions)
    .set({ state: "superseded", effectiveTo: effectiveFrom, supersededAt: ctx.now, updatedAt: ctx.now })
    .where(scoped(ctx, schema.axisPolicyVersions, eq(schema.axisPolicyVersions.id, current.id)));

  const terms = { ...(JSON.parse(current.termsJson ?? "{}") as Record<string, unknown>), ...input.changes };
  const version = {
    id: newId("pver", ctx.now),
    tenantId: ctx.tenantId,
    policyId: policy.id,
    versionSeq: current.versionSeq + 1,
    reason: "endorsement",
    reasonCode: input.reason ?? null,
    effectiveFrom,
    effectiveTo: policy.endAt,
    premiumMinor: current.premiumMinor + quote.premiumDeltaMinor,
    taxMinor: current.taxMinor + quote.taxDeltaMinor,
    feesMinor: current.feesMinor,
    commissionMinor: current.commissionMinor + quote.commissionDeltaMinor,
    currency: policy.currency,
    // Full-term, so §C.2's `Σ delta = head − v1` holds. `proRataDays` is what
    // says how much of it actually moved.
    premiumDeltaMinor: quote.premiumDeltaMinor,
    proRataDays: quote.proRataDays,
    termsJson: JSON.stringify(terms),
    txnId: txn?.id ?? null,
    state: "effective",
    issuedBy: actorRef(ctx),
    issuedAt: ctx.now,
    createdAt: ctx.now,
    updatedAt: ctx.now
  };
  await ctx.db.insert(schema.axisPolicyVersions).values(version);

  const stamp = {
    currentVersionId: version.id,
    versionSeq: version.versionSeq,
    premiumMinor: version.premiumMinor,
    taxMinor: version.taxMinor,
    commissionMinor: version.commissionMinor,
    grossMinor: version.premiumMinor + version.taxMinor + version.feesMinor,
    ...(txn ? { lastTxnId: txn.id } : {}),
    updatedAt: ctx.now
  };
  await ctx.db
    .update(schema.axisPolicies)
    .set(stamp)
    .where(scoped(ctx, schema.axisPolicies, eq(schema.axisPolicies.id, policy.id)));
  const after = { ...policy, ...stamp };

  await audit(ctx, { action: "axis.policy.endorse", subjectRef: policy.id, before: policy, after });
  await emit(ctx, {
    module: "axis",
    type: "axis.policy.endorsed",
    subject: policy.id,
    data: {
      policyId: policy.id,
      customerId: policy.customerId,
      versionId: version.id,
      versionSeq: version.versionSeq,
      effectiveFrom,
      premiumDeltaMinor: quote.premiumDeltaMinor,
      chargeMinor: quote.chargeMinor,
      refundMinor,
      currency: policy.currency,
      ...(txn ? { txnId: txn.id } : {})
    }
  });
  return { policy: after, version, txn };
}


