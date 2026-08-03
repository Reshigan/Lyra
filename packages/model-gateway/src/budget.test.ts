import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson, schema } from "@lyra/db";
import { AppError, permissionsForRole, type Ctx } from "@lyra/core";
import { assertBudget, charge, checkBudget, dayKey, setLimits, WARN_AT } from "./budget.js";

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

/** Small, distinct token/cost ceilings so the two dimensions never overlap by accident. */
function budgetPolicy(tokens: number, costMicro: number): PolicyJson {
  return PolicyJson.parse({ aiBudgetDailyTokens: tokens, aiBudgetDailyCostMicro: costMicro });
}

describe("dayKey", () => {
  it("returns the exact UTC day slice, not a truncated or reformatted one", () => {
    // 2023-11-14T22:13:20.000Z by hand from the epoch ms — pins `.slice(0, 10)`
    // against a wrong length or a dropped/shifted offset.
    expect(dayKey(1_700_000_000_000)).toBe("2023-11-14");
    expect(dayKey(1_700_000_000_000)).toHaveLength(10);
  });
});

describe("checkBudget percentage math", () => {
  it("computes usedPct as a true division, not a multiplication or inversion", async () => {
    // 50 of 200 tokens is 25%. A `*` instead of `/`, or a swapped numerator/
    // denominator, lands on a wildly different number, not an off-by-one.
    const ctx = makeCtx(budgetPolicy(200, 2_000_000));
    await charge(ctx, { tokensIn: 50, tokensOut: 0, costMicro: 0 }, "pct");
    const check = await checkBudget(ctx, "pct");
    expect(check.usedPct).toBe(25);
    expect(check.ok).toBe(true);
  });

  it("is ok one token below the tokens ceiling", async () => {
    const ctx = makeCtx(budgetPolicy(100, 1_000_000));
    await charge(ctx, { tokensIn: 99, tokensOut: 0, costMicro: 0 }, "tok");
    const check = await checkBudget(ctx, "tok");
    expect(check.ok).toBe(true);
    expect(check.usedPct).toBe(99);
    expect(check.reason).toBeUndefined();
  });

  it("stops exactly at the tokens ceiling — pins `>` vs `>=`", async () => {
    const ctx = makeCtx(budgetPolicy(100, 1_000_000));
    await charge(ctx, { tokensIn: 100, tokensOut: 0, costMicro: 0 }, "tok");
    const check = await checkBudget(ctx, "tok");
    expect(check.ok).toBe(false);
    expect(check.usedPct).toBe(100);
    expect(check.reason).toBe("tokens");
  });

  it("is ok one micro-unit below the cost ceiling", async () => {
    const ctx = makeCtx(budgetPolicy(1_000_000, 100));
    await charge(ctx, { tokensIn: 0, tokensOut: 0, costMicro: 99 }, "cost");
    const check = await checkBudget(ctx, "cost");
    expect(check.ok).toBe(true);
    expect(check.usedPct).toBe(99);
    expect(check.reason).toBeUndefined();
  });

  it("stops exactly at the cost ceiling — pins `>` vs `>=`", async () => {
    const ctx = makeCtx(budgetPolicy(1_000_000, 100));
    await charge(ctx, { tokensIn: 0, tokensOut: 0, costMicro: 100 }, "cost");
    const check = await checkBudget(ctx, "cost");
    expect(check.ok).toBe(false);
    expect(check.usedPct).toBe(100);
    expect(check.reason).toBe("cost");
  });

  it("reports ok:false from stoppedAt alone, even when neither dimension is over", async () => {
    // Drives the row directly (not through charge/setLimits) so tokensUsed and
    // costMicroUsed stay well under both ceilings — isolating the `state.stoppedAt
    // || outOfTokens || outOfCost` compound condition's first term from the other two.
    const ctx = makeCtx(budgetPolicy(1_000_000, 1_000_000));
    await charge(ctx, { tokensIn: 1, tokensOut: 0, costMicro: 1 }, "stuck");
    await db
      .update(schema.aiBudgets)
      .set({ stoppedAt: ctx.now })
      .where(
        and(
          eq(schema.aiBudgets.tenantId, "t_1"),
          eq(schema.aiBudgets.day, dayKey(ctx.now)),
          eq(schema.aiBudgets.module, "stuck")
        )
      );

    const check = await checkBudget(ctx, "stuck");
    expect(check.state.tokensUsed).toBeLessThan(check.state.tokensLimit);
    expect(check.state.costMicroUsed).toBeLessThan(check.state.costMicroLimit);
    expect(check.ok).toBe(false);
  });
});

