import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson, id as newId, schema } from "@lyra/db";
import { permissionsForRole, type Ctx, type TimeseriesIngest } from "@lyra/core";
import {
  MAX_POINTS_PER_BATCH,
  TelematicsIngest,
  telemetryBySource,
  type PolicyRow
} from "./telematics.js";

// docs/27 group E — H6 seam's first real implementation. Same flat local-helper
// harness as partner-bind.test.ts: real migrated libSQL, a tenant ctx, direct
// inserts for the policy the points hang off.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "..", "packages", "db", "migrations");

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

const DAY = 86_400_000;
const SOURCE = "telematics:obd:km";

let client: Client;
let ctx: Ctx;
let policy: PolicyRow;

async function seedPolicy(): Promise<PolicyRow> {
  const policyId = newId("pol", ctx.now);
  await ctx.db.insert(schema.axisPolicies).values({
    id: policyId,
    tenantId: ctx.tenantId,
    customerId: `cust_${policyId}`,
    providerId: "prov_test",
    policyNo: `POL-${policyId}`,
    versionSeq: 1,
    startAt: ctx.now - 30 * DAY,
    endAt: ctx.now + 335 * DAY,
    premiumMinor: 100_000,
    currency: "ZAR",
    status: "active",
    createdAt: ctx.now,
    updatedAt: ctx.now
  } as never);
  const [row] = await ctx.db.select().from(schema.axisPolicies).where(eq(schema.axisPolicies.id, policyId));
  return row!;
}

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  const tenantId = "t_1";
  const now = Date.UTC(2026, 5, 15, 12);
  ctx = {
    db: drizzle(client) as unknown as Ctx["db"],
    tenantId,
    actor: {
      kind: "user",
      id: "u_test",
      tenantId,
      grants: [{ roleKey: "owner", permissions: permissionsForRole("owner") }]
    },
    requestId: "req_1",
    now,
    locale: "en",
    policy: PolicyJson.parse({ currency: "ZAR" }),
    entitlements: EntitlementsJson.parse({})
  };
  policy = await seedPolicy();
});

/**
 * An effective version. `pricedTo` stamps the `ubi.windowEnd` a reprice would
 * have left behind — the only thing that moves the priced watermark; without it
 * the version is a price change that priced nothing.
 */
async function seedVersion(effectiveFrom: number, pricedTo?: number): Promise<void> {
  await ctx.db.insert(schema.axisPolicyVersions).values({
    id: newId("pver", ctx.now),
    tenantId: ctx.tenantId,
    policyId: policy.id,
    versionSeq: 1,
    reason: "issue",
    effectiveFrom,
    effectiveTo: policy.endAt,
    premiumMinor: policy.premiumMinor,
    taxMinor: 0,
    feesMinor: 0,
    commissionMinor: 0,
    currency: policy.currency,
    premiumDeltaMinor: 0,
    proRataDays: 365,
    termsJson: JSON.stringify(pricedTo === undefined ? {} : { ubi: { windowEnd: pricedTo } }),
    state: "effective",
    issuedBy: "user:u_test",
    issuedAt: ctx.now,
    createdAt: ctx.now,
    updatedAt: ctx.now
  } as never);
}

/** The same cover, moved to another status and re-read as the route would read it. */
async function withStatus(status: string): Promise<PolicyRow> {
  await ctx.db.update(schema.axisPolicies).set({ status }).where(eq(schema.axisPolicies.id, policy.id));
  const [row] = await ctx.db.select().from(schema.axisPolicies).where(eq(schema.axisPolicies.id, policy.id));
  return row!;
}

const subjectRef = (): string => `policy:${policy.id}`;

function ingester(source = SOURCE): TelematicsIngest {
  return new TelematicsIngest(ctx, source, policy);
}

async function points() {
  return ctx.db
    .select()
    .from(schema.axisTelemetryPoints)
    .where(and(eq(schema.axisTelemetryPoints.tenantId, ctx.tenantId), eq(schema.axisTelemetryPoints.subjectRef, subjectRef())));
}

async function telemTxns() {
  return ctx.db
    .select()
    .from(schema.ledgerTxns)
    .where(and(eq(schema.ledgerTxns.tenantId, ctx.tenantId), eq(schema.ledgerTxns.type, "TELEM-INGEST")));
}

async function ingestedEvents() {
  return ctx.db
    .select()
    .from(schema.eventOutbox)
    .where(and(eq(schema.eventOutbox.tenantId, ctx.tenantId), eq(schema.eventOutbox.type, "axis.telemetry.ingested")));
}

/**
 * `badRequest()`'s Error.message is the fixed literal "Bad request" (docs/04 §1
 * problem+json); the reason lives on `.detail` — same assertion shape as
 * apps/api/src/premium-financing.test.ts.
 */
