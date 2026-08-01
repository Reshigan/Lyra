import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PolicyJson, EntitlementsJson, schema } from "@lyra/db";
import { permissionsForRole, type Actor, type Ctx } from "@lyra/core";
import {
  renewalDay0,
  renewalDay21Escalate,
  renewalDay7Followup,
  renewalExpireIfUndecided
} from "./renewal-campaign.js";

// docs/10 §2 `WF` binding: the day-0/7/21/30 renewal campaign
// (renewal-workflow.ts) is a thin durable wrapper around these steps. This
// covers the actual state machine without needing a Workflow runtime.

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
    id: "renewal-workflow",
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

async function seedRenewal(state: "scheduled" | "offered" | "accepted" | "lost" = "scheduled") {
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
  await ctx.db.insert(schema.axisPolicies).values({
    id: "pol_1",
    tenantId: ctx.tenantId,
    customerId: "cu_1",
    providerId: "prov_1",
    policyNo: "P-1",
    startAt: ctx.now - 300 * 86_400_000,
    endAt: ctx.now + 20 * 86_400_000,
    premiumMinor: 100_00,
    currency: "AED",
    status: "active",
    createdAt: ctx.now,
    updatedAt: ctx.now
  });
  await ctx.db.insert(schema.orbitRenewals).values({
    id: "rnw_1",
    tenantId: ctx.tenantId,
    policyRef: "pol_1",
    customerId: "cu_1",
    expiryAt: ctx.now + 20 * 86_400_000,
    churnScore: 40,
    strategy: "auto_requote",
    state,
    createdAt: ctx.now,
    updatedAt: ctx.now
  } as never);
}

async function renewal() {
  const [row] = await ctx.db.select().from(schema.orbitRenewals).where(eq(schema.orbitRenewals.id, "rnw_1"));
  return row!;
}

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  ctx = await makeCtx();
});

describe("renewalDay0", () => {
  it("opens a scheduled renewal for action", async () => {
    await seedRenewal("scheduled");
    const result = await renewalDay0(ctx, "rnw_1");
    expect(result.done).toBe(false);
    const row = await renewal();
    expect(row.state).toBe("offered");
    expect(row.offeredAt).toBe(ctx.now);
  });

  it("is a no-op once a human has already moved the row on", async () => {
    await seedRenewal("accepted");
    const result = await renewalDay0(ctx, "rnw_1");
    expect(result.done).toBe(true);
    const row = await renewal();
    expect(row.state).toBe("accepted");
  });
});

describe("renewalDay7Followup / renewalDay21Escalate", () => {
  it("keeps nudging while still offered, and escalates to the human desk", async () => {
    await seedRenewal("offered");

    const followup = await renewalDay7Followup(ctx, "rnw_1");
    expect(followup.done).toBe(false);

    const escalate = await renewalDay21Escalate(ctx, "rnw_1");
    expect(escalate.done).toBe(false);
    const row = await renewal();
    expect(row.strategy).toBe("human");
  });

  it("stops touching a renewal once it is decided", async () => {
    await seedRenewal("lost");
    expect((await renewalDay7Followup(ctx, "rnw_1")).done).toBe(true);
    expect((await renewalDay21Escalate(ctx, "rnw_1")).done).toBe(true);
  });
});

describe("renewalExpireIfUndecided", () => {
  it("closes out a renewal nobody decided by day 30", async () => {
    await seedRenewal("offered");
    await renewalExpireIfUndecided(ctx, "rnw_1");
    const row = await renewal();
    expect(row.state).toBe("lost");
    expect(row.outcomeReason).toBe("expired_no_response");
    expect(row.decidedAt).toBe(ctx.now);
  });

  it("leaves an already-accepted renewal alone", async () => {
    await seedRenewal("accepted");
    await renewalExpireIfUndecided(ctx, "rnw_1");
    const row = await renewal();
    expect(row.state).toBe("accepted");
  });
});
