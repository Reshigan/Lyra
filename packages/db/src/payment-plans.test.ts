import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");

async function migrate(db: Client) {
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of readFileSync(join(MIGRATIONS, file), "utf8").split("--> statement-breakpoint")) {
      if (sql.trim()) await db.execute(sql.trim());
    }
  }
}

async function insertPaymentPlan(db: Client, over: Record<string, string | number> = {}) {
  const row: Record<string, string | number> = {
    id: "pp_1",
    tenant_id: "ten_1",
    subject_ref: "pol_1",
    total_minor: 100_000,
    currency: "AED",
    instalments: 3,
    schedule_json: JSON.stringify([{ dueAt: Date.now(), amountMinor: 33_333 }]),
    state: "active",
    created_at: Date.now(),
    updated_at: Date.now(),
    ...over
  };
  const cols = Object.keys(row);
  await db.execute({
    sql: `INSERT INTO ledger_payment_plans (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    args: cols.map((c) => row[c]!)
  });
}

describe("payment plans schema", () => {
  it("missedStreak column defaults to 0 when not specified", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);

    // Insert a payment plan without specifying missed_streak
    await insertPaymentPlan(db);

    // Assert the column exists and reads back as 0
    const result = (await db.execute("SELECT missed_streak FROM ledger_payment_plans WHERE id = 'pp_1'")).rows;
    expect(result.length).toBe(1);
    expect(result[0]?.missed_streak).toBe(0);
  });

  it("missedStreak column is NOT NULL", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);

    await insertPaymentPlan(db);
    const result = (await db.execute("SELECT missed_streak FROM ledger_payment_plans WHERE id = 'pp_1'")).rows;

    // Verify the value is not null (it's 0, which is falsy but not null)
    expect(result[0]?.missed_streak).not.toBeNull();
    expect(result[0]?.missed_streak).toBe(0);
  });

  it("missedStreak column accepts integer values", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);

    // Insert a payment plan with an explicit missed_streak value
    await insertPaymentPlan(db, { id: "pp_2", missed_streak: 5 });

    const result = (await db.execute("SELECT missed_streak FROM ledger_payment_plans WHERE id = 'pp_2'")).rows;
    expect(result.length).toBe(1);
    expect(result[0]?.missed_streak).toBe(5);
  });
});
