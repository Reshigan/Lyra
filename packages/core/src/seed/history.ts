import { and, eq, inArray } from "drizzle-orm";
import { id, schema } from "@lyra/db";
import { applyPpm } from "../commission.js";
import { DAY, HOUR, MINUTE } from "./context.js";
import type { CoreDb } from "../context.js";

// docs/19 — the trading history the demo book implies. `seed.ts` writes the one
// sale the whole product tells a story about; this writes the months of ordinary
// days around it, so trend lines, period closes and reconciliation screens open
// on a book with a past instead of a fortnight of fixtures.
//
// Additive and re-runnable: it is applied to an already-seeded tenant (staging,
// production), skips days it has already written, and never touches a row the
// core seed owns. The two ledger invariants hold for every day it writes —
// each batch balances, and client money (1010) never falls below the liability
// it segregates (2010), because the only lines that touch either move both.

const BASE = "AED";

/** One trading day, three transactions: money in, commission earned, money out. */
const SALES_PER_DAY = 2;

export interface HistoryOptions {
  /** How many days back from `now` to write. */
  days: number;
  /** The clock. Never `Date.now()` inside, so a re-run is deterministic. */
  now: number;
  /** Actor for the postings — a finance user id where one is known. */
  postedBy?: string | undefined;
}

export interface HistoryResult {
  daysWritten: number;
  daysSkipped: number;
  txns: number;
  batches: number;
  periodsCreated: number;
}

interface Line {
  code: string;
  side: "debit" | "credit";
  amountMinor: number;
  memo: string;
}

interface Posting {
  type: string;
  idempotencyKey: string;
  correlationId: string;
  actorKind: string;
  actorId: string;
  grossMinor: number;
  amounts: Record<string, number>;
  at: number;
  lines: readonly Line[];
}

/**
 * D1 binds at most 100 parameters per statement, so a thousand-row insert has to
 * arrive as many small ones. Sized off the widest table rather than per call.
 */
const CHUNK = 3;

