import { and, eq, like } from "drizzle-orm";
import { schema } from "@lyra/db";
import { checkKAnonymity, conflict, type Ctx } from "@lyra/core";

// docs/specs/gap-finance-design.md D2/D3. Some transactions are illegal because
// of what is already in the ledger, not because of their own arguments: a second
// opening balance, a year-end close over months still open, a year closed twice.
//
// A recipe cannot see the database and the state machine must not grow a branch
// per type, so this is the one new mechanism: a table of read-only checks that
// run once, at the top of the `initiated` hop, before anything has been written.
// Read, decide, then write — enforced by the shape.

export type Precondition = (ctx: Ctx, args: Record<string, unknown>) => Promise<void>;

/** Settled transactions of `type`, oldest first. */
async function settledOfType(ctx: Ctx, type: string): Promise<{ idempotencyKey: string }[]> {
  return ctx.db
    .select({ idempotencyKey: schema.ledgerTxns.idempotencyKey })
    .from(schema.ledgerTxns)
    .where(
      and(
        eq(schema.ledgerTxns.tenantId, ctx.tenantId),
        eq(schema.ledgerTxns.type, type),
        eq(schema.ledgerTxns.state, "settled")
      )
    );
}

function fiscalYearOf(args: Record<string, unknown>): number {
  const y = args["fiscalYear"];
  if (typeof y !== "number" || !Number.isInteger(y)) throw conflict("fiscalYear is required");
  return y;
}

/**
 * An opening balance restates the whole ledger from nothing. A second one would
 * double every balance it names, and no reversal makes that obvious after the
 * fact — so it is once per tenant, ever.
 */
const firstOpeningBalanceOnly: Precondition = async (ctx) => {
  const prior = await settledOfType(ctx, "OPEN-BAL");
  if (prior.length) {
    throw conflict(
      `this tenant already posted an opening balance (${prior[0]?.idempotencyKey}); correct it with a manual journal`
    );
  }
};

/**
 * Closing a year whose months are still open would close figures that can still
 * move. Months with no postings have no period row and so nothing to close —
 * the check is over what exists, not over twelve codes.
 */
const fiscalYearSoftClosed: Precondition = async (ctx, args) => {
  const year = fiscalYearOf(args);
  const rows = await ctx.db
    .select({ code: schema.ledgerPeriods.code, state: schema.ledgerPeriods.state })
    .from(schema.ledgerPeriods)
    .where(and(eq(schema.ledgerPeriods.tenantId, ctx.tenantId), like(schema.ledgerPeriods.code, `${year}-%`)));
  const open = rows.filter((r) => r.state === "open").map((r) => r.code).sort();
  if (open.length) {
    throw conflict(`fiscal year ${year} still has open periods: ${open.join(", ")}`);
  }
};

/**
 * `yearend:{year}` as the idempotency key makes a replay a no-op through the
 * existing unique index, so the only thing left to catch is a *different* key
 * for a year already closed — which would post retained earnings twice.
 */
const yearNotAlreadyClosed: Precondition = async (ctx, args) => {
  const year = fiscalYearOf(args);
  const prior = await settledOfType(ctx, "YEAR-END-CLOSE");
  if (prior.some((p) => p.idempotencyKey === `yearend:${year}`)) {
    throw conflict(`fiscal year ${year} is already closed`);
  }
};

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || !v) throw conflict(`${key} is required`);
  return v;
}

function requireNumber(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  if (typeof v !== "number" || !Number.isFinite(v)) throw conflict(`${key} is required`);
  return v;
}

/**
 * docs/19 §5.2 F: a data-product delivery whose result set is too small to
 * anonymise must be refused before any transaction is opened — the caller
 * supplies the query's own cell count via `args`, the product supplies its
 * own floor via `aggregationMin` (docs/03 §SCOUT).
 */
const dataProductKAnonymity: Precondition = async (ctx, args) => {
  const dataProductId = requireString(args, "dataProductId");
  const cellCount = requireNumber(args, "cellCount");
  const [product] = await ctx.db
    .select({ aggregationMin: schema.scoutDataProducts.aggregationMin })
    .from(schema.scoutDataProducts)
    .where(
      and(eq(schema.scoutDataProducts.tenantId, ctx.tenantId), eq(schema.scoutDataProducts.id, dataProductId))
    );
  if (!product) throw conflict(`data product ${dataProductId} not found`);
  const result = checkKAnonymity(cellCount, product.aggregationMin);
  if (!result.allowed) {
    throw conflict(
      `k-anonymity floor not met: ${result.cellCount} cells below floor of ${result.floor}`
    );
  }
};

/** Every check that must pass before a transaction of this type may proceed. */
export const TXN_PRECONDITIONS: Record<string, Precondition> = {
  "OPEN-BAL": firstOpeningBalanceOnly,
  "YEAR-END-CLOSE": async (ctx, args) => {
    await yearNotAlreadyClosed(ctx, args);
    await fiscalYearSoftClosed(ctx, args);
  },
  "DPROD-DELIVER": dataProductKAnonymity
};
