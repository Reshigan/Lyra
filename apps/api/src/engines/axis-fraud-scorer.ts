import { desc, eq, ne } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { scoped, type Ctx } from "@lyra/core";
import { fraudMessages, parseFraud, type FraudScoreResult, type Gateway } from "@lyra/model-gateway";

// docs/specs/gap-axis-design.md §G.2. Fraud/SIU scoring: score a claim from
// its own facts, the holder's claim history, and any document extraction
// results, then queue a referral when the score crosses SIU_REFERRAL_THRESHOLD.
//
// Not consequential (spec's "Not consequential" list names SIU referral
// creation explicitly, and packages/core/src/approvals.ts has no policy for
// it): unlike axis-reserve-advisor.ts's write through appendReserve, this
// writes axis_siu_referrals directly. A referral is a queue entry for a
// human investigator, never a declinature — it never touches claims.status,
// a reserve, or a payment.

type ClaimRow = typeof schema.axisClaims.$inferSelect;
type SiuReferralRow = typeof schema.axisSiuReferrals.$inferSelect;

// docs/decisions/ADR-0035 (pending): the spec's "tenant threshold" is a
// per-tenant setting not yet modeled; this reuses a single platform-wide cutoff,
// the same simplification G.3 made by reusing appendReserve's authority threshold.
const SIU_REFERRAL_THRESHOLD = 60;
const HISTORY_LIMIT = 20;

/** Other claims by the same policyholder, most recent first, excluding this one. */
export async function holderClaimHistory(ctx: Ctx, claim: ClaimRow): Promise<ClaimRow[]> {
  return ctx.db
    .select()
    .from(schema.axisClaims)
    .where(scoped(ctx, schema.axisClaims, eq(schema.axisClaims.customerId, claim.customerId), ne(schema.axisClaims.id, claim.id)))
    .orderBy(desc(schema.axisClaims.reportedAt))
    .limit(HISTORY_LIMIT);
}

/** Document extraction results for the claim's case, if it has one. No case means no documents yet. */
export async function claimDocuments(ctx: Ctx, claim: ClaimRow): Promise<(typeof schema.axisDocuments.$inferSelect)[]> {
  if (!claim.caseId) return [];
  return ctx.db.select().from(schema.axisDocuments).where(scoped(ctx, schema.axisDocuments, eq(schema.axisDocuments.caseId, claim.caseId)));
}

/** Generation only — never writes anything. Ambient, not consequential (CLAUDE.md §4): a failed call scores nothing. */
/** Prompt payloads carry ISO-8601, never epoch ms — see `FraudContext`. */
const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

export async function scoreFraud(
  ctx: Ctx,
  claim: ClaimRow,
  gateway: Gateway
): Promise<{ result: FraudScoreResult; aiAuditId: string } | null> {
  try {
    const [history, documents] = await Promise.all([holderClaimHistory(ctx, claim), claimDocuments(ctx, claim)]);
    const coverage = claim.coverageJson ? (JSON.parse(claim.coverageJson) as { limits?: Record<string, number> }) : null;

    const reply = await gateway.complete(ctx, {
      module: "axis",
      purpose: "axis.claim.fraud_score",
      tier: "fast",
      messages: fraudMessages({
        perilCode: claim.perilCode,
        causeCode: claim.causeCode,
        incidentAt: iso(claim.incidentAt),
        reportedAt: new Date(claim.reportedAt).toISOString(),
        amountMinor: claim.amountMinor,
        limits: coverage?.limits ?? null,
        history: history.map((h) => ({
          id: h.id,
          perilCode: h.perilCode,
          status: h.status,
          amountMinor: h.amountMinor,
          settledMinor: h.settledMinor,
          closedAt: iso(h.closedAt)
        })),
        documents: documents.map((d) => ({ id: d.id, docType: d.docType, extractionConfidence: d.extractionConfidence }))
      })
    });

    return { result: parseFraud(reply.text), aiAuditId: reply.auditId };
  } catch {
    return null;
  }
}

export interface FraudScoreOutcome {
  score: number;
  /** Null when generation failed, the score is below threshold, or the claim already has a referral (`axis_siu_claim_uq`). */
  referral: SiuReferralRow | null;
}

/**
 * Scores the claim, stamps `claims.fraudScore`, and — when the score crosses
 * SIU_REFERRAL_THRESHOLD and the claim has no referral yet — inserts one
 * `axis_siu_referrals` row and sets `claims.siuState = "referred"`. Returns
 * null only when generation itself failed; a below-threshold score still
 * updates `claims.fraudScore` and returns with `referral: null`.
 */
export async function scoreAndReferClaim(ctx: Ctx, claim: ClaimRow, gateway: Gateway): Promise<FraudScoreOutcome | null> {
  const scored = await scoreFraud(ctx, claim, gateway);
  if (!scored) return null;
  const { result, aiAuditId } = scored;

  await ctx.db
    .update(schema.axisClaims)
    .set({ fraudScore: result.score, updatedAt: ctx.now })
    .where(scoped(ctx, schema.axisClaims, eq(schema.axisClaims.id, claim.id)));

  if (result.score < SIU_REFERRAL_THRESHOLD) return { score: result.score, referral: null };

  const [existing] = await ctx.db
    .select()
    .from(schema.axisSiuReferrals)
    .where(scoped(ctx, schema.axisSiuReferrals, eq(schema.axisSiuReferrals.claimId, claim.id)));
  if (existing) return { score: result.score, referral: null };

  const row: SiuReferralRow = {
    id: newId("siu", ctx.now),
    tenantId: ctx.tenantId,
    claimId: claim.id,
    policyId: claim.policyId,
    score: result.score,
    reasonsJson: JSON.stringify(result.indicators.map((i) => ({ indicator: i.code, weight: i.weight, evidenceRef: i.evidenceRef }))),
    aiAuditId,
    source: "model",
    state: "open",
    assignedTo: null,
    outcome: null,
    savedMinor: 0,
    currency: claim.currency,
    openedAt: ctx.now,
    closedAt: null,
    createdAt: ctx.now,
    updatedAt: ctx.now
  };
  await ctx.db.insert(schema.axisSiuReferrals).values(row);
  await ctx.db
    .update(schema.axisClaims)
    .set({ siuState: "referred", updatedAt: ctx.now })
    .where(scoped(ctx, schema.axisClaims, eq(schema.axisClaims.id, claim.id)));

  return { score: result.score, referral: row };
}