async function insertChunked<T>(
  insert: (rows: T[]) => Promise<unknown>,
  rows: readonly T[],
  size = CHUNK
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

const monthCode = (at: number): string => new Date(at).toISOString().slice(0, 7);
const monthStartOf = (at: number): number => {
  const d = new Date(at);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};
const nextMonthStart = (at: number): number => {
  const d = new Date(at);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
};

/** A day's premium, spread over a plausible range without a random source. */
function premiumFor(dayIndex: number, sale: number): number {
  return 120_000 + (((dayIndex * 7919 + sale * 3301) % 69) * 5_000);
}

export async function seedHistory(
  db: CoreDb,
  tenantId: string,
  options: HistoryOptions
): Promise<HistoryResult> {
  const { days, now } = options;
  if (days < 1) throw new Error("seedHistory: days must be at least 1");
  const postedBy = options.postedBy ? `user:${options.postedBy}` : "system:backfill";

  let seq = 0;
  const nid = (prefix: string): string => id(prefix, now + seq++);

  /* ------------------------------------------------------------- the window */
  const first = now - days * DAY;
  const postings: Posting[] = [];
  for (let dayIndex = days; dayIndex >= 1; dayIndex--) {
    // Anchored to UTC midnight, not to `now` minus a multiple of a day: a
    // posting six hours after an afternoon start lands on tomorrow's date, and
    // a day-by-day chart would show two thin days instead of one full one.
    const midnight = new Date(now - dayIndex * DAY).setUTCHours(0, 0, 0, 0);
    const dayKey = new Date(midnight).toISOString().slice(0, 10);
    for (let sale = 0; sale < SALES_PER_DAY; sale++) {
      const premiumMinor = premiumFor(dayIndex, sale);
      const taxMinor = applyPpm(premiumMinor, 50_000); // 5% VAT, AE standard rate
      const grossMinor = premiumMinor + taxMinor;
      const commissionMinor = applyPpm(premiumMinor, 150_000); // 15%, the motor rate
      const ref = `${dayKey}:${sale}`;
      const at = midnight + (9 + sale * 3) * HOUR;

      postings.push(
        {
          // The customer pays. Their money sits segregated until the insurer is paid.
          type: "PREM-COLLECT",
          idempotencyKey: `history:prem-collect:${ref}`,
          correlationId: `history:sale:${ref}`,
          actorKind: "customer",
          actorId: `history:${ref}`,
          grossMinor,
          amounts: { gross: grossMinor, net: premiumMinor, tax: taxMinor },
          at,
          lines: [
            { code: "1010", side: "debit", amountMinor: grossMinor, memo: `Premium collected ${ref}` },
            { code: "2010", side: "credit", amountMinor: grossMinor, memo: `Client money held ${ref}` }
          ]
        },
        {
          // Commission is earned on issue, so it accrues before anyone pays it.
          type: "CMSN-ACCR",
          idempotencyKey: `history:cmsn-accr:${ref}`,
          correlationId: `history:sale:${ref}`,
          actorKind: "system",
          actorId: "scheduler",
          grossMinor: commissionMinor,
          amounts: { gross: commissionMinor, net: commissionMinor, tax: 0 },
          at: at + 5 * MINUTE,
          lines: [
            { code: "1100", side: "debit", amountMinor: commissionMinor, memo: `Commission receivable ${ref}` },
            { code: "4000", side: "credit", amountMinor: commissionMinor, memo: `Commission earned ${ref}` }
          ]
        },
        {
          // Settlement day: the insurer is paid out of client money and the
          // commission moves to the operating account, clearing the receivable.
          // Both client-money legs move together, so 1010 ≥ 2010 still holds.
          type: "PREM-REMIT",
          idempotencyKey: `history:prem-remit:${ref}`,
          correlationId: `history:sale:${ref}`,
          actorKind: "user",
          actorId: options.postedBy ?? "system",
          grossMinor,
          amounts: { gross: grossMinor, commission: commissionMinor, net: grossMinor - commissionMinor },
          at: at + 6 * HOUR,
          lines: [
            { code: "2010", side: "debit", amountMinor: grossMinor, memo: `Client money released ${ref}` },
            { code: "1000", side: "debit", amountMinor: commissionMinor, memo: `Commission received ${ref}` },
            { code: "1010", side: "credit", amountMinor: grossMinor, memo: `Remitted to insurer ${ref}` },
            { code: "1100", side: "credit", amountMinor: commissionMinor, memo: `Receivable cleared ${ref}` }
          ]
        }
      );
    }
  }

  /* ------------------------------------------------- skip what already exists */
  const wanted = postings.map((p) => p.idempotencyKey);
  const seen = new Set<string>();
  for (let i = 0; i < wanted.length; i += 20) {
    const rows = await db
      .select({ key: schema.ledgerTxns.idempotencyKey })
      .from(schema.ledgerTxns)
      .where(and(eq(schema.ledgerTxns.tenantId, tenantId), inArray(schema.ledgerTxns.idempotencyKey, wanted.slice(i, i + 20))));
    for (const row of rows) seen.add(row.key);
  }
  const fresh = postings.filter((p) => !seen.has(p.idempotencyKey));
  const dayOf = (p: Posting): string => p.correlationId.slice("history:sale:".length, "history:sale:".length + 10);
  const freshDays = new Set(fresh.map(dayOf));
  const allDays = new Set(postings.map(dayOf));
  if (fresh.length === 0) {
    return { daysWritten: 0, daysSkipped: allDays.size, txns: 0, batches: 0, periodsCreated: 0 };
  }

  /* ------------------------------------------------------------- the periods */
  // A batch with no period is a NOT NULL violation, and the months this backfill
  // reaches are older than the three the core seed opens.
  const existing = await db
    .select({ id: schema.ledgerPeriods.id, code: schema.ledgerPeriods.code })
    .from(schema.ledgerPeriods)
    .where(eq(schema.ledgerPeriods.tenantId, tenantId));
  const periodIds = new Map(existing.map((p) => [p.code, p.id]));
  const oldestExisting = existing.map((p) => p.code).sort()[0];

  let periodsCreated = 0;
  for (let start = monthStartOf(first); start <= now; start = nextMonthStart(start)) {
    const code = monthCode(start);
    if (periodIds.has(code)) continue;
    // Months that end before the book the core seed opens are history: closed,
    // with the same checklist a real close writes.
    const closed = oldestExisting !== undefined && code < oldestExisting;
    const periodId = nid("per");
    await db.insert(schema.ledgerPeriods).values({
      id: periodId,
      tenantId,
      code,
      startAt: start,
      endAt: nextMonthStart(start) - 1,
      state: closed ? "hard_closed" : "open",
      checklistJson: closed
        ? JSON.stringify([
            { name: `trial_balance_zero@${code}`, ok: true },
            { name: `no_pending_external@${code}`, ok: true },
            { name: `no_open_client_money_breach@${code}`, ok: true }
          ])
        : null,
      closePackFileId: null,
      closedBy: closed ? postedBy : null,
      closedAt: closed ? nextMonthStart(start) + 5 * DAY : null
    });
    periodIds.set(code, periodId);
    periodsCreated += 1;
  }

  /* ---------------------------------------------------------- the postings */
  const txnRows: (typeof schema.ledgerTxns.$inferInsert)[] = [];
  const batchRows: (typeof schema.ledgerJournalBatches.$inferInsert)[] = [];
  const lineRows: (typeof schema.ledgerJournalLines.$inferInsert)[] = [];
  const transitionRows: (typeof schema.ledgerTxnTransitions.$inferInsert)[] = [];
  const deltas = new Map<string, { debitMinor: number; creditMinor: number }>();

  for (const p of fresh) {
    const txnId = nid("txn");
    const batchId = nid("jbt");
    const code = monthCode(p.at);
    const periodId = periodIds.get(code);
    if (!periodId) throw new Error(`seedHistory: no ledger period ${code}`);

    const debit = p.lines.filter((l) => l.side === "debit").reduce((n, l) => n + l.amountMinor, 0);
    const credit = p.lines.filter((l) => l.side === "credit").reduce((n, l) => n + l.amountMinor, 0);
    // Asserted, not assumed: an unbalanced batch would surface later as a ledger
    // property-test failure that says nothing about which day wrote it.
    if (debit !== credit) throw new Error(`seedHistory: ${p.idempotencyKey} does not balance (${debit}/${credit})`);

    txnRows.push({
      id: txnId,
      tenantId,
      type: p.type,
      idempotencyKey: p.idempotencyKey,
      correlationId: p.correlationId,
      state: "settled",
      actorKind: p.actorKind,
      actorId: p.actorId,
      currency: BASE,
      baseCurrency: BASE,
      fxRatePpm: 1_000_000,
      amountsJson: JSON.stringify(p.amounts),
      grossMinor: p.grossMinor,
      baseGrossMinor: p.grossMinor,
      ledgerBatchId: batchId,
      createdAt: p.at,
      updatedAt: p.at + MINUTE,
      settledAt: p.at + MINUTE
    });

    batchRows.push({
      id: batchId,
      tenantId,
      txnId,
      periodId,
      currency: BASE,
      baseCurrency: BASE,
      fxRatePpm: 1_000_000,
      totalDebitMinor: debit,
      totalCreditMinor: credit,
      baseTotalDebitMinor: debit,
      baseTotalCreditMinor: credit,
      postedBy,
      postedAt: p.at
    });

    p.lines.forEach((l, i) => {
      lineRows.push({
        id: nid("jln"),
        tenantId,
        batchId,
        txnId,
        seq: i + 1,
        accountCode: l.code,
        side: l.side,
        amountMinor: l.amountMinor,
        currency: BASE,
        baseAmountMinor: l.amountMinor,
        baseCurrency: BASE,
        memo: l.memo,
        dimsJson: null,
        postedAt: p.at
      });
      const d = deltas.get(l.code) ?? { debitMinor: 0, creditMinor: 0 };
      if (l.side === "debit") d.debitMinor += l.amountMinor;
      else d.creditMinor += l.amountMinor;
      deltas.set(l.code, d);
    });

    ["initiated", "settled"].forEach((to, i) => {
      transitionRows.push({
        id: nid("txt"),
        tenantId,
        txnId,
        fromState: i === 0 ? null : "initiated",
        toState: to,
        actorRef: postedBy,
        reason: null,
        ts: p.at + i * MINUTE
      });
    });
  }

  await insertChunked((rows) => db.insert(schema.ledgerTxns).values(rows), txnRows);
  await insertChunked((rows) => db.insert(schema.ledgerJournalBatches).values(rows), batchRows, 5);
  await insertChunked((rows) => db.insert(schema.ledgerJournalLines).values(rows), lineRows, 6);
  await insertChunked((rows) => db.insert(schema.ledgerTxnTransitions).values(rows), transitionRows, 12);

  /* ----------------------------------------------------------- the balances */
  // Balances are a cache of the lines, so they are added to rather than replaced:
  // the core seed's own postings are already in the row this backfill finds.
  for (const [accountCode, delta] of deltas) {
    const [row] = await db
      .select()
      .from(schema.ledgerAccountBalances)
      .where(
        and(
          eq(schema.ledgerAccountBalances.tenantId, tenantId),
          eq(schema.ledgerAccountBalances.accountCode, accountCode),
          eq(schema.ledgerAccountBalances.currency, BASE)
        )
      )
      .limit(1);
    if (row) {
      await db
        .update(schema.ledgerAccountBalances)
        .set({
          debitMinor: row.debitMinor + delta.debitMinor,
          creditMinor: row.creditMinor + delta.creditMinor,
          baseDebitMinor: row.baseDebitMinor + delta.debitMinor,
          baseCreditMinor: row.baseCreditMinor + delta.creditMinor,
          updatedAt: now
        })
        .where(eq(schema.ledgerAccountBalances.id, row.id));
    } else {
      await db.insert(schema.ledgerAccountBalances).values({
        id: nid("bal"),
        tenantId,
        accountCode,
        currency: BASE,
        debitMinor: delta.debitMinor,
        creditMinor: delta.creditMinor,
        baseDebitMinor: delta.debitMinor,
        baseCreditMinor: delta.creditMinor,
        updatedAt: now
      });
    }
  }

  return {
    daysWritten: freshDays.size,
    daysSkipped: allDays.size - freshDays.size,
    txns: txnRows.length,
    batches: batchRows.length,
    periodsCreated
  };
}
