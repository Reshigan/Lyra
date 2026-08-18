# Group C — Whitelabel Billing + Data Products (F2, F3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/api/src/engines/billing.ts`, the engine that owns usage metering, subscription invoicing, overage charges, revenue recognition, and data-product subscribe/deliver (with a k-anonymity gate), so whitelabel billing (F2) and data-product monetisation (F3) move from PARTIAL/SEEDED-ONLY to fully working, ledger-integrated engines.

**Architecture:** One new engine file (`billing.ts`) owns all writes to `ledgerUsageMeters`, `ledgerInvoices`, `ledgerRevenueSchedules` for the subscription/billing path. It posts through the existing `runTxn`/`buildRecipe` ledger primitives using six existing `TXN_TYPES` rows (no new types needed — `USAGE-METER`, `SUB-INVOICE`, `OVERAGE`, `SUB-RECOG`, `DPROD-SUB`, `DPROD-DELIVER` all already exist in `packages/ledger/src/types.ts`). A new `TXN_PRECONDITIONS["DPROD-DELIVER"]` entry enforces the k-anonymity floor before `openTxn` burns an idempotency key. A bounded-bite sweep (`sweepBilling`, following `sweepRouting`'s exact pattern) runs on the existing cron `scheduled()` handler to raise invoices, apply overages, and post recognition. F3's `deliverDataProduct()` chains `DPROD-DELIVER` → `SUB-INVOICE` → `SUB-RECOG` under one `parentTxnId`, using `incomeAccount: "4060"` at the `SUB-RECOG` call site per spec decision D2.

**Tech Stack:** TypeScript strict, Drizzle ORM (SQLite dialect, D1/libSQL), Hono on Cloudflare Workers, Vitest + miniflare/workers pool, `@lyra/core` (`scoped`, `audit`, `emit`, `conflict`, `badRequest`, `Ctx`), `@lyra/db` (`schema`), `@lyra/ledger` (`runTxn`, `buildRecipe`, `TXN_PRECONDITIONS`, `checkKAnonymity` from `@lyra/core`).

## Global Constraints

- Tenancy first: every query goes through `scoped(ctx, table, ...conditions)`. No raw cross-tenant queries.
- One schema, two homes: Drizzle SQLite dialect only, works on both D1 and libSQL.
- Model access only via `packages/model-gateway` — not applicable to this plan (no AI calls in Group C).
- Human-in-the-loop: not applicable — all six Group C types have `approval: null` in `TXN_TYPES`, so no `gate()`/`preApproved` needed anywhere in this plan.
- Events over calls: emit `{module}.{noun}.{pastTenseVerb}` on completion via `emit(ctx, {...})`.
- Migrations are forward-only and reviewed. Never edit an applied migration — this plan adds a new migration file only.
- Transaction integrity (docs/19): anything that changes money or contractual state is a transaction via `runTxn`, with idempotency keys, and (if financial) balanced double-entry journal lines via `buildRecipe`. Never write money-affecting state directly outside `runTxn`.
- Generic CRUD lockdown: once `billing.ts` owns writes to `revenue-schedules`/`usage-meters`, `apps/api/src/resources.ts` must be read-only for those resources (confirmed already true — Task 6 is verification-only).
- Build to the seams (docs/16): reuse existing `TXN_TYPES` rows and recipe builders; do not invent new transaction types where the spec says none are needed (D2).
- Every engine: tenancy via `scoped()`, audit row via `audit()` for domain-level events, event emit on completion, TDD (failing test first).

---

## Reference: exact signatures this plan depends on

**`runTxn` (packages/ledger/src/txn.ts)** — precondition check runs BEFORE `openTxn` (a refused precondition burns no idempotency key). `def.financial === !!opts.recipe?.lines.length` — non-financial (⊘) types must call `runTxn` with no `recipe` key in `opts` at all. Approval gate is skipped when `def.approval` is null (true for all six Group C types). `opts.args` is available to `TXN_PRECONDITIONS[code]` as `opts.args ?? {}`.

**`buildRecipe(code, args)` (packages/ledger/src/recipes.ts)** — merges `{...s.defaults, ...args}`, validates via Zod, throws `badRequest` on failure or if built line count `< 2`.

```ts
const InvoiceArgs = z.object({
  netMinor: Pos,
  taxMinor: NonNeg.default(0),
  creditAccount: z.string().default("2300"),
  receivableAccount: z.string().default("1160"),
  memo: Memo,
  dims: Dims
});
export function invoiceRaised(a: z.infer<typeof InvoiceArgs>): PostingLine[] {
  return lines(
    line(a.receivableAccount, "debit", a.netMinor + a.taxMinor, a.memo ?? "invoice raised", a.dims),
    line(a.creditAccount, "credit", a.netMinor, a.memo ?? "invoice raised", a.dims),
    line("2200", "credit", a.taxMinor, "output tax", a.dims)
  );
}

const RecogniseArgs = z.object({
  amountMinor: Pos,
  incomeAccount: z.string().default("4040"),
  deferredAccount: z.string().default("2300"),
  memo: Memo,
  dims: Dims
});
export function revenueRecognition(a: z.infer<typeof RecogniseArgs>): PostingLine[] {
  return lines(
    line(a.deferredAccount, "debit", a.amountMinor, a.memo ?? "revenue recognised", a.dims),
    line(a.incomeAccount, "credit", a.amountMinor, a.memo ?? "revenue recognised", a.dims)
  );
}
```

Registry: `"SUB-INVOICE": spec(InvoiceArgs, invoiceRaised)`, `"SUB-RECOG": spec(RecogniseArgs, revenueRecognition)`, `OVERAGE: spec(InvoiceArgs, invoiceRaised, { creditAccount: "4050" })`. `InvoiceArgs` has NO `incomeAccount` field — `incomeAccount: "4060"` for F3 is only ever passed to `buildRecipe("SUB-RECOG", {...})`, never to `SUB-INVOICE`.

**`checkKAnonymity` (packages/core/src/k-anonymity.ts)**:

```ts
export const DEFAULT_K_FLOOR = 20;
export interface KAnonymityResult {
  readonly allowed: boolean;
  readonly cellCount: number;
  readonly floor: number;
}
export function checkKAnonymity(cellCount: number, floor: number): KAnonymityResult {
  return { allowed: cellCount >= floor, cellCount, floor };
}
```

**`dataProducts` table (packages/db/src/schema/scout.ts, exported as `schema.scoutDataProducts`)** — relevant column: `aggregationMin: integer("aggregation_min").notNull().default(50)` (the product's own k-anonymity floor).

**Chained-saga + trailing audit/emit template (`apps/api/src/engines/axis-endorse.ts`)**:

```ts
const txn = await runTxn(ctx, { type, idempotencyKey, currency, grossMinor, subjectRefs }, {
  recipe: { lines: buildRecipe(...), currency }
});
// ... second leg, chained:
const secondTxn = await runTxn(ctx, {
  type: "SECOND-TYPE",
  idempotencyKey: secondKey,
  currency,
  grossMinor: secondAmount,
  subjectRefs,
  ...(txn ? { parentTxnId: txn.id } : {})
}, { recipe: { lines: buildRecipe(...), currency } });
// trailing manual audit + emit:
await audit(ctx, { action: "billing.dprod.delivered", subjectRef: dataProductId, before, after });
await emit(ctx, {
  module: "billing",
  type: "billing.dprod.delivered",
  subject: dataProductId,
  data: { ...fields, ...(txn ? { txnId: txn.id } : {}) }
});
```

**Bounded-bite sweep template (`apps/api/src/engines/orbit-routing.ts`, `SWEEP_MAX` from `apps/api/src/engines/sweep.ts` = 500)**:

```ts
const due = await ctx.db
  .select(...)
  .from(table)
  .where(scoped(ctx, table, ...conditions))
  .orderBy(asc(dueColumn))
  .limit(SWEEP_MAX);
for (const row of due) {
  // process row, then update it so it leaves this query's result set
  await emit(ctx, { module: "billing", type: "...", subject: row.id, data: {...} });
}
return { ...summaryCounts };
```

**`claimNumber()` pattern (apps/api/src/engines/axis-fnol.ts)** — the exact shape `invoiceNumber()` mirrors: a short human-readable id derived from a timestamp plus a slice of the row id.

---

### Task 1: Schema migration — add due-date columns

**Files:**
- Modify: `packages/db/src/schema/ledger.ts` (subscriptions table, after `endAt`; usageMeters table, after `unitPriceMicro`)
- Create: `packages/db/migrations/0025_*.sql` (auto-generated by `pnpm db:generate`)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `schema.ledgerSubscriptions.nextInvoiceAt` (nullable integer, epoch ms), `schema.ledgerUsageMeters.overageInvoicedAt` (nullable integer, epoch ms) — Tasks 3-4 read/write both columns.

- [ ] **Step 1: Modify the subscriptions table**

In `packages/db/src/schema/ledger.ts`, find the `subscriptions` table definition:

```ts
export const subscriptions = sqliteTable(
  "ledger_subscriptions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    customerRef: text("customer_ref").notNull(),
    plan: text("plan").notNull(),
    edition: text("edition"),
    priceMinor: integer("price_minor").notNull(),
    currency: text("currency").notNull(),
    interval: text("interval").notNull().default("month"),
    seats: integer("seats").notNull().default(1),
    startAt: integer("start_at").notNull(),
    endAt: integer("end_at"),
    state: text("state").notNull().default("active"),
    termsJson: text("terms_json"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [index("ledger_subscriptions_idx").on(t.tenantId, t.state, t.customerRef)]
);
```

Add `nextInvoiceAt` right after `endAt`:

```ts
export const subscriptions = sqliteTable(
  "ledger_subscriptions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    customerRef: text("customer_ref").notNull(),
    plan: text("plan").notNull(),
    edition: text("edition"),
    priceMinor: integer("price_minor").notNull(),
    currency: text("currency").notNull(),
    interval: text("interval").notNull().default("month"),
    seats: integer("seats").notNull().default(1),
    startAt: integer("start_at").notNull(),
    endAt: integer("end_at"),
    nextInvoiceAt: integer("next_invoice_at"),
    state: text("state").notNull().default("active"),
    termsJson: text("terms_json"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [
    index("ledger_subscriptions_idx").on(t.tenantId, t.state, t.customerRef),
    index("ledger_subscriptions_next_invoice_idx").on(t.tenantId, t.nextInvoiceAt)
  ]
);
```

- [ ] **Step 2: Modify the usageMeters table**

Find:

```ts
export const usageMeters = sqliteTable(
  "ledger_usage_meters",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    subscriptionId: text("subscription_id"),
    meter: text("meter").notNull(),
    period: text("period").notNull(),
    quantity: integer("quantity").notNull().default(0),
    includedQuantity: integer("included_quantity").notNull().default(0),
    unitPriceMicro: integer("unit_price_micro").notNull().default(0),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [uniqueIndex("ledger_usage_uq").on(t.tenantId, t.subscriptionId, t.meter, t.period)]
);
```

Add `overageInvoicedAt` right after `unitPriceMicro`:

```ts
export const usageMeters = sqliteTable(
  "ledger_usage_meters",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    subscriptionId: text("subscription_id"),
    meter: text("meter").notNull(),
    period: text("period").notNull(),
    quantity: integer("quantity").notNull().default(0),
    includedQuantity: integer("included_quantity").notNull().default(0),
    unitPriceMicro: integer("unit_price_micro").notNull().default(0),
    overageInvoicedAt: integer("overage_invoiced_at"),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [uniqueIndex("ledger_usage_uq").on(t.tenantId, t.subscriptionId, t.meter, t.period)]
);
```

- [ ] **Step 3: Generate migration**

Run: `pnpm db:generate`
Expected: new file `packages/db/migrations/0025_<auto-name>.sql` containing two `ALTER TABLE` statements adding `next_invoice_at` to `ledger_subscriptions` and `overage_invoiced_at` to `ledger_usage_meters`, plus the new index on `ledger_subscriptions`.

- [ ] **Step 4: Apply migration locally and verify**

Run: `pnpm db:migrate`
Expected: migration applies with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/ledger.ts packages/db/migrations/
git commit -m "feat(ledger): add nextInvoiceAt and overageInvoicedAt columns for billing sweep"
```

---

### Task 2: `TXN_PRECONDITIONS["DPROD-DELIVER"]` — k-anonymity gate

**Files:**
- Modify: `packages/ledger/src/preconditions.ts`
- Test: `packages/ledger/src/preconditions.test.ts` (create if it doesn't exist; check first with `ls packages/ledger/src/*.test.ts`)

**Interfaces:**
- Consumes: `checkKAnonymity(cellCount: number, floor: number): KAnonymityResult` from `@lyra/core`; `schema.scoutDataProducts` from `@lyra/db` (`.aggregationMin` column).
- Produces: `TXN_PRECONDITIONS["DPROD-DELIVER"]`, a `Precondition` that reads `args.dataProductId` (string) and `args.cellCount` (number) — Task 5's `deliverDataProduct()` must call `runTxn` with `opts.args = { dataProductId, cellCount }` for this to receive them.

- [ ] **Step 1: Write the failing test**

Create/append to `packages/ledger/src/preconditions.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { TXN_PRECONDITIONS } from "./preconditions.js";

function fakeCtx(aggregationMin: number) {
  return {
    tenantId: "t1",
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{ aggregationMin }])
        })
      })
    }
  } as any;
}

describe("TXN_PRECONDITIONS[DPROD-DELIVER]", () => {
  it("throws conflict when cellCount is below the product's aggregationMin", async () => {
    const ctx = fakeCtx(50);
    await expect(
      TXN_PRECONDITIONS["DPROD-DELIVER"]!(ctx, { dataProductId: "dp1", cellCount: 10 })
    ).rejects.toThrow(/k-anonymity/i);
  });

  it("passes when cellCount meets the product's aggregationMin", async () => {
    const ctx = fakeCtx(50);
    await expect(
      TXN_PRECONDITIONS["DPROD-DELIVER"]!(ctx, { dataProductId: "dp1", cellCount: 50 })
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lyra/ledger test -- preconditions.test.ts`
Expected: FAIL with `TXN_PRECONDITIONS["DPROD-DELIVER"] is not a function` or `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `packages/ledger/src/preconditions.ts`, add the import for `schema` and `checkKAnonymity`, a helper, and the new registry entry:

```ts
import { and, eq, like } from "drizzle-orm";
import { schema } from "@lyra/db";
import { checkKAnonymity, conflict, type Ctx } from "@lyra/core";
```

(Replace the existing `import { conflict, type Ctx } from "@lyra/core";` line with the one above, adding `checkKAnonymity`.)

Add a new function above the `TXN_PRECONDITIONS` export:

```ts
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
```

Update the exported registry:

```ts
export const TXN_PRECONDITIONS: Record<string, Precondition> = {
  "OPEN-BAL": firstOpeningBalanceOnly,
  "YEAR-END-CLOSE": async (ctx, args) => {
    await yearNotAlreadyClosed(ctx, args);
    await fiscalYearSoftClosed(ctx, args);
  },
  "DPROD-DELIVER": dataProductKAnonymity
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lyra/ledger test -- preconditions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ledger/src/preconditions.ts packages/ledger/src/preconditions.test.ts
git commit -m "feat(ledger): add DPROD-DELIVER k-anonymity precondition"
```

---

### Task 3: `billing.ts` — `recordUsage()` and `invoiceNumber()` helper

**Files:**
- Create: `apps/api/src/engines/billing.ts`
- Test: `apps/api/src/engines/billing.test.ts`

**Interfaces:**
- Consumes: `runTxn`, `buildRecipe` from `@lyra/ledger`; `scoped`, `emit`, `type Ctx` from `@lyra/core`; `schema`, `id as newId` from `@lyra/db`.
- Produces: `recordUsage(ctx: Ctx, args: { subscriptionId: string; meter: string; period: string; delta: number; includedQuantity?: number; unitPriceMicro?: number; idempotencyKey: string }): Promise<{ meterId: string; quantity: number }>` and `invoiceNumber(invoiceId: string, now: number): string` — both consumed by Task 4 and Task 5.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/engines/billing.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { testCtx } from "../test/ctx.js"; // existing test helper used across engines (see axis-endorse.test.ts for the same import)
import { schema } from "@lyra/db";
import { eq, and } from "drizzle-orm";
import { recordUsage, invoiceNumber } from "./billing.js";

describe("recordUsage", () => {
  let ctx: Awaited<ReturnType<typeof testCtx>>;

  beforeEach(async () => {
    ctx = await testCtx();
  });

  it("creates a usage meter row on first call and posts USAGE-METER", async () => {
    const result = await recordUsage(ctx, {
      subscriptionId: "sub1",
      meter: "api-calls",
      period: "2026-08",
      delta: 100,
      includedQuantity: 1000,
      idempotencyKey: "usage:sub1:api-calls:2026-08:1"
    });
    expect(result.quantity).toBe(100);

    const [row] = await ctx.db
      .select()
      .from(schema.ledgerUsageMeters)
      .where(
        and(
          eq(schema.ledgerUsageMeters.tenantId, ctx.tenantId),
          eq(schema.ledgerUsageMeters.id, result.meterId)
        )
      );
    expect(row?.quantity).toBe(100);

    const [txn] = await ctx.db
      .select()
      .from(schema.ledgerTxns)
      .where(
        and(eq(schema.ledgerTxns.tenantId, ctx.tenantId), eq(schema.ledgerTxns.idempotencyKey, "usage:sub1:api-calls:2026-08:1"))
      );
    expect(txn?.type).toBe("USAGE-METER");
    expect(txn?.state).toBe("settled");
  });

  it("accumulates delta across calls in the same period", async () => {
    await recordUsage(ctx, {
      subscriptionId: "sub1",
      meter: "api-calls",
      period: "2026-08",
      delta: 100,
      idempotencyKey: "usage:sub1:api-calls:2026-08:1"
    });
    const second = await recordUsage(ctx, {
      subscriptionId: "sub1",
      meter: "api-calls",
      period: "2026-08",
      delta: 50,
      idempotencyKey: "usage:sub1:api-calls:2026-08:2"
    });
    expect(second.quantity).toBe(150);
  });

  it("is idempotent on a replayed key — does not double-increment", async () => {
    await recordUsage(ctx, {
      subscriptionId: "sub1",
      meter: "api-calls",
      period: "2026-08",
      delta: 100,
      idempotencyKey: "usage:sub1:api-calls:2026-08:1"
    });
    const replay = await recordUsage(ctx, {
      subscriptionId: "sub1",
      meter: "api-calls",
      period: "2026-08",
      delta: 100,
      idempotencyKey: "usage:sub1:api-calls:2026-08:1"
    });
    expect(replay.quantity).toBe(100);
  });
});

describe("invoiceNumber", () => {
  it("derives a stable, human-readable number from id and timestamp", () => {
    const n = invoiceNumber("inv_abcdef123456", Date.parse("2026-08-17T00:00:00Z"));
    expect(n).toMatch(/^INV-\d{8}-123456$/);
  });
});
```

(If `../test/ctx.js` does not export `testCtx`, inspect `apps/api/src/engines/axis-endorse.test.ts`'s first few lines for the exact existing test-context helper import and use that same helper/path instead — do not invent a new one.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- billing.test.ts`
Expected: FAIL — `Cannot find module './billing.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/engines/billing.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { runTxn } from "@lyra/ledger";
import { scoped, type Ctx } from "@lyra/core";

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

  const [priorTxn] = await ctx.db
    .select({ id: schema.ledgerTxns.id })
    .from(schema.ledgerTxns)
    .where(and(eq(schema.ledgerTxns.tenantId, ctx.tenantId), eq(schema.ledgerTxns.idempotencyKey, args.idempotencyKey)));
  const alreadyApplied = !!priorTxn;

  const meterId = existing?.id ?? newId();
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

  await runTxn(
    ctx,
    {
      type: "USAGE-METER",
      idempotencyKey: args.idempotencyKey,
      currency: "USD",
      grossMinor: 0,
      subjectRefs: { subscriptionId: args.subscriptionId, meter: args.meter, period: args.period }
    },
    {}
  );

  return { meterId, quantity };
}
```

Check `OpenTxnInput` in `packages/ledger/src/txn.ts` for the exact required field names (`currency`, `grossMinor`, `subjectRefs` are used elsewhere in this plan per `axis-endorse.ts`'s call shape) — if a field name differs, match `txn.ts`'s actual interface, not this snippet.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- billing.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/engines/billing.ts apps/api/src/engines/billing.test.ts
git commit -m "feat(billing): add recordUsage and invoiceNumber helper"
```

---

### Task 4: `billing.ts` — `sweepBilling()` + cron wiring

**Files:**
- Modify: `apps/api/src/engines/billing.ts`
- Modify: `apps/api/src/index.ts` (import block + `scheduled()` handler)
- Test: `apps/api/src/engines/billing.test.ts`

**Interfaces:**
- Consumes: `recordUsage()`/`invoiceNumber()` from Task 3; `SWEEP_MAX` from `./sweep.js`; `buildRecipe` from `@lyra/ledger`; `asc`, `and`, `eq`, `lte`, `isNull` from `drizzle-orm`.
- Produces: `sweepBilling(ctx: Ctx): Promise<{ invoicesRaised: number; overagesApplied: number; recognitionsPosted: number }>` — called from `apps/api/src/index.ts`'s `scheduled()` handler; also reused by Task 5's tests as the mechanism that turns a `DPROD-DELIVER`'s chained `SUB-INVOICE` into a schedule (no — Task 5 posts its own invoice/schedule rows directly, see Task 5). `sweepBilling` is independent of Task 5's data-product path.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/engines/billing.test.ts`:

```ts
import { sweepBilling } from "./billing.js";

describe("sweepBilling", () => {
  let ctx: Awaited<ReturnType<typeof testCtx>>;

  beforeEach(async () => {
    ctx = await testCtx();
  });

  it("raises SUB-INVOICE for subscriptions due, and advances nextInvoiceAt so the row leaves the sweep", async () => {
    const subId = "sub_due1";
    await ctx.db.insert(schema.ledgerSubscriptions).values({
      id: subId,
      tenantId: ctx.tenantId,
      customerRef: "cust1",
      plan: "pro",
      priceMinor: 10000,
      currency: "USD",
      interval: "month",
      seats: 1,
      startAt: ctx.now - 1000,
      nextInvoiceAt: ctx.now - 1000,
      state: "active",
      createdAt: ctx.now - 1000,
      updatedAt: ctx.now - 1000
    });

    const first = await sweepBilling(ctx);
    expect(first.invoicesRaised).toBe(1);

    const [sub] = await ctx.db
      .select()
      .from(schema.ledgerSubscriptions)
      .where(eq(schema.ledgerSubscriptions.id, subId));
    expect(sub?.nextInvoiceAt).toBeGreaterThan(ctx.now - 1000);

    const [invoice] = await ctx.db
      .select()
      .from(schema.ledgerInvoices)
      .where(eq(schema.ledgerInvoices.subscriptionId, subId));
    expect(invoice?.totalMinor).toBe(10000);
    expect(invoice?.txnId).toBeTruthy();

    const second = await sweepBilling(ctx);
    expect(second.invoicesRaised).toBe(0);
  });

  it("applies OVERAGE when usage exceeds included quantity, once", async () => {
    const subId = "sub_over1";
    await ctx.db.insert(schema.ledgerSubscriptions).values({
      id: subId,
      tenantId: ctx.tenantId,
      customerRef: "cust2",
      plan: "pro",
      priceMinor: 10000,
      currency: "USD",
      interval: "month",
      seats: 1,
      startAt: ctx.now - 1000,
      state: "active",
      createdAt: ctx.now - 1000,
      updatedAt: ctx.now - 1000
    });
    await recordUsage(ctx, {
      subscriptionId: subId,
      meter: "api-calls",
      period: "2026-08",
      delta: 1500,
      includedQuantity: 1000,
      unitPriceMicro: 1000,
      idempotencyKey: "usage:over1"
    });

    const result = await sweepBilling(ctx);
    expect(result.overagesApplied).toBe(1);

    const again = await sweepBilling(ctx);
    expect(again.overagesApplied).toBe(0);
  });

  it("posts SUB-RECOG for scheduled revenue rows due by the current period", async () => {
    const subId = "sub_recog1";
    await ctx.db.insert(schema.ledgerSubscriptions).values({
      id: subId,
      tenantId: ctx.tenantId,
      customerRef: "cust3",
      plan: "pro",
      priceMinor: 10000,
      currency: "USD",
      interval: "month",
      seats: 1,
      startAt: ctx.now - 1000,
      nextInvoiceAt: ctx.now - 1000,
      state: "active",
      createdAt: ctx.now - 1000,
      updatedAt: ctx.now - 1000
    });
    await sweepBilling(ctx); // raises the invoice + schedule row for the current period

    const result = await sweepBilling(ctx);
    expect(result.recognitionsPosted).toBe(1);

    const [schedule] = await ctx.db
      .select()
      .from(schema.ledgerRevenueSchedules)
      .where(eq(schema.ledgerRevenueSchedules.tenantId, ctx.tenantId));
    expect(schedule?.state).toBe("recognized");
    expect(schedule?.txnId).toBeTruthy();
  });

  it("is bounded-bite: a processed row never reappears in the same-tick result set (ADR-0050)", async () => {
    for (let i = 0; i < 3; i++) {
      await ctx.db.insert(schema.ledgerSubscriptions).values({
        id: `sub_bite_${i}`,
        tenantId: ctx.tenantId,
        customerRef: `cust_bite_${i}`,
        plan: "pro",
        priceMinor: 5000,
        currency: "USD",
        interval: "month",
        seats: 1,
        startAt: ctx.now - 1000,
        nextInvoiceAt: ctx.now - 1000,
        state: "active",
        createdAt: ctx.now - 1000,
        updatedAt: ctx.now - 1000
      });
    }
    const result = await sweepBilling(ctx);
    expect(result.invoicesRaised).toBe(3);
    const rerun = await sweepBilling(ctx);
    expect(rerun.invoicesRaised).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- billing.test.ts`
Expected: FAIL — `sweepBilling is not exported`.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/api/src/engines/billing.ts` (extend the existing imports at the top of the file to include what's needed):

```ts
import { and, asc, eq, isNull, lt, lte } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { buildRecipe, runTxn } from "@lyra/ledger";
import { emit, scoped, type Ctx } from "@lyra/core";
import { SWEEP_MAX } from "./sweep.js";
```

(Merge with the Task 3 import block rather than duplicating — final file has one import per module.)

```ts
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
    const invoiceId = newId();
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
      id: newId(),
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
      module: "billing",
      type: "billing.invoice.raised",
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

    const invoiceId = newId();
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
      id: newId(),
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
      module: "billing",
      type: "billing.overage.applied",
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
        lte(schema.ledgerRevenueSchedules.period, period)
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
      module: "billing",
      type: "billing.revenue.recognized",
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
```

`incomeAccount` in `postRecognitions` is always `"4040"` here (F2's default) — Task 5's data-product recognition path posts its own `SUB-RECOG` call directly with `incomeAccount: "4060"` rather than going through this sweep function, since `ledgerRevenueSchedules` has no column distinguishing F2 from F3 origin. Note this explicitly: `postRecognitions` only ever recognises F2 (subscription) schedules; F3 (data-product) recognition happens inline in `deliverDataProduct()` (Task 5), which does not write a `ledgerRevenueSchedules` row needing later sweep — it recognises immediately as part of the chained saga.

- [ ] **Step 4: Wire into cron**

In `apps/api/src/index.ts`, add the import alongside the other `./engines/*.js` imports:

```ts
import { sweepBilling } from "./engines/billing.js";
```

In the `scheduled()` handler, insert the call right after `await sweepRouting(ctx);` and before `await runBudgetAutopilot(ctx);`:

```ts
await sweepRouting(ctx);
await sweepBilling(ctx);
await runBudgetAutopilot(ctx);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter api test -- billing.test.ts`
Expected: PASS (all tests in the file, including the 4 new `sweepBilling` tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors in `apps/api/src/engines/billing.ts` or `apps/api/src/index.ts`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/engines/billing.ts apps/api/src/engines/billing.test.ts apps/api/src/index.ts
git commit -m "feat(billing): add sweepBilling (invoice, overage, recognition) and wire into cron"
```

---

### Task 5: `billing.ts` — `subscribeToDataProduct()` + `deliverDataProduct()`

**Files:**
- Modify: `apps/api/src/engines/billing.ts`
- Test: `apps/api/src/engines/billing.test.ts`

**Interfaces:**
- Consumes: `TXN_PRECONDITIONS["DPROD-DELIVER"]` from Task 2 (invoked internally by `runTxn`, not called directly); `invoiceNumber()` from Task 3; `buildRecipe`, `runTxn` from `@lyra/ledger`; `audit`, `emit` from `@lyra/core`.
- Produces: `subscribeToDataProduct(ctx: Ctx, args: { dataProductId: string; subscriberRef: string; idempotencyKey: string }): Promise<{ txnId: string | undefined }>` and `deliverDataProduct(ctx: Ctx, args: { dataProductId: string; subscriberRef: string; cellCount: number; netMinor: number; idempotencyKey: string }): Promise<{ deliverTxnId: string | undefined; invoiceId: string; scheduleId: string }>`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/engines/billing.test.ts`:

```ts
import { subscribeToDataProduct, deliverDataProduct } from "./billing.js";
import { conflict } from "@lyra/core";

describe("subscribeToDataProduct", () => {
  it("posts DPROD-SUB with no journal lines", async () => {
    const ctx = await testCtx();
    await ctx.db.insert(schema.scoutDataProducts).values({
      id: "dp1",
      tenantId: ctx.tenantId,
      name: "Market pulse",
      definitionJson: "{}",
      consentBasis: "legitimate-interest",
      aggregationMin: 20,
      status: "active",
      createdAt: ctx.now,
      updatedAt: ctx.now
    });

    const result = await subscribeToDataProduct(ctx, {
      dataProductId: "dp1",
      subscriberRef: "partner1",
      idempotencyKey: "dprod-sub:dp1:partner1"
    });
    expect(result.txnId).toBeTruthy();

    const [txn] = await ctx.db
      .select()
      .from(schema.ledgerTxns)
      .where(and(eq(schema.ledgerTxns.tenantId, ctx.tenantId), eq(schema.ledgerTxns.id, result.txnId!)));
    expect(txn?.type).toBe("DPROD-SUB");
  });
});

describe("deliverDataProduct", () => {
  let ctx: Awaited<ReturnType<typeof testCtx>>;

  beforeEach(async () => {
    ctx = await testCtx();
    await ctx.db.insert(schema.scoutDataProducts).values({
      id: "dp1",
      tenantId: ctx.tenantId,
      name: "Market pulse",
      definitionJson: "{}",
      consentBasis: "legitimate-interest",
      aggregationMin: 20,
      status: "active",
      createdAt: ctx.now,
      updatedAt: ctx.now
    });
  });

  it("refuses delivery below the k-anonymity floor and burns no idempotency key", async () => {
    await expect(
      deliverDataProduct(ctx, {
        dataProductId: "dp1",
        subscriberRef: "partner1",
        cellCount: 5,
        netMinor: 50000,
        idempotencyKey: "dprod-deliver:dp1:1"
      })
    ).rejects.toThrow(/k-anonymity/i);

    const [txn] = await ctx.db
      .select()
      .from(schema.ledgerTxns)
      .where(
        and(eq(schema.ledgerTxns.tenantId, ctx.tenantId), eq(schema.ledgerTxns.idempotencyKey, "dprod-deliver:dp1:1"))
      );
    expect(txn).toBeUndefined();
  });

  it("delivers, invoices, and recognises revenue against income account 4060", async () => {
    const result = await deliverDataProduct(ctx, {
      dataProductId: "dp1",
      subscriberRef: "partner1",
      cellCount: 50,
      netMinor: 50000,
      idempotencyKey: "dprod-deliver:dp1:2"
    });
    expect(result.deliverTxnId).toBeTruthy();

    const [invoice] = await ctx.db
      .select()
      .from(schema.ledgerInvoices)
      .where(eq(schema.ledgerInvoices.id, result.invoiceId));
    expect(invoice?.totalMinor).toBe(50000);

    const [recogTxn] = await ctx.db
      .select()
      .from(schema.ledgerTxns)
      .where(and(eq(schema.ledgerTxns.tenantId, ctx.tenantId), eq(schema.ledgerTxns.type, "SUB-RECOG")));
    expect(recogTxn).toBeTruthy();
    expect(recogTxn?.parentTxnId).toBe(result.deliverTxnId);

    const lines = await ctx.db
      .select()
      .from(schema.ledgerPostings)
      .where(eq(schema.ledgerPostings.txnId, recogTxn!.id));
    const creditLine = lines.find((l) => l.side === "credit" && l.accountCode === "4060");
    expect(creditLine).toBeTruthy();
  });
});
```

(Verify `schema.ledgerPostings`'s exact column names — `txnId`, `side`, `accountCode` — against `packages/db/src/schema/ledger.ts`'s postings table before finalizing; adjust the assertion to match if names differ. Do not invent columns.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- billing.test.ts`
Expected: FAIL — `subscribeToDataProduct is not exported`.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/api/src/engines/billing.ts` (add `audit` to the `@lyra/core` import):

```ts
import { audit, emit, scoped, type Ctx } from "@lyra/core";
```

```ts
export interface SubscribeToDataProductArgs {
  dataProductId: string;
  subscriberRef: string;
  idempotencyKey: string;
}

/** DPROD-SUB (⊘): subscribing a partner to a data product posts no journal. */
export async function subscribeToDataProduct(
  ctx: Ctx,
  args: SubscribeToDataProductArgs
): Promise<{ txnId: string | undefined }> {
  const txn = await runTxn(
    ctx,
    {
      type: "DPROD-SUB",
      idempotencyKey: args.idempotencyKey,
      currency: "USD",
      grossMinor: 0,
      subjectRefs: { dataProductId: args.dataProductId, subscriberRef: args.subscriberRef }
    },
    {}
  );

  await audit(ctx, {
    action: "billing.dprod.subscribed",
    subjectRef: args.dataProductId,
    before: null,
    after: { subscriberRef: args.subscriberRef }
  });
  await emit(ctx, {
    module: "billing",
    type: "billing.dprod.subscribed",
    subject: args.dataProductId,
    data: { subscriberRef: args.subscriberRef, ...(txn ? { txnId: txn.id } : {}) }
  });

  return { txnId: txn?.id };
}

export interface DeliverDataProductArgs {
  dataProductId: string;
  subscriberRef: string;
  cellCount: number;
  netMinor: number;
  idempotencyKey: string;
}

/**
 * DPROD-DELIVER (⊘, gated by TXN_PRECONDITIONS on k-anonymity) chained into the
 * F2 money legs per spec D2: same SUB-INVOICE/SUB-RECOG recipes, incomeAccount
 * "4060" passed only at the SUB-RECOG call site (InvoiceArgs has no such field).
 */
export async function deliverDataProduct(
  ctx: Ctx,
  args: DeliverDataProductArgs
): Promise<{ deliverTxnId: string | undefined; invoiceId: string; scheduleId: string }> {
  const deliverTxn = await runTxn(
    ctx,
    {
      type: "DPROD-DELIVER",
      idempotencyKey: args.idempotencyKey,
      currency: "USD",
      grossMinor: 0,
      subjectRefs: { dataProductId: args.dataProductId, subscriberRef: args.subscriberRef }
    },
    { args: { dataProductId: args.dataProductId, cellCount: args.cellCount } }
  );

  const invoiceId = newId();
  const currency = "USD";
  const period = currentPeriod(ctx.now);

  const invoiceTxn = await runTxn(
    ctx,
    {
      type: "SUB-INVOICE",
      idempotencyKey: `${args.idempotencyKey}:invoice`,
      currency,
      grossMinor: args.netMinor,
      subjectRefs: { dataProductId: args.dataProductId, subscriberRef: args.subscriberRef },
      ...(deliverTxn ? { parentTxnId: deliverTxn.id } : {})
    },
    { recipe: { lines: buildRecipe("SUB-INVOICE", { netMinor: args.netMinor }), currency } }
  );

  await ctx.db.insert(schema.ledgerInvoices).values({
    id: invoiceId,
    tenantId: ctx.tenantId,
    number: invoiceNumber(invoiceId, ctx.now),
    customerRef: args.subscriberRef,
    subtotalMinor: args.netMinor,
    totalMinor: args.netMinor,
    currency,
    linesJson: JSON.stringify([{ description: `data product ${args.dataProductId} delivery`, amountMinor: args.netMinor }]),
    state: "issued",
    issuedAt: ctx.now,
    txnId: invoiceTxn?.id,
    createdAt: ctx.now,
    updatedAt: ctx.now
  });

  const recogTxn = await runTxn(
    ctx,
    {
      type: "SUB-RECOG",
      idempotencyKey: `${args.idempotencyKey}:recog`,
      currency,
      grossMinor: args.netMinor,
      subjectRefs: { dataProductId: args.dataProductId, invoiceId },
      ...(deliverTxn ? { parentTxnId: deliverTxn.id } : {})
    },
    {
      recipe: {
        lines: buildRecipe("SUB-RECOG", { amountMinor: args.netMinor, incomeAccount: "4060" }),
        currency
      }
    }
  );

  const scheduleId = newId();
  await ctx.db.insert(schema.ledgerRevenueSchedules).values({
    id: scheduleId,
    tenantId: ctx.tenantId,
    invoiceId,
    accountCode: "4060",
    period,
    plannedMinor: args.netMinor,
    recognizedMinor: args.netMinor,
    currency,
    txnId: recogTxn?.id,
    state: "recognized"
  });

  await audit(ctx, {
    action: "billing.dprod.delivered",
    subjectRef: args.dataProductId,
    before: null,
    after: { subscriberRef: args.subscriberRef, netMinor: args.netMinor, invoiceId }
  });
  await emit(ctx, {
    module: "billing",
    type: "billing.dprod.delivered",
    subject: args.dataProductId,
    data: {
      subscriberRef: args.subscriberRef,
      invoiceId,
      netMinor: args.netMinor,
      ...(deliverTxn ? { txnId: deliverTxn.id } : {})
    }
  });

  return { deliverTxnId: deliverTxn?.id, invoiceId, scheduleId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- billing.test.ts`
Expected: PASS (full file — all `recordUsage`, `invoiceNumber`, `sweepBilling`, `subscribeToDataProduct`, `deliverDataProduct` tests green).

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/engines/billing.ts apps/api/src/engines/billing.test.ts
git commit -m "feat(billing): add subscribeToDataProduct and deliverDataProduct with k-anonymity gate"
```

---

### Task 6: Resource lockdown verification

**Files:**
- Read only: `apps/api/src/resources.ts` (lines 800-815)
- No modification expected.

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — verification step.

- [ ] **Step 1: Confirm current state**

Run: `sed -n '800,815p' apps/api/src/resources.ts`

Expected output shows `revenue-schedules` and `usage-meters` already registered as:

```ts
"revenue-schedules": ro("ledger:journals:read"),
"usage-meters": ro("admin:billing:read"),
```

- [ ] **Step 2: Record the outcome**

This task requires no code change. Both resources are already read-only, matching the spec's requirement that `billing.ts` (Tasks 3-5, which now own all writes to `ledgerUsageMeters` and `ledgerRevenueSchedules`) is the sole writer. Do not touch `subscriptions` or `invoices` resource registrations — those remain writable via their existing generic CRUD routes (subscriptions are created out-of-band; invoices keep their existing lifecycle-guarded write path), per spec scope (Group C's spec text only calls out locking `revenue-schedules`/`usage-meters`).

No commit needed for this task (no file changes).

---

### Task 7: Worked-example integration test — full F2 flow

**Files:**
- Test: `apps/api/src/engines/billing.integration.test.ts`

**Interfaces:**
- Consumes: `recordUsage`, `sweepBilling` from Tasks 3-4.
- Produces: nothing new — end-to-end regression coverage.

- [ ] **Step 1: Write the test**

Create `apps/api/src/engines/billing.integration.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { testCtx } from "../test/ctx.js";
import { schema } from "@lyra/db";
import { eq } from "drizzle-orm";
import { recordUsage, sweepBilling } from "./billing.js";

describe("F2 worked example: subscription + overage + recognition", () => {
  it("takes a subscription from due invoice through overage to recognized revenue", async () => {
    const ctx = await testCtx();
    const subId = "sub_worked1";

    await ctx.db.insert(schema.ledgerSubscriptions).values({
      id: subId,
      tenantId: ctx.tenantId,
      customerRef: "cust_worked1",
      plan: "growth",
      priceMinor: 20000,
      currency: "USD",
      interval: "month",
      seats: 3,
      startAt: ctx.now - 1000,
      nextInvoiceAt: ctx.now - 1000,
      state: "active",
      createdAt: ctx.now - 1000,
      updatedAt: ctx.now - 1000
    });

    await recordUsage(ctx, {
      subscriptionId: subId,
      meter: "api-calls",
      period: "2026-08",
      delta: 12000,
      includedQuantity: 10000,
      unitPriceMicro: 500,
      idempotencyKey: "worked1:usage:1"
    });

    // tick 1: raises subscription invoice + applies overage
    const tick1 = await sweepBilling(ctx);
    expect(tick1.invoicesRaised).toBe(1);
    expect(tick1.overagesApplied).toBe(1);

    const invoices = await ctx.db
      .select()
      .from(schema.ledgerInvoices)
      .where(eq(schema.ledgerInvoices.subscriptionId, subId));
    expect(invoices.length).toBe(1); // overage invoice has no subscriptionId column match by design; base invoice only here
    expect(invoices[0]?.totalMinor).toBe(20000);

    // tick 2: recognizes both schedules (subscription + overage, both due same period)
    const tick2 = await sweepBilling(ctx);
    expect(tick2.recognitionsPosted).toBe(2);

    const schedules = await ctx.db
      .select()
      .from(schema.ledgerRevenueSchedules)
      .where(eq(schema.ledgerRevenueSchedules.tenantId, ctx.tenantId));
    expect(schedules.every((s) => s.state === "recognized")).toBe(true);

    // tick 3: nothing left to do
    const tick3 = await sweepBilling(ctx);
    expect(tick3).toEqual({ invoicesRaised: 0, overagesApplied: 0, recognitionsPosted: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- billing.integration.test.ts`
Expected: FAIL if Tasks 3-4 are incomplete; if Tasks 1-6 are already done in sequence, this should mostly pass — treat any failure as a real integration gap, not a scaffolding gap, and fix `billing.ts` rather than the test.

- [ ] **Step 3: Fix any integration gaps found**

If `invoices.length` assertion fails because the overage invoice also lacks a `subscriptionId` match (it's stored with `subscriptionId: meter.subscriptionId`, which does equal `subId`), adjust the test assertion to `expect(invoices.length).toBe(2)` and split `totalMinor` checks per invoice — verify against actual behavior of the Task 4 implementation rather than guessing; whichever is correct, make the test assert the real, intended behavior (both invoices belong to the same subscription).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- billing.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass, no regressions in other engines.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/engines/billing.integration.test.ts
git commit -m "test(billing): add worked-example integration test for F2 subscription+overage+recognition flow"
```

---

## Self-Review

**Spec coverage (spec lines 60-69):**
- `recordUsage()` posting `USAGE-METER` (⊘) → Task 3. ✅
- Monthly sweep raising `SUB-INVOICE`, applying `OVERAGE`, posting `SUB-RECOG` on a recognition schedule → Task 4. ✅
- `DPROD-SUB` (⊘) → Task 5 `subscribeToDataProduct()`. ✅
- `DPROD-DELIVER` (⊘) gated on k-anonymity, precondition-style not a new type → Task 2 (`TXN_PRECONDITIONS`) + Task 5 (`deliverDataProduct()`). ✅
- F3 money leg reusing `SUB-INVOICE`/`SUB-RECOG` with `incomeAccount: "4060"` → Task 5, `incomeAccount` passed only at `SUB-RECOG` call site. ✅
- Lock `revenue-schedules`/`usage-meters` to read-only → Task 6 (verified already true). ✅
- Sweep bounded-bite test (ADR-0050) → Task 4, Step 1, dedicated test. ✅
- k-anonymity refusal test for `DPROD-DELIVER` → Task 2 unit test + Task 5 integration test (no idempotency key burned). ✅
- income-account-4060 assertion for F3 money path → Task 5 test. ✅

**Placeholder scan:** no "TBD"/"handle edge cases"/"similar to Task N" found — every step has literal code, exact file paths, and exact commands.

**Type consistency:** `recordUsage`'s `RecordUsageArgs`, `sweepBilling`'s return shape `{ invoicesRaised, overagesApplied, recognitionsPosted }`, `subscribeToDataProduct`'s `{ txnId }`, and `deliverDataProduct`'s `{ deliverTxnId, invoiceId, scheduleId }` are used consistently across Tasks 3-7 with the same field names throughout.

**Known risk flagged for the implementer:** Task 7 Step 3 explicitly calls out that the exact invoice-count assertion depends on real Task 4 behavior (subscription invoice and overage invoice are separate `ledgerInvoices` rows, both carrying the same `subscriptionId`) — the implementer must verify against actual behavior rather than assume, consistent with "No Placeholders."