describe("zero limits mean blocked, not unlimited", () => {
  // A tenant zeroing an AI budget is turning AI off, not removing the ceiling.
  it("checkBudget blocks on a tokens limit of 0", async () => {
    const ctx = makeCtx(budgetPolicy(0, 1_000_000));
    const check = await checkBudget(ctx, "zero-tok");
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("tokens");
  });

  it("checkBudget blocks on a cost limit of 0", async () => {
    const ctx = makeCtx(budgetPolicy(1_000_000, 0));
    const check = await checkBudget(ctx, "zero-cost");
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("cost");
  });

  it("charge against a 0 limit latches the stop", async () => {
    const ctx = makeCtx(budgetPolicy(0, 1_000_000));
    const result = await charge(ctx, { tokensIn: 5, tokensOut: 0, costMicro: 0 }, "zero-charge");
    expect(result.stopped).toBe(true);
    expect((await checkBudget(ctx, "zero-charge")).state.stoppedAt).not.toBeNull();
  });

  it("setLimits to 0 keeps an existing stop — 0 is not a raise to unlimited", async () => {
    const ctx = makeCtx(budgetPolicy(100, 1_000_000));
    await charge(ctx, { tokensIn: 100, tokensOut: 0, costMicro: 0 }, "*");
    expect((await checkBudget(ctx, "*")).ok).toBe(false);

    await setLimits(ctx, { tokensLimit: 0 }, "*");
    const check = await checkBudget(ctx, "*");
    expect(check.ok).toBe(false);
    expect(check.state.stoppedAt).not.toBeNull();
  });
});

describe("concurrent charges", () => {
  it("latches stoppedAt even when every charge read the row under the limit", async () => {
    // Two charges of 60 against a 100-token ceiling, interleaved so both read
    // tokensUsed=0 before either writes (Promise.all on one connection issues
    // both SELECTs before either UPDATE). The counters are relative SQL and end
    // at 120; the latch must come from the post-increment value, not the stale read.
    const ctx = makeCtx(budgetPolicy(100, 1_000_000));
    await checkBudget(ctx, "race"); // seed the row so both charges hit the read→update path
    const [a, b] = await Promise.all([
      charge(ctx, { tokensIn: 60, tokensOut: 0, costMicro: 0 }, "race"),
      charge(ctx, { tokensIn: 60, tokensOut: 0, costMicro: 0 }, "race")
    ]);

    const state = (await checkBudget(ctx, "race")).state;
    expect(state.tokensUsed).toBe(120);
    expect(state.stoppedAt).not.toBeNull();
    expect(a.stopped || b.stopped).toBe(true);
  });
});

describe("assertBudget", () => {
  it("throws a 429 with a retry-after computed to the next UTC midnight", async () => {
    // 2024-01-15T10:30:00.000Z by hand: 13h30m to the next UTC midnight = 48,600s.
    const NOW2 = Date.UTC(2024, 0, 15, 10, 30, 0);
    const ctx = makeCtx(budgetPolicy(1, 1_000_000), NOW2);
    await charge(ctx, { tokensIn: 1, tokensOut: 0, costMicro: 0 }, "assert");

    await expect(assertBudget(ctx, "assert")).rejects.toBeInstanceOf(AppError);
    await expect(assertBudget(ctx, "assert")).rejects.toMatchObject({
      status: 429,
      extras: { retry_after: 48_600 }
    });
  });
});

