import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { id as newId, schema } from "@lyra/db";
import {
  actorRef,
  audit,
  badRequest,
  canPolicyReach,
  conflict,
  emit,
  gate,
  hashObject,
  isPolicyState,
  quoteEndorsement,
  scoped,
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

/**
 * The identity of a change set, and with it the approval subject ref and the
 * idempotency key. Canonical (sorted keys) rather than `JSON.stringify`: the
 * same factors in a different order are the same change, and a reprice builds
 * `changes` from the model's reply order, so a stringify hash forks the key on
 * nothing and a granted approval stops matching on retry.
 */
export const changeSetHashOf = (input: Pick<EndorseInput, "changes" | "reason">): Promise<string> =>
  hashObject({ changes: input.changes, reason: input.reason ?? null });

/**
 * Terms blocks that describe *the version that produced them* and must not be
 * inherited by the next one. `ubi` is the model's price-move provenance: carried
 * forward, every later manual endorsement would claim a model moved its price.
 */
const VERSION_SCOPED_TERMS = ["ubi"];

/**
 * What the product declares it prices on (§D.4's `allowedChanges`), or `null`
 * when it declares nothing. A product that declares nothing constrains nothing —
 * which is fine for a human endorsement and is not fine for a model-proposed
 * one, so the reprice path refuses on `null` rather than trusting it.
 */
export async function declaredPricingInputs(ctx: Ctx, policy: PolicyRow): Promise<string[] | null> {
  const product = policy.productId
    ? (
        await ctx.db
          .select()
          .from(schema.products)
          .where(scoped(ctx, schema.products, eq(schema.products.id, policy.productId)))
      )[0]
    : undefined;
  return product?.pricingInputsJson ? Object.keys(JSON.parse(product.pricingInputsJson)) : null;
}

/** The one version a policy is currently on (§C.2: exactly one is `effective`). */
export async function effectiveVersion(ctx: Ctx, policyId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.axisPolicyVersions)
    .where(
      scoped(
        ctx,
        schema.axisPolicyVersions,
        and(eq(schema.axisPolicyVersions.policyId, policyId), eq(schema.axisPolicyVersions.state, "effective"))
      )
    );
  return row;
}

/** The two statuses that carry risk: the contract exists and has not left it. */
const onRisk = (policy: PolicyRow): boolean => policy.status === "bound" || policy.status === "active";

/**
 * The term bound, in one place because both predicates below need it and two
 * adjacent copies of a comparison is how this rule has drifted before.
 *
 * Half-open, to match every window that reads it: `endAt` itself is outside the
 * priceable term, because `priceEndorsement` refuses an `effectiveFrom` at or
 * past it and a reprice window is `[unpricedFrom, now)`.
 */
const termEnded = (policy: PolicyRow, now: number): boolean => now >= policy.endAt;

const TERM_ENDED = "cover term has ended; there is no remaining term to price into";

/**
 * Why this cover cannot take an endorsement at `now`, or `null` if it can.
 *
 * One predicate rather than a hand-copy per pricing site: read by
 * `priceEndorsement` and by `repriceFromTelemetry`, which asks it before
 * `gateway.complete` so a refusal costs no billed model call.
 *
 * This is a question about **now**, and its refusal is reversible — the priced
 * watermark does not move, so exposure it declines today is priced by the next
 * window that opens. `ingestBlocker` below is the question a doorway asks
 * instead.
 */
export function endorsementBlocker(policy: PolicyRow, now: number): string | null {
  if (!onRisk(policy)) return "this cover is not on risk; endorsement is unavailable";
  if (termEnded(policy, now)) return TERM_ENDED;
  return null;
}

/**
 * Why no future window could ever price a point on this cover, or `null`.
 *
 * Not `endorsementBlocker`: that one asks whether an endorsement can be priced
 * *now*, and may refuse reversibly. This one guards `TelematicsIngest.ingest`,
 * whose refusal is a 400 that discards the batch — a device treats 4xx as
 * terminal and drops its buffer — so it may only refuse what is unpriceable
 * *forever*, or it destroys evidence that cannot be recovered.
 *
 * The two answers coincide on `cancelled`, `expired`, `renewed` and `ntu`, and
 * differ on `lapsed` (and `draft`), which still have a path back to `active`:
 * `reinstatePolicy` cures a lapse over an unchanged term and writes no cover
 * gap, and the watermark does not advance while reprices are refused, so the
 * next window spans the whole lapse and prices exactly these points.
 *
 * The status answer comes from `POLICY_TRANSITIONS` via `canPolicyReach` and
 * never from a literal list of states — a second list is the hand-copy that has
 * produced this rule's last three defects.
 */
