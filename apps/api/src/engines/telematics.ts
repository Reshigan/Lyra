import { eq, gte, lte } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { badRequest, emit, hashObject, scoped, type Ctx, type TimeseriesIngest } from "@lyra/core";
import { runTxn } from "@lyra/ledger";

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

  async ingest(subjectRef: string, points: ReadonlyArray<Point>): Promise<void> {
    const ctx = this.ctx;

    // Everything that can refuse the batch happens before `runTxn`, so a
    // refusal leaves no transaction row and the corrected batch is not stuck
    // behind a burnt idempotency key (docs/19 §3, same ordering as runTxn's own
    // preconditions).
    if (!namesPolicy(subjectRef, this.policy)) {
      throw badRequest(`subjectRef ${subjectRef} is not policy ${this.policy.id}`);
    }
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