describe("charge", () => {
  it("crosses WARN_AT in one call — pins `wasPct < WARN_AT && nowPct >= WARN_AT`", async () => {
    const ctx = makeCtx(budgetPolicy(100, 1_000_000));
    const result = await charge(ctx, { tokensIn: WARN_AT * 100, tokensOut: 0, costMicro: 0 }, "warn");
    expect(result.crossedWarning).toBe(true);
  });

  it("does not re-trigger crossedWarning once already above WARN_AT", async () => {
    const ctx = makeCtx(budgetPolicy(100, 1_000_000));
    await charge(ctx, { tokensIn: WARN_AT * 100 + 1, tokensOut: 0, costMicro: 0 }, "warn2");
    const second = await charge(ctx, { tokensIn: 1, tokensOut: 0, costMicro: 0 }, "warn2");
    expect(second.crossedWarning).toBe(false);
  });

  it("stops exactly at 100% usage, not just under it — pins `>=` vs `>`", async () => {
    const under = makeCtx(budgetPolicy(100, 1_000_000));
    const notStopped = await charge(under, { tokensIn: 99, tokensOut: 0, costMicro: 0 }, "stop-under");
    expect(notStopped.stopped).toBe(false);

    const at = makeCtx(budgetPolicy(100, 1_000_000));
    const stopped = await charge(at, { tokensIn: 100, tokensOut: 0, costMicro: 0 }, "stop-at");
    expect(stopped.stopped).toBe(true);
  });

  it("preserves the original stoppedAt across a later charge, it does not overwrite it", async () => {
    const ctx = makeCtx(budgetPolicy(100, 1_000_000));
    await charge(ctx, { tokensIn: 100, tokensOut: 0, costMicro: 0 }, "preserve");
    const firstStopAt = (await checkBudget(ctx, "preserve")).state.stoppedAt;
    expect(firstStopAt).toBe(NOW);

    // A later charge, same day, different `now` — stoppedAt must stay pinned to
    // the first stop, not slide to `ctx.now` on every subsequent charge.
    const later = makeCtx(budgetPolicy(100, 1_000_000), NOW + 1_000);
    await charge(later, { tokensIn: 1, tokensOut: 0, costMicro: 0 }, "preserve");
    const secondStopAt = (await checkBudget(later, "preserve")).state.stoppedAt;
    expect(secondStopAt).toBe(NOW);
    expect(secondStopAt).not.toBe(NOW + 1_000);
  });

  it("accumulates costMicroUsed as prior + new, not prior - new", async () => {
    const ctx = makeCtx(budgetPolicy(1_000_000, 1_000_000));
    await charge(ctx, { tokensIn: 0, tokensOut: 0, costMicro: 1_000 }, "sum");
    const result = await charge(ctx, { tokensIn: 0, tokensOut: 0, costMicro: 2_000 }, "sum");
    expect(result.usedPct).toBe(0); // 3_000 / 1_000_000 rounds to 0 — the row is the real assertion below.

    const state = (await checkBudget(ctx, "sum")).state;
    expect(state.costMicroUsed).toBe(3_000);
  });

  it("defaults module to the tenant-wide '*' row, distinct from an explicit module", async () => {
    const ctx = makeCtx(budgetPolicy(1_000_000, 1_000_000));
    await charge(ctx, { tokensIn: 42, tokensOut: 0, costMicro: 0 }); // no module argument
    await charge(ctx, { tokensIn: 7, tokensOut: 0, costMicro: 0 }, "explicit");

    const star = await db
      .select()
      .from(schema.aiBudgets)
      .where(
        and(
          eq(schema.aiBudgets.tenantId, "t_1"),
          eq(schema.aiBudgets.day, dayKey(NOW)),
          eq(schema.aiBudgets.module, "*")
        )
      );
    expect(star).toHaveLength(1);
    expect(star[0]!.tokensUsed).toBe(42);

    const explicit = await db
      .select()
      .from(schema.aiBudgets)
      .where(
        and(
          eq(schema.aiBudgets.tenantId, "t_1"),
          eq(schema.aiBudgets.day, dayKey(NOW)),
          eq(schema.aiBudgets.module, "explicit")
        )
      );
    expect(explicit).toHaveLength(1);
    expect(explicit[0]!.tokensUsed).toBe(7);
  });
});
