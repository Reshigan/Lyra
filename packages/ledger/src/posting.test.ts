import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { describe, expect, it } from "vitest";
import { PolicyJson, EntitlementsJson, schema } from "@lyra/db";
import type { Ctx } from "@lyra/core";
import { fxRateFor } from "./posting.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "db", "migrations");

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

async function testCtx(opts?: { baseCurrency?: string }): Promise<Ctx> {
  const client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  return {
    db: drizzle(client) as unknown as Ctx["db"],
    tenantId: "t_test",
    actor: {
      kind: "user",
      id: "u_test",
      tenantId: "t_test",
      grants: [{ roleKey: "owner", permissions: ["*:*:*"] }]
    },
    requestId: "req_test",
    now: Date.UTC(2026, 5, 15, 12),
    locale: "en",
    policy: PolicyJson.parse({ currency: opts?.baseCurrency ?? "AED" }),
    entitlements: EntitlementsJson.parse({})
  };
}

describe("fxRateFor", () => {
  it("returns PPM (1_000_000) when currency matches tenant base currency", async () => {
    const ctx = await testCtx({ baseCurrency: "AED" });
    const rate = await fxRateFor(ctx, "AED");
    expect(rate).toBe(1_000_000);
  });

  it("returns the most recent stored rate for a foreign currency", async () => {
    const ctx = await testCtx({ baseCurrency: "AED" });
    await ctx.db.insert(schema.ledgerFxRates).values({
      id: "fxr_old",
      tenantId: ctx.tenantId,
      fromCurrency: "USD",
      toCurrency: "AED",
      ratePpm: 3_670_000,
      asOf: "2026-01-01",
      source: "manual"
    });
    await ctx.db.insert(schema.ledgerFxRates).values({
      id: "fxr_new",
      tenantId: ctx.tenantId,
      fromCurrency: "USD",
      toCurrency: "AED",
      ratePpm: 3_680_000,
      asOf: "2026-06-01",
      source: "manual"
    });
    const rate = await fxRateFor(ctx, "USD");
    expect(rate).toBe(3_680_000);
  });

  it("returns undefined when no rate exists for the currency pair", async () => {
    const ctx = await testCtx({ baseCurrency: "AED" });
    const rate = await fxRateFor(ctx, "JPY");
    expect(rate).toBeUndefined();
  });
});
