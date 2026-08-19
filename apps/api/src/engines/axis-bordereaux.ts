import { and, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { id as newId, schema } from "@lyra/db";
import { actorRef, audit, badRequest, conflict, emit, scoped, type Ctx } from "@lyra/core";
import { IsoMonth } from "../http.js";

// docs/27 §E. A bordereau is the periodic reconciliation file between us and
// a provider/channel/partner: what we say happened this period vs what they
// say happened. Outbound is generated straight from our own ledger data;
// inbound is whatever lines the counterparty handed us, matched against our
// records by reconcileBordereaux. Line matchState is one of unmatched,
// matched, variance, missing_ours, missing_theirs — this first pass never
// produces missing_theirs (we only ever reconcile lines *they* sent us).

type BordereauRow = typeof schema.axisBordereaux.$inferSelect;
type LineInsert = typeof schema.axisBordereauLines.$inferInsert;
type LineRow = typeof schema.axisBordereauLines.$inferSelect;

const RawLine = z.object({
  externalRef: z.string().min(1).max(200),
  policyId: z.string().nullish(),
  grossPremiumMinor: z.number().int().default(0),
  taxMinor: z.number().int().default(0),
  netPremiumMinor: z.number().int().default(0),
  commissionMinor: z.number().int().default(0),
  claimsPaidMinor: z.number().int().default(0),
  reserveMinor: z.number().int().default(0)
});

export const GenerateBordereauBody = z.object({
  direction: z.enum(["inbound", "outbound"]),
  counterpartyKind: z.enum(["provider", "channel", "partner"]),
  counterpartyId: z.string().min(1),
  kind: z.enum(["premium", "claims", "combined"]),
  // `IsoMonth`, not the bare shape: `2026-13` matched, and `Date.UTC(2026, 12,
  // 1)` in `periodRange` rolls it into January 2027 — a regulatory return
  // labelled one month and summing another, with nothing to notice it.
  period: IsoMonth,
  currency: z.string().length(3).default("AED"),
  lines: z.array(RawLine).default([])
});
export type GenerateBordereauInput = z.infer<typeof GenerateBordereauBody>;

function periodRange(period: string): { start: number; end: number } {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return { start: Date.UTC(y, m - 1, 1), end: Date.UTC(y, m, 1) };
}

async function buildOutboundLines(ctx: Ctx, input: GenerateBordereauInput, bordereauId: string): Promise<LineInsert[]> {
  const { start, end } = periodRange(input.period);
  const lines: LineInsert[] = [];

  if (input.kind === "premium" || input.kind === "combined") {
    // dist_commission_entries.providerId is copied from the policy at accrual
    // time (see dist.ts /commission-entries/accrue), so this filters directly
    // with no join through policies/policy versions.
    const entries = await ctx.db
      .select()
      .from(schema.distCommissionEntries)
      .where(
        and(
          eq(schema.distCommissionEntries.tenantId, ctx.tenantId),
          eq(schema.distCommissionEntries.providerId, input.counterpartyId),
          gte(schema.distCommissionEntries.earnedAt, start),
          lt(schema.distCommissionEntries.earnedAt, end)
        )
      );
    for (const entry of entries) {
      lines.push({
        id: newId("bdxl", ctx.now),
        tenantId: ctx.tenantId,
        bordereauId,
        lineNo: lines.length + 1,
        policyId: entry.policyId,
        policyVersionId: null,
        claimId: null,
        externalRef: null,
        riskRef: null,
        effectiveFrom: null,
        effectiveTo: null,
        grossPremiumMinor: entry.premiumMinor,
        taxMinor: entry.taxMinor,
        netPremiumMinor: entry.premiumMinor - entry.taxMinor,
        commissionMinor: entry.grossCommissionMinor,
        claimsPaidMinor: 0,
        reserveMinor: 0,
        currency: entry.currency,
        matchState: "unmatched",
        varianceMinor: 0,
        rawJson: null,
        createdAt: ctx.now,
        updatedAt: ctx.now
      });
    }
  }

  if (input.kind === "claims" || input.kind === "combined") {
    const rows = await ctx.db
      .select({ claim: schema.axisClaims })
      .from(schema.axisClaims)
      .innerJoin(schema.axisPolicies, eq(schema.axisClaims.policyId, schema.axisPolicies.id))
      .where(
        and(
          eq(schema.axisClaims.tenantId, ctx.tenantId),
          eq(schema.axisPolicies.providerId, input.counterpartyId),
          gte(schema.axisClaims.updatedAt, start),
          lt(schema.axisClaims.updatedAt, end)
        )
      );
    for (const { claim } of rows) {
      lines.push({
        id: newId("bdxl", ctx.now),
        tenantId: ctx.tenantId,
        bordereauId,
        lineNo: lines.length + 1,
        policyId: claim.policyId,
        policyVersionId: claim.policyVersionId,
        claimId: claim.id,
        externalRef: null,
        riskRef: null,
        effectiveFrom: null,
        effectiveTo: null,
        grossPremiumMinor: 0,
        taxMinor: 0,
        netPremiumMinor: 0,
        commissionMinor: 0,
        claimsPaidMinor: claim.paidMinor,
        reserveMinor: claim.reserveMinor,
        currency: claim.currency,
        matchState: "unmatched",
        varianceMinor: 0,
        rawJson: null,
        createdAt: ctx.now,
        updatedAt: ctx.now
      });
    }
  }

  return lines;
}

function buildInboundLines(ctx: Ctx, input: GenerateBordereauInput, bordereauId: string): LineInsert[] {
  return input.lines.map((raw, i) => ({
    id: newId("bdxl", ctx.now),
    tenantId: ctx.tenantId,
    bordereauId,
    lineNo: i + 1,
    policyId: raw.policyId ?? null,
    policyVersionId: null,
    claimId: null,
    externalRef: raw.externalRef,
    riskRef: null,
    effectiveFrom: null,
    effectiveTo: null,
    grossPremiumMinor: raw.grossPremiumMinor,
    taxMinor: raw.taxMinor,
    netPremiumMinor: raw.netPremiumMinor || raw.grossPremiumMinor - raw.taxMinor,
    commissionMinor: raw.commissionMinor,
    claimsPaidMinor: raw.claimsPaidMinor,
    reserveMinor: raw.reserveMinor,
    currency: input.currency,
    matchState: "unmatched",
    varianceMinor: 0,
    rawJson: JSON.stringify(raw),
    createdAt: ctx.now,
    updatedAt: ctx.now
  }));
}

async function replaceLines(ctx: Ctx, bordereauId: string, lines: LineInsert[]): Promise<void> {
  await ctx.db
    .delete(schema.axisBordereauLines)
    .where(scoped(ctx, schema.axisBordereauLines, eq(schema.axisBordereauLines.bordereauId, bordereauId)));
  if (lines.length > 0) await ctx.db.insert(schema.axisBordereauLines).values(lines);
}

function totals(lines: LineInsert[]) {
  const sum = (f: "grossPremiumMinor" | "commissionMinor" | "claimsPaidMinor" | "reserveMinor") =>
    lines.reduce((n, l) => n + (Number(l[f]) || 0), 0);
  return {
    lineCount: lines.length,
    grossPremiumMinor: sum("grossPremiumMinor"),
    commissionMinor: sum("commissionMinor"),
    claimsPaidMinor: sum("claimsPaidMinor"),
    reserveMinor: sum("reserveMinor")
  };
}

export async function generateBordereaux(ctx: Ctx, input: GenerateBordereauInput) {
  if (input.direction === "inbound" && input.lines.length === 0) {
    throw badRequest("inbound bordereau needs at least one line");
  }

  const [prior] = await ctx.db
    .select()
    .from(schema.axisBordereaux)
    .where(
      and(
        eq(schema.axisBordereaux.tenantId, ctx.tenantId),
        eq(schema.axisBordereaux.direction, input.direction),
        eq(schema.axisBordereaux.counterpartyId, input.counterpartyId),
        eq(schema.axisBordereaux.kind, input.kind),
        eq(schema.axisBordereaux.period, input.period)
      )
    );

  // ponytail: regenerating an inbound bordereau would blow away matchState a
  // human already set on its lines via reconcileBordereaux. Outbound is
  // system-generated and safe to recompute every call; inbound import is a
  // one-shot for this first pass — regenerate support for it can follow if
  // a real need for re-importing a period shows up.
  if (prior && input.direction === "inbound") {
    throw conflict(`inbound bordereau for ${input.period} already exists (${prior.id})`);
  }

  const bordereauId = prior?.id ?? newId("bdx", ctx.now);
  const lines =
    input.direction === "outbound"
      ? await buildOutboundLines(ctx, input, bordereauId)
      : buildInboundLines(ctx, input, bordereauId);

  await replaceLines(ctx, bordereauId, lines);
  const sums = totals(lines);

  const row: typeof schema.axisBordereaux.$inferInsert = {
    id: bordereauId,
    tenantId: ctx.tenantId,
    direction: input.direction,
    counterpartyKind: input.counterpartyKind,
    counterpartyId: input.counterpartyId,
    kind: input.kind,
    period: input.period,
    currency: lines[0]?.currency ?? input.currency,
    ...sums,
    varianceMinor: prior?.varianceMinor ?? 0,
    state: "generated",
    fileId: null,
    sourceFileId: null,
    escrowBatchId: null,
    generatedBy: actorRef(ctx),
    generatedAt: ctx.now,
    closedAt: null,
    createdAt: prior?.createdAt ?? ctx.now,
    updatedAt: ctx.now
  };

  if (prior) {
    await ctx.db
      .update(schema.axisBordereaux)
      .set(row)
      .where(scoped(ctx, schema.axisBordereaux, eq(schema.axisBordereaux.id, bordereauId)));
  } else {
    await ctx.db.insert(schema.axisBordereaux).values(row);
  }

  await audit(ctx, { action: "axis.bordereau.generated", subjectRef: bordereauId, before: prior, after: row });
  await emit(ctx, {
    module: "axis",
    type: "axis.bordereau.generated",
    subject: bordereauId,
    data: {
      bordereauId,
      direction: input.direction,
      counterpartyId: input.counterpartyId,
      kind: input.kind,
      period: input.period,
      lineCount: sums.lineCount
    }
  });

  return { bordereau: row, lines };
}

export async function reconcileBordereaux(ctx: Ctx, bordereau: BordereauRow) {
  const lines = await ctx.db
    .select()
    .from(schema.axisBordereauLines)
    .where(scoped(ctx, schema.axisBordereauLines, eq(schema.axisBordereauLines.bordereauId, bordereau.id)));

  let varianceTotal = 0;
  const updated: LineRow[] = [];
  for (const line of lines) {
    if (!line.externalRef) {
      updated.push(line);
      continue;
    }

    // ponytail: single-tier match on policyNo. docs/27 §E names a 3-tier
    // match order (policyNo, then risk ref, then fuzzy); this collapses it to
    // the one identifier every real bordereau line actually carries. Add the
    // other tiers if a real feed shows up without policyNo populated.
    const [policy] = await ctx.db
      .select()
      .from(schema.axisPolicies)
      .where(and(eq(schema.axisPolicies.tenantId, ctx.tenantId), eq(schema.axisPolicies.policyNo, line.externalRef)));

    let matchState: string;
    let varianceMinor = 0;
    if (!policy) {
      matchState = "missing_ours";
    } else {
      varianceMinor = line.grossPremiumMinor - policy.grossMinor;
      matchState = varianceMinor === 0 ? "matched" : "variance";
    }
    varianceTotal += varianceMinor;

    const policyId = policy?.id ?? line.policyId;
    await ctx.db
      .update(schema.axisBordereauLines)
      .set({ matchState, varianceMinor, policyId, updatedAt: ctx.now })
      .where(scoped(ctx, schema.axisBordereauLines, eq(schema.axisBordereauLines.id, line.id)));
    updated.push({ ...line, matchState, varianceMinor, policyId, updatedAt: ctx.now });
  }

  const after: BordereauRow = { ...bordereau, varianceMinor: varianceTotal, state: "matched", updatedAt: ctx.now };
  await ctx.db
    .update(schema.axisBordereaux)
    .set({ varianceMinor: varianceTotal, state: "matched", updatedAt: ctx.now })
    .where(scoped(ctx, schema.axisBordereaux, eq(schema.axisBordereaux.id, bordereau.id)));

  await audit(ctx, { action: "axis.bordereau.reconciled", subjectRef: bordereau.id, before: bordereau, after });
  await emit(ctx, {
    module: "axis",
    type: "axis.bordereau.reconciled",
    subject: bordereau.id,
    data: { bordereauId: bordereau.id, varianceMinor: varianceTotal, lineCount: updated.length }
  });

  return { bordereau: after, lines: updated };
}
