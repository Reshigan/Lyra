import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson, schema } from "@lyra/db";
import { permissionsForRole, type Ctx } from "@lyra/core";
import { checkBudget, charge, setLimits } from "./budget.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "db", "migrations");

function migrationStatements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const SEEDED = { aiBudgetDailyTokens: 1_000, aiBudgetDailyCostMicro: 100_000 };

let client: Client;
let db: Ctx["db"];

function makeCtx(policy: PolicyJson, now = NOW): Ctx {
  return {
    db,
    tenantId: "t_1",
    actor: {
      kind: "user",
      id: "u_admin",
      tenantId: "t_1",
      grants: [{ roleKey: "tenant.admin", permissions: permissionsForRole("tenant.admin") }]
    },
    requestId: "req_1",
    now,
    locale: "en",
    policy,
    entitlements: EntitlementsJson.parse({})
  };
}

/**
 * What apps/api/src/auth.ts does on every request: the tenant row is the only
 * source of ctx.policy. Tomorrow's request cannot see anything setLimits kept
 * in memory, so the test reads policy back the same way the gateway will.
 */
async function policyFromDb(): Promise<PolicyJson> {
  const rows = await db
    .select({ policyJson: schema.tenants.policyJson })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, "t_1"))
    .limit(1);
  return PolicyJson.parse(JSON.parse(rows[0]!.policyJson ?? "{}"));
}

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of migrationStatements()) await client.execute(sql);
  db = drizzle(client) as unknown as Ctx["db"];
  await db.insert(schema.tenants).values({
    id: "t_1",
    slug: "t-1",
    name: "Tenant One",
    policyJson: JSON.stringify(PolicyJson.parse(SEEDED)),
    createdAt: NOW,
    updatedAt: NOW
  });
});

describe("setLimits", () => {
  // CLAUDE.md §4: moving a spend ceiling is consequential. The audit row is
  // written in the gateway, not the route, so every caller of setLimits leaves
  // one — a second route or a scheduled raise cannot skip it.
  it("audits the change with before and after images", async () => {
    const ctx = makeCtx(await policyFromDb());
    await setLimits(ctx, { tokensLimit: 5_000 }, "*");

    const rows = await db.select().from(schema.auditLog);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action).toBe("ai.budget.set_limits");
    expect(row.actorRef).toBe("user:u_admin");
    expect(row.tenantId).toBe("t_1");
    // Both images present, and different — a hash pair that matches would mean
    // the row recorded nothing.
    expect(row.beforeHash).toBeTruthy();
    expect(row.afterHash).toBeTruthy();
    expect(row.beforeHash).not.toBe(row.afterHash);
  });

  it("audits a per-module ceiling against that module's row", async () => {
    const ctx = makeCtx(await policyFromDb());
    const state = await setLimits(ctx, { costMicroLimit: 900_000 }, "axis");
    const rows = await db.select().from(schema.auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.subjectRef).toBe(state.id);
  });

  it("still clears the stop when the new ceiling is above what was spent", async () => {
    const ctx = makeCtx(await policyFromDb());
    await charge(ctx, { tokensIn: 1_200, tokensOut: 0, costMicro: 0 }, "*");
    expect((await checkBudget(ctx, "*")).ok).toBe(false);

    await setLimits(ctx, { tokensLimit: 5_000 }, "*");
    expect((await checkBudget(ctx, "*")).ok).toBe(true);
  });

  /**
   * The bug this pins: ai_budgets rows are per (tenant, day, module), so
   * tomorrow's row is seeded fresh from tenant policy. Without the write-through
   * the ceiling set through POST /v1/ai/budget/limits silently reverted at the
   * UTC day boundary and nothing in the product could put it back.
   */
  it("keeps the tenant-wide ceiling after the day rolls over", async () => {
    const today = makeCtx(await policyFromDb());
    await setLimits(today, { tokensLimit: 5_000, costMicroLimit: 750_000 }, "*");

    const tomorrow = makeCtx(await policyFromDb(), NOW + DAY);
    const state = (await checkBudget(tomorrow, "*")).state;
    expect(state.day).not.toBe((await checkBudget(today, "*")).state.day);
    expect(state.tokensLimit).toBe(5_000);
    expect(state.costMicroLimit).toBe(750_000);
    // A fresh window starts empty: the ceiling carries, the spend does not.
    expect(state.tokensUsed).toBe(0);
  });

  it("leaves the untouched ceiling on its policy value", async () => {
    const today = makeCtx(await policyFromDb());
    await setLimits(today, { tokensLimit: 5_000 }, "*");

    const policy = await policyFromDb();
    expect(policy.aiBudgetDailyTokens).toBe(5_000);
    expect(policy.aiBudgetDailyCostMicro).toBe(SEEDED.aiBudgetDailyCostMicro);
    // Everything else in the policy survives the write.
    expect(policy.currency).toBe("AED");
    expect(policy.domainPack).toBe("insurance-retail");
  });
});
