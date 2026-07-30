import { and, eq, sql } from "drizzle-orm";
import { CLIENT_MONEY_ACCOUNT, CLIENT_MONEY_LIABILITY_ACCOUNT, account, id, schema } from "@lyra/db";
import { PPM, actorRef, applyPpm, badRequest, conflict, type Ctx } from "@lyra/core";
import { assertPostable, ensurePeriod, periodCode } from "./periods.js";

// docs/19 §5. The double-entry engine. Every financial transaction in the system
// posts through here — there is no second path that writes ledger_journal_lines.
//
// Three rules are enforced at post time rather than in a nightly job, because a
// ledger that is briefly wrong is a ledger nobody trusts:
//   1. the batch balances in transaction *and* base currency,
//   2. no batch debits segregated client money to credit income or expense,
//   3. client-money assets never fall below client-money liabilities.

export type Side = "debit" | "credit";

export interface PostingLine {
  accountCode: string;
  side: Side;
  /** Positive minor units; `side` carries the sign. */
  amountMinor: number;
  memo?: string;
  /** Reporting dimensions: provider, partner, channel, campaign, product. */
  dims?: Record<string, string | number>;
  /** Pre-computed base amount; otherwise derived from `fxRatePpm`. */
  baseAmountMinor?: number;
}

export interface PostInput {
  txnId: string;
  currency: string;
  baseCurrency?: string;
  /** Rate to base, parts per million. 1_000_000 = same currency. */
  fxRatePpm?: number;
  lines: readonly PostingLine[];
  /** Defaults to the period containing `postedAt`. */
  periodCode?: string;
  /** Set on reversal batches; the one thing a hard-closed period still accepts. */
  reversalOfBatchId?: string;
  /** Required to post into a soft-closed period. */
  reason?: string;
  postedAt?: number;
}

export interface PostedBatch {
  batchId: string;
  periodId: string;
  totalMinor: number;
  baseTotalMinor: number;
  lineCount: number;
}

function assertAmount(n: number, what: string): void {
  if (!Number.isInteger(n)) throw badRequest(`${what} must be integer minor units, got ${n}`);
  if (n <= 0) throw badRequest(`${what} must be positive; use the opposite side, not a negative amount`);
  if (!Number.isSafeInteger(n)) throw badRequest(`${what} exceeds safe integer range`);
}

/**
 * FX rounding leaves a residual: converting each line independently can put the
 * base debits a unit or two away from the base credits. We place the whole
 * residual on the largest line of the heavier side — largest because a one-unit
 * nudge distorts it least in relative terms, and one line because spreading it
 * makes every line's base amount un-reproducible from its own source amount.
 */
function balanceBase(lines: { side: Side; baseAmountMinor: number }[]): void {
  const total = (s: Side) => lines.filter((l) => l.side === s).reduce((a, l) => a + l.baseAmountMinor, 0);
  const diff = total("debit") - total("credit");
  if (diff === 0) return;

  const heavy: Side = diff > 0 ? "debit" : "credit";
  let target: { side: Side; baseAmountMinor: number } | undefined;
  for (const l of lines) {
    if (l.side === heavy && (!target || l.baseAmountMinor > target.baseAmountMinor)) target = l;
  }
  if (!target) throw badRequest("cannot balance base currency: no line on the heavier side");
  const adjusted = target.baseAmountMinor - Math.abs(diff);
  if (adjusted <= 0) throw badRequest("fx residual exceeds the line it would be absorbed by");
  target.baseAmountMinor = adjusted;
}

const INCOME_OR_EXPENSE = /^[45]/;

/**
 * docs/19 §5.2 B: client money is a pass-through, never a revenue source. The
 * check is on the client-money *asset* — CM-TRANSFER legitimately debits the
 * 2010 liability to move an earned commission into own funds.
 */
