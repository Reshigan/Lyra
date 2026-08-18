import { eq, gte, lte } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { badRequest, conflict, emit, hashObject, scoped, type Ctx, type TimeseriesIngest } from "@lyra/core";
import { runTxn } from "@lyra/ledger";
import { parseUbi, ubiMessages, type Gateway, type UbiContext } from "@lyra/model-gateway";
import { effectiveVersion, endorsePolicy } from "./axis-endorse.js";

// docs/27 group E — telematics/UBI. First real implementation of the H6 seam
// (`TimeseriesIngest`, packages/core/src/seams.ts): usage/sensor points arriving
// against a contract, stored as the input a later reprice reads.
//
// The seam's point shape carries a value and no metric name, so `source` is the
// series key (`telematics:obd:km`, `telematics:obd:harsh_brake`) and there is
// one adapter instance per series. Widening H6 would need an ADR; nothing here
// needs it widened.

export type PolicyRow = typeof schema.axisPolicies.$inferSelect;

/**
 * One batch, one transaction. The cap is what keeps a single ingest inside a
 * Worker's CPU budget and keeps `acceptedCount` a number an operator can read;
 * a device with more than this to send sends two batches, and the unique index
 * makes the split free of double counting.
 */
export const MAX_POINTS_PER_BATCH = 1000;

/** D1 caps bound parameters per statement (same reasoning as engines/backup.ts). */
const ROWS_PER_INSERT = 11; // 8 columns per row

type Point = { at: number; value: number };

/** Legacy/loose callers may name the bare policy id; the stored form is prefixed. */
const namesPolicy = (subjectRef: string, policy: PolicyRow): boolean =>
  subjectRef === `policy:${policy.id}` || subjectRef === policy.id;

/**
 * H6 for one series on one contract. Aggregated telemetry only becomes
 * consequential when it changes a price, so ingest has no approval gate and
 * posts no journal — Task 4's reprice owns that gate.
 */
export class TelematicsIngest implements TimeseriesIngest {
  constructor(
    private readonly ctx: Ctx,
    readonly source: string,
    private readonly policy: PolicyRow
  ) {}

  async ingest(loose: string, points: ReadonlyArray<Point>): Promise<void> {
    const ctx = this.ctx;

    // Everything that can refuse the batch happens before `runTxn`, so a
    // refusal leaves no transaction row and the corrected batch is not stuck
    // behind a burnt idempotency key (docs/19 §3, same ordering as runTxn's own
    // preconditions).
    if (!namesPolicy(loose, this.policy)) {
      throw badRequest(`subjectRef ${loose} is not policy ${this.policy.id}`);
    }
    // Stored in the prefixed form whichever form the caller used: a reprice
    // reads one subjectRef, so points split across `pol_1` and `policy:pol_1`
    // would be read as half the exposure and priced on it.
    const subjectRef = `policy:${this.policy.id}`;
    if (points.length === 0) throw badRequest("no points to ingest");
    if (points.length > MAX_POINTS_PER_BATCH) {
      throw badRequest(`too many points: ${points.length} exceeds MAX_POINTS_PER_BATCH (${MAX_POINTS_PER_BATCH})`);
    }

    // Dedup inside the batch as well as against the table: two rows for the
    // same instant would collide on `axis_telem_point_uq` and make
    // `acceptedCount` a lie about what landed. First occurrence wins.
    const byAt = new Map<number, Point>();
    for (const p of points) {
      // The unique index dedups on the exact stored `at`, so a fractional
      // timestamp would let two "same instant" readings both land and
      // double-count the kilometres they carry.
      if (!Number.isSafeInteger(p.at)) throw badRequest(`point at ${p.at} is not an epoch-millis integer`);
      if (p.at < this.policy.startAt || p.at > this.policy.endAt) {
        throw badRequest(
          `point at ${p.at} falls outside the cover term (${this.policy.startAt}..${this.policy.endAt})`
        );
      }
      if (!Number.isFinite(p.value)) throw badRequest(`point value ${p.value} is not finite`);
      if (p.value < 0) throw badRequest(`point value ${p.value} is negative`);
      if (!byAt.has(p.at)) byAt.set(p.at, p);
    }
    const batch = [...byAt.values()].sort((a, b) => a.at - b.at);

    // The transaction's key stops a replay of the *same* batch; the unique index
    // stops a partially overlapping one. Both are load-bearing: a batch that
    // double-counts kilometres reprices the contract wrong and bills for it.
    const batchHash = await hashObject(batch);
    const txn = await runTxn(ctx, {
      type: "TELEM-INGEST",
      idempotencyKey: `axis.telemetry:${subjectRef}:${this.source}:${batchHash}`,
      currency: this.policy.currency,
      subjectRefs: { policy: this.policy.id },
      metadata: { source: this.source, submittedCount: batch.length }
    });

    // What is already stored inside this batch's span, read over
    // `axis_telem_subject_idx` rather than as one `in (…)` of up to 1000 `at`
    // values (D1 would refuse that). `onConflictDoNothing` below is still the
    // guard that makes a concurrent writer harmless — this read only makes the
    // accepted count exact.
    const known = new Set(
      (
        await ctx.db
          .select({ at: schema.axisTelemetryPoints.at })
          .from(schema.axisTelemetryPoints)
          .where(
            scoped(
              ctx,
              schema.axisTelemetryPoints,
              eq(schema.axisTelemetryPoints.subjectRef, subjectRef),
              eq(schema.axisTelemetryPoints.source, this.source),
              gte(schema.axisTelemetryPoints.at, batch[0]!.at),
              lte(schema.axisTelemetryPoints.at, batch[batch.length - 1]!.at)
            )
          )
      ).map((r) => r.at)
    );

    const fresh = batch.filter((p) => !known.has(p.at));
    for (let i = 0; i < fresh.length; i += ROWS_PER_INSERT) {
      await ctx.db
        .insert(schema.axisTelemetryPoints)
        .values(
          fresh.slice(i, i + ROWS_PER_INSERT).map((p) => ({
            id: newId("telp", ctx.now),
            tenantId: ctx.tenantId,
            subjectRef,
            source: this.source,
            at: p.at,
            value: p.value,
            txnId: txn.id,
            createdAt: ctx.now
          }))
        )
        .onConflictDoNothing();
    }

    // The accepted count, not the submitted one: they differ on an overlapping
    // batch and the difference is what tells an operator a device is resending.
    await emit(ctx, {
      module: "axis",
      type: "axis.telemetry.ingested",
      subject: subjectRef,
      data: {
        policyId: this.policy.id,
        subjectRef,
        source: this.source,
        txnId: txn.id,
        submittedCount: points.length,
        acceptedCount: fresh.length
      }
    });
  }
}

