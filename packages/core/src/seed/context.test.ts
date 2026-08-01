import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { schema } from "@lyra/db";
import { accountByCode, DAY, HOUR, MINUTE, type SeedContext } from "./context.js";
import type { CoreDb } from "../context.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "db", "migrations");

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

let client: Client;
let db: CoreDb;

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  db = drizzle(client) as unknown as CoreDb;
});

describe("time constants", () => {
  it("expresses DAY, HOUR and MINUTE in exact milliseconds", () => {
    expect(MINUTE).toBe(60_000);
    expect(HOUR).toBe(60 * MINUTE);
    expect(HOUR).toBe(3_600_000);
    expect(DAY).toBe(24 * HOUR);
    expect(DAY).toBe(86_400_000);
  });
});

describe("accountByCode", () => {
  it("resolves a ledger account's id from its chart code, scoped to the tenant", async () => {
    const now = 1_700_000_000_000;
    await db.insert(schema.tenants).values({
      id: "tn_1",
      slug: "gonxt",
      name: "GONXT",
      createdAt: now,
      updatedAt: now
    });
    await db.insert(schema.ledgerAccounts).values([
      {
        id: "la_1100",
        tenantId: "tn_1",
        code: "1100",
        nameJson: JSON.stringify({ en: "Cash" }),
        type: "asset",
        normalSide: "debit",
        createdAt: now
      },
      // Same code under a different tenant must not resolve for tn_1.
      {
        id: "la_other",
        tenantId: "tn_2",
        code: "1100",
        nameJson: JSON.stringify({ en: "Cash" }),
        type: "asset",
        normalSide: "debit",
        createdAt: now
      }
    ]);

    const ctx = { db, now, tenantId: "tn_1" } as SeedContext;
    expect(await accountByCode(ctx, "1100")).toBe("la_1100");
  });

  it("throws with the missing code named, when no account matches", async () => {
    const ctx = { db, now: 1, tenantId: "tn_1" } as SeedContext;
    await expect(accountByCode(ctx, "9999")).rejects.toThrow(/seed: no ledger account 9999/);
  });

  it("does not resolve another tenant's account of the same code", async () => {
    const now = 1_700_000_000_000;
    await db.insert(schema.ledgerAccounts).values({
      id: "la_1",
      tenantId: "tn_2",
      code: "1200",
      nameJson: JSON.stringify({ en: "Cash" }),
      type: "asset",
      normalSide: "debit",
      createdAt: now
    });
    const ctx = { db, now, tenantId: "tn_1" } as SeedContext;
    await expect(accountByCode(ctx, "1200")).rejects.toThrow(/seed: no ledger account 1200/);
  });
});
