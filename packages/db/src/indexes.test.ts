import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");

/** Replay every migration into a fresh in-memory libSQL db (same harness as tenancy.test.ts). */
async function migrated(): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of readFileSync(join(MIGRATIONS, file), "utf8").split("--> statement-breakpoint")) {
      if (sql.trim()) await db.execute(sql.trim());
    }
  }
  return db;
}

describe("uniqueness constraints survive the migrated schema", () => {
  let db: Client;
  beforeAll(async () => {
    db = await migrated();
  });

  it("a soft-deleted user does not block re-inviting the same email", async () => {
    const user = (id: string, deletedAt: number | null) =>
      db.execute({
        sql: "INSERT INTO core_users (id, tenant_id, email, name, created_at, updated_at, deleted_at) VALUES (?, 't1', 'a@x.com', 'A', 1, 1, ?)",
        args: [id, deletedAt]
      });
    await user("u1", 99); // soft-deleted
    await user("u2", null); // re-invite must succeed
    await expect(user("u3", null)).rejects.toThrow(/UNIQUE/i); // live duplicate still blocked
  });

  it("two tenants can each own the same IdP email domain, one tenant cannot own it twice", async () => {
    const idp = (id: string, tenant: string) =>
      db.execute({
        sql: "INSERT INTO core_identity_providers (id, tenant_id, name, email_domain, issuer, created_at, updated_at) VALUES (?, ?, 'Okta', 'shared.example', 'https://iss', 1, 1)",
        args: [id, tenant]
      });
    await idp("i1", "t1");
    await idp("i2", "t2");
    await expect(idp("i3", "t1")).rejects.toThrow(/UNIQUE/i);
  });

  it("a duplicate commission accrual for the same policy and kind fails at the database", async () => {
    const entry = (id: string, kind: string) =>
      db.execute({
        sql: `INSERT INTO dist_commission_entries
                (id, tenant_id, policy_id, provider_id, channel_id, kind, premium_minor,
                 gross_commission_minor, net_commission_minor, currency, created_at, updated_at)
              VALUES (?, 't1', 'pol1', 'prov1', 'ch1', ?, 1000, 100, 90, 'AED', 1, 1)`,
        args: [id, kind]
      });
    await entry("ce1", "new_business");
    await expect(entry("ce2", "new_business")).rejects.toThrow(/UNIQUE/i);
    await entry("ce3", "renewal"); // different kind is a different accrual
    // clawbacks are exempt: one policy may accrue twice (new_business + renewal)
    // and each may be reversed, giving two kind='clawback' rows.
    await entry("cb1", "clawback");
    await entry("cb2", "clawback");
  });

  it("a soft-deleted case ref / channel key / offering code can be reused", async () => {
    const caseRow = (id: string, deletedAt: number | null) =>
      db.execute({
        sql: "INSERT INTO axis_cases (id, tenant_id, ref, kind, created_at, updated_at, deleted_at) VALUES (?, 't1', 'C-1', 'quote', 1, 1, ?)",
        args: [id, deletedAt]
      });
    await caseRow("c1", 99);
    await caseRow("c2", null);
    await expect(caseRow("c3", null)).rejects.toThrow(/UNIQUE/i);

    const channel = (id: string, deletedAt: number | null) =>
      db.execute({
        sql: "INSERT INTO dist_channels (id, tenant_id, key, kind, name_json, created_at, updated_at, deleted_at) VALUES (?, 't1', 'web', 'b2c', '{}', 1, 1, ?)",
        args: [id, deletedAt]
      });
    await channel("ch1", 99);
    await channel("ch2", null);
    await expect(channel("ch3", null)).rejects.toThrow(/UNIQUE/i);

    const offering = (id: string, deletedAt: number | null) =>
      db.execute({
        sql: "INSERT INTO dist_offerings (id, tenant_id, product_id, provider_id, code, name_json, currency, effective_from, created_at, updated_at, deleted_at) VALUES (?, 't1', 'p1', 'prov1', 'MOT-1', '{}', 'AED', 1, 1, 1, ?)",
        args: [id, deletedAt]
      });
    await offering("o1", 99);
    await offering("o2", null);
    await expect(offering("o3", null)).rejects.toThrow(/UNIQUE/i);
  });

  it("the outbox drain query has a matching partial index", async () => {
    const rows = (
      await db.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'core_event_outbox'"
      )
    ).rows.map((r) => String(r.sql));
    expect(
      rows.some((s) => /published_at\s+(IS|is)\s+(NULL|null)/i.test(s) && /created_at/.test(s))
    ).toBe(true);
  });
});
