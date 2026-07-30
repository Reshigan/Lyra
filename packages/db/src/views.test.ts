import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";
import { VIEWS, viewSql } from "./views.js";

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");

function migrationStatements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Migrations + views applied to a real engine. Catches a view that names a
 *  column the schema doesn't have — the only failure mode that matters here. */
describe("views", () => {
  it("apply on a migrated database and are queryable", async () => {
    const db = createClient({ url: ":memory:" });
    for (const sql of migrationStatements()) await db.execute(sql);
    for (const sql of viewSql()) await db.execute(sql);

    for (const name of Object.keys(VIEWS)) {
      const rows = await db.execute(`SELECT * FROM ${name} WHERE tenant_id = 't_none'`);
      expect(rows.rows).toHaveLength(0);
    }
  });
});
