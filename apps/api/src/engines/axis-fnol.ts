import { and, desc, eq, inArray, lte, gt } from "drizzle-orm";
import { z } from "zod";
import { id as newId, schema } from "@lyra/db";
import { audit, emit, notFound, scoped, type Ctx } from "@lyra/core";
import { runTxn } from "@lyra/ledger";
import { parseTriage, triageMessages, type Gateway, type Triage } from "@lyra/model-gateway";

// docs/27 F24 / docs/specs/gap-axis-design.md §D.1. Two rules, and everything
// here follows from them. The cover that answers a loss is the cover that was
// in force on the day of the loss, not the cover in force today — so the check
// reads the version history, never the policy head. And a notification is
// recorded whether or not any cover answers, because refusing to write one
// down is a conduct failure, not a control.

type PolicyRow = typeof schema.axisPolicies.$inferSelect;
type VersionRow = typeof schema.axisPolicyVersions.$inferSelect;

/** docs/specs/gap-axis-design.md §C.3. */
export type CoverageState =
  | "in_force"
  | "not_yet_incepted"
  | "lapsed_at_loss"
  | "cancelled_at_loss"
  | "out_of_cover"
  | "unknown";

export interface Coverage {
  coverageState: CoverageState;
  policyVersionId: string | null;
  versionSeq: number | null;
  limits: unknown;
  excessMinor: number;
  warnings: string[];
}

/**
 * An instant a `Date` can actually hold (ECMA-262: ±8.64e15 ms from the epoch).
 * `z.number().int()` alone is a *safe*-integer check, so it lets through the band
 * (8.64e15, 9.007e15] — and every renderer downstream (`new Date(ms).toISOString()`,
 * the fraud prompt, the claim UI) throws on those. It threw inside a blanket
 * `catch`, so a claimant filing with a big number silently turned their own fraud
 * scoring off. Rejected at the trust boundary; `promptInstant` is the second layer.
 */
const InstantMs = z.number().int().min(-8.64e15).max(8.64e15);

export const CoverageCheckBody = z.object({
  policyId: z.string().min(1),
  incidentAt: InstantMs
});

/**
 * The version whose window contains the incident. `voided` versions are
 * excluded — a correction that never should have existed cannot be the cover
 * someone relied on — but `superseded` ones are the whole point: an endorsement
 * closes version 1's window, it does not erase the term it covered.
 */
export async function versionAt(ctx: Ctx, policyId: string, incidentAt: number): Promise<VersionRow | undefined> {
  const [row] = await ctx.db
    .select()
    .from(schema.axisPolicyVersions)
    .where(
      scoped(
        ctx,
        schema.axisPolicyVersions,
        and(
          eq(schema.axisPolicyVersions.policyId, policyId),
          inArray(schema.axisPolicyVersions.state, ["effective", "superseded"]),
          lte(schema.axisPolicyVersions.effectiveFrom, incidentAt),
          gt(schema.axisPolicyVersions.effectiveTo, incidentAt)
        )
      )
    )
    // Windows should not overlap (§C.2 invariant), but if a correction ever
    // leaves two, the later one is the one that was actually being applied.
    .orderBy(desc(schema.axisPolicyVersions.versionSeq))
    .limit(1);
  return row;
}

export async function policyForCoverage(ctx: Ctx, policyId: string): Promise<PolicyRow> {
  const [policy] = await ctx.db
    .select()
    .from(schema.axisPolicies)
    .where(scoped(ctx, schema.axisPolicies, eq(schema.axisPolicies.id, policyId)));
  if (!policy) throw notFound("policies");
  return policy;
}

/**
 * Deterministic SQL, no model (§G). Order matters: a loss before inception is
 * `not_yet_incepted` even on a policy that was later cancelled, because the
 * earliest reason cover fails is the true one and it is the one the handler
 * must be told.
 */
