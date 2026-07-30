import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { CHART_OF_ACCOUNTS, account, schema } from "@lyra/db";
import { notFound, type Ctx } from "@lyra/core";

// docs/19 §9. Every figure a finance user sees comes from here, and every one of
// them is derived from ledger_journal_lines — the balances table is a cache we
// can always rebuild and check against (see `rebuildBalances`).

export interface TrialBalanceRow {
  accountCode: string;
  name: string;
  type: string;
  normalSide: string;
  debitMinor: number;
  creditMinor: number;
  balanceMinor: number;
}

export interface TrialBalance {
  currency: string;
  asOf: number;
  periodCode?: string;
  rows: TrialBalanceRow[];
  totalDebitMinor: number;
  totalCreditMinor: number;
  balanced: boolean;
}

function periodWindow(code: string): { from: number; to: number } {
  const [y, m] = code.split("-").map(Number);
  if (!y || !m) throw notFound(`period ${code}`);
  return { from: Date.UTC(y, m - 1, 1), to: Date.UTC(y, m, 1) - 1 };
}

/**
 * Summed from lines in base currency, so a multi-currency tenant still gets one
 * balanced statement. `periodCode` gives the movement in that month; without it
 * the report is cumulative to `asOf`.
 */
export async function trialBalance(
  ctx: Ctx,
  opts: { periodCode?: string; asOf?: number; currency?: string } = {}
): Promise<TrialBalance> {
  const asOf = opts.asOf ?? ctx.now;
  const l = schema.ledgerJournalLines;
  const where = [eq(l.tenantId, ctx.tenantId), lte(l.postedAt, asOf)];
  if (opts.periodCode) {
    const w = periodWindow(opts.periodCode);
    where.push(gte(l.postedAt, w.from), lte(l.postedAt, Math.min(w.to, asOf)));
  }
  if (opts.currency) where.push(eq(l.currency, opts.currency));

  const rows = await ctx.db
    .select({
      accountCode: l.accountCode,
      side: l.side,
      total: sql<number>`sum(${l.baseAmountMinor})`
    })
    .from(l)
    .where(and(...where))
    .groupBy(l.accountCode, l.side);

  const byAccount = new Map<string, { debit: number; credit: number }>();
  for (const r of rows) {
    const acc = byAccount.get(r.accountCode) ?? { debit: 0, credit: 0 };
    if (r.side === "debit") acc.debit += Number(r.total);
    else acc.credit += Number(r.total);
    byAccount.set(r.accountCode, acc);
  }

  const out: TrialBalanceRow[] = [];
  let totalDebitMinor = 0;
  let totalCreditMinor = 0;
  for (const [code, v] of [...byAccount].sort(([a], [b]) => a.localeCompare(b))) {
    const def = account(code);
    const normalSide = def?.normalSide ?? "debit";
    out.push({
      accountCode: code,
      name: def?.en ?? code,
      type: def?.type ?? "unknown",
      normalSide,
      debitMinor: v.debit,
      creditMinor: v.credit,
      balanceMinor: normalSide === "debit" ? v.debit - v.credit : v.credit - v.debit
    });
    totalDebitMinor += v.debit;
    totalCreditMinor += v.credit;
  }

  return {
    currency: opts.currency ?? ctx.policy.currency,
    asOf,
    ...(opts.periodCode ? { periodCode: opts.periodCode } : {}),
    rows: out,
    totalDebitMinor,
    totalCreditMinor,
    balanced: totalDebitMinor === totalCreditMinor
  };
}

export interface AccountStatementLine {
  batchId: string;
  txnId: string;
  seq: number;
  side: string;
  amountMinor: number;
  baseAmountMinor: number;
  currency: string;
  memo: string | null;
  dims: Record<string, unknown> | null;
  postedAt: number;
  runningMinor: number;
}

