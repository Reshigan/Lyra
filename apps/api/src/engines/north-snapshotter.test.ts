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
// Mirrors north-snapshotter.ts's own monthStart derivation, so month-grain
// fixtures land inside the exact [monthStart, NOW) window it computes.
const MONTH_START = new Date(new Date(NOW).toISOString().slice(0, 7) + "-01T00:00:00.000Z").getTime();

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
    await seedMetric("claims_leakage", "month");

    const result = await runSnapshotter(ctx);
    expect(result.written).toBe(0);

    const rows = await ctx.db.select().from(schema.northSnapshots);
    expect(rows.length).toBe(0);
  });
});

describe("runSnapshotter: alert rules", () => {
  it("emits an event when a fresh snapshot breaches an enabled rule's threshold", async () => {
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
    await ctx.db.insert(schema.northAlertRules).values({
      id: "nar_1",
      tenantId: ctx.tenantId,
      metricKey: "policies_issued",
      operator: "gte",
      thresholdValue: 1,
      windowGrain: "day",
      notifyChannelRef: null,
      enabled: true,
      createdAt: ctx.now,
      updatedAt: ctx.now
    });

    const result = await runSnapshotter(ctx);
    expect(result.alertsTriggered).toBe(1);

    const events = await ctx.db.select().from(schema.eventOutbox).where(eq(schema.eventOutbox.tenantId, ctx.tenantId));
    const fired = events.filter((e) => e.type === "north.alert.triggered");
    expect(fired.length).toBe(1);
    const data = JSON.parse(fired[0]!.envelopeJson).data;
    expect(data).toMatchObject({ ruleId: "nar_1", metricKey: "policies_issued", value: 1, thresholdValue: 1, operator: "gte" });
  });

  it("does not fire a disabled rule", async () => {
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
    await ctx.db.insert(schema.northAlertRules).values({
      id: "nar_1",
      tenantId: ctx.tenantId,
      metricKey: "policies_issued",
      operator: "gte",
      thresholdValue: 1,
      windowGrain: "day",
      notifyChannelRef: null,
      enabled: false,
      createdAt: ctx.now,
      updatedAt: ctx.now
    });

    const result = await runSnapshotter(ctx);
    expect(result.alertsTriggered).toBe(0);
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

describe("runSnapshotter: loss_ratio", () => {
  it("loss ratio is null at day grain and a basis-point integer at month grain", async () => {
    await seedProviderAndCustomer();
    await ctx.db.insert(schema.axisPolicies).values({
      id: "pol_1",
      tenantId: ctx.tenantId,
      customerId: "cu_1",
      providerId: "prov_1",
      policyNo: "P-1",
      startAt: MONTH_START,
      endAt: NOW + 365 * DAY,
      premiumMinor: 100_000,
      currency: "AED",
      status: "active",
      createdAt: MONTH_START,
      updatedAt: MONTH_START
    });
    await ctx.db.insert(schema.axisPolicyVersions).values({
      id: "polv_1",
      tenantId: ctx.tenantId,
      policyId: "pol_1",
      versionSeq: 1,
      reason: "issue",
      effectiveFrom: MONTH_START,
      effectiveTo: NOW,
      premiumMinor: 100_000,
      currency: "AED",
      termsJson: "{}",
      issuedBy: "user:test",
      issuedAt: MONTH_START,
      createdAt: MONTH_START,
      updatedAt: MONTH_START
    });
    await ctx.db.insert(schema.axisClaims).values({
      id: "clm_1",
      tenantId: ctx.tenantId,
      policyId: "pol_1",
      customerId: "cu_1",
      claimNo: "C-1",
      incidentAt: MONTH_START + DAY,
      reportedAt: MONTH_START + DAY,
      currency: "AED",
      paidMinor: 20_000,
      reserveMinor: 5_000,
      createdAt: MONTH_START + DAY,
      updatedAt: MONTH_START + DAY
    });

    // Day grain: the metric's own compute function returns null for
    // anything but month grain, so nothing is written.
    await seedMetric("loss_ratio", "day");
    const dayResult = await runSnapshotter(ctx);
    expect(dayResult.written).toBe(0);

    // Month grain: (paid + reserve - recovered) / earned premium, in bp.
    await ctx.db.update(schema.northMetrics).set({ grain: "month" }).where(eq(schema.northMetrics.key, "loss_ratio"));
    const monthResult = await runSnapshotter(ctx);
    expect(monthResult.written).toBe(1);

    const [row] = await ctx.db
      .select()
      .from(schema.northSnapshots)
      .where(and(eq(schema.northSnapshots.tenantId, ctx.tenantId), eq(schema.northSnapshots.metricKey, "loss_ratio")));
    expect(row!.grain).toBe("month");
    expect(row!.value).toBe(2_500);
  });
});

describe("runSnapshotter: renewal_retention", () => {
  it("retention counts a renewed term once", async () => {
    await seedMetric("renewal_retention", "month");
    await seedProviderAndCustomer();
    await ctx.db.insert(schema.axisPolicies).values([
      {
        id: "pol_prior_renewed",
        tenantId: ctx.tenantId,
        customerId: "cu_1",
        providerId: "prov_1",
        policyNo: "P-PRIOR-1",
        startAt: MONTH_START - 365 * DAY,
        endAt: NOW - DAY,
        premiumMinor: 10_000,
        currency: "AED",
        status: "expired",
        createdAt: MONTH_START - 365 * DAY,
        updatedAt: MONTH_START - 365 * DAY
      },
      {
        id: "pol_prior_lapsed",
        tenantId: ctx.tenantId,
        customerId: "cu_1",
        providerId: "prov_1",
        policyNo: "P-PRIOR-2",
        startAt: MONTH_START - 365 * DAY,
        endAt: NOW - DAY,
        premiumMinor: 10_000,
        currency: "AED",
        status: "lapsed",
        createdAt: MONTH_START - 365 * DAY,
        updatedAt: MONTH_START - 365 * DAY
      },
      {
        id: "pol_renewal",
        tenantId: ctx.tenantId,
        customerId: "cu_1",
        providerId: "prov_1",
        policyNo: "P-RENEWED-1",
        startAt: NOW - DAY,
        endAt: NOW + 365 * DAY,
        premiumMinor: 10_000,
        currency: "AED",
        status: "active",
        renewedFromPolicyId: "pol_prior_renewed",
        createdAt: NOW - DAY,
        updatedAt: NOW - DAY
      }
    ]);

    const result = await runSnapshotter(ctx);
    expect(result.written).toBe(1);

    const [row] = await ctx.db
      .select()
      .from(schema.northSnapshots)
      .where(and(eq(schema.northSnapshots.tenantId, ctx.tenantId), eq(schema.northSnapshots.metricKey, "renewal_retention")));
    // 1 renewed / 2 expiring prior terms = 5000 bp.
    expect(row!.value).toBe(5_000);
  });
});

describe("runSnapshotter: reserve_adequacy", () => {
  it("reserve adequacy uses the 30-day reserve, not the current one", async () => {
    await seedMetric("reserve_adequacy", "month");
    await seedProviderAndCustomer();
    const reportedAt = MONTH_START - 90 * DAY;
    await ctx.db.insert(schema.axisPolicies).values({
      id: "pol_1",
      tenantId: ctx.tenantId,
      customerId: "cu_1",
      providerId: "prov_1",
      policyNo: "P-1",
      startAt: reportedAt - 30 * DAY,
      endAt: NOW + 365 * DAY,
      premiumMinor: 100_000,
      currency: "AED",
      status: "active",
      createdAt: reportedAt - 30 * DAY,
      updatedAt: reportedAt - 30 * DAY
    });
    await ctx.db.insert(schema.axisClaims).values({
      id: "clm_1",
      tenantId: ctx.tenantId,
      policyId: "pol_1",
      customerId: "cu_1",
      claimNo: "C-1",
      reportedAt,
      currency: "AED",
      paidMinor: 40_000,
      closedAt: NOW - DAY,
      createdAt: reportedAt,
      updatedAt: NOW - DAY
    });
    await ctx.db.insert(schema.axisClaimReserves).values([
      {
        id: "acr_1",
        tenantId: ctx.tenantId,
        claimId: "clm_1",
        seq: 1,
        amountMinor: 50_000,
        deltaMinor: 50_000,
        currency: "AED",
        basis: "assessor",
        setBy: "user:test",
        setAt: reportedAt + 5 * DAY,
        createdAt: reportedAt + 5 * DAY
      },
      {
        id: "acr_2",
        tenantId: ctx.tenantId,
        claimId: "clm_1",
        seq: 2,
        amountMinor: 40_000,
        previousMinor: 50_000,
        deltaMinor: -10_000,
        currency: "AED",
        basis: "assessor",
        setBy: "user:test",
        setAt: reportedAt + 28 * DAY,
        createdAt: reportedAt + 28 * DAY
      },
      {
        id: "acr_3",
        tenantId: ctx.tenantId,
        claimId: "clm_1",
        seq: 3,
        amountMinor: 10_000,
        previousMinor: 40_000,
        deltaMinor: -30_000,
        currency: "AED",
        basis: "closure",
        setBy: "user:test",
        setAt: reportedAt + 45 * DAY,
        createdAt: reportedAt + 45 * DAY
      }
    ]);

    const result = await runSnapshotter(ctx);
    expect(result.written).toBe(1);

    const [row] = await ctx.db
      .select()
      .from(schema.northSnapshots)
      .where(and(eq(schema.northSnapshots.tenantId, ctx.tenantId), eq(schema.northSnapshots.metricKey, "reserve_adequacy")));
    // 40,000 reserve-at-30-days / 40,000 final paid = 10,000 bp, not the
    // 10,000-minor "current" reserve set at closure.
    expect(row!.value).toBe(10_000);
  });
});

describe("runSnapshotter: combined_ratio", () => {
  it("sums the loss_ratio and expense_ratio snapshots written in the same run", async () => {
    await ctx.db.insert(schema.northMetrics).values([
      { id: "mtr_loss_ratio", tenantId: ctx.tenantId, key: "loss_ratio", nameJson: "{}", definitionSqlRef: "x", unit: "ratio", grain: "month", owner: "test", targetJson: "{}", createdAt: ctx.now, updatedAt: ctx.now },
      { id: "mtr_expense_ratio", tenantId: ctx.tenantId, key: "expense_ratio", nameJson: "{}", definitionSqlRef: "x", unit: "ratio", grain: "month", owner: "test", targetJson: "{}", createdAt: ctx.now, updatedAt: ctx.now },
      { id: "mtr_combined_ratio", tenantId: ctx.tenantId, key: "combined_ratio", nameJson: "{}", definitionSqlRef: "x", unit: "ratio", grain: "month", owner: "test", targetJson: "{}", createdAt: ctx.now, updatedAt: ctx.now }
    ]);
    await seedProviderAndCustomer();
    await ctx.db.insert(schema.axisPolicies).values({
      id: "pol_1",
      tenantId: ctx.tenantId,
      customerId: "cu_1",
      providerId: "prov_1",
      policyNo: "P-1",
      startAt: MONTH_START,
      endAt: NOW + 365 * DAY,
      premiumMinor: 100_000,
      currency: "AED",
      status: "active",
      createdAt: MONTH_START,
      updatedAt: MONTH_START
    });
    await ctx.db.insert(schema.axisPolicyVersions).values({
      id: "polv_1",
      tenantId: ctx.tenantId,
      policyId: "pol_1",
      versionSeq: 1,
      reason: "issue",
      effectiveFrom: MONTH_START,
      effectiveTo: NOW,
      premiumMinor: 100_000,
      currency: "AED",
      termsJson: "{}",
      issuedBy: "user:test",
      issuedAt: MONTH_START,
      createdAt: MONTH_START,
      updatedAt: MONTH_START
    });
    await ctx.db.insert(schema.axisClaims).values({
      id: "clm_1",
      tenantId: ctx.tenantId,
      policyId: "pol_1",
      customerId: "cu_1",
      claimNo: "C-1",
      incidentAt: MONTH_START + DAY,
      reportedAt: MONTH_START + DAY,
      currency: "AED",
      paidMinor: 20_000,
      reserveMinor: 5_000,
      createdAt: MONTH_START + DAY,
      updatedAt: MONTH_START + DAY
    });
    // 5xxx expense account, 15,000 debit — expense_ratio = 15,000 / 100,000 = 1,500 bp.
    await ctx.db.insert(schema.ledgerJournalLines).values({
      id: "ljl_1",
      tenantId: ctx.tenantId,
      batchId: "batch_1",
      txnId: "txn_1",
      seq: 1,
      accountCode: "5100",
      side: "debit",
      amountMinor: 15_000,
      currency: "AED",
      baseAmountMinor: 15_000,
      baseCurrency: "AED",
      postedAt: MONTH_START + DAY
    });

    const result = await runSnapshotter(ctx);

    const [row] = await ctx.db
      .select()
      .from(schema.northSnapshots)
      .where(and(eq(schema.northSnapshots.tenantId, ctx.tenantId), eq(schema.northSnapshots.metricKey, "combined_ratio")));
    // loss_ratio 2,500 bp + expense_ratio 1,500 bp = 4,000 bp, from rows written earlier in this same run.
    expect(row!.value).toBe(4_000);
    expect(result.written).toBeGreaterThanOrEqual(3);
  });
});

describe("runSnapshotter: gross_written_premium / net_written_premium", () => {
  it("sums premium+tax+fees for gross, premium only for net, filtered by effectiveFrom in period", async () => {
    await seedMetric("gross_written_premium", "day");
    await seedMetric("net_written_premium", "day");
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
    await ctx.db.insert(schema.axisPolicyVersions).values([
      {
        id: "polv_yesterday",
        tenantId: ctx.tenantId,
        policyId: "pol_1",
        versionSeq: 1,
        reason: "issue",
        effectiveFrom: YESTERDAY_MID,
        effectiveTo: YESTERDAY_MID + 365 * DAY,
        premiumMinor: 10_000,
        taxMinor: 500,
        feesMinor: 200,
        currency: "AED",
        termsJson: "{}",
        issuedBy: "user:test",
        issuedAt: YESTERDAY_MID,
        createdAt: YESTERDAY_MID,
        updatedAt: YESTERDAY_MID
      },
      {
        id: "polv_voided",
        tenantId: ctx.tenantId,
        policyId: "pol_1",
        versionSeq: 2,
        reason: "cancellation",
        effectiveFrom: YESTERDAY_MID,
        effectiveTo: YESTERDAY_MID + 365 * DAY,
        premiumMinor: 999_999,
        taxMinor: 999_999,
        feesMinor: 999_999,
        currency: "AED",
        termsJson: "{}",
        state: "voided",
        issuedBy: "user:test",
        issuedAt: YESTERDAY_MID,
        createdAt: YESTERDAY_MID,
        updatedAt: YESTERDAY_MID
      },
      {
        id: "polv_today",
        tenantId: ctx.tenantId,
        policyId: "pol_1",
        versionSeq: 3,
        reason: "endorsement",
        effectiveFrom: NOW,
        effectiveTo: NOW + 365 * DAY,
        premiumMinor: 1_000_000,
        taxMinor: 1_000_000,
        feesMinor: 1_000_000,
        currency: "AED",
        termsJson: "{}",
        issuedBy: "user:test",
        issuedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW
      }
    ]);

    const result = await runSnapshotter(ctx);
    expect(result.written).toBe(2);

    const rows = await ctx.db
      .select()
      .from(schema.northSnapshots)
      .where(eq(schema.northSnapshots.tenantId, ctx.tenantId));
    expect(rows.find((r) => r.metricKey === "gross_written_premium")!.value).toBe(10_700);
    expect(rows.find((r) => r.metricKey === "net_written_premium")!.value).toBe(10_000);
  });
});

describe("runSnapshotter: quote_hit_rate", () => {
  it("divides BIND txns created in period by quote requests created in period", async () => {
    await seedMetric("quote_hit_rate", "day");
    const quoteRequestBase = {
      tenantId: ctx.tenantId,
      channelId: "chan_1",
      productId: "prod_1",
      inputsJson: "{}",
      currency: "AED",
      updatedAt: YESTERDAY_MID
    };
    await ctx.db.insert(schema.distQuoteRequests).values([
      { ...quoteRequestBase, id: "qr_1", createdAt: YESTERDAY_MID },
      { ...quoteRequestBase, id: "qr_2", createdAt: YESTERDAY_MID },
      { ...quoteRequestBase, id: "qr_3", createdAt: YESTERDAY_MID },
      { ...quoteRequestBase, id: "qr_4", createdAt: YESTERDAY_MID },
      { ...quoteRequestBase, id: "qr_today", createdAt: NOW, updatedAt: NOW }
    ]);
    await ctx.db.insert(schema.ledgerTxns).values([
      {
        id: "txn_bind",
        tenantId: ctx.tenantId,
        type: "BIND",
        idempotencyKey: "idem_bind",
        actorKind: "system",
        actorId: "scheduler",
        currency: "AED",
        baseCurrency: "AED",
        createdAt: YESTERDAY_MID,
        updatedAt: YESTERDAY_MID
      },
      {
        id: "txn_other",
        tenantId: ctx.tenantId,
        type: "CMSN-ACCR",
        idempotencyKey: "idem_other",
        actorKind: "system",
        actorId: "scheduler",
        currency: "AED",
        baseCurrency: "AED",
        createdAt: YESTERDAY_MID,
        updatedAt: YESTERDAY_MID
      }
    ]);

    const result = await runSnapshotter(ctx);
    expect(result.written).toBe(1);

    const [row] = await ctx.db
      .select()
      .from(schema.northSnapshots)
      .where(and(eq(schema.northSnapshots.tenantId, ctx.tenantId), eq(schema.northSnapshots.metricKey, "quote_hit_rate")));
    // 1 BIND / 4 requests created yesterday = 2,500 bp.
    expect(row!.value).toBe(2_500);
  });
});

describe("runSnapshotter: avg_handling_time_claims", () => {
  it("takes the median closedAt - reportedAt over claims closed in period", async () => {
    await seedMetric("avg_handling_time_claims", "day");
    await seedProviderAndCustomer();
    await ctx.db.insert(schema.axisPolicies).values({
      id: "pol_1",
      tenantId: ctx.tenantId,
      customerId: "cu_1",
      providerId: "prov_1",
      policyNo: "P-1",
      startAt: YESTERDAY_MID - 365 * DAY,
      endAt: NOW + 365 * DAY,
      premiumMinor: 10_000,
      currency: "AED",
      status: "active",
      createdAt: YESTERDAY_MID - 365 * DAY,
      updatedAt: YESTERDAY_MID - 365 * DAY
    });
    await ctx.db.insert(schema.axisClaims).values([
      {
        id: "clm_1",
        tenantId: ctx.tenantId,
        policyId: "pol_1",
        customerId: "cu_1",
        claimNo: "C-1",
        reportedAt: YESTERDAY_MID - 2 * DAY,
        closedAt: YESTERDAY_MID,
        currency: "AED",
        createdAt: YESTERDAY_MID - 2 * DAY,
        updatedAt: YESTERDAY_MID
      },
      {
        id: "clm_2",
        tenantId: ctx.tenantId,
        policyId: "pol_1",
        customerId: "cu_1",
        claimNo: "C-2",
        reportedAt: YESTERDAY_MID - 6 * DAY,
        closedAt: YESTERDAY_MID,
        currency: "AED",
        createdAt: YESTERDAY_MID - 6 * DAY,
        updatedAt: YESTERDAY_MID
      }
    ]);

    const result = await runSnapshotter(ctx);
    expect(result.written).toBe(1);

    const [row] = await ctx.db
      .select()
      .from(schema.northSnapshots)
      .where(and(eq(schema.northSnapshots.tenantId, ctx.tenantId), eq(schema.northSnapshots.metricKey, "avg_handling_time_claims")));
    // median of 2 days and 6 days = 4 days, in ms.
    expect(row!.value).toBe(4 * DAY);
  });
});

describe("runSnapshotter: avg_handling_time_cases", () => {
  it("takes the median closedAt - createdAt over cases closed in period", async () => {
    await seedMetric("avg_handling_time_cases", "day");
    await ctx.db.insert(schema.axisCases).values([
      {
        id: "case_1",
        tenantId: ctx.tenantId,
        ref: "CASE-1",
        kind: "quote",
        createdAt: YESTERDAY_MID - DAY,
        closedAt: YESTERDAY_MID,
        updatedAt: YESTERDAY_MID
      },
      {
        id: "case_2",
        tenantId: ctx.tenantId,
        ref: "CASE-2",
        kind: "quote",
        createdAt: YESTERDAY_MID - 3 * DAY,
        closedAt: YESTERDAY_MID,
        updatedAt: YESTERDAY_MID
      }
    ]);

    const result = await runSnapshotter(ctx);
    expect(result.written).toBe(1);

    const [row] = await ctx.db
      .select()
      .from(schema.northSnapshots)
      .where(and(eq(schema.northSnapshots.tenantId, ctx.tenantId), eq(schema.northSnapshots.metricKey, "avg_handling_time_cases")));
    // median of 1 day and 3 days = 2 days, in ms.
    expect(row!.value).toBe(2 * DAY);
  });
});

describe("runSnapshotter: sla_breach_rate", () => {
  it("counts cases and claims closed past their slaDueAt", async () => {
    await seedMetric("sla_breach_rate", "day");
    await seedProviderAndCustomer();
    await ctx.db.insert(schema.axisCases).values([
      {
        id: "case_ontime",
        tenantId: ctx.tenantId,
        ref: "CASE-1",
        kind: "quote",
        slaDueAt: YESTERDAY_MID + DAY,
        createdAt: YESTERDAY_MID - DAY,
        closedAt: YESTERDAY_MID,
        updatedAt: YESTERDAY_MID
      },
      {
        id: "case_breached",
        tenantId: ctx.tenantId,
        ref: "CASE-2",
        kind: "quote",
        slaDueAt: YESTERDAY_MID - DAY,
        createdAt: YESTERDAY_MID - 3 * DAY,
        closedAt: YESTERDAY_MID,
        updatedAt: YESTERDAY_MID
      }
    ]);
    await ctx.db.insert(schema.axisPolicies).values({
      id: "pol_1",
      tenantId: ctx.tenantId,
      customerId: "cu_1",
      providerId: "prov_1",
      policyNo: "P-1",
      startAt: YESTERDAY_MID - 365 * DAY,
      endAt: NOW + 365 * DAY,
      premiumMinor: 10_000,
      currency: "AED",
      status: "active",
      createdAt: YESTERDAY_MID - 365 * DAY,
      updatedAt: YESTERDAY_MID - 365 * DAY
    });
    await ctx.db.insert(schema.axisClaims).values({
      id: "clm_breached",
      tenantId: ctx.tenantId,
      policyId: "pol_1",
      customerId: "cu_1",
      claimNo: "C-1",
      reportedAt: YESTERDAY_MID - 3 * DAY,
      slaDueAt: YESTERDAY_MID - DAY,
      closedAt: YESTERDAY_MID,
      currency: "AED",
      createdAt: YESTERDAY_MID - 3 * DAY,
      updatedAt: YESTERDAY_MID
    });

    const result = await runSnapshotter(ctx);
    expect(result.written).toBe(1);

    const [row] = await ctx.db
      .select()
      .from(schema.northSnapshots)
      .where(and(eq(schema.northSnapshots.tenantId, ctx.tenantId), eq(schema.northSnapshots.metricKey, "sla_breach_rate")));
    // 2 breached (1 case + 1 claim) / 3 closed total = 6,667 bp.
    expect(row!.value).toBe(6_667);
  });
});

describe("runSnapshotter: open_claim_count / outstanding_reserve", () => {
  it("point-in-time gauges ignore the period window and current status/reserve", async () => {
    await seedMetric("open_claim_count", "month");
    await seedMetric("outstanding_reserve", "month");
    await seedProviderAndCustomer();
    await ctx.db.insert(schema.axisPolicies).values({
      id: "pol_1",
      tenantId: ctx.tenantId,
      customerId: "cu_1",
      providerId: "prov_1",
      policyNo: "P-1",
      startAt: MONTH_START - 365 * DAY,
      endAt: NOW + 365 * DAY,
      premiumMinor: 10_000,
      currency: "AED",
      status: "active",
      createdAt: MONTH_START - 365 * DAY,
      updatedAt: MONTH_START - 365 * DAY
    });
    await ctx.db.insert(schema.axisClaims).values([
      {
        id: "clm_open",
        tenantId: ctx.tenantId,
        policyId: "pol_1",
        customerId: "cu_1",
        claimNo: "C-1",
        reportedAt: MONTH_START - 365 * DAY,
        reserveMinor: 5_000,
        currency: "AED",
        status: "assessing",
        createdAt: MONTH_START - 365 * DAY,
        updatedAt: MONTH_START - 365 * DAY
      },
      {
        id: "clm_withdrawn",
        tenantId: ctx.tenantId,
        policyId: "pol_1",
        customerId: "cu_1",
        claimNo: "C-2",
        reportedAt: MONTH_START - 365 * DAY,
        reserveMinor: 1_000,
        currency: "AED",
        status: "withdrawn",
        createdAt: MONTH_START - 365 * DAY,
        updatedAt: MONTH_START - 365 * DAY
      },
      {
        id: "clm_closed",
        tenantId: ctx.tenantId,
        policyId: "pol_1",
        customerId: "cu_1",
        claimNo: "C-3",
        reportedAt: MONTH_START - 365 * DAY,
        closedAt: MONTH_START - 100 * DAY,
        reserveMinor: 2_000,
        currency: "AED",
        status: "settled",
        createdAt: MONTH_START - 365 * DAY,
        updatedAt: MONTH_START - 100 * DAY
      }
    ]);

    const result = await runSnapshotter(ctx);
    expect(result.written).toBe(2);

    const rows = await ctx.db
      .select()
      .from(schema.northSnapshots)
      .where(eq(schema.northSnapshots.tenantId, ctx.tenantId));
    // Only clm_open has no closedAt and a non-excluded status.
    expect(rows.find((r) => r.metricKey === "open_claim_count")!.value).toBe(1);
    // Sums reserveMinor across all claims regardless of status/closedAt: 5,000 + 1,000 + 2,000.
    expect(rows.find((r) => r.metricKey === "outstanding_reserve")!.value).toBe(8_000);
  });
});
