import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { describe, expect, it } from "vitest";
import { claimReserveViolations, reserveAsAt, type ClaimReserveRow } from "./claim-reserves.js";

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");
const DAY = 86_400_000;
const T0 = 1_767_225_600_000; // 2026-01-01

function movement(over: Partial<ClaimReserveRow> & { seq: number }): ClaimReserveRow {
  const previousMinor = over.previousMinor ?? 0;
  const amountMinor = over.amountMinor ?? 0;
  return {
    head: "indemnity",
    setAt: T0,
    deltaMinor: amountMinor - previousMinor,
    ...over,
    previousMinor,
    amountMinor
  };
}

async function migrate(db: Client) {
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of readFileSync(join(MIGRATIONS, file), "utf8").split("--> statement-breakpoint")) {
      if (sql.trim()) await db.execute(sql.trim());
    }
  }
}

async function insertReserve(db: Client, over: Record<string, string | number> = {}) {
  const row: Record<string, string | number> = {
    id: "clr_1",
    tenant_id: "ten_1",
    claim_id: "clm_1",
    seq: 1,
    head: "indemnity",
    amount_minor: 500_000,
    previous_minor: 0,
    delta_minor: 500_000,
    currency: "AED",
    basis: "desk_estimate",
    set_by: "usr_1",
    set_at: T0,
    created_at: T0,
    ...over
  };
  const cols = Object.keys(row);
  await db.execute({
    sql: `INSERT INTO axis_claim_reserves (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    args: cols.map((c) => row[c]!)
  });
}

describe("claim reserve invariants", () => {
  it("reserve history is append-only", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    await insertReserve(db);

    // §C.4: no UPDATE, no DELETE. A reserve that can be edited in place cannot
    // answer "what did we think this claim was worth in March", which is the
    // only reason the table exists — and it is how reserve fraud hides.
    await expect(
      db.execute("UPDATE axis_claim_reserves SET amount_minor = 1 WHERE id = 'clr_1'")
    ).rejects.toThrow(/append-only/);
    await expect(
      db.execute("DELETE FROM axis_claim_reserves WHERE id = 'clr_1'")
    ).rejects.toThrow(/append-only/);

    const after = (await db.execute("SELECT amount_minor FROM axis_claim_reserves")).rows;
    expect(after.length).toBe(1);
    expect(Number(after[0]!.amount_minor)).toBe(500_000);

    // A correction is a new movement, not an edit.
    await insertReserve(db, { id: "clr_2", seq: 2, previous_minor: 500_000, amount_minor: 1, delta_minor: -499_999 });
    expect((await db.execute("SELECT id FROM axis_claim_reserves")).rows.length).toBe(2);
  });

  it("claims.reserveMinor equals the sum of the latest row per head", () => {
    const rows = [
      movement({ seq: 1, amountMinor: 500_000 }),
      movement({ seq: 2, previousMinor: 500_000, amountMinor: 750_000, setAt: T0 + 30 * DAY }),
      movement({ head: "expense", seq: 1, amountMinor: 40_000, setAt: T0 + 5 * DAY })
    ];
    expect(claimReserveViolations({ reserveMinor: 790_000 }, rows)).toEqual([]);

    // Summing every row instead of the latest per head double-counts the
    // superseded estimate — the denormalized head then reads 1,290,000.
    expect(claimReserveViolations({ reserveMinor: 1_290_000 }, rows).join("|")).toContain(
      "head.reserveMinor 1290000 != 790000"
    );

    // The chain has to reconcile too: previousMinor links to the prior row and
    // deltaMinor is the difference, or the movement history lies about who moved it.
    const brokenLink = [rows[0]!, { ...rows[1]!, previousMinor: 0, deltaMinor: 750_000 }];
    expect(claimReserveViolations({ reserveMinor: 750_000 }, brokenLink).join("|")).toContain(
      "indemnity seq 2 opens at 0 but seq 1 closed at 500000"
    );

    const brokenDelta = [{ ...rows[0]!, deltaMinor: 1 }];
    expect(claimReserveViolations({ reserveMinor: 500_000 }, brokenDelta).join("|")).toContain(
      "indemnity seq 1 delta 1 != 500000 - 0"
    );

    // Dense from 1 per head: a missing seq means a movement was lost.
    const gapped = [rows[0]!, { ...rows[1]!, seq: 3 }];
    expect(claimReserveViolations({ reserveMinor: 750_000 }, gapped).join("|")).toContain(
      "indemnity seq is not dense from 1"
    );

    expect(claimReserveViolations({ reserveMinor: 0 }, [])).toEqual([]);
    expect(claimReserveViolations({ reserveMinor: 1 }, []).join("|")).toContain("head.reserveMinor 1 != 0");
  });

  it("reserve as at a past date reads the history, not the head", () => {
    const rows = [
      movement({ seq: 1, amountMinor: 100_000 }),
      movement({ seq: 2, previousMinor: 100_000, amountMinor: 900_000, setAt: T0 + 60 * DAY }),
      movement({ head: "expense", seq: 1, amountMinor: 20_000, setAt: T0 + 90 * DAY })
    ];

    // Before anything was set the claim was reserved at nil.
    expect(reserveAsAt(rows, T0 - 1)).toBe(0);
    // The triangle for month 1 must see 100,000, not today's 920,000.
    expect(reserveAsAt(rows, T0 + 30 * DAY)).toBe(100_000);
    // Boundary: a movement set exactly at the as-at instant counts.
    expect(reserveAsAt(rows, T0 + 60 * DAY)).toBe(900_000);
    expect(reserveAsAt(rows, T0 + 89 * DAY)).toBe(900_000);
    expect(reserveAsAt(rows, T0 + 90 * DAY)).toBe(920_000);
    // Today's number agrees with the denormalized head.
    expect(reserveAsAt(rows, T0 + 365 * DAY)).toBe(920_000);
    expect(claimReserveViolations({ reserveMinor: reserveAsAt(rows, T0 + 365 * DAY) }, rows)).toEqual([]);

    // Rows out of setAt order (a backdated assessor estimate loaded after a desk
    // one) resolve by seq, not by insertion order.
    const shuffled = [rows[2]!, rows[1]!, rows[0]!];
    expect(reserveAsAt(shuffled, T0 + 30 * DAY)).toBe(100_000);
  });
});