export async function checkCoverage(ctx: Ctx, policy: PolicyRow, incidentAt: number): Promise<Coverage> {
  const version = await versionAt(ctx, policy.id, incidentAt);
  const terms = version ? (JSON.parse(version.termsJson) as Record<string, unknown>) : {};
  const excessMinor = typeof terms.excessMinor === "number" ? terms.excessMinor : 0;
  const warnings: string[] = [];

  const state = ((): CoverageState => {
    if (incidentAt < policy.startAt) {
      warnings.push(`incident predates inception (cover starts ${policy.startAt})`);
      return "not_yet_incepted";
    }
    const cancelledAt = policy.cancelEffectiveAt ?? policy.cancelledAt;
    if (cancelledAt !== null && cancelledAt <= incidentAt) {
      warnings.push(`policy was cancelled with effect from ${cancelledAt}`);
      return "cancelled_at_loss";
    }
    if (policy.lapsedAt !== null && policy.lapsedAt <= incidentAt) {
      warnings.push(`policy had lapsed for non-payment at ${policy.lapsedAt}`);
      return "lapsed_at_loss";
    }
    if (incidentAt >= policy.endAt) {
      warnings.push(`incident falls after the term ended (${policy.endAt})`);
      return "out_of_cover";
    }
    if (!version) {
      // Inside the term, yet no version answers. Either the policy predates
      // versioning or a correction left a hole; either way a human decides.
      warnings.push("no policy version covers the incident date");
      return "unknown";
    }
    return "in_force";
  })();

  return {
    coverageState: state,
    policyVersionId: state === "in_force" ? (version?.id ?? null) : null,
    versionSeq: state === "in_force" ? (version?.versionSeq ?? null) : null,
    limits: state === "in_force" ? (terms.limits ?? terms) : null,
    excessMinor: state === "in_force" ? excessMinor : 0,
    warnings
  };
}

/* --------------------------------------------------------------- register */

export const FnolBody = z.object({
  policyId: z.string().min(1),
  customerId: z.string().min(1).optional(),
  claimNo: z.string().min(1).max(64).optional(),
  /** Absent on a notification where nobody can yet say when it happened. */
  incidentAt: InstantMs.nullish(),
  reportedAt: InstantMs.optional(),
  perilCode: z.string().max(64).nullish(),
  causeCode: z.string().max(64).nullish(),
  catCode: z.string().max(64).nullish(),
  description: z.string().max(4000).nullish(),
  /** What the claimant says it is worth. Not a reserve and not a settlement. */
  amountMinor: z.number().int().nonnegative().nullish(),
  settledMinor: z.number().int().nonnegative().nullish(),
  currency: z.string().length(3).optional(),
  channel: z.string().max(32).nullish(),
  contact: z.string().max(200).nullish()
});
export type FnolInput = z.infer<typeof FnolBody>;

/**
 * `CLM-YYMM-XXXXXX` off the claim id. A counter would need a lock and a
 * gap-free sequence nobody asked for; the id is already unique per tenant.
 */
function claimNumber(claimId: string, now: number): string {
  const d = new Date(now);
  const stamp = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return `CLM-${stamp}-${claimId.slice(-6).toUpperCase()}`;
}

/**
 * docs/specs/gap-axis-design.md §G.1. Ambient, non-consequential: only fills
 * the fields a human left blank, never overwrites a typed value. Never
 * throws to the caller — a triage failure is not a reason to fail the
 * notification (§D.1, same principle `registerFnol` itself follows).
 */
export async function triageFnol(
  ctx: Ctx,
  gateway: Gateway,
  description: string
): Promise<{ triage: Triage; aiAuditId: string } | null> {
  try {
    const reply = await gateway.complete(ctx, {
      module: "axis",
      purpose: "axis.fnol.triage",
      tier: "fast",
      messages: triageMessages(description)
    });
    return { triage: parseTriage(reply.text), aiAuditId: reply.auditId };
  } catch {
    return null;
  }
}