export interface TelemetryAggregate {
  readonly source: string;
  readonly total: number;
  readonly count: number;
  readonly min: number;
  readonly max: number;
  /** The span actually covered by stored points, not the window asked for. */
  readonly fromAt: number;
  readonly toAt: number;
}

/**
 * Per-source aggregates for one subject over `[from, to]` inclusive — what a
 * reprice reads to turn raw points into a rating input. Keyed by source, in the
 * shape of premium-financing's `paymentsBySeq`.
 *
 * ponytail: reduces in memory over one indexed scan rather than a SQL GROUP BY.
 * A window is bounded by a cover term and a batch by MAX_POINTS_PER_BATCH, so
 * this is thousands of rows, not millions. Push it into SQL if a term ever
 * carries a scan worth paging.
 */
export async function telemetryBySource(
  ctx: Ctx,
  subjectRef: string,
  window: { from: number; to: number }
): Promise<Map<string, TelemetryAggregate>> {
  const rows = await ctx.db
    .select()
    .from(schema.axisTelemetryPoints)
    .where(
      scoped(
        ctx,
        schema.axisTelemetryPoints,
        eq(schema.axisTelemetryPoints.subjectRef, subjectRef),
        gte(schema.axisTelemetryPoints.at, window.from),
        lte(schema.axisTelemetryPoints.at, window.to)
      )
    );

  const out = new Map<string, TelemetryAggregate>();
  for (const r of rows) {
    const prev = out.get(r.source);
    out.set(
      r.source,
      prev
        ? {
            source: r.source,
            total: prev.total + r.value,
            count: prev.count + 1,
            min: Math.min(prev.min, r.value),
            max: Math.max(prev.max, r.value),
            fromAt: Math.min(prev.fromAt, r.at),
            toAt: Math.max(prev.toAt, r.at)
          }
        : { source: r.source, total: r.value, count: 1, min: r.value, max: r.value, fromAt: r.at, toAt: r.at }
    );
  }
  return out;
}

/* ------------------------------------------------------- usage-based reprice */
// docs/27 F5. A telemetry-driven price change **is an endorsement**: same
// pricing call, same referral guard, same approval gate, same recipe, same
// event. Only the provenance differs, and that is what the UBI-REPRICE
// transaction type records. Nothing here is a second pricing engine.