/** The drill-down behind any trial-balance figure: every line, with a running total. */
export async function accountStatement(
  ctx: Ctx,
  accountCode: string,
  opts: { currency?: string; from?: number; to?: number; limit?: number } = {}
): Promise<{ accountCode: string; openingMinor: number; closingMinor: number; lines: AccountStatementLine[] }> {
  const def = account(accountCode);
  const normalSide = def?.normalSide ?? "debit";
  const l = schema.ledgerJournalLines;
  const base = [eq(l.tenantId, ctx.tenantId), eq(l.accountCode, accountCode)];
  if (opts.currency) base.push(eq(l.currency, opts.currency));

  // Opening balance is everything before the window, not a stored figure —
  // otherwise a backdated correction would silently change history.
  let openingMinor = 0;
  if (opts.from) {
    const prior = await ctx.db
      .select({ side: l.side, total: sql<number>`sum(${l.baseAmountMinor})` })
      .from(l)
      .where(and(...base, sql`${l.postedAt} < ${opts.from}`))
      .groupBy(l.side);
    for (const p of prior) {
      const signed = p.side === normalSide ? Number(p.total) : -Number(p.total);
      openingMinor += signed;
    }
  }

  const where = [...base];
  if (opts.from) where.push(gte(l.postedAt, opts.from));
  if (opts.to) where.push(lte(l.postedAt, opts.to));

  const rows = await ctx.db
    .select()
    .from(l)
    .where(and(...where))
    .orderBy(asc(l.postedAt), asc(l.seq))
    .limit(opts.limit ?? 500);

  let running = openingMinor;
  const lines = rows.map((r) => {
    running += r.side === normalSide ? r.baseAmountMinor : -r.baseAmountMinor;
    return {
      batchId: r.batchId,
      txnId: r.txnId,
      seq: r.seq,
      side: r.side,
      amountMinor: r.amountMinor,
      baseAmountMinor: r.baseAmountMinor,
      currency: r.currency,
      memo: r.memo,
      dims: r.dimsJson ? (JSON.parse(r.dimsJson) as Record<string, unknown>) : null,
      postedAt: r.postedAt,
      runningMinor: running
    };
  });

  return { accountCode, openingMinor, closingMinor: running, lines };
}

export interface ClientMoneyPosition {
  currency: string;
  assetMinor: number;
  liabilityMinor: number;
  surplusMinor: number;
  breach: boolean;
  asOf: number;
}

/**
 * docs/12: the regulator's question is "is client money whole right now". This
 * answers it from lines, independently of the running-balance cache, so the two
 * can be compared as a control.
 */
export async function clientMoneyPosition(ctx: Ctx, currency?: string): Promise<ClientMoneyPosition[]> {
  const l = schema.ledgerJournalLines;
  const where = [eq(l.tenantId, ctx.tenantId), sql`${l.accountCode} in ('1010','2010')`];
  if (currency) where.push(eq(l.currency, currency));

  const rows = await ctx.db
    .select({
      currency: l.currency,
      accountCode: l.accountCode,
      side: l.side,
      total: sql<number>`sum(${l.amountMinor})`
    })
    .from(l)
    .where(and(...where))
    .groupBy(l.currency, l.accountCode, l.side);

  const byCurrency = new Map<string, { asset: number; liability: number }>();
  for (const r of rows) {
    const acc = byCurrency.get(r.currency) ?? { asset: 0, liability: 0 };
    const n = Number(r.total);
    if (r.accountCode === "1010") acc.asset += r.side === "debit" ? n : -n;
    else acc.liability += r.side === "credit" ? n : -n;
    byCurrency.set(r.currency, acc);
  }

  return [...byCurrency].map(([cur, v]) => ({
    currency: cur,
    assetMinor: v.asset,
    liabilityMinor: v.liability,
    surplusMinor: v.asset - v.liability,
    breach: v.asset < v.liability,
    asOf: ctx.now
  }));
}

export interface RebuildResult {
  accountCode: string;
  currency: string;
  storedDebitMinor: number;
  storedCreditMinor: number;
  rebuiltDebitMinor: number;
  rebuiltCreditMinor: number;
  drifted: boolean;
}