export async function registerFnol(ctx: Ctx, input: FnolInput, gateway?: Gateway) {
  const policy = await policyForCoverage(ctx, input.policyId);
  const reportedAt = input.reportedAt ?? ctx.now;
  // No incident date given: the notification date is the best evidence there
  // is, and a claim with no date at all cannot be coverage-checked at all.
  const incidentAt = input.incidentAt ?? reportedAt;
  const cover = await checkCoverage(ctx, policy, incidentAt);

  const claimId = newId("clm", ctx.now);
  const currency = input.currency ?? policy.currency;

  // §G.1: triage only when the human left both codes blank and gave enough
  // text to classify. `gateway` is optional so pre-existing callers/tests
  // that construct a claim with no model available keep working unchanged.
  const triaged =
    gateway && !input.perilCode && !input.causeCode && input.description
      ? await triageFnol(ctx, gateway, input.description)
      : null;

  // Non-financial: a notification moves no money, so `FNOL-REGISTER` carries no
  // recipe. It exists so the claim has a transaction to be reversed against and
  // an idempotency key of its own.
  const txn = await runTxn(ctx, {
    type: "FNOL-REGISTER",
    idempotencyKey: `axis.fnol:${claimId}`,
    currency,
    subjectRefs: { policy: policy.id, claim: claimId }
  });

  const fnol = {
    description: input.description ?? null,
    channel: input.channel ?? "api",
    contact: input.contact ?? null,
    causeCode: input.causeCode ?? null,
    ...(triaged ? { triage: { ...triaged.triage, aiAuditId: triaged.aiAuditId } } : {})
  };
  const claim: typeof schema.axisClaims.$inferSelect = {
    id: claimId,
    tenantId: ctx.tenantId,
    policyId: policy.id,
    customerId: input.customerId ?? policy.customerId,
    caseId: null,
    claimNo: input.claimNo ?? claimNumber(claimId, ctx.now),
    incidentAt,
    reportedAt,
    amountMinor: input.amountMinor ?? null,
    settledMinor: input.settledMinor ?? null,
    currency,
    status: "reported",
    fnolJson: JSON.stringify(fnol),
    assessorRef: null,
    policyVersionId: cover.policyVersionId,
    coverageState: cover.coverageState,
    coverageCheckedAt: ctx.now,
    // Snapshotted, not looked up later: the version can be voided by a
    // correction and the claim must still show what was relied on.
    coverageJson: JSON.stringify({
      versionSeq: cover.versionSeq,
      limits: cover.limits,
      excessMinor: cover.excessMinor,
      warnings: cover.warnings
    }),
    perilCode: input.perilCode ?? triaged?.triage.perilCode ?? null,
    causeCode: input.causeCode ?? triaged?.triage.causeCode ?? null,
    catCode: input.catCode ?? null,
    reserveMinor: 0,
    paidMinor: 0,
    recoveredMinor: 0,
    excessMinor: cover.excessMinor,
    handlerRef: null,
    slaDueAt: null,
    fraudScore: null,
    siuState: null,
    complexity: triaged?.triage.complexity ?? "standard",
    reopenedAt: null,
    closedAt: null,
    lastTxnId: txn.id,
    createdAt: ctx.now,
    updatedAt: ctx.now
  };
  await ctx.db.insert(schema.axisClaims).values(claim);

  await audit(ctx, { action: "axis.claim.registered", subjectRef: claimId, after: claim });
  const data = {
    claimId,
    claimNo: claim.claimNo,
    policyId: policy.id,
    customerId: claim.customerId,
    incidentAt,
    coverageState: cover.coverageState,
    perilCode: claim.perilCode
  };
  await emit(ctx, { module: "axis", type: "axis.claim.registered", subject: claimId, data });
  // ORBIT acknowledges the notification to whoever reported it; it must not
  // have to poll AXIS to learn a claim exists (§ state machine, CLAUDE.md §6).
  await emit(ctx, { module: "orbit", type: "orbit.fnol.registered", subject: claimId, data });

  return { claim, coverage: cover, txn };
}