async function refusalDetail(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as { detail?: string }).detail ?? String(e);
  }
  throw new Error("expected a refusal, got none");
}

/** Three in-term instants, one day apart. */
const batch = (base: number, n: number, value = 10) =>
  Array.from({ length: n }, (_, i) => ({ at: base + i * DAY, value }));

describe("TelematicsIngest.ingest", () => {
  it("stores every point of the batch under one transaction", async () => {
    await ingester().ingest(subjectRef(), batch(ctx.now - 5 * DAY, 3));

    const [txn] = await telemTxns();
    expect(txn!.state).toBe("settled");

    const rows = await points();
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.txnId))).toEqual(new Set([txn!.id]));
    expect(rows.map((r) => r.source)).toEqual([SOURCE, SOURCE, SOURCE]);

    const [event] = await ingestedEvents();
    expect(JSON.parse(event!.envelopeJson).data).toMatchObject({ acceptedCount: 3, submittedCount: 3 });
  });

  it("replaying the identical batch stores nothing new", async () => {
    const b = batch(ctx.now - 5 * DAY, 3);
    await ingester().ingest(subjectRef(), b);
    await ingester().ingest(subjectRef(), b);

    expect(await points()).toHaveLength(3);
    // Same content hash -> same idempotency key -> the one transaction.
    expect(await telemTxns()).toHaveLength(1);
  });

  it("a partially overlapping batch stores only the points that are new", async () => {
    const base = ctx.now - 5 * DAY;
    await ingester().ingest(subjectRef(), batch(base, 3));
    await ingester().ingest(subjectRef(), batch(base + 2 * DAY, 3));

    const rows = await points();
    expect(rows).toHaveLength(5);
    const events = await ingestedEvents();
    expect(JSON.parse(events[1]!.envelopeJson).data).toMatchObject({ acceptedCount: 2, submittedCount: 3 });
  });

  it("stores a batch wider than one insert chunk", async () => {
    // The insert is chunked for D1's bound-parameter cap, so the loop's
    // boundaries are exercised rather than assumed (25 points > ROWS_PER_INSERT).
    await ingester().ingest(subjectRef(), batch(ctx.now - 25 * DAY, 25, 1));
    expect(await points()).toHaveLength(25);
  });

  it("keeps points of a different source apart", async () => {
    const b = batch(ctx.now - 5 * DAY, 2);
    await ingester().ingest(subjectRef(), b);
    await ingester("telematics:obd:harsh_brake").ingest(subjectRef(), b);

    expect(await points()).toHaveLength(4);
  });

  it("refuses an empty batch and leaves no transaction", async () => {
    expect(await refusalDetail(() => ingester().ingest(subjectRef(), []))).toMatch(/no points/i);
    expect(await telemTxns()).toHaveLength(0);
  });

  it("refuses a batch over MAX_POINTS_PER_BATCH and leaves no transaction", async () => {
    const big = batch(ctx.now - 300 * DAY, MAX_POINTS_PER_BATCH + 1, 1);
    expect(await refusalDetail(() => ingester().ingest(subjectRef(), big))).toMatch(/MAX_POINTS_PER_BATCH/);
    expect(await telemTxns()).toHaveLength(0);
    expect(await points()).toHaveLength(0);
  });

  it("refuses a point outside the cover term and leaves no transaction", async () => {
    const before = [{ at: policy.startAt - 1, value: 5 }];
    expect(await refusalDetail(() => ingester().ingest(subjectRef(), before))).toMatch(/cover term/i);
    const after = [{ at: policy.endAt + 1, value: 5 }];
    expect(await refusalDetail(() => ingester().ingest(subjectRef(), after))).toMatch(/cover term/i);

    expect(await telemTxns()).toHaveLength(0);
    expect(await points()).toHaveLength(0);
  });

  it("refuses a point at exactly endAt: the reprice window is half-open, so nothing would price it", async () => {
    // Every reprice window is `[unpricedFrom, now)` and a reprice is refused at
    // `now >= endAt`, so no window ever contains `endAt`. Accepting a point there
    // is accepting exposure that is structurally unbillable.
    //
    // `endAt - 1` is accepted below because the bound is the term bound,
    // half-open — not because that point is priceable. It is not: the largest
    // `now` a reprice can run at is `endAt - 1` and the window excludes its own
    // end, so the last stamp any window reaches is `endAt - 2`. The final
    // millisecond is a degenerate case carrying no material exposure, and
    // pinning it would mean `- 1` arithmetic on a term bound.
    expect(
      await refusalDetail(() => ingester().ingest(subjectRef(), [{ at: policy.endAt, value: 5 }]))
    ).toMatch(/cover term/i);
    expect(await telemTxns()).toHaveLength(0);
    expect(await points()).toHaveLength(0);

    await ingester().ingest(subjectRef(), [{ at: policy.endAt - 1, value: 5 }]);
    expect((await points()).map((r) => r.at)).toEqual([policy.endAt - 1]);
  });

  it("refuses ingest on a cover that can never go on risk again and stores zero points", async () => {
    // ADR-0065 decision 5: accepted implies priceable. Cancellation leaves
    // `endAt` and the effective version untouched, so without a status check the
    // doorway returns `acceptedCount` for points no reprice will ever price —
    // exposure recorded against a cover nothing can bill.
    //
    // This is deliberately a *different* list from ubi-reprice.test.ts's
    // "refuses a reprice on a cover that is not on risk", which keeps `lapsed`.
    // The pricer asks whether the cover is on risk *now* and its refusal is
    // reversible; this doorway asks whether the cover can ever be on risk again,
    // because its refusal is a 400 that discards the batch for good. `lapsed`
    // and `draft` still have a path to `active`, so they are admitted here and
    // refused there. Only the states with no path back belong in this loop.
    for (const status of ["cancelled", "expired", "renewed", "ntu"]) {
      const off = await withStatus(status);
      expect(
        await refusalDetail(() => new TelematicsIngest(ctx, SOURCE, off).ingest(subjectRef(), batch(ctx.now - DAY, 3)))
      ).toMatch(/can no longer go on risk/i);
      expect(await points()).toHaveLength(0);
      expect(await telemTxns()).toHaveLength(0);
    }

    // Same batch, same instants, on risk: the refusal above was the status and
    // nothing else about the batch.
    await new TelematicsIngest(ctx, SOURCE, await withStatus("active")).ingest(subjectRef(), batch(ctx.now - DAY, 3));
    expect(await points()).toHaveLength(3);
  });

  it("accepts ingest on a lapsed cover, whose reinstatement the next window prices", async () => {
    // `reinstatePolicy` hops a lapsed cover back to `active` over an unchanged
    // term and writes no cover gap, and the watermark does not advance while
    // reprices are refused — so the first window after reinstatement spans the
    // lapse and prices these very points. Refusing them at the door would throw
    // away exposure nothing can recover (the money property is pinned in
    // ubi-reprice.test.ts; here it is that the rows land at all).
    const lapsed = await withStatus("lapsed");
    await new TelematicsIngest(ctx, SOURCE, lapsed).ingest(subjectRef(), batch(ctx.now - DAY, 3));
    expect(await points()).toHaveLength(3);
  });

  it("refuses a negative or non-finite value and leaves no transaction", async () => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await refusalDetail(() => ingester().ingest(subjectRef(), [{ at: ctx.now - DAY, value }]))).toMatch(
        /value/i
      );
    }
    expect(await telemTxns()).toHaveLength(0);
    expect(await points()).toHaveLength(0);
  });

  it("refuses a subjectRef that is not this policy", async () => {
    expect(await refusalDetail(() => ingester().ingest("policy:pol_other", batch(ctx.now - DAY, 1)))).toMatch(
      /subjectRef/i
    );
    expect(await telemTxns()).toHaveLength(0);
  });

  it("posts no journal: TELEM-INGEST settles with zero lines and no batch", async () => {
    await ingester().ingest(subjectRef(), batch(ctx.now - 5 * DAY, 2));

    const [txn] = await telemTxns();
    expect(txn!.ledgerBatchId).toBeNull();
    const lines = await ctx.db
      .select()
      .from(schema.ledgerJournalLines)
      .where(and(eq(schema.ledgerJournalLines.tenantId, ctx.tenantId), eq(schema.ledgerJournalLines.txnId, txn!.id)));
    expect(lines).toHaveLength(0);
  });

  it("counts what the caller submitted the same way on the transaction and the event", async () => {
    // Two fields called `submittedCount` that disagree for any batch containing a
    // repeated instant are two facts, not one.
    const at = ctx.now - 5 * DAY;
    await ingester().ingest(subjectRef(), [
      { at, value: 10 },
      { at, value: 99 },
      { at: at + DAY, value: 5 }
    ]);

    const [txn] = await telemTxns();
    const [event] = await ingestedEvents();
    const meta = JSON.parse(txn!.metadataJson!) as { submittedCount: number };
    const data = JSON.parse(event!.envelopeJson).data as { submittedCount: number; acceptedCount: number };
    expect(meta.submittedCount).toBe(data.submittedCount);
    expect(data).toMatchObject({ submittedCount: 3, acceptedCount: 2 });
  });

  it("refuses points older than the last priced window end instead of accepting exposure nothing will price", async () => {
    // A reprice reads `[unpricedFrom, now)` and stamps the window it priced, so
    // everything below that stamp is already billed. A device flushing a stale
    // offline buffer would otherwise get `acceptedCount` for kilometres no
    // window will ever bill.
    const pricedTo = ctx.now - 3 * DAY;
    await seedVersion(ctx.now - 10 * DAY, pricedTo);

    expect(await refusalDetail(() => ingester().ingest(subjectRef(), [{ at: pricedTo - 1, value: 5 }]))).toMatch(
      /priced watermark/
    );
    expect(await telemTxns()).toHaveLength(0);
    expect(await points()).toHaveLength(0);

    // The watermark itself is in the next window (half-open at the bottom), so a
    // point at exactly that instant is priced once, not refused and not twice.
    await ingester().ingest(subjectRef(), [{ at: pricedTo, value: 5 }]);
    expect(await points()).toHaveLength(1);
  });

  it("accepts points before a version boundary that priced nothing, back to inception", async () => {
    // A version boundary is where the price changed, not where pricing got up
    // to. Reading the watermark off one refused — and, once a forward-dated
    // endorsement's date arrived, permanently stranded — exposure that no
    // reprice had ever priced. With no `ubi` stamp anywhere, the whole term from
    // inception is still unpriced and every point in it is billable.
    await seedVersion(ctx.now - 3 * DAY);

    await ingester().ingest(subjectRef(), [
      { at: policy.startAt, value: 5 },
      { at: ctx.now - 3 * DAY - 1, value: 7 }
    ]);
    expect((await points()).map((r) => r.at).sort()).toEqual([policy.startAt, ctx.now - 3 * DAY - 1]);

    // Inception is still the floor: exposure before the cover began is not
    // covered exposure, and the term bound refuses it first.
    expect(
      await refusalDetail(() => ingester().ingest(subjectRef(), [{ at: policy.startAt - 1, value: 5 }]))
    ).toMatch(/outside the cover term/);
  });

  it("@seam:H6 TelematicsIngest satisfies TimeseriesIngest and its points land", async () => {
    // The seam's real contract test: assigned to the interface, called through
    // it, and nothing about the interface's shape is widened to make it fit.
    const seam: TimeseriesIngest = ingester();
    expect(seam.source).toBe(SOURCE);
    await seam.ingest(subjectRef(), [{ at: ctx.now - DAY, value: 42 }]);

    const rows = await points();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe(42);
  });
});

