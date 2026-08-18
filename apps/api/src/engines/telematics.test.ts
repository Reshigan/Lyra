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

    const agg = await telemetryBySource(ctx, subjectRef(), { from: base, to: base + 2 * DAY });
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
