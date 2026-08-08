import { and, desc, eq, gte, isNotNull, ne } from "drizzle-orm";
import { schema } from "@lyra/db";
import { scoped, type Ctx } from "@lyra/core";
import { parseReserve, reserveMessages, type Gateway, type ReserveRecommendation } from "@lyra/model-gateway";
import { appendReserve, type ClaimReserveInput } from "./axis-claim-lifecycle.js";

// docs/specs/gap-axis-design.md §G.3. Reserve recommendation: suggest the
// indemnity reserve from peril/cause/complexity, policy limits/excess, and
// the tenant's own comparable closed claims — then hand it to appendReserve
// (axis-claim-lifecycle.ts) like any other reserve movement, so it inherits
// that engine's gate above RESERVE_THRESHOLD_MINOR for free.

type ClaimRow = typeof schema.axisClaims.$inferSelect;

const RESERVE_ADVISOR_ACTOR = "reserve-advisor";
const COMPARABLE_WINDOW_MONTHS = 24;
const COMPARABLE_LIMIT = 20;

function monthsAgo(atMs: number, months: number): number {
  const d = new Date(atMs);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.getTime();
}

/** Same peril, closed in the last 24 months, not this claim. "Closed" is `closedAt IS NOT NULL` — `status` has no "closed" value. */
export async function comparableClosedClaims(ctx: Ctx, claim: ClaimRow): Promise<ClaimRow[]> {
  if (!claim.perilCode) return [];
  const since = monthsAgo(ctx.now, COMPARABLE_WINDOW_MONTHS);
  return ctx.db
    .select()
    .from(schema.axisClaims)
    .where(
      scoped(
        ctx,
        schema.axisClaims,
        and(
          eq(schema.axisClaims.perilCode, claim.perilCode),
          isNotNull(schema.axisClaims.closedAt),
          gte(schema.axisClaims.closedAt, since),
          ne(schema.axisClaims.id, claim.id)
        )
      )
    )
    .orderBy(desc(schema.axisClaims.closedAt))
    .limit(COMPARABLE_LIMIT);
}

/** Generation only — never writes anything. Ambient, not consequential (CLAUDE.md §4): a failed call recommends nothing. */
export async function recommendReserve(
  ctx: Ctx,
  claim: ClaimRow,
  gateway: Gateway
): Promise<{ recommendation: ReserveRecommendation; aiAuditId: string } | null> {
  try {
    const comparables = await comparableClosedClaims(ctx, claim);
    const coverage = claim.coverageJson
      ? (JSON.parse(claim.coverageJson) as { limits?: Record<string, number> })
      : null;

    const reply = await gateway.complete(ctx, {
      module: "axis",
      purpose: "axis.claim.reserve_recommend",
      tier: "fast",
      messages: reserveMessages({
        perilCode: claim.perilCode,
        causeCode: claim.causeCode,
        complexity: claim.complexity,
        excessMinor: claim.excessMinor,
        limits: coverage?.limits ?? null,
        comparables: comparables.map((c) => ({
          id: c.id,
          perilCode: c.perilCode,
          causeCode: c.causeCode,
          reserveMinor: c.reserveMinor,
          paidMinor: c.paidMinor,
          settledMinor: c.settledMinor
        }))
      })
    });

    return { recommendation: parseReserve(reply.text), aiAuditId: reply.auditId };
  } catch {
    return null;
  }
}

/**
 * Generates a recommendation and writes it as an indemnity reserve movement
 * with `setBy: "agent:reserve-advisor"`, via the existing appendReserve gate.
 * Returns null when generation failed or gave no usable point estimate — the
 * claim keeps whatever reserve it already had.
 */
export async function writeRecommendedReserve(ctx: Ctx, claim: ClaimRow, gateway: Gateway) {
  const result = await recommendReserve(ctx, claim, gateway);
  if (!result) return null;
  const { recommendation, aiAuditId } = result;
  const { recommendedMinor } = recommendation;
  if (recommendedMinor === null) return null;

  const agentCtx: Ctx = {
    ...ctx,
    actor: { kind: "agent", id: RESERVE_ADVISOR_ACTOR, tenantId: ctx.tenantId, grants: [] }
  };
  const input: ClaimReserveInput = {
    head: "indemnity",
    amountMinor: recommendedMinor,
    basis: "ai_recommended",
    rationale: "AI-recommended reserve from comparable closed claims.",
    evidenceJson: JSON.stringify({ band: recommendation.band, comparables: recommendation.comparables }),
    confidence: recommendation.confidence,
    aiAuditId
  };
  return appendReserve(agentCtx, claim, input);
}