function assertClientMoneyShape(lines: readonly PostingLine[]): void {
  const debitsClientMoney = lines.some((l) => {
    const a = account(l.accountCode);
    return l.side === "debit" && Boolean(a?.clientMoney) && a?.type === "asset";
  });
  if (!debitsClientMoney) return;
  const bad = lines.find((l) => l.side === "credit" && INCOME_OR_EXPENSE.test(l.accountCode));
  if (bad) {
    throw badRequest(
      `a batch debiting client money may not credit ${bad.accountCode}; transfer to own funds first (CM-TRANSFER)`
    );
  }
}

export async function post(ctx: Ctx, input: PostInput): Promise<PostedBatch> {
  if (input.lines.length < 2) throw badRequest("a journal batch needs at least two lines");

  const postedAt = input.postedAt ?? ctx.now;
  const baseCurrency = input.baseCurrency ?? ctx.policy.currency;
  const fxRatePpm = input.fxRatePpm ?? (input.currency === baseCurrency ? PPM : undefined);
  if (!fxRatePpm) throw badRequest(`no fx rate supplied for ${input.currency} -> ${baseCurrency}`);
  if (fxRatePpm <= 0) throw badRequest("fx rate must be positive");

  const prepared = input.lines.map((l, i) => {
    assertAmount(l.amountMinor, `line ${i} amount`);
    if (!account(l.accountCode)) throw badRequest(`unknown account ${l.accountCode}`);
    const base = l.baseAmountMinor ?? applyPpm(l.amountMinor, fxRatePpm);
    assertAmount(base, `line ${i} base amount`);
    return { ...l, baseAmountMinor: base };
  });

  const debit = prepared.filter((l) => l.side === "debit").reduce((a, l) => a + l.amountMinor, 0);
  const credit = prepared.filter((l) => l.side === "credit").reduce((a, l) => a + l.amountMinor, 0);
  if (debit !== credit) throw badRequest(`batch does not balance: debits ${debit} vs credits ${credit}`);
  if (debit === 0) throw badRequest("a journal batch may not be all zeroes");

  balanceBase(prepared);
  assertClientMoneyShape(prepared);

  const code = input.periodCode ?? periodCode(postedAt);
  const period = await ensurePeriod(ctx, code);
  assertPostable(period, {
    ...(input.reversalOfBatchId ? { contra: true as const } : {}),
    ...(input.reason ? { reason: input.reason } : {})
  });

  const baseDebit = prepared.filter((l) => l.side === "debit").reduce((a, l) => a + l.baseAmountMinor, 0);
  const batchId = id("bat", postedAt);

  // The unique index on (tenant, txn) is what makes replay post nothing new:
  // a second post() for the same transaction is a conflict, not a duplicate batch.
  try {
    await ctx.db.insert(schema.ledgerJournalBatches).values({
      id: batchId,
      tenantId: ctx.tenantId,
      txnId: input.txnId,
      periodId: period.id,
      currency: input.currency,
      baseCurrency,
      fxRatePpm,
      totalDebitMinor: debit,
      totalCreditMinor: credit,
      baseTotalDebitMinor: baseDebit,
      baseTotalCreditMinor: baseDebit,
      reversalOfBatchId: input.reversalOfBatchId ?? null,
      postedBy: actorRef(ctx),
      postedAt
    });
  } catch (err) {
    if (String(err).includes("ledger_batches_txn_uq") || String(err).toUpperCase().includes("UNIQUE")) {
      throw conflict(`transaction ${input.txnId} already has a posted batch`);
    }
    throw err;
  }

  await ctx.db.insert(schema.ledgerJournalLines).values(
    prepared.map((l, i) => ({
      id: id("jln", postedAt),
      tenantId: ctx.tenantId,
      batchId,
      txnId: input.txnId,
      seq: i + 1,
      accountCode: l.accountCode,
      side: l.side,
      amountMinor: l.amountMinor,
      currency: input.currency,
      baseAmountMinor: l.baseAmountMinor,
      baseCurrency,
      memo: l.memo ?? null,
      dimsJson: l.dims ? JSON.stringify(l.dims) : null,
      postedAt
    }))
  );

  await bumpBalances(ctx, input.currency, prepared, postedAt);
  await assertClientMoneySegregation(ctx, input.currency, input.txnId, postedAt);

  await ctx.db
    .update(schema.ledgerTxns)
    .set({ ledgerBatchId: batchId, fxRatePpm, updatedAt: postedAt })
    .where(and(eq(schema.ledgerTxns.tenantId, ctx.tenantId), eq(schema.ledgerTxns.id, input.txnId)));

  return {
    batchId,
    periodId: period.id,
    totalMinor: debit,
    baseTotalMinor: baseDebit,
    lineCount: prepared.length
  };
}

