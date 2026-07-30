import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@lyra/db";
import { seed } from "./seed.js";
import { hashPassword, needsRehash, verifyPassword } from "./password.js";
import { permissionsForRole } from "./rbac.js";
import type { CoreDb } from "./context.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "db", "migrations");

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

describe("password", () => {
  it("round-trips and rejects a wrong password", async () => {
    const stored = await hashPassword("correct-horse-battery");
    expect(await verifyPassword("correct-horse-battery", stored)).toBe(true);
    expect(await verifyPassword("correct-horse-batterz", stored)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
    expect(needsRehash(stored)).toBe(false);
    expect(needsRehash("pbkdf2$1000$aa$bb")).toBe(true);
  });

  it("refuses a short password", async () => {
    await expect(hashPassword("short")).rejects.toThrow(/12 characters/);
  });
});

describe("seed", () => {
  it("provisions GONXT once, with logins, panel and a reconcilable sale", async () => {
    const r = await seed(db, { password: "gonxt-test-password" });
    expect(r.tenantId).toMatch(/^tn_/);

    // Roles carry the real permission catalogue, not an empty list.
    const admin = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.key, "tenant.admin"));
    expect(JSON.parse(admin[0]!.permissionsJson)).toEqual(permissionsForRole("tenant.admin"));

    const user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, "amina.saleh@gonxt.ae"));
    expect(await verifyPassword("gonxt-test-password", user[0]!.passwordHash)).toBe(true);

    // Our own paper sits on the panel alongside the external underwriters.
    const providers = await db.select().from(schema.providers);
    expect(providers.filter((p) => p.isInternal)).toHaveLength(1);
    expect(providers.length).toBeGreaterThan(4);

    // The fan-out shared four comparable quotes and one was bound.
    const responses = await db.select().from(schema.distQuoteResponses);
    expect(responses).toHaveLength(4);

    const [entry] = await db.select().from(schema.distCommissionEntries);
    const [policy] = await db.select().from(schema.axisPolicies);
    expect(entry!.policyId).toBe(policy!.id);
    expect(entry!.grossCommissionMinor).toBe(policy!.commissionMinor);
    expect(entry!.channelCommissionMinor + entry!.taxMinor + entry!.netCommissionMinor).toBe(
      entry!.grossCommissionMinor
    );

    await expect(seed(db)).rejects.toThrow(/already seeded/);
  });
});
