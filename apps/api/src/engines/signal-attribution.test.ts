import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PolicyJson, EntitlementsJson, schema } from "@lyra/db";
import { permissionsForRole, type Actor, type Ctx, type Envelope } from "@lyra/core";
import { funnelByCampaign, onBindIssued, recordTouch } from "./signal-attribution.js";

// The acquisition funnel writer. `signal_attribution_events` was a dead seam —
// north-snapshotter read it for CAC and nothing wrote to it, so every funnel
// metric answered zero. These tests pin the two write paths (public tracking
// and the axis.policy.issued consumer) and the last-touch bind credit.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "..", "packages", "db", "migrations");

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

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

async function makeCtx(now = 1_700_000_000_000): Promise<Ctx> {
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

function issuedEvent(customerId: string, policyId = "pol_1"): Envelope {
  return {
    id: "evt_1",
    ts: ctx.now,
    tenant_id: ctx.tenantId,
    module: "axis",
    type: "axis.policy.issued",
    actor: "system:queue",
    subject: policyId,
    data: { policyId, customerId, premiumMinor: 120_000_00, currency: "AED" },
    v: 1
  };
}

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  ctx = await makeCtx();
});

describe("recordTouch", () => {
  it("writes a tenant-scoped touch row", async () => {
    const id = await recordTouch(ctx, { touchType: "click", channel: "meta", campaignId: "cmp_1", anonId: "anon_9" });
    const [row] = await ctx.db.select().from(schema.signalAttributionEvents).where(eq(schema.signalAttributionEvents.id, id));
    expect(row?.tenantId).toBe("t_1");
    expect(row?.touchType).toBe("click");
    expect(row?.anonId).toBe("anon_9");
    expect(row?.customerId).toBeNull();
  });
});

describe("onBindIssued", () => {
  it("credits the bind to the customer's most recent attributed lead", async () => {
    await recordTouch(ctx, { touchType: "lead", channel: "google", campaignId: "cmp_old", customerId: "cus_1" });
    ctx = await makeCtx(ctx.now + 60_000);
    await recordTouch(ctx, { touchType: "lead", channel: "meta", campaignId: "cmp_new", customerId: "cus_1" });

    const bindId = await onBindIssued(ctx, issuedEvent("cus_1"));
    expect(bindId).not.toBeNull();

    const [bind] = await ctx.db
      .select()
      .from(schema.signalAttributionEvents)
      .where(eq(schema.signalAttributionEvents.id, bindId!));
    expect(bind?.touchType).toBe("bind");
    expect(bind?.campaignId).toBe("cmp_new");
    expect(bind?.channel).toBe("meta");
    expect(bind?.valueMinor).toBe(120_000_00);
    expect(bind?.subjectRef).toBe("pol_1");
  });

  it("returns null for a customer with no attributed lead — organic, no credit", async () => {
    expect(await onBindIssued(ctx, issuedEvent("cus_organic"))).toBeNull();
    const rows = await ctx.db.select().from(schema.signalAttributionEvents);
    expect(rows).toHaveLength(0);
  });

  it("is tenant-scoped: another tenant's lead is not credited", async () => {
    await recordTouch(ctx, { touchType: "lead", channel: "meta", campaignId: "cmp_1", customerId: "cus_1" });
    const other = { ...(await makeCtx()), tenantId: "t_2" };
    expect(await onBindIssued(other, issuedEvent("cus_1"))).toBeNull();
  });
});

describe("funnelByCampaign", () => {
  it("aggregates touches per campaign and channel", async () => {
    await recordTouch(ctx, { touchType: "impression", channel: "meta", campaignId: "cmp_1" });
    await recordTouch(ctx, { touchType: "impression", channel: "meta", campaignId: "cmp_1" });
    await recordTouch(ctx, { touchType: "click", channel: "meta", campaignId: "cmp_1" });
    await recordTouch(ctx, { touchType: "lead", channel: "meta", campaignId: "cmp_1", customerId: "cus_1" });
    await onBindIssued(ctx, issuedEvent("cus_1"));

    const funnel = await funnelByCampaign(ctx, ctx.now - 1000, ctx.now + 1000);
    expect(funnel).toHaveLength(1);
    expect(funnel[0]).toMatchObject({
      campaignId: "cmp_1",
      channel: "meta",
      impressions: 2,
      clicks: 1,
      leads: 1,
      binds: 1,
      valueMinor: 120_000_00
    });
  });

  it("excludes touches outside the window", async () => {
    await recordTouch(ctx, { touchType: "click", channel: "meta", campaignId: "cmp_1" });
    const funnel = await funnelByCampaign(ctx, ctx.now + 1000, ctx.now + 2000);
    expect(funnel).toHaveLength(0);
  });
});