describe("telemetryBySource", () => {
  it("aggregates per source over the requested window", async () => {
    const base = ctx.now - 10 * DAY;
    await new TelematicsIngest(ctx, "telematics:obd:km", policy).ingest(subjectRef(), [
      { at: base, value: 12 },
      { at: base + DAY, value: 30 },
      { at: base + 2 * DAY, value: 8 }
    ]);
    await new TelematicsIngest(ctx, "telematics:obd:harsh_brake", policy).ingest(subjectRef(), [
      { at: base + DAY, value: 2 }
    ]);

    const agg = await telemetryBySource(ctx, subjectRef(), { from: base, to: base + 3 * DAY });
    expect(agg.get("telematics:obd:km")).toEqual({
      source: "telematics:obd:km",
      total: 50,
      count: 3,
      min: 8,
      max: 30,
      fromAt: base,
      toAt: base + 2 * DAY
    });
    expect(agg.get("telematics:obd:harsh_brake")).toMatchObject({ total: 2, count: 1, fromAt: base + DAY, toAt: base + DAY });
  });

  it("is half-open, so consecutive windows sharing an endpoint cannot count a point twice", async () => {
    const base = ctx.now - 10 * DAY;
    await ingester().ingest(subjectRef(), [
      { at: base, value: 12 },
      { at: base + DAY, value: 30 },
      { at: base + 2 * DAY, value: 8 }
    ]);

    // `to` becomes the next window's `from`; inclusive at both ends, the point at
    // that instant would be priced in both.
    const first = await telemetryBySource(ctx, subjectRef(), { from: base, to: base + 2 * DAY });
    const second = await telemetryBySource(ctx, subjectRef(), { from: base + 2 * DAY, to: base + 3 * DAY });
    expect(first.get(SOURCE)).toMatchObject({ count: 2, total: 42 });
    expect(second.get(SOURCE)).toMatchObject({ count: 1, total: 8 });
  });

  it("excludes points outside the window and returns an empty map when nothing matches", async () => {
    const base = ctx.now - 10 * DAY;
    await ingester().ingest(subjectRef(), [
      { at: base, value: 1 },
      { at: base + 5 * DAY, value: 100 }
    ]);

    const agg = await telemetryBySource(ctx, subjectRef(), { from: base, to: base + DAY });
    expect(agg.get(SOURCE)).toMatchObject({ total: 1, count: 1, toAt: base });
    expect(await telemetryBySource(ctx, "policy:nobody", { from: 0, to: ctx.now })).toEqual(new Map());
  });
});