/**
 * The control that makes the balances cache trustworthy: re-sum every line and
 * compare. `apply` repairs drift; without it this is a read-only audit that can
 * be run against production safely.
 */
export async function rebuildBalances(
  ctx: Ctx,
  opts: { apply?: boolean } = {}
): Promise<RebuildResult[]> {
  const l = schema.ledgerJournalLines;
  const rebuilt = await ctx.db
    .select({
      accountCode: l.accountCode,
      currency: l.currency,
      side: l.side,
      amount: sql<number>`sum(${l.amountMinor})`,
      base: sql<number>`sum(${l.baseAmountMinor})`
    })
    .from(l)
    .where(eq(l.tenantId, ctx.tenantId))
    .groupBy(l.accountCode, l.currency, l.side);

  const key = (a: string, c: string) => `${a}|${c}`;
  const map = new Map<string, { debit: number; credit: number; baseDebit: number; baseCredit: number }>();
  for (const r of rebuilt) {
    const k = key(r.accountCode, r.currency);
    const v = map.get(k) ?? { debit: 0, credit: 0, baseDebit: 0, baseCredit: 0 };
    if (r.side === "debit") {
      v.debit += Number(r.amount);
      v.baseDebit += Number(r.base);
    } else {
      v.credit += Number(r.amount);
      v.baseCredit += Number(r.base);
    }
    map.set(k, v);
  }

  const stored = await ctx.db
    .select()
    .from(schema.ledgerAccountBalances)
    .where(eq(schema.ledgerAccountBalances.tenantId, ctx.tenantId));
  const storedMap = new Map(stored.map((s) => [key(s.accountCode, s.currency), s]));

  const out: RebuildResult[] = [];
  for (const [k, v] of map) {
    const [accountCode = "", currency = ""] = k.split("|");
    const s = storedMap.get(k);
    const drifted = !s || s.debitMinor !== v.debit || s.creditMinor !== v.credit;
    out.push({
      accountCode,
      currency,
      storedDebitMinor: s?.debitMinor ?? 0,
      storedCreditMinor: s?.creditMinor ?? 0,
      rebuiltDebitMinor: v.debit,
      rebuiltCreditMinor: v.credit,
      drifted
    });
    if (drifted && opts.apply) {
      await ctx.db
        .insert(schema.ledgerAccountBalances)
        .values({
          id: `bal_${ctx.tenantId}_${accountCode}_${currency}`,
          tenantId: ctx.tenantId,
          accountCode,
          currency,
          debitMinor: v.debit,
          creditMinor: v.credit,
          baseDebitMinor: v.baseDebit,
          baseCreditMinor: v.baseCredit,
          updatedAt: ctx.now
        })
        .onConflictDoUpdate({
          target: [
            schema.ledgerAccountBalances.tenantId,
            schema.ledgerAccountBalances.accountCode,
            schema.ledgerAccountBalances.currency
          ],
          set: {
            debitMinor: v.debit,
            creditMinor: v.credit,
            baseDebitMinor: v.baseDebit,
            baseCreditMinor: v.baseCredit,
            updatedAt: ctx.now
          }
        });
    }
  }
  return out;
}

export interface PnlSection {
  label: string;
  rows: { accountCode: string; name: string; amountMinor: number }[];
  totalMinor: number;
}

export interface Pnl {
  periodCode: string;
  currency: string;
  income: PnlSection;
  expense: PnlSection;
  grossMarginMinor: number;
  marginPpm: number;
}