export function ingestBlocker(policy: PolicyRow, now: number): string | null {
  // `status` is an unconstrained text column, so guard rather than cast: an
  // unrecognised status has no row in `POLICY_TRANSITIONS`, and indexing it
  // would turn a device-facing 400 into a 500. Unknown means unwalkable, which
  // is exactly the answer this predicate wants.
  const reachesRisk = isPolicyState(policy.status) && canPolicyReach(policy.status, "active");
  if (!onRisk(policy) && !reachesRisk) {
    return "this cover can no longer go on risk; telemetry cannot be priced into it";
  }
  // Kept, unlike the status half: past `endAt` no reprice can ever run
  // (`repriceFromTelemetry` refuses on the same bound), so every point in the
  // batch is unpriceable forever. The per-point `p.at >= endAt` check is about
  // where the point is stamped, not about whether a window can still open.
  if (termEnded(policy, now)) return TERM_ENDED;
  return null;
}

/** Everything the preview endpoint returns and the write endpoint acts on. */
export async function priceEndorsement(ctx: Ctx, policy: PolicyRow, input: EndorseInput) {
  const blocker = endorsementBlocker(policy, ctx.now);
  if (blocker) throw conflict(blocker);
  const current = await effectiveVersion(ctx, policy.id);
  if (!current) throw conflict("policy has no effective version to endorse");

  // Cover sold today may incept next week, and an endorsement cannot take
  // effect before the cover it changes: defaulting to `now` on a forward-dated
  // policy refused every endorsement with "must fall inside the remaining
  // term". Left unsaid, the change takes effect when the cover does.
  const effectiveFrom = input.effectiveFrom ?? Math.max(ctx.now, current.effectiveFrom);
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
  const declared = await declaredPricingInputs(ctx, policy);
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
    changeSetHash: await changeSetHashOf(input)
  };
}

/**
 * `opts.type` is the transaction type the change is recorded under, and with it
 * the idempotency-key prefix and the approval subject ref. A telemetry-driven
 * reprice (`UBI-REPRICE`) is an endorsement in every other respect — same
 * pricing, same gate, same recipe, same event — so it rides this function rather
 * than a second copy of it, and only the provenance of the change differs.
 *
 * The type belongs in the *approval* subject ref and not only in the ledger key:
 * `openTxn` already keys idempotency on (tenant, type, key), but an approval is
 * looked up on (tenant, subjectRef, policyKey) with no type in it. Without the
 * type, a manual endorsement whose change set happens to equal a reprice's
 * factor set shares one subject ref, and a `/reprice` could then consume the
 * human decision granted for the manual change.
 *
 * `opts.termsStamp` is merged into the new version's `termsJson` in the same
 * insert — provenance a later write could fail to add is provenance a disputed
 * premium does not have. `opts.approvalContext` is what the approver is shown.
 */