/** Where the model's proposal is filed on the version it produced. */
export interface UbiStamp {
  /** ai_audit_log row — "which model call, on which telemetry, moved this price". */
  aiAuditId: string;
  premiumDeltaPpm: number;
  windowStart: number;
  windowEnd: number;
  factors: { code: string; weight: number; evidenceRef: string }[];
  droppedFactorCount: number;
  confidence: number;
}

/**
 * Prices the exposure stored since the contract's current version took effect
 * and, if it moved, endorses the contract by that much.
 *
 * Refuses on no telemetry rather than repricing on nothing: a price change with
 * no evidence behind it is the failure mode that ends up in front of a
 * regulator. Returns `{ repriced: false }` on a zero adjustment — a no-op must
 * not leave a transaction row, an approval to action, or an audit entry
 * claiming a change happened.
 */
export async function repriceFromTelemetry(ctx: Ctx, policy: PolicyRow, gateway: Gateway) {
  const current = await effectiveVersion(ctx, policy.id);
  if (!current) throw conflict("policy has no effective version to reprice");

  // Exposure since the version being replaced, not since inception: the last
  // reprice already priced everything before it, and counting it twice would
  // charge for the same kilometres on every run.
  const windowStart = current.effectiveFrom;
  const windowEnd = ctx.now;
  const subjectRef = `policy:${policy.id}`;
  const aggregates = await telemetryBySource(ctx, subjectRef, { from: windowStart, to: windowEnd });
  if (aggregates.size === 0) {
    throw conflict("no telemetry stored for this cover in the window; there is nothing to price");
  }

  const context: UbiContext = {
    series: [...aggregates.values()].map((a) => ({
      source: a.source,
      total: a.total,
      pointCount: a.count,
      // ponytail: no per-series book baseline exists to read — `products` carries
      // declared pricing inputs, not expected totals per series key. `null` is a
      // supported value and the prompt handles it. Add a product-level baselines
      // map when a book actually carries one.
      baseline: null
    })),
    windowStart,
    windowEnd
  };

  // CLAUDE.md §3: the model is reached only through the gateway, so the call is
  // scrubbed, budgeted, guardrailed and written to ai_audit_log.
  const reply = await gateway.complete(ctx, {
    module: "axis",
    purpose: "axis.policy.ubi_reprice",
    tier: "fast",
    messages: ubiMessages(context)
  });
  const proposal = parseUbi(reply.text);
  if (proposal.premiumDeltaPpm === 0) return { repriced: false as const };

  // Integer minor units throughout — no float ever holds money. Floored at 0: a
  // large enough negative adjustment must not invert the premium.
  const premiumMinor = Math.max(
    0,
    current.premiumMinor + Math.round((current.premiumMinor * proposal.premiumDeltaPpm) / 1_000_000)
  );

  // The change set is keyed by factor code deliberately: `priceEndorsement`
  // refuses codes absent from the product's `pricingInputsJson`, which is the
  // guard that stops a model inventing a rating factor and having it silently
  // priced. The codes go in exactly as the model named them.
  const changes = Object.fromEntries(
    proposal.factors.map((f) => [f.code, { weight: f.weight, evidenceRef: f.evidenceRef }])
  );

  const out = await endorsePolicy(ctx, policy, { changes, reason: "ubi_reprice", premiumMinor }, { type: "UBI-REPRICE" });

  // Stamped after the endorsement rather than passed through `changes`, because
  // anything in `changes` is a rating factor and would be referred as an
  // undeclared one. When a customer disputes a premium, this is the first thing
  // asked for (docs/27 F5).
  const ubi: UbiStamp = {
    aiAuditId: reply.auditId,
    premiumDeltaPpm: proposal.premiumDeltaPpm,
    windowStart,
    windowEnd,
    factors: proposal.factors,
    droppedFactorCount: proposal.droppedFactorCount,
    confidence: proposal.confidence
  };
  const termsJson = JSON.stringify({
    ...(JSON.parse(out.version.termsJson ?? "{}") as Record<string, unknown>),
    ubi
  });
  await ctx.db
    .update(schema.axisPolicyVersions)
    .set({ termsJson, updatedAt: ctx.now })
    .where(scoped(ctx, schema.axisPolicyVersions, eq(schema.axisPolicyVersions.id, out.version.id)));

  return {
    repriced: true as const,
    policy: out.policy,
    version: { ...out.version, termsJson },
    txn: out.txn,
    premiumMinor,
    premiumDeltaPpm: proposal.premiumDeltaPpm,
    aiAuditId: reply.auditId
  };
}