/**
 * Running balances are a cache of the lines, maintained in the same write so a
 * report never has to re-sum a year of journal. reports.ts rebuilds from lines
 * to prove the cache agrees.
 *
 * ponytail: one upsert per account, not per line — a batch touches a handful of
 * accounts. Batching into a single statement matters only if batches get wide.
 */
async function bumpBalances(
  ctx: Ctx,
  currency: string,
  lines: readonly { accountCode: string; side: Side; amountMinor: number; baseAmountMinor: number }[],
  at: number
): Promise<void> {
  const agg = new Map<string, { debit: number; credit: number; baseDebit: number; baseCredit: number }>();
  for (const l of lines) {
    const a = agg.get(l.accountCode) ?? { debit: 0, credit: 0, baseDebit: 0, baseCredit: 0 };
    if (l.side === "debit") {
      a.debit += l.amountMinor;
      a.baseDebit += l.baseAmountMinor;
    } else {
      a.credit += l.amountMinor;
      a.baseCredit += l.baseAmountMinor;
    }
    agg.set(l.accountCode, a);
  }

  for (const [accountCode, a] of agg) {
    await ctx.db
      .insert(schema.ledgerAccountBalances)
      .values({
        id: id("bal", at),
        tenantId: ctx.tenantId,
        accountCode,
        currency,
        debitMinor: a.debit,
        creditMinor: a.credit,
        baseDebitMinor: a.baseDebit,
        baseCreditMinor: a.baseCredit,
        updatedAt: at
      })
      .onConflictDoUpdate({
        target: [
          schema.ledgerAccountBalances.tenantId,
          schema.ledgerAccountBalances.accountCode,
          schema.ledgerAccountBalances.currency
        ],
        set: {
          debitMinor: sql`${schema.ledgerAccountBalances.debitMinor} + ${a.debit}`,
          creditMinor: sql`${schema.ledgerAccountBalances.creditMinor} + ${a.credit}`,
          baseDebitMinor: sql`${schema.ledgerAccountBalances.baseDebitMinor} + ${a.baseDebit}`,
          baseCreditMinor: sql`${schema.ledgerAccountBalances.baseCreditMinor} + ${a.baseCredit}`,
          updatedAt: at
        }
      });
  }
}

export interface Balance {
  accountCode: string;
  currency: string;
  debitMinor: number;
  creditMinor: number;
  baseDebitMinor: number;
  baseCreditMinor: number;
  /** Signed by the account's normal side: positive means "as expected". */
  balanceMinor: number;
}

export async function balanceOf(ctx: Ctx, accountCode: string, currency: string): Promise<Balance> {
  const rows = await ctx.db
    .select()
    .from(schema.ledgerAccountBalances)
    .where(
      and(
        eq(schema.ledgerAccountBalances.tenantId, ctx.tenantId),
        eq(schema.ledgerAccountBalances.accountCode, accountCode),
        eq(schema.ledgerAccountBalances.currency, currency)
      )
    )
    .limit(1);

  const r = rows[0] ?? {
    debitMinor: 0,
    creditMinor: 0,
    baseDebitMinor: 0,
    baseCreditMinor: 0
  };
  const normal = account(accountCode)?.normalSide ?? "debit";
  const signed = normal === "debit" ? r.debitMinor - r.creditMinor : r.creditMinor - r.debitMinor;
  return {
    accountCode,
    currency,
    debitMinor: r.debitMinor,
    creditMinor: r.creditMinor,
    baseDebitMinor: r.baseDebitMinor,
    baseCreditMinor: r.baseCreditMinor,
    balanceMinor: signed
  };
}

