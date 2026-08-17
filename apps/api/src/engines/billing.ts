import { and, asc, eq, isNull, lt, lte } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { buildRecipe, runTxn } from "@lyra/ledger";
import { emit, scoped, type Ctx } from "@lyra/core";
import { SWEEP_MAX } from "./sweep.js";

/** `INV-YYYYMMDD-<last6ofId>`, mirrors axis-fnol.ts's claimNumber() shape. */
export function invoiceNumber(invoiceId: string, now: number): string {
  const d = new Date(now);
  const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `INV-${stamp}-${invoiceId.slice(-6).toUpperCase()}`;
}

export interface RecordUsageArgs {
  subscriptionId: string;
  meter: string;
  period: string;
  delta: number;
  includedQuantity?: number;
  unitPriceMicro?: number;
  idempotencyKey: string;
}

/** Upserts the period's usage-meter row and posts a non-financial USAGE-METER txn. */
export async function recordUsage(
  ctx: Ctx,
  args: RecordUsageArgs
): Promise<{ meterId: string; quantity: number }> {
  const [existing] = await ctx.db
    .select()
    .from(schema.ledgerUsageMeters)
    .where(
      scoped(
        ctx,
        schema.ledgerUsageMeters,
        eq(schema.ledgerUsageMeters.subscriptionId, args.subscriptionId),
        eq(schema.ledgerUsageMeters.meter, args.meter),
        eq(schema.ledgerUsageMeters.period, args.period)
      )
    );

  // The idempotency key already burned means this exact call happened before
  // (runTxn's own openTxn would just replay the settled row) — the guard here
  // is for *our* side effect, the quantity increment, which runTxn's replay
  // does not know about.
  const [priorTxn] = await ctx.db
    .select({ id: schema.ledgerTxns.id })
    .from(schema.ledgerTxns)
    .where(
      and(
        eq(schema.ledgerTxns.tenantId, ctx.tenantId),
        eq(schema.ledgerTxns.type, "USAGE-METER"),
        eq(schema.ledgerTxns.idempotencyKey, args.idempotencyKey)
      )
    );
  const alreadyApplied = !!priorTxn;

  const meterId = existing?.id ?? newId("usg", ctx.now);
  const quantity = alreadyApplied ? (existing?.quantity ?? 0) : (existing?.quantity ?? 0) + args.delta;

  if (existing) {
    if (!alreadyApplied) {
      await ctx.db
        .update(schema.ledgerUsageMeters)
        .set({ quantity, updatedAt: ctx.now })
        .where(scoped(ctx, schema.ledgerUsageMeters, eq(schema.ledgerUsageMeters.id, meterId)));
    }
  } else {
    await ctx.db.insert(schema.ledgerUsageMeters).values({
      id: meterId,
      tenantId: ctx.tenantId,
      subscriptionId: args.subscriptionId,
      meter: args.meter,
      period: args.period,
      quantity,
      includedQuantity: args.includedQuantity ?? 0,
      unitPriceMicro: args.unitPriceMicro ?? 0,
      updatedAt: ctx.now
    });
  }

  // Non-financial (⊘ in packages/ledger/src/types.ts): a meter tick moves no
  // money, so no recipe — it exists so usage has a transaction of its own to
  // key idempotency and audit off.
  await runTxn(
    ctx,
    {
      type: "USAGE-METER",
      idempotencyKey: args.idempotencyKey,
      grossMinor: 0,
      subjectRefs: { subscriptionId: args.subscriptionId, meter: args.meter, period: args.period }
    },
    {}
  );

  if (!alreadyApplied) {
    // No "billing" entry in MODULES (packages/core/src/events.ts) — usage
    // metering lives in the ledger domain alongside settlement.ts, which
    // emits its "ledger.settlement.*" events under module "ledger" too.
    await emit(ctx, {
      module: "ledger",
      type: "ledger.usage.recorded",
      subject: args.subscriptionId,
      data: { meterId, subscriptionId: args.subscriptionId, meter: args.meter, period: args.period, quantity }
    });
  }

  return { meterId, quantity };
}

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function currentPeriod(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function raiseInvoices(ctx: Ctx): Promise<number> {
  const due = await ctx.db
    .select()
    .from(schema.ledgerSubscriptions)
    .where(
      scoped(
        ctx,
        schema.ledgerSubscriptions,
        eq(schema.ledgerSubscriptions.state, "active"),
        lte(schema.ledgerSubscriptions.nextInvoiceAt, ctx.now)
      )
    )
    .orderBy(asc(schema.ledgerSubscriptions.nextInvoiceAt))
    .limit(SWEEP_MAX);

  let count = 0;
  for (const sub of due) {
    const invoiceId = newId("inv", ctx.now);
    const period = currentPeriod(ctx.now);
    const netMinor = sub.priceMinor;
    const idempotencyKey = `sub-invoice:${sub.id}:${period}`;

    const txn = await runTxn(
      ctx,
      {
        type: "SUB-INVOICE",
        idempotencyKey,
        currency: sub.currency,
        grossMinor: netMinor,
        subjectRefs: { subscriptionId: sub.id, customerRef: sub.customerRef }
      },
      { recipe: { lines: buildRecipe("SUB-INVOICE", { netMinor }), currency: sub.currency } }
    );

    await ctx.db.insert(schema.ledgerInvoices).values({
      id: invoiceId,
      tenantId: ctx.tenantId,
      number: invoiceNumber(invoiceId, ctx.now),
      customerRef: sub.customerRef,
      subscriptionId: sub.id,
      subtotalMinor: netMinor,
      totalMinor: netMinor,
      currency: sub.currency,
      linesJson: JSON.stringify([{ description: `${sub.plan} subscription`, amountMinor: netMinor }]),
      state: "issued",
      issuedAt: ctx.now,
      txnId: txn?.id,
      createdAt: ctx.now,
      updatedAt: ctx.now
    });

    await ctx.db.insert(schema.ledgerRevenueSchedules).values({
      id: newId("sch", ctx.now),
      tenantId: ctx.tenantId,
      invoiceId,
      accountCode: "2300",
      period,
      plannedMinor: netMinor,
      currency: sub.currency,
      state: "scheduled"
    });

    await ctx.db
      .update(schema.ledgerSubscriptions)
      .set({ nextInvoiceAt: ctx.now + MONTH_MS, updatedAt: ctx.now })
      .where(scoped(ctx, schema.ledgerSubscriptions, eq(schema.ledgerSubscriptions.id, sub.id)));

    await emit(ctx, {
      module: "ledger",
      type: "ledger.invoice.raised",
      subject: invoiceId,
      data: { subscriptionId: sub.id, netMinor, currency: sub.currency, txnId: txn?.id }
    });
    count++;
  }
  return count;
}

async function applyOverages(ctx: Ctx): Promise<number> {
  const meters = await ctx.db
    .select()
    .from(schema.ledgerUsageMeters)
    .where(
      scoped(
        ctx,
        schema.ledgerUsageMeters,
        isNull(schema.ledgerUsageMeters.overageInvoicedAt),
        lt(schema.ledgerUsageMeters.includedQuantity, schema.ledgerUsageMeters.quantity)
      )
    )
    .orderBy(asc(schema.ledgerUsageMeters.updatedAt))
    .limit(SWEEP_MAX);

  let count = 0;
  for (const meter of meters) {
    const overageUnits = meter.quantity - meter.includedQuantity;
    const netMinor = Math.ceil((overageUnits * meter.unitPriceMicro) / 1_000_000);
    if (netMinor <= 0) continue;

    const invoiceId = newId("inv", ctx.now);
    const idempotencyKey = `overage:${meter.id}`;
    const currency = "USD";

    const txn = await runTxn(
      ctx,
      {
        type: "OVERAGE",
        idempotencyKey,
        currency,
        grossMinor: netMinor,
        subjectRefs: { subscriptionId: meter.subscriptionId ?? "", meter: meter.meter, period: meter.period }
      },
      { recipe: { lines: buildRecipe("OVERAGE", { netMinor }), currency } }
    );

    await ctx.db.insert(schema.ledgerInvoices).values({
      id: invoiceId,
      tenantId: ctx.tenantId,
      number: invoiceNumber(invoiceId, ctx.now),
      customerRef: meter.subscriptionId ?? "unknown",
      subscriptionId: meter.subscriptionId,
      subtotalMinor: netMinor,
      totalMinor: netMinor,
      currency,
      linesJson: JSON.stringify([{ description: `${meter.meter} overage (${overageUnits} units)`, amountMinor: netMinor }]),
      state: "issued",
      issuedAt: ctx.now,
      txnId: txn?.id,
      createdAt: ctx.now,
      updatedAt: ctx.now
    });

    await ctx.db.insert(schema.ledgerRevenueSchedules).values({
      id: newId("sch", ctx.now),
      tenantId: ctx.tenantId,
      invoiceId,
      accountCode: "4050",
      period: meter.period,
      plannedMinor: netMinor,
      currency,
      state: "scheduled"
    });

    await ctx.db
      .update(schema.ledgerUsageMeters)
      .set({ overageInvoicedAt: ctx.now, updatedAt: ctx.now })
      .where(scoped(ctx, schema.ledgerUsageMeters, eq(schema.ledgerUsageMeters.id, meter.id)));

    await emit(ctx, {
      module: "ledger",
      type: "ledger.overage.applied",
      subject: invoiceId,
      data: { meterId: meter.id, netMinor, txnId: txn?.id }
    });
    count++;
  }
  return count;
}

async function postRecognitions(ctx: Ctx): Promise<number> {
  const period = currentPeriod(ctx.now);
  const due = await ctx.db
    .select()
    .from(schema.ledgerRevenueSchedules)
    .where(
      scoped(
        ctx,
        schema.ledgerRevenueSchedules,
        eq(schema.ledgerRevenueSchedules.state, "scheduled"),
        lt(schema.ledgerRevenueSchedules.period, period)
      )
    )
    .orderBy(asc(schema.ledgerRevenueSchedules.period))
    .limit(SWEEP_MAX);

  let count = 0;
  for (const row of due) {
    const idempotencyKey = `sub-recog:${row.id}`;
    const incomeAccount = row.accountCode === "4050" ? "4040" : "4040";

    const txn = await runTxn(
      ctx,
      {
        type: "SUB-RECOG",
        idempotencyKey,
        currency: row.currency,
        grossMinor: row.plannedMinor,
        subjectRefs: { invoiceId: row.invoiceId }
      },
      {
        recipe: {
          lines: buildRecipe("SUB-RECOG", { amountMinor: row.plannedMinor, incomeAccount }),
          currency: row.currency
        }
      }
    );

    await ctx.db
      .update(schema.ledgerRevenueSchedules)
      .set({ state: "recognized", recognizedMinor: row.plannedMinor, txnId: txn?.id })
      .where(scoped(ctx, schema.ledgerRevenueSchedules, eq(schema.ledgerRevenueSchedules.id, row.id)));

    await emit(ctx, {
      module: "ledger",
      type: "ledger.revenue.recognized",
      subject: row.id,
      data: { invoiceId: row.invoiceId, amountMinor: row.plannedMinor, txnId: txn?.id }
    });
    count++;
  }
  return count;
}

/** Bounded-bite sweep (ADR-0050): invoices due subscriptions, applies pending overages, posts due recognitions. */
export async function sweepBilling(
  ctx: Ctx
): Promise<{ invoicesRaised: number; overagesApplied: number; recognitionsPosted: number }> {
  const invoicesRaised = await raiseInvoices(ctx);
  const overagesApplied = await applyOverages(ctx);
  const recognitionsPosted = await postRecognitions(ctx);
  return { invoicesRaised, overagesApplied, recognitionsPosted };
}
