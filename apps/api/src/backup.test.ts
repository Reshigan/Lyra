import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson } from "@lyra/db";
import type { Ctx } from "@lyra/core";
import { backupTenant } from "./engines/backup.js";

// docs/10 §6: nightly D1 -> R2 backup. One check: the dump carries a tenant's
// own rows, in every table that has them, and never another tenant's.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

const NOW = Date.UTC(2026, 5, 15, 12);
let ctx: Ctx;
let stored: Map<string, Uint8Array>;

const bucket = {
  put: async (key: string, bytes: string) => {
    stored.set(key, new TextEncoder().encode(bytes));
  }
} as unknown as R2Bucket;

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  for (const stmt of statements()) await client.execute(stmt);
  stored = new Map();
  await client.execute({
    sql: `insert into core_users (id, tenant_id, email, name, locale, status, auth_provider, mfa_enrolled, created_at, updated_at)
          values ('u_a','t_a','a@test','A','en','active','password',0,?,?),
                 ('u_b','t_b','b@test','B','en','active','password',0,?,?)`,
    args: [NOW, NOW, NOW, NOW]
  });
  ctx = {
    db: drizzle(client) as unknown as Ctx["db"],
    tenantId: "t_a",
    actor: { kind: "system", id: "scheduler", tenantId: "t_a", grants: [] },
    requestId: "req_test",
    now: NOW,
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  };
});

describe("backupTenant", () => {
  it("dumps the tenant's own rows and none of another tenant's", async () => {
    await backupTenant(ctx, bucket);
    const key = `backups/t_a/${new Date(NOW).toISOString().slice(0, 10)}.json`;
    const dump = JSON.parse(new TextDecoder().decode(stored.get(key)));
    const users = dump.core_users as Array<{ id: string; tenantId: string }>;
    expect(users.map((u) => u.id)).toEqual(["u_a"]);
    expect(users.every((u) => u.tenantId === "t_a")).toBe(true);
  });

  it("no-ops without a bucket bound", async () => {
    await expect(backupTenant(ctx, undefined)).resolves.toBeUndefined();
  });
});