/** Income statement for a month, base currency, from lines. */
export async function profitAndLoss(ctx: Ctx, code: string): Promise<Pnl> {
  const tb = await trialBalance(ctx, { periodCode: code });
  const pick = (type: string, label: string): PnlSection => {
    const rows = tb.rows
      .filter((r) => r.type === type)
      .map((r) => ({ accountCode: r.accountCode, name: r.name, amountMinor: r.balanceMinor }));
    return { label, rows, totalMinor: rows.reduce((s, r) => s + r.amountMinor, 0) };
  };
  const income = pick("income", "Revenue");
  const expense = pick("expense", "Cost of revenue & operating");
  const grossMarginMinor = income.totalMinor - expense.totalMinor;
  return {
    periodCode: code,
    currency: ctx.policy.currency,
    income,
    expense,
    grossMarginMinor,
    marginPpm: income.totalMinor ? Math.round((grossMarginMinor / income.totalMinor) * 1_000_000) : 0
  };
}

export interface BalanceSheet {
  asOf: number;
  currency: string;
  assets: PnlSection;
  liabilities: PnlSection;
  equityMinor: number;
  balanced: boolean;
}

export async function balanceSheet(ctx: Ctx, asOf?: number): Promise<BalanceSheet> {
  const tb = await trialBalance(ctx, { ...(asOf !== undefined ? { asOf } : {}) });
  const pick = (type: string, label: string): PnlSection => {
    const rows = tb.rows
      .filter((r) => r.type === type)
      .map((r) => ({ accountCode: r.accountCode, name: r.name, amountMinor: r.balanceMinor }));
    return { label, rows, totalMinor: rows.reduce((s, r) => s + r.amountMinor, 0) };
  };
  const assets = pick("asset", "Assets");
  const liabilities = pick("liability", "Liabilities");
  const income = tb.rows.filter((r) => r.type === "income").reduce((s, r) => s + r.balanceMinor, 0);
  const expense = tb.rows.filter((r) => r.type === "expense").reduce((s, r) => s + r.balanceMinor, 0);
  // Retained earnings are derived, not posted: a closing journal would be a
  // second source of truth for the same number.
  const equityMinor = income - expense + tb.rows.filter((r) => r.type === "equity").reduce((s, r) => s + r.balanceMinor, 0);
  return {
    asOf: asOf ?? ctx.now,
    currency: ctx.policy.currency,
    assets,
    liabilities,
    equityMinor,
    balanced: assets.totalMinor === liabilities.totalMinor + equityMinor
  };
}

export interface AgedRow {
  counterparty: string;
  currency: string;
  currentMinor: number;
  d30Minor: number;
  d60Minor: number;
  d90Minor: number;
  olderMinor: number;
  totalMinor: number;
}

const DAY = 86_400_000;

/**
 * Ageing by the `counterparty` dimension stamped on each line. Receivable
 * accounts default to the three we actually invoice against.
 */
export async function agedBalances(
  ctx: Ctx,
  opts: { accountCodes?: string[]; asOf?: number } = {}
): Promise<AgedRow[]> {
  const asOf = opts.asOf ?? ctx.now;
  const codes = opts.accountCodes ?? ["1100", "1150", "1160"];
  const l = schema.ledgerJournalLines;
  const rows = await ctx.db
    .select()
    .from(l)
    .where(
      and(
        eq(l.tenantId, ctx.tenantId),
        lte(l.postedAt, asOf),
        sql`${l.accountCode} in (${sql.join(codes.map((c) => sql`${c}`), sql`,`)})`
      )
    )
    .orderBy(desc(l.postedAt))
    .limit(20_000);

  const buckets = new Map<string, AgedRow>();
  for (const r of rows) {
    const dims = r.dimsJson ? (JSON.parse(r.dimsJson) as Record<string, unknown>) : {};
    const counterparty = String(dims.counterparty ?? dims.provider ?? dims.partner ?? "unattributed");
    const k = `${counterparty}|${r.currency}`;
    const row =
      buckets.get(k) ??
      ({
        counterparty,
        currency: r.currency,
        currentMinor: 0,
        d30Minor: 0,
        d60Minor: 0,
        d90Minor: 0,
        olderMinor: 0,
        totalMinor: 0
      } satisfies AgedRow);
    const signed = r.side === "debit" ? r.amountMinor : -r.amountMinor;
    const age = Math.floor((asOf - r.postedAt) / DAY);
    if (age <= 30) row.currentMinor += signed;
    else if (age <= 60) row.d30Minor += signed;
    else if (age <= 90) row.d60Minor += signed;
    else if (age <= 120) row.d90Minor += signed;
    else row.olderMinor += signed;
    row.totalMinor += signed;
    buckets.set(k, row);
  }
  return [...buckets.values()].filter((r) => r.totalMinor !== 0).sort((a, b) => b.totalMinor - a.totalMinor);
}