export async function endorsePolicy(
  ctx: Ctx,
  policy: PolicyRow,
  input: EndorseInput,
  opts: {
    type?: string;
    termsStamp?: Record<string, unknown>;
    approvalContext?: Record<string, unknown>;
  } = {}
) {
  const { current, effectiveFrom, quote, needsReferral, changeSetHash } = await priceEndorsement(ctx, policy, input);
  if (needsReferral) throw badRequest("this change is outside the product's rating inputs and needs referral");

  const type = opts.type ?? "ENDORSE";
  // `ENDORSE` -> `axis.endorse`, unchanged from before this parameter existed.
  const keyPrefix = `axis.${type.toLowerCase()}`;

  // `ENDORSE` -> `axis_endorse:<policy>:<version>:<hash>`, extending the
  // convention docs/specs/gap-axis-design.md §B.1 fixed and ORBIT's tool path
  // shares. `current.id` is in the key because `changeSetHash` covers
  // `{changes, reason}` and NOT the price: two endorsements naming the same
  // factors at the same weights but a different premium hash identically, and
  // on the hash alone the second one replayed the first's settled transaction
  // — `runTxn` returns it untouched and posts no journal — while this function
  // carried on and superseded the version at the new premium. Money state
  // moved with no journal behind it (CLAUDE.md #12). Exactly one endorsement
  // can supersede a given version (§C.2), so that version's id is the honest
  // scope: a genuine duplicate off the same version still collides, a real
  // second price move does not. An agent-raised and a desk-raised endorsement
  // of the same change set still share one approval identity, because they
  // read the same current version.
  //
  // The **ledger** keys below carry `premiumDeltaMinor` and `proRataDays` on top
  // of that, and the subject ref deliberately does not. The version only stops
  // being the full scope when a retry re-reads it: the charge settles, the
  // version insert never lands, and the retry prices differently — a reprice
  // whose model returns another `premiumDeltaPpm` for the same factor codes.
  // Those two fields are what makes the keys differ, and they are the honest
  // pair: off a fixed `current.id` the new premium is
  // `current.premiumMinor + premiumDeltaMinor`, and every other quote field
  // derives from that plus `proRataDays`, so together they determine the whole
  // quote. Neither posted amount does on its own — `share()` maps a band of
  // deltas onto one `chargeMinor`, and `premiumDeltaMinor` alone cannot tell a
  // back-dated re-issue from the original at the same target premium.
  //
  // It does not make the path atomic; the abandoned settled charge still needs
  // compensation, and that is a recorded follow-up. The quote lives on the
  // ledger key alone because the approval identity is the *request*, not the
  // price it happens to compute to, and forking it on the price would stop an
  // agent-raised and a desk-raised change sharing one decision.
  const subjectRef = `axis_${type.toLowerCase().replaceAll("-", "_")}:${policy.id}:${current.id}:${changeSetHash}`;
  const refundMinor = quote.refundMinor;

  // Both gates run before the first write. Settling the commission move and
  // then failing the refund approval would leave money posted against a
  // contract that never grew a version.
  // ponytail: a refused refund has already consumed the endorse approval, so
  // the retry needs it re-granted. Chaining the two into one approval record is
  // the fix if desks feel it.
  //
  // The context is what the approver actually reads: without it the pending row
  // is a policy id and a SHA-256, and a model-driven reprice is indistinguishable
  // from a manual change (CLAUDE.md #11 — every AI artifact carries an
  // inspectable "why", and this is the surface where a human authorises one).
  const context = { txnType: type, reason: input.reason ?? null, ...(opts.approvalContext ?? {}) };
  if (quote.chargeMinor !== 0) {
    await gate(ctx, { policyKey: "axis.endorse", subjectRef, amountMinor: Math.abs(quote.chargeMinor), context });
  }
  if (refundMinor > 0) {
    if (!autoApprovable("REFUND-ISSUE") && ctx.policy.autoApprove.includes("ledger.refund")) {
      throw conflict("REFUND-ISSUE may not be auto-approved (docs/19 §7)");
    }
    await gate(ctx, {
      policyKey: "ledger.refund",
      subjectRef: `${subjectRef}:refund`,
      amountMinor: refundMinor,
      context
    });
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
        type,
        idempotencyKey: `${keyPrefix}:${policy.id}:${current.id}:${changeSetHash}:${quote.premiumDeltaMinor}:${quote.proRataDays}`,
        currency: policy.currency,
        grossMinor: Math.abs(quote.chargeMinor),
        subjectRefs: { policy: policy.id }
      },
      {
        recipe: {
          // A negative delta gives commission back. That is the clawback recipe,
          // under the ENDORSE type — the transaction is still an endorsement.
          //
          // The recipe stays ENDORSE's whatever `opts.type` says, and that
          // divergence is deliberate: the transaction type records *why* the
          // price moved (a sensor, not an underwriter) while the posting is the
          // same posting. RECIPES["UBI-REPRICE"] exists only because
          // POST /v1/txn/{type} validates against that table.
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
        idempotencyKey: `${keyPrefix}.refund:${policy.id}:${current.id}:${changeSetHash}:${quote.premiumDeltaMinor}:${quote.proRataDays}`,
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

  const carried = JSON.parse(current.termsJson ?? "{}") as Record<string, unknown>;
  for (const k of VERSION_SCOPED_TERMS) delete carried[k];
  const terms = { ...carried, ...input.changes, ...(opts.termsStamp ?? {}) };
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