/**
 * docs/19 §5.2 B, the invariant the regulator actually cares about: the money we
 * hold for clients (asset 1010) is never less than what we owe them (liability
 * 2010). Checked after every posting rather than nightly, and recorded either
 * way so the compliance evidence exists without a separate job.
 */
export async function assertClientMoneySegregation(
  ctx: Ctx,
  currency: string,
  triggeredBy: string,
  at: number
): Promise<void> {
  const asset = await balanceOf(ctx, CLIENT_MONEY_ACCOUNT, currency);
  const liability = await balanceOf(ctx, CLIENT_MONEY_LIABILITY_ACCOUNT, currency);
  if (asset.balanceMinor === 0 && liability.balanceMinor === 0) return;

  const shortfall = liability.balanceMinor - asset.balanceMinor;
  const breach = shortfall > 0;
  await ctx.db.insert(schema.ledgerClientMoneyChecks).values({
    id: id("cmc", at),
    tenantId: ctx.tenantId,
    assetMinor: asset.balanceMinor,
    liabilityMinor: liability.balanceMinor,
    currency,
    shortfallMinor: breach ? shortfall : 0,
    breach,
    triggeredBy,
    resolvedAt: null,
    ts: at
  });

  if (breach) {
    // Throwing rolls the caller's transaction back where one is open; where it is
    // not, the check row above is the alarm that survives.
    throw conflict(
      `client money shortfall of ${shortfall} ${currency}: asset ${asset.balanceMinor} < liability ${liability.balanceMinor}`
    );
  }
}

/**
 * Reversal is a new contra batch, never an edit: posted lines are immutable.
 * Sides are flipped and base amounts copied so the pair nets to exactly zero
 * even when the original carried an FX residual.
 */
export async function reverse(
  ctx: Ctx,
  batchId: string,
  opts: { txnId: string; reason: string; postedAt?: number }
): Promise<PostedBatch> {
  const batches = await ctx.db
    .select()
    .from(schema.ledgerJournalBatches)
    .where(
      and(eq(schema.ledgerJournalBatches.tenantId, ctx.tenantId), eq(schema.ledgerJournalBatches.id, batchId))
    )
    .limit(1);
  const batch = batches[0];
  if (!batch) throw badRequest(`no journal batch ${batchId}`);

  const already = await ctx.db
    .select({ id: schema.ledgerJournalBatches.id })
    .from(schema.ledgerJournalBatches)
    .where(
      and(
        eq(schema.ledgerJournalBatches.tenantId, ctx.tenantId),
        eq(schema.ledgerJournalBatches.reversalOfBatchId, batchId)
      )
    )
    .limit(1);
  if (already[0]) throw conflict(`batch ${batchId} is already reversed by ${already[0].id}`);

  const lines = await ctx.db
    .select()
    .from(schema.ledgerJournalLines)
    .where(
      and(eq(schema.ledgerJournalLines.tenantId, ctx.tenantId), eq(schema.ledgerJournalLines.batchId, batchId))
    )
    .orderBy(schema.ledgerJournalLines.seq);

  return post(ctx, {
    txnId: opts.txnId,
    currency: batch.currency,
    baseCurrency: batch.baseCurrency,
    fxRatePpm: batch.fxRatePpm,
    reversalOfBatchId: batchId,
    reason: opts.reason,
    ...(opts.postedAt !== undefined ? { postedAt: opts.postedAt } : {}),
    lines: lines.map((l) => ({
      accountCode: l.accountCode,
      side: (l.side === "debit" ? "credit" : "debit") as Side,
      amountMinor: l.amountMinor,
      baseAmountMinor: l.baseAmountMinor,
      memo: `reversal of ${batchId}: ${opts.reason}`
    }))
  });
}
