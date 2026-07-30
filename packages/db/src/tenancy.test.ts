import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");

/**
 * PLAT-001. A table without `tenant_id` is a table the tenancy guard cannot
 * scope, so the rule is checked against the migrated schema rather than trusted
 * to review. Only rows that belong to no tenant are exempt, and each exemption
 * is named here on purpose.
 */
const GLOBAL_TABLES = new Set([
  "core_tenants", // the tenant row itself
  "d1_migrations",
  "sqlite_sequence",
  "_cf_KV"
]);

describe("tenancy", () => {
  it("every persisted table carries tenant_id", async () => {
    const db = createClient({ url: ":memory:" });
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
      for (const sql of readFileSync(join(MIGRATIONS, file), "utf8").split("--> statement-breakpoint")) {
        if (sql.trim()) await db.execute(sql.trim());
      }
    }

    const tables = (await db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")).rows
      .map((r) => String(r.name))
      .filter((n) => !n.startsWith("sqlite_") && !GLOBAL_TABLES.has(n));
    expect(tables.length).toBeGreaterThan(100);

    const missing: string[] = [];
    for (const table of tables) {
      const cols = (await db.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name));
      if (!cols.includes("tenant_id")) missing.push(table);
    }
    expect(missing).toEqual([]);
  });
});
