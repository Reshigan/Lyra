import { count, desc, eq, gte, lt, lte, max } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { badRequest, conflict, emit, hashObject, scoped, type Ctx, type TimeseriesIngest } from "@lyra/core";
import { runTxn } from "@lyra/ledger";
import { parseUbi, promptInstant, ubiMessages, type Gateway, type UbiContext } from "@lyra/model-gateway";
import {
  declaredPricingInputs,
  effectiveVersion,
  endorsementBlocker,
  endorsePolicy,
  ingestBlocker
} from "./axis-endorse.js";

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

/**
 * The end of the last window a reprice actually priced, or 0 if none has.
 *
 * `termsJson.ubi` is stamped by the reprice that produced the version and is in
 * `VERSION_SCOPED_TERMS`, so it is never carried forward: only versions a
 * reprice wrote carry one, and the highest `versionSeq` carrying one is the
 * most recent window. One query, versions-of-one-policy sized.
 */
async function lastPricedWindowEnd(ctx: Ctx, policyId: string): Promise<number> {
  const rows = await ctx.db
    .select({ termsJson: schema.axisPolicyVersions.termsJson })
    .from(schema.axisPolicyVersions)
    .where(scoped(ctx, schema.axisPolicyVersions, eq(schema.axisPolicyVersions.policyId, policyId)))
    .orderBy(desc(schema.axisPolicyVersions.versionSeq));
  for (const row of rows) {
    const { ubi } = JSON.parse(row.termsJson ?? "{}") as { ubi?: UbiStamp };
    if (typeof ubi?.windowEnd === "number") return ubi.windowEnd;
  }
  return 0;
}

/**
 * The start of exposure no reprice has priced yet.
 *
 * A version boundary is where the price changed, not where pricing got up to,
 * so no version is a watermark: reading one put the start in the future under a
 * pending forward-dated endorsement and stranded accepted telemetry. Only two
 * bounds matter — exposure cannot precede inception, and the last window a
 * reprice actually priced is the only thing already billed.
 */
async function unpricedFrom(ctx: Ctx, policy: PolicyRow): Promise<number> {
  return Math.max(policy.startAt, await lastPricedWindowEnd(ctx, policy.id));
}

/**
 * The exposure a reprice run right now would price: half-open, `[from, to)`.
 *
 * One definition, because the reprice route's idempotency key and the pricer
 * itself both need it and deriving it twice is how this rule has failed before.
 * A key covering a wider window than the pricer bills a model call for exposure
 * the run then ignores; a narrower one replays a stale answer over exposure the
 * run would have priced.
 *
 * `unpricedFrom` alone is the start, and the ingest doorway wants only that —
 * it asks whether a point is already billed, not whether it is priceable yet.
 */
async function unpricedWindow(ctx: Ctx, policy: PolicyRow): Promise<{ from: number; to: number }> {
  return { from: await unpricedFrom(ctx, policy), to: ctx.now };
}

/**
 * A fingerprint of the stored telemetry no reprice has priced yet: the newest
 * instant in it and how many points it holds.
 *
 * The reprice route builds its fallback idempotency key from this. That key
 * must change when the telemetry to be priced changes: a run that comes back
 * `repriced:false` has still billed a model call and written an audit row, so
 * its key is kept rather than released — and keeping a key derived from the
 * *version* would replay "nothing happened" for 24h over telemetry that landed
 * afterwards. Keyed on what will be priced, new telemetry mints a new key and
 * no new telemetry replays.
 *
 * ponytail: the points, not the window's end, though the end reaches the model
 * as `windowEnd`. So an idle device's same kilometres spread over a longer
 * window — which a model may read as a discount — replays the stored no-op for
 * up to the key's TTL. Deliberate: `to` is `ctx.now`, so putting it in the key
 * would mint a fresh key every millisecond and there would be no collapse left
 * to speak of. Quantise `to` into the key (to the hour, say) if that delay ever
 * costs more than the retry storms it is buying protection from.
 *
 * The count is why this is not just the max: a device that buffers and uploads
 * out of order backfills points *older* than the newest one already stored, and
 * a max-only key would not move for them — leaving that exposure replaying a
 * no-op until the key expired. Both scalars come out of one aggregate over the
 * `axis_telem_point_uq` (tenant, subjectRef, …) prefix, cheaper than the window
 * scan the reprice itself runs.
 *
 * It fingerprints `unpricedWindow`, not everything from the watermark onwards,
 * and that is load-bearing rather than tidiness. Ingest bounds a point by the
 * cover's term and the watermark, never by the clock, so a device running fast
 * stores future-dated points. Fingerprinting past `to` would mint a new key for
 * a point the reprice cannot yet price — a second billed model call for the
 * same question — and then fail to mint one when the clock caught up and that
 * same point became a real price move, replaying the stored no-op instead.
 */
