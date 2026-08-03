import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq, and } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PolicyJson, EntitlementsJson, schema } from "@lyra/db";
import { permissionsForRole, type Actor, type Ctx } from "@lyra/core";
import { runSnapshotter } from "./north-snapshotter.js";

// ADR-0024 + docs/modules/north.md §2.2/§3: north_snapshots had no real
// writer, only seed.ts fixtures. This covers the Snapshotter actually
// computing values from live rows, upserting idempotently, and the Anomaly
// Hunter flagging a big swing between two runs.

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

let client: Client;
let ctx: Ctx;

function actor(): Actor {
  return {
    kind: "system",
    id: "scheduler",
    tenantId: "t_1",
    grants: [{ roleKey: "tenant.admin", permissions: permissionsForRole("tenant.admin") }]
  };
}

async function makeCtx(now: number): Promise<Ctx> {
  return {
    db: drizzle(client) as unknown as Ctx["db"],
    tenantId: "t_1",
    actor: actor(),
    requestId: "req_1",
    now,
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  };
}

// Yesterday (UTC) at noon, so the "day" period the snapshotter computes lands
// squarely inside yesterday's UTC day regardless of when this test runs.
const NOW = Math.floor(Date.now() / DAY) * DAY + 12 * 3_600_000;
const YESTERDAY_MID = NOW - DAY;

async function seedMetric(key: string, grain: "day" | "month"): Promise<void> {
  await ctx.db.insert(schema.northMetrics).values({
    id: `mtr_${key}`,
    tenantId: ctx.tenantId,
    key,
    nameJson: JSON.stringify({ en: key, ar: key }),
    definitionSqlRef: key,
    unit: "count",
    grain,
    owner: "test",
    targetJson: JSON.stringify({}),
    createdAt: ctx.now,
    updatedAt: ctx.now
  });
}

async function seedProviderAndCustomer(): Promise<void> {
  await ctx.db.insert(schema.providers).values({
    id: "prov_1",
    tenantId: ctx.tenantId,
    name: "Test Insurer",
    createdAt: ctx.now,
    updatedAt: ctx.now
  });
  await ctx.db.insert(schema.customers).values({
    id: "cu_1",
    tenantId: ctx.tenantId,
    nameJson: JSON.stringify({ first: "Amina" }),
    createdAt: ctx.now,
    updatedAt: ctx.now
  });
}

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  ctx = await makeCtx(NOW);
});

describe("runSnapshotter: policies_issued", () => {
  it("counts only policies created inside yesterday's UTC day", async () => {
    await seedMetric("policies_issued", "day");
    await seedProviderAndCustomer();
    await ctx.db.insert(schema.axisPolicies).values([
      {
        id: "pol_yesterday",
        tenantId: ctx.tenantId,
        customerId: "cu_1",
        providerId: "prov_1",
        policyNo: "P-1",
        startAt: YESTERDAY_MID,
        endAt: YESTERDAY_MID + 365 * DAY,
        premiumMinor: 10_000,
        currency: "AED",
        status: "active",
        createdAt: YESTERDAY_MID,
        updatedAt: YESTERDAY_MID
      },
      {
        id: "pol_today",
        tenantId: ctx.tenantId,
        customerId: "cu_1",
        providerId: "prov_1",
        policyNo: "P-2",
        startAt: NOW,
        endAt: NOW + 365 * DAY,
        premiumMinor: 10_000,
        currency: "AED",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW
      }
    ]);

    const result = await runSnapshotter(ctx);
    expect(result.written).toBe(1);

    const [row] = await ctx.db
      .select()
      .from(schema.northSnapshots)
      .where(and(eq(schema.northSnapshots.tenantId, ctx.tenantId), eq(schema.northSnapshots.metricKey, "policies_issued")));
    expect(row!.value).toBe(1);
  });
});

describe("runSnapshotter idempotency", () => {
  it("upserts instead of duplicating on a second run", async () => {
    await seedMetric("policies_issued", "day");
    await seedProviderAndCustomer();
    await ctx.db.insert(schema.axisPolicies).values({
      id: "pol_1",
      tenantId: ctx.tenantId,
      customerId: "cu_1",
      providerId: "prov_1",
      policyNo: "P-1",
      startAt: YESTERDAY_MID,
      endAt: YESTERDAY_MID + 365 * DAY,
      premiumMinor: 10_000,
      currency: "AED",
      status: "active",
      createdAt: YESTERDAY_MID,
      updatedAt: YESTERDAY_MID
    });

    await runSnapshotter(ctx);
    await runSnapshotter(ctx);

    const rows = await ctx.db
      .select()
      .from(schema.northSnapshots)
      .where(and(eq(schema.northSnapshots.tenantId, ctx.tenantId), eq(schema.northSnapshots.metricKey, "policies_issued")));
    expect(rows.length).toBe(1);
    expect(rows[0]!.value).toBe(1);
  });
});

describe("runSnapshotter: unregistered metric", () => {
  it("skips a metric key with no compute function instead of guessing", async () => {
    await seedMetric("loss_ratio", "month");

    const result = await runSnapshotter(ctx);
    expect(result.written).toBe(0);

    const rows = await ctx.db.select().from(schema.northSnapshots);
    expect(rows.length).toBe(0);
  });
});

describe("runSnapshotter: anomaly detection", () => {
  it("flags a new anomaly when a metric swings hard between two runs", async () => {
    await seedMetric("gwp", "month");
    await seedProviderAndCustomer();

    // First run: one policy this month, in the past relative to ctx.now.
    await ctx.db.insert(schema.axisPolicies).values({
      id: "pol_small",
      tenantId: ctx.tenantId,
      customerId: "cu_1",
      providerId: "prov_1",
      policyNo: "P-1",
      startAt: NOW - DAY,
      endAt: NOW + 365 * DAY,
      premiumMinor: 1_000,
      currency: "AED",
      status: "active",
      createdAt: NOW - DAY,
      updatedAt: NOW - DAY
    });
    await runSnapshotter(ctx);

    // Second tick, same month: a huge additional policy blows the total up.
    // createdAt is set just before ctx.now, matching real usage — `until` is
    // an exclusive "now" bound, so a row created exactly at ctx.now would
    // never be included.
    ctx.now = NOW + 3_600_000;
    await ctx.db.insert(schema.axisPolicies).values({
      id: "pol_huge",
      tenantId: ctx.tenantId,
      customerId: "cu_1",
      providerId: "prov_1",
      policyNo: "P-2",
      startAt: ctx.now - 1,
      endAt: ctx.now + 365 * DAY,
      premiumMinor: 10_000_000,
      currency: "AED",
      status: "active",
      createdAt: ctx.now - 1,
      updatedAt: ctx.now - 1
    });
    const result = await runSnapshotter(ctx);
    expect(result.anomalies).toBe(1);

    const [anomaly] = await ctx.db
      .select()
      .from(schema.northAnomalies)
      .where(and(eq(schema.northAnomalies.tenantId, ctx.tenantId), eq(schema.northAnomalies.metricKey, "gwp")));
    expect(anomaly!.state).toBe("new");
    expect(anomaly!.magnitude).toBeGreaterThan(0);
  });
});
