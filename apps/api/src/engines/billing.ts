import { and, eq } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { runTxn } from "@lyra/ledger";
import { emit, scoped, type Ctx } from "@lyra/core";

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
