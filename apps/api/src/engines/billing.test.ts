import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PolicyJson, EntitlementsJson, schema } from "@lyra/db";
import { permissionsForRole, type Actor, type Ctx } from "@lyra/core";
import { recordUsage, invoiceNumber } from "./billing.js";

// Group C revenue lines (docs/specs revenue lines full build design, task 3):
// recordUsage() had no real writer, only the schema and a hand-fixtured seed
// row. This covers it actually upserting the period's usage-meter row,
// accumulating across calls, and refusing to double-count a replayed
// idempotency key.

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

describe("recordUsage", () => {
  beforeEach(async () => {
    client = createClient({ url: ":memory:" });
    for (const sql of statements()) await client.execute(sql);
    ctx = await makeCtx();
  });

  it("creates a usage meter row on first call and posts USAGE-METER", async () => {
    const result = await recordUsage(ctx, {
      subscriptionId: "sub1",
      meter: "api-calls",
      period: "2026-08",
      delta: 100,
      includedQuantity: 1000,
      idempotencyKey: "usage:sub1:api-calls:2026-08:1"
    });
    expect(result.quantity).toBe(100);

    const [row] = await ctx.db
      .select()
      .from(schema.ledgerUsageMeters)
      .where(
        and(
          eq(schema.ledgerUsageMeters.tenantId, ctx.tenantId),
          eq(schema.ledgerUsageMeters.id, result.meterId)
        )
      );
    expect(row?.quantity).toBe(100);

    const [txn] = await ctx.db
      .select()
      .from(schema.ledgerTxns)
      .where(
        and(eq(schema.ledgerTxns.tenantId, ctx.tenantId), eq(schema.ledgerTxns.idempotencyKey, "usage:sub1:api-calls:2026-08:1"))
      );
    expect(txn?.type).toBe("USAGE-METER");
    expect(txn?.state).toBe("settled");
  });

  it("accumulates delta across calls in the same period", async () => {
    await recordUsage(ctx, {
      subscriptionId: "sub1",
      meter: "api-calls",
      period: "2026-08",
      delta: 100,
      idempotencyKey: "usage:sub1:api-calls:2026-08:1"
    });
    const second = await recordUsage(ctx, {
      subscriptionId: "sub1",
      meter: "api-calls",
      period: "2026-08",
      delta: 50,
      idempotencyKey: "usage:sub1:api-calls:2026-08:2"
    });
    expect(second.quantity).toBe(150);
  });

  it("is idempotent on a replayed key — does not double-increment", async () => {
    await recordUsage(ctx, {
      subscriptionId: "sub1",
      meter: "api-calls",
      period: "2026-08",
      delta: 100,
      idempotencyKey: "usage:sub1:api-calls:2026-08:1"
    });
    const replay = await recordUsage(ctx, {
      subscriptionId: "sub1",
      meter: "api-calls",
      period: "2026-08",
      delta: 100,
      idempotencyKey: "usage:sub1:api-calls:2026-08:1"
    });
    expect(replay.quantity).toBe(100);
  });
});

describe("invoiceNumber", () => {
  it("derives a stable, human-readable number from id and timestamp", () => {
    const n = invoiceNumber("inv_abcdef123456", Date.parse("2026-08-17T00:00:00Z"));
    expect(n).toMatch(/^INV-\d{8}-123456$/);
  });
});