export interface CommissionByDimension {
  dimension: string;
  value: string;
  grossMinor: number;
  channelShareMinor: number;
  netMinor: number;
  currency: string;
}

/**
 * The aggregator's core question: what did we earn, from which underwriter,
 * through which channel, and what did the channel keep. Grouped by any dimension
 * stamped on the line.
 */
export async function commissionByDimension(
  ctx: Ctx,
  dimension: string,
  opts: { periodCode?: string } = {}
): Promise<CommissionByDimension[]> {
  const l = schema.ledgerJournalLines;
  const where = [eq(l.tenantId, ctx.tenantId), sql`${l.accountCode} like '40%' or ${l.accountCode} = '2100'`];
  if (opts.periodCode) {
    const w = periodWindow(opts.periodCode);
    where.push(gte(l.postedAt, w.from), lte(l.postedAt, w.to));
  }
  const rows = await ctx.db
    .select()
    .from(l)
    .where(and(...where))
    .limit(50_000);

  const out = new Map<string, CommissionByDimension>();
  for (const r of rows) {
    const dims = r.dimsJson ? (JSON.parse(r.dimsJson) as Record<string, unknown>) : {};
    const value = String(dims[dimension] ?? "unattributed");
    const k = `${value}|${r.currency}`;
    const row =
      out.get(k) ??
      ({ dimension, value, grossMinor: 0, channelShareMinor: 0, netMinor: 0, currency: r.currency } satisfies CommissionByDimension);
    const signed = r.side === "credit" ? r.amountMinor : -r.amountMinor;
    if (r.accountCode === "2100") row.channelShareMinor += signed;
    else row.netMinor += signed;
    row.grossMinor = row.netMinor + row.channelShareMinor;
    out.set(k, row);
  }
  return [...out.values()].sort((a, b) => b.grossMinor - a.grossMinor);
}

/** Flat rows for the XLSX/PDF exporters — one shape, every report. */
export interface ReportTable {
  title: string;
  columns: { key: string; label: string; kind: "text" | "money" | "date" | "number" }[];
  rows: Record<string, unknown>[];
  currency?: string;
  generatedAt: number;
}

export function trialBalanceTable(tb: TrialBalance): ReportTable {
  return {
    title: tb.periodCode ? `Trial balance ${tb.periodCode}` : "Trial balance",
    columns: [
      { key: "accountCode", label: "Account", kind: "text" },
      { key: "name", label: "Name", kind: "text" },
      { key: "type", label: "Type", kind: "text" },
      { key: "debitMinor", label: "Debit", kind: "money" },
      { key: "creditMinor", label: "Credit", kind: "money" },
      { key: "balanceMinor", label: "Balance", kind: "money" }
    ],
    rows: tb.rows as unknown as Record<string, unknown>[],
    currency: tb.currency,
    generatedAt: tb.asOf
  };
}

/** Accounts with no movement still belong on a chart-of-accounts export. */
export function chartOfAccountsTable(): ReportTable {
  return {
    title: "Chart of accounts",
    columns: [
      { key: "code", label: "Code", kind: "text" },
      { key: "en", label: "Name", kind: "text" },
      { key: "type", label: "Type", kind: "text" },
      { key: "normalSide", label: "Normal side", kind: "text" }
    ],
    rows: CHART_OF_ACCOUNTS as unknown as Record<string, unknown>[],
    generatedAt: 0
  };
}
