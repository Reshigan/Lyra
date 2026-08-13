import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { schema } from "@lyra/db";
import type { CoreDb } from "../context.js";
import { seedHistory } from "./history.js";
import { DAY } from "./context.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "db", "migrations");

function migrationStatements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

const NOW = Date.UTC(2026, 7, 12, 8, 0, 0);
const TENANT = "t_history_test";
const DAYS = 120;

let client: Client;
let db: CoreDb;

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of migrationStatements()) await client.execute(sql);
  db = drizzle(client) as unknown as CoreDb;
});

/** The three months the core seed opens, so the backfill has an anchor to age against. */
async function seedPeriods(): Promise<void> {
  for (const delta of [-1, 0]) {
    const start = Date.UTC(2026, 7 + delta, 1);
    await db.insert(schema.ledgerPeriods).values({
      id: `per_${delta}`,
      tenantId: TENANT,
      code: new Date(start).toISOString().slice(0, 7),
      startAt: start,
      endAt: Date.UTC(2026, 8 + delta, 1) - 1,
      state: "open",
      checklistJson: null,
      closePackFileId: null,
      closedBy: null,
      closedAt: null
    });
  }
}

describe("seedHistory", () => {
  it("writes a transaction history across the whole window", async () => {
    await seedPeriods();
    const result = await seedHistory(db, TENANT, { days: DAYS, now: NOW });

    expect(result.daysWritten).toBe(DAYS);
    expect(result.daysSkipped).toBe(0);
    expect(result.txns).toBe(DAYS * 2 * 3);
    expect(result.batches).toBe(result.txns);

    const txns = await db.select().from(schema.ledgerTxns).where(eq(schema.ledgerTxns.tenantId, TENANT));
    expect(txns).toHaveLength(DAYS * 2 * 3);
    // Every posting lands inside the window and is settled — a trend line drawn
    // over this book has a point on every day of it.
    for (const txn of txns) {
      expect(txn.state).toBe("settled");
      expect(txn.createdAt).toBeGreaterThan(NOW - (DAYS + 1) * DAY);
      expect(txn.createdAt).toBeLessThanOrEqual(NOW);
    }
    const days = new Set(txns.map((t) => new Date(t.createdAt).toISOString().slice(0, 10)));
    expect(days.size).toBe(DAYS);
  });

  it("creates the periods the window reaches back into, closed if they predate the book", async () => {
    await seedPeriods();
    const result = await seedHistory(db, TENANT, { days: DAYS, now: NOW });

    // 120 days back from 12 Aug is 14 Apr: Apr, May, Jun are missing (Jul, Aug exist).
    expect(result.periodsCreated).toBe(3);
    const periods = await db.select().from(schema.ledgerPeriods).where(eq(schema.ledgerPeriods.tenantId, TENANT));
    const byCode = new Map(periods.map((p) => [p.code, p]));
    expect([...byCode.keys()].sort()).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
    for (const code of ["2026-04", "2026-05", "2026-06"]) {
      expect(byCode.get(code)!.state).toBe("hard_closed");
      expect(byCode.get(code)!.closedAt).not.toBeNull();
    }

    // Every batch is filed against a real period — an orphan batch never
    // appears in a close pack and silently drops out of the trial balance.
    const batches = await db.select().from(schema.ledgerJournalBatches).where(eq(schema.ledgerJournalBatches.tenantId, TENANT));
    for (const batch of batches) expect(periods.some((p) => p.id === batch.periodId)).toBe(true);
  });

  it("balances every batch it posts", async () => {
    await seedPeriods();
    await seedHistory(db, TENANT, { days: DAYS, now: NOW });

    const lines = await db.select().from(schema.ledgerJournalLines).where(eq(schema.ledgerJournalLines.tenantId, TENANT));
    const sums = new Map<string, { debit: number; credit: number }>();
    for (const line of lines) {
      const s = sums.get(line.batchId) ?? { debit: 0, credit: 0 };
      if (line.side === "debit") s.debit += line.amountMinor;
      else s.credit += line.amountMinor;
      // Base currency equals txn currency here, so a divergence means the
      // base leg was computed from the wrong amount.
      expect(line.baseAmountMinor).toBe(line.amountMinor);
      sums.set(line.batchId, s);
    }
    expect(sums.size).toBeGreaterThan(0);
    for (const [batchId, s] of sums) expect(`${batchId}:${s.debit}`).toBe(`${batchId}:${s.credit}`);

    const batches = await db.select().from(schema.ledgerJournalBatches).where(eq(schema.ledgerJournalBatches.tenantId, TENANT));
    for (const batch of batches) {
      expect(batch.totalDebitMinor).toBe(batch.totalCreditMinor);
      expect(batch.baseTotalDebitMinor).toBe(batch.totalDebitMinor);
    }
  });

  it("never lets client money fall below the liability it segregates", async () => {
    await seedPeriods();
    await seedHistory(db, TENANT, { days: DAYS, now: NOW });

    // docs/19 §5: 1010 (cash held for clients) ≥ 2010 (what is owed to them),
    // checked after every single posting rather than only at the end — a
    // remittance that ran before its collection would balance but breach.
    const lines = await db.select().from(schema.ledgerJournalLines).where(eq(schema.ledgerJournalLines.tenantId, TENANT));
    lines.sort((a, b) => a.postedAt - b.postedAt || a.seq - b.seq);
    let cash = 0;
    let owed = 0;
    for (const line of lines) {
      const signed = line.side === "debit" ? line.amountMinor : -line.amountMinor;
      if (line.accountCode === "1010") cash += signed;
      if (line.accountCode === "2010") owed -= signed; // liability: credit increases it
      expect(cash).toBeGreaterThanOrEqual(owed);
    }
  });

  it("rolls the account balance cache forward instead of overwriting it", async () => {
    await seedPeriods();
    const opening = 500_000;
    await db.insert(schema.ledgerAccountBalances).values({
      id: "bal_seed_1000",
      tenantId: TENANT,
      accountCode: "1000",
      currency: "AED",
      debitMinor: opening,
      creditMinor: 0,
      baseDebitMinor: opening,
      baseCreditMinor: 0,
      updatedAt: NOW - 400 * DAY
    });

    await seedHistory(db, TENANT, { days: DAYS, now: NOW });

    const lines = await db.select().from(schema.ledgerJournalLines).where(eq(schema.ledgerJournalLines.tenantId, TENANT));
    const posted = lines
      .filter((l) => l.accountCode === "1000" && l.side === "debit")
      .reduce((n, l) => n + l.amountMinor, 0);
    expect(posted).toBeGreaterThan(0);

    const [balance] = await db
      .select()
      .from(schema.ledgerAccountBalances)
      .where(and(eq(schema.ledgerAccountBalances.tenantId, TENANT), eq(schema.ledgerAccountBalances.accountCode, "1000")));
    expect(balance!.debitMinor).toBe(opening + posted);
    expect(balance!.baseDebitMinor).toBe(opening + posted);
    expect(balance!.id).toBe("bal_seed_1000");
  });

  it("is a no-op on a second run against the same window", async () => {
    await seedPeriods();
    await seedHistory(db, TENANT, { days: DAYS, now: NOW });
    const before = await db.select().from(schema.ledgerTxns).where(eq(schema.ledgerTxns.tenantId, TENANT));

    // Re-running is how a half-finished remote seed is resumed, so it has to be
    // safe rather than merely tolerated.
    const again = await seedHistory(db, TENANT, { days: DAYS, now: NOW });
    expect(again.daysWritten).toBe(0);
    expect(again.daysSkipped).toBe(DAYS);
    expect(again.txns).toBe(0);
    expect(again.periodsCreated).toBe(0);

    const after = await db.select().from(schema.ledgerTxns).where(eq(schema.ledgerTxns.tenantId, TENANT));
    expect(after).toHaveLength(before.length);
  });

  it("extends a window that already covers part of the range", async () => {
    await seedPeriods();
    await seedHistory(db, TENANT, { days: 30, now: NOW });
    const wider = await seedHistory(db, TENANT, { days: DAYS, now: NOW });

    expect(wider.daysWritten).toBe(DAYS - 30);
    expect(wider.daysSkipped).toBe(30);
    const txns = await db.select().from(schema.ledgerTxns).where(eq(schema.ledgerTxns.tenantId, TENANT));
    expect(txns).toHaveLength(DAYS * 2 * 3);
  });

  it("measures every day it writes, so the metric screens open on the same book", async () => {
    await seedPeriods();
    const result = await seedHistory(db, TENANT, { days: DAYS, now: NOW });

    // One unit-economics row per trading day: the home KPI wall reads this
    // table for the last 30 days and shows nothing without it.
    const econ = await db.select().from(schema.unitEconomics).where(eq(schema.unitEconomics.tenantId, TENANT));
    expect(econ).toHaveLength(DAYS);
    expect(result.unitEconomics).toBe(DAYS);
    expect(econ.every((r) => r.volume === 2 && r.revenueMinor > 0)).toBe(true);

    const snaps = await db.select().from(schema.northSnapshots).where(eq(schema.northSnapshots.tenantId, TENANT));
    // Four daily metrics on every day, eight monthly ones on each month touched.
    const months = new Set(snaps.filter((s) => s.grain === "month").map((s) => s.period));
    expect(snaps.filter((s) => s.grain === "day")).toHaveLength(DAYS * 4);
    expect(snaps.filter((s) => s.grain === "month")).toHaveLength(months.size * 8);
    expect(result.snapshots).toBe(snaps.length);

    // The measurements are the postings, not a parallel invention: the month's
    // gwp is the premium the ledger actually collected in it, net of tax.
    const august = snaps.find((s) => s.metricKey === "gwp" && s.period === "2026-08")!;
    const lines = await db
      .select()
      .from(schema.ledgerJournalLines)
      .where(and(eq(schema.ledgerJournalLines.tenantId, TENANT), eq(schema.ledgerJournalLines.accountCode, "1010")));
    const collectedInAugust = lines
      .filter((l) => l.side === "debit" && new Date(l.postedAt).toISOString().startsWith("2026-08"))
      .reduce((n, l) => n + l.amountMinor, 0);
    // Gross collected is premium + 5% VAT; gwp is the premium alone.
    expect(august.value).toBe(Math.round(collectedInAugust / 1.05));
  });

  it("does not duplicate measurements on a second run", async () => {
    await seedPeriods();
    await seedHistory(db, TENANT, { days: 30, now: NOW });
    const again = await seedHistory(db, TENANT, { days: 30, now: NOW });

    expect(again.unitEconomics).toBe(0);
    expect(again.snapshots).toBe(0);
    const econ = await db.select().from(schema.unitEconomics).where(eq(schema.unitEconomics.tenantId, TENANT));
    expect(econ).toHaveLength(30);
  });

  it("stays inside one tenant", async () => {
    await seedPeriods();
    await seedHistory(db, TENANT, { days: 10, now: NOW });
    const others = await db.select().from(schema.ledgerTxns).where(eq(schema.ledgerTxns.tenantId, "t_other"));
    expect(others).toEqual([]);
  });
});