export async function unpricedExposureKey(ctx: Ctx, policy: PolicyRow): Promise<string> {
  const { from, to } = await unpricedWindow(ctx, policy);
  const [row] = await ctx.db
    .select({ newest: max(schema.axisTelemetryPoints.at), points: count() })
    .from(schema.axisTelemetryPoints)
    .where(
      scoped(
        ctx,
        schema.axisTelemetryPoints,
        eq(schema.axisTelemetryPoints.subjectRef, `policy:${policy.id}`),
        gte(schema.axisTelemetryPoints.at, from),
        lt(schema.axisTelemetryPoints.at, to)
      )
    );
  return `${row?.newest ?? 0}x${row?.points ?? 0}`;
}

/** The seam hands us a subjectRef; it must be the one cover this adapter holds. */
const namesPolicy = (subjectRef: string, policy: PolicyRow): boolean => subjectRef === `policy:${policy.id}`;

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

  async ingest(ref: string, points: ReadonlyArray<Point>): Promise<void> {
    const ctx = this.ctx;

    // Everything that can refuse the batch happens before `runTxn`, so a
    // refusal leaves no transaction row and the corrected batch is not stuck
    // behind a burnt idempotency key (docs/19 §3, same ordering as runTxn's own
    // preconditions).
    if (!namesPolicy(ref, this.policy)) {
      throw badRequest(`subjectRef ${ref} is not policy ${this.policy.id}`);
    }

    // Accepted implies priceable (ADR-0065 decision 5). Cancellation leaves
    // `endAt` and the effective version untouched, so nothing else here notices
    // it, and every point accepted after it is exposure no reprice can ever
    // bill. Deliberately `ingestBlocker` and not the pricer's
    // `endorsementBlocker`: this refusal discards the batch, so it may only
    // refuse what is unpriceable forever, where the pricer refuses what is
    // unpriceable now — the two differ on `lapsed`, which reinstatement cures
    // and the next window prices. Both predicates live in one file and share
    // their term bound, so they cannot drift. A 400 rather than the pricer's
    // 409: this is a device-facing doorway, and every other refusal on it is a
    // 400.
    const blocker = ingestBlocker(this.policy, ctx.now);
    if (blocker) throw badRequest(blocker);

    const subjectRef = ref;
    if (points.length === 0) throw badRequest("no points to ingest");
    if (points.length > MAX_POINTS_PER_BATCH) {
      throw badRequest(`too many points: ${points.length} exceeds MAX_POINTS_PER_BATCH (${MAX_POINTS_PER_BATCH})`);
    }

    // The priced watermark. A reprice reads `[unpricedFrom, now)` and each
    // reprice advances that start, so a point stamped before it is
    // exposure no window will ever price. A device that buffers offline and
    // flushes stale points must hear that, not get `acceptedCount: 400` for
    // readings nothing will bill.
    const priced = await unpricedFrom(ctx, this.policy);

    // Dedup inside the batch as well as against the table: two rows for the
    // same instant would collide on `axis_telem_point_uq` and make
    // `acceptedCount` a lie about what landed. First occurrence wins.
    const byAt = new Map<number, Point>();
    for (const p of points) {
      // The unique index dedups on the exact stored `at`, so a fractional
      // timestamp would let two "same instant" readings both land and
      // double-count the kilometres they carry.
      if (!Number.isSafeInteger(p.at)) throw badRequest(`point at ${p.at} is not an epoch-millis integer`);
      // Half-open, like every window that reads these points: a reprice prices
      // `[unpricedFrom, now)` and is refused at `now >= endAt`, so a point at
      // exactly `endAt` is in no window there will ever be.
      //
      // The bound is the term bound and nothing finer. Strictly, the largest
      // `now` a reprice can run at is `endAt - 1` and the window excludes its
      // own end, so the last stamp any window reaches is `endAt - 2` — the final
      // millisecond is admitted here and never priced. That is deliberate: one
      // millisecond of exposure pro-rates to zero, and `- 1` arithmetic on a
      // term bound is a worse defect than the degenerate case it would close.
      if (p.at < this.policy.startAt || p.at >= this.policy.endAt) {
        throw badRequest(
          `point at ${p.at} falls outside the cover term [${this.policy.startAt}, ${this.policy.endAt})`
        );
      }
      if (p.at < priced) {
        throw badRequest(`point at ${p.at} predates the priced watermark ${priced}; no reprice window will price it`);
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
      // `submittedCount` means the same thing here and on the event below: what
      // the caller sent. The post-dedup number is `acceptedCount` on the event.
      metadata: { source: this.source, submittedCount: points.length }
    });

    // What is already stored inside this batch's span, read over
    // `axis_telem_point_uq` rather than as one `in (…)` of up to 1000 `at`
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
 * Per-source aggregates for one subject over `[from, to)` — what a reprice reads
 * to turn raw points into a rating input. Half-open because consecutive reprice
 * windows share an endpoint (`to` becomes the next `from`), and an inclusive one
 * would count a point at exactly that instant in both. Keyed by source, in the
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
        lt(schema.axisTelemetryPoints.at, window.to)
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
 * Prices the exposure stored since the last window a reprice priced and, if
 * that moved the premium, endorses the contract by that much.
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

  // What `priceEndorsement` would refuse, asked here rather than discovered
  // there: there it is raised after `gateway.complete` — a billed, audited model
  // call for a price that was never going to move. Read from the shared
  // predicate, never hand-copied: a doorway that refuses less than the pricer
  // burns a model call, and one that refuses more silently stops repricing live
  // covers.
  const blocker = endorsementBlocker(policy, ctx.now);
  if (blocker) throw conflict(blocker);

  // The whole safety of a model-proposed factor is `priceEndorsement`'s referral
  // guard, and that guard is inert when the product declares no pricing inputs
  // (there is no allowlist to check against). A human endorsement may proceed
  // unconstrained; a model-proposed one may not, or an invented factor code is
  // priced with nothing having checked it.
  if ((await declaredPricingInputs(ctx, policy)) === null) {
    throw conflict("policy's product declares no pricing inputs; a model-proposed factor cannot be validated");
  }

  // Exposure since the last priced window, not since inception: the last reprice
  // already priced everything before it, and counting it twice would charge for
  // the same kilometres on every run. Same watermark the ingest refuses against,
  // so a point that was accepted is a point some window will price.
  const window = await unpricedWindow(ctx, policy);
  const windowStart = window.from;
  const windowEnd = window.to;
  const subjectRef = `policy:${policy.id}`;
  const aggregates = await telemetryBySource(ctx, subjectRef, window);
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
    windowStart: promptInstant(windowStart),
    windowEnd: promptInstant(windowEnd)
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

  // Integer minor units throughout — no float ever holds money.
  const premiumMinor = current.premiumMinor + Math.round((current.premiumMinor * proposal.premiumDeltaPpm) / 1_000_000);

  // Refused, not floored at 0. `quoteEndorsement` divides the new premium by the
  // current one, so a contract sitting at 0 has `taxDeltaMinor` and
  // `commissionDeltaMinor` frozen at 0 forever after — it could then be repriced
  // back up with no tax and no commission accruing. A price of nothing is not a
  // price this engine is allowed to write (docs/19, ADR-0065 decision 3).
  if (premiumMinor <= 0) {
    throw conflict(
      `reprice would take the premium to ${premiumMinor} minor units; a zero or negative premium is not a price`
    );
  }

  // The change set is keyed by factor code deliberately: `priceEndorsement`
  // refuses codes absent from the product's `pricingInputsJson`, which is the
  // guard that stops a model inventing a rating factor and having it silently
  // priced. The codes go in exactly as the model named them.
  //
  // Keyed means collapsing: two factors sharing a code would leave `changes`
  // with one entry and the stamp below with two different weights, so the priced
  // change set and its own provenance would disagree. Refuse rather than pick.
  const codes = proposal.factors.map((f) => f.code);
  if (new Set(codes).size !== codes.length) {
    throw conflict(`proposal repeats a factor code (${codes.join(", ")}); the change set and its stamp would disagree`);
  }
  const changes = Object.fromEntries(
    proposal.factors.map((f) => [f.code, { weight: f.weight, evidenceRef: f.evidenceRef }])
  );

  // Passed as a terms stamp rather than through `changes`, because anything in
  // `changes` is a rating factor and would be referred as an undeclared one —
  // and written in the version's own insert rather than after it, because a
  // second write can fail and leave a moved premium with no provenance at all.
  // When a customer disputes a premium, this is the first thing asked for
  // (docs/27 F5).
  const ubi: UbiStamp = {
    aiAuditId: reply.auditId,
    premiumDeltaPpm: proposal.premiumDeltaPpm,
    windowStart,
    windowEnd,
    factors: proposal.factors,
    droppedFactorCount: proposal.droppedFactorCount,
    confidence: proposal.confidence
  };

  const out = await endorsePolicy(
    ctx,
    policy,
    { changes, reason: "ubi_reprice", premiumMinor },
    {
      type: "UBI-REPRICE",
      termsStamp: { ubi },
      // What the approver is shown (CLAUDE.md #11): without it the pending row is
      // a policy id and a hash, and the human cannot tell a model's proposal from
      // an underwriter's own change, let alone inspect why.
      approvalContext: { ubi, source: "telematics" }
    }
  );

  return {
    repriced: true as const,
    policy: out.policy,
    version: out.version,
    txn: out.txn,
    premiumMinor,
    premiumDeltaPpm: proposal.premiumDeltaPpm,
    aiAuditId: reply.auditId
  };
}
