import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PolicyJson, EntitlementsJson, schema } from "@lyra/db";
import { permissionsForRole, type Actor, type Ctx } from "@lyra/core";
import { recordUsage, sweepBilling } from "./billing.js";

// Group C revenue lines, task 7: worked-example integration test proving the
// full F2 flow (subscription invoice -> overage -> revenue recognition)
// across multiple sweepBilling ticks. Setup block below is copied verbatim
// from billing.test.ts (lines 1-58) — no shared test-helper module exists in
// this codebase, each test file builds its own isolated in-memory db.

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
    policy: PolicyJson.parse({ currency: "USD" }),
    entitlements: EntitlementsJson.parse({})
  };
}

/** Fresh in-memory db + migrations + ctx, for describe blocks that don't need a shared beforeEach. */
async function testCtx(now = 1_700_000_000_000): Promise<Ctx> {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  return makeCtx(now);
}

describe("F2 worked example: subscription + overage + recognition", () => {
  it("takes a subscription from due invoice through overage to recognized revenue", async () => {
    const ctx = await testCtx();
    const subId = "sub_worked1";

    await ctx.db.insert(schema.ledgerSubscriptions).values({
      id: subId,
      tenantId: ctx.tenantId,
      customerRef: "cust_worked1",
      plan: "growth",
      priceMinor: 20000,
      currency: "USD",
      interval: "month",
      seats: 3,
      startAt: ctx.now - 1000,
      nextInvoiceAt: ctx.now - 1000,
      state: "active",
      createdAt: ctx.now - 1000,
      updatedAt: ctx.now - 1000
    });

    await recordUsage(ctx, {
      subscriptionId: subId,
      meter: "api-calls",
      period: "2026-08",
      delta: 12000,
      includedQuantity: 10000,
      unitPriceMicro: 500,
      idempotencyKey: "worked1:usage:1"
    });

    // tick 1: raises subscription invoice + applies overage
    const tick1 = await sweepBilling(ctx);
    expect(tick1.invoicesRaised).toBe(1);
    expect(tick1.overagesApplied).toBe(1);

    const invoices = await ctx.db
      .select()
      .from(schema.ledgerInvoices)
      .where(eq(schema.ledgerInvoices.subscriptionId, subId));
    // Both the subscription invoice (raiseInvoices) and the overage invoice
    // (applyOverages) carry subscriptionId: sub.id / meter.subscriptionId,
    // which are the same subId here — verified against actual behavior of
    // billing.ts, not the brief's initial guess of a single row.
    expect(invoices.length).toBe(2);
    const subInvoice = invoices.find((i) => i.totalMinor === 20000);
    const overageInvoice = invoices.find((i) => i.id !== subInvoice?.id);
    expect(subInvoice?.totalMinor).toBe(20000);
    expect(overageInvoice?.totalMinor).toBe(1); // ceil(2000 overage units * 500 micros / 1e6)

    // tick 2 (same ctx.now): nothing recognized yet — postRecognitions only
    // fires for schedules strictly before the current period, and no time
    // has passed since the schedules were raised in tick 1.
    const tick2 = await sweepBilling(ctx);
    expect(tick2).toEqual({ invoicesRaised: 0, overagesApplied: 0, recognitionsPosted: 0 });

    // Advance 17 real-clock days: enough to cross the calendar-month
    // boundary (Nov -> Dec) so the subscription's revenue schedule becomes
    // due, but short of the 30-day MONTH_MS bump applied to nextInvoiceAt
    // in tick 1 — so this does not raise a second subscription invoice.
    const nextMonthCtx = await makeCtx(ctx.now + 17 * 24 * 60 * 60 * 1000);
    const tick3 = await sweepBilling(nextMonthCtx);
    expect(tick3).toEqual({ invoicesRaised: 0, overagesApplied: 0, recognitionsPosted: 1 });

    const schedules = await ctx.db
      .select()
      .from(schema.ledgerRevenueSchedules)
      .where(eq(schema.ledgerRevenueSchedules.tenantId, ctx.tenantId));
    expect(schedules.length).toBe(2);
    // Only the subscription schedule (real-clock period "2023-11") is due
    // by nextMonthCtx's "2023-12"; the overage schedule is pinned to the
    // literal "2026-08" period passed to recordUsage, which sorts after
    // "2023-12" lexicographically and so never becomes due here.
    const recognized = schedules.filter((s) => s.state === "recognized");
    const stillScheduled = schedules.filter((s) => s.state === "scheduled");
    expect(recognized.length).toBe(1);
    expect(stillScheduled.length).toBe(1);

    // tick 4: nothing left to do at this clock — the remaining schedule's
    // period ("2026-08") is still not before nextMonthCtx's real-clock period.
    const tick4 = await sweepBilling(nextMonthCtx);
    expect(tick4).toEqual({ invoicesRaised: 0, overagesApplied: 0, recognitionsPosted: 0 });
  });
});
