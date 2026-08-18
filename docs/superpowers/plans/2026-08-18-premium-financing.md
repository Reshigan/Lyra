# Premium Financing (F4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tenant finance a policy's premium through a third-party financier: open a plan that pays us commission up front, collect instalments from the financier on a schedule, and cascade N consecutive missed instalments into the policy's existing lapse path.

**Architecture:** One new engine file (`apps/api/src/engines/premium-financing.ts`) owns `createPlan()`, `payInstalment()` and `sweepPremiumFinancing()`. All money movement goes through `runTxn`/`buildRecipe` (docs/19). The plan-create commission is chained to the plan-create transaction via `parentTxnId`. The cron sweep drives instalment collection itself (not just miss detection) and, once a plan's `missedStreak` reaches a fixed threshold, emits an event that a new `axis-lifecycle.ts` consumer turns into the existing `lapsePolicy()` cascade. A new route wraps `createPlan()` in `withIdempotency`. The pre-existing `payment-plans` CRUD resource, currently wide open with no owning engine, is locked to read-only now that this engine owns writes.

**Tech Stack:** Hono routes, Drizzle (SQLite dialect, D1/libSQL), `@lyra/ledger` (`runTxn`, `buildRecipe`, recipe registry), `@lyra/core` (`scoped`, `emit`, `consume`, `withIdempotency`, `badRequest`), Vitest.

## Global Constraints

- Tenancy: every query through `scoped(ctx, table, ...)`. No raw cross-tenant queries.
- Money movement only through `runTxn`/`buildRecipe` with idempotency keys, state machine, balanced double-entry. Never write `ledger_journal_lines` directly.
- Every `runTxn` call whose recipe's posting shape depends on a currency-derived `fxRatePpm` MUST pre-check the rate via `fxRateFor()` before any mutation, and MUST be wrapped in a per-row `try { } catch { continue; }` guard when running inside a loop over multiple rows/plans, so one plan's missing fx rate cannot throw out of the tenant's cron tick (docs/19; proven pattern from `raiseInvoices`/`applyOverages` on the sibling Group C branch — an uncaught throw here kills every other cron job for that tenant that tick).
- Migrations are forward-only, reviewed, never edit an applied migration.
- Events over direct cross-module calls: `axis-lifecycle.ts`'s new consumer reacts to an emitted event (`ledger.financing.lapse_due`), not a direct import from `premium-financing.ts`.
- Reuse the existing lapse cascade (`lapsePolicy()` in `apps/api/src/engines/axis-lifecycle.ts`) — do not add a second cancel/lapse path.
- ADR ceiling on this branch is ADR-0061 (docs/decisions/). Nothing in this plan requires a new ADR — no unresolved design deviation from documented conventions.
- Test files are flat: `apps/api/src/premium-financing.test.ts`, locally-declared helpers (no shared fixture file), matching existing convention (see `axis-lifecycle.test.ts`, `axis-claim-lifecycle.test.ts`).

---

### Task 1: `fxRateFor()` in `packages/ledger`

**Files:**
- Modify: `packages/ledger/src/posting.ts` (add export near top, after imports)
- Test: `packages/ledger/src/posting.test.ts` (create if it does not already exist — check first with `ls packages/ledger/src/*.test.ts`)

**Interfaces:**
- Produces: `export async function fxRateFor(ctx: Ctx, currency: string): Promise<number | undefined>` — returns `PPM` (same-currency short-circuit, `ctx.policy.currency === currency`) or the most recent `ledger_fx_rates` row's `ratePpm` for `currency -> ctx.policy.currency`, or `undefined` if neither exists. Consumed by Task 4/5's `createPlan()`/`payInstalment()`.

- [ ] **Step 1: Write the failing test**

First check whether `packages/ledger/src/posting.test.ts` exists:
```bash
ls packages/ledger/src/*.test.ts
```
If it exists, add the test below to it (matching its existing `describe`/`testCtx`-style setup — read the file first for its exact test-context helper). If it does not exist, create it using the same `testCtx()`/seed pattern as `packages/ledger/src/txn.test.ts` (read that file first for the exact helper shape — table setup, `Ctx` construction, `ctx.policy.currency`).

```typescript
import { describe, expect, it } from "vitest";
import { fxRateFor } from "./posting.js";

describe("fxRateFor", () => {
  it("returns PPM (1_000_000) when currency matches tenant base currency", async () => {
    const ctx = await testCtx({ baseCurrency: "AED" });
    const rate = await fxRateFor(ctx, "AED");
    expect(rate).toBe(1_000_000);
  });

  it("returns the most recent stored rate for a foreign currency", async () => {
    const ctx = await testCtx({ baseCurrency: "AED" });
    await ctx.db.insert(schema.fxRates).values({
      id: "fxr_old",
      tenantId: ctx.tenantId,
      fromCurrency: "USD",
      toCurrency: "AED",
      ratePpm: 3_670_000,
      asOf: "2026-01-01",
      source: "manual"
    });
    await ctx.db.insert(schema.fxRates).values({
      id: "fxr_new",
      tenantId: ctx.tenantId,
      fromCurrency: "USD",
      toCurrency: "AED",
      ratePpm: 3_680_000,
      asOf: "2026-06-01",
      source: "manual"
    });
    const rate = await fxRateFor(ctx, "USD");
    expect(rate).toBe(3_680_000);
  });

  it("returns undefined when no rate exists for the currency pair", async () => {
    const ctx = await testCtx({ baseCurrency: "AED" });
    const rate = await fxRateFor(ctx, "JPY");
    expect(rate).toBeUndefined();
  });
});
```

Match the file's actual `testCtx`/`schema` import paths exactly — read the neighboring test file first, then adapt.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lyra/ledger test -- posting.test.ts`
Expected: FAIL — `fxRateFor is not a function` / `does not provide an export named 'fxRateFor'`.

- [ ] **Step 3: Implement `fxRateFor()`**

In `packages/ledger/src/posting.ts`, add after the existing imports (the file already imports `and`, `eq`, `sql` from `drizzle-orm`, `schema` from `@lyra/db`, `PPM` from `@lyra/core`; add `desc` to the drizzle-orm import and `scoped` to the `@lyra/core` import):

```typescript
import { and, desc, eq, sql } from "drizzle-orm";
// ... existing @lyra/db import unchanged ...
import { PPM, actorRef, applyPpm, badRequest, conflict, scoped, type Ctx } from "@lyra/core";
```

Then add the function, placed right after the module-level docstring block and before `export type Side`:

```typescript
/**
 * Most recent stored rate for `currency -> ctx.policy.currency`, or PPM
 * (1_000_000) when they're the same currency. Undefined means "no rate on
 * file" — callers decide whether that's a hard stop or a skip-this-row.
 */
export async function fxRateFor(ctx: Ctx, currency: string): Promise<number | undefined> {
  if (currency === ctx.policy.currency) return PPM;
  const rows = await ctx.db
    .select({ ratePpm: schema.fxRates.ratePpm })
    .from(schema.fxRates)
    .where(scoped(ctx, schema.fxRates, eq(schema.fxRates.fromCurrency, currency), eq(schema.fxRates.toCurrency, ctx.policy.currency)))
    .orderBy(desc(schema.fxRates.asOf))
    .limit(1);
  return rows[0]?.ratePpm;
}
```

- [ ] **Step 4: Update the fx fallback at the existing bug site**

At line ~131 in the same file, the `post()` function currently reads:

```typescript
  const fxRatePpm = input.fxRatePpm ?? (input.currency === baseCurrency ? PPM : undefined);
  if (!fxRatePpm) throw badRequest(`no fx rate supplied for ${input.currency} -> ${baseCurrency}`);
```

Leave this exactly as-is — `post()` is a synchronous posting primitive and stays that way; `fxRateFor()` is a separate async pre-check callers use *before* calling `runTxn`, passing the result through `opts.recipe.fxRatePpm`. No change needed here; this step exists only to confirm (by re-reading) that `post()`'s contract is unchanged by this task.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @lyra/ledger test -- posting.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 6: Run full ledger suite and typecheck**

Run: `pnpm --filter @lyra/ledger test && pnpm --filter @lyra/ledger typecheck`
Expected: all green, no regressions.

- [ ] **Step 7: Commit**

```bash
git add packages/ledger/src/posting.ts packages/ledger/src/posting.test.ts
git commit -m "feat(ledger): add fxRateFor pre-check for currency-dependent postings"
```

---

### Task 2: `PLAN-CREATE` transaction type

**Files:**
- Modify: `packages/ledger/src/types.ts:103` (insert between `PREM-COLLECT` and `PREM-INSTALMENT`)
- Test: `packages/ledger/src/types.test.ts` (check with `ls` first; if absent, add to `packages/ledger/src/txn.test.ts` instead — read it first to confirm it already exercises `txnType()`/`TXN_TYPES` lookups)

**Interfaces:**
- Produces: `TXN_TYPES` entry `["PLAN-CREATE", false, null]` — a non-financial, non-gated transaction type, consumed by Task 4's `createPlan()`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { txnType } from "./types.js";

describe("PLAN-CREATE txn type", () => {
  it("is registered as non-financial with no approval gate", () => {
    const t = txnType("PLAN-CREATE");
    expect(t.financial).toBe(false);
    expect(t.approvalGate).toBeNull();
  });
});
```

Read `packages/ledger/src/types.ts`'s `txnType()` signature first and match its actual return shape (field names may differ from `financial`/`approvalGate` — confirm against how existing tests assert on, e.g., `LAPSE` or `INCEPT`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lyra/ledger test -- types.test.ts` (or `txn.test.ts`, whichever file the test landed in)
Expected: FAIL — unknown transaction type `PLAN-CREATE`.

- [ ] **Step 3: Add the entry**

In `packages/ledger/src/types.ts`, change:

```typescript
  ["PREM-COLLECT", true, null],
  ["PREM-INSTALMENT", true, null],
```

to:

```typescript
  ["PREM-COLLECT", true, null],
  // Opening a financing plan moves no money itself — it's the FIN-CMSN txn
  // chained off it (via parentTxnId) that posts the commission.
  ["PLAN-CREATE", false, null],
  ["PREM-INSTALMENT", true, null],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lyra/ledger test -- types.test.ts` (or `txn.test.ts`)
Expected: PASS.

- [ ] **Step 5: Run full ledger suite**

Run: `pnpm --filter @lyra/ledger test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/ledger/src/types.ts packages/ledger/src/types.test.ts
git commit -m "feat(ledger): register PLAN-CREATE transaction type"
```

(Adjust the `git add` test path if the test landed in `txn.test.ts` instead.)

---

### Task 3: `missedStreak` column on `paymentPlans`

**Files:**
- Modify: `packages/db/src/schema/ledger.ts:379-395` (add column)
- Create: `packages/db/migrations/0025_<generated-name>.sql` (via drizzle-kit, name auto-generated)

**Interfaces:**
- Produces: `schema.ledgerPaymentPlans.missedStreak` (integer, not null, default 0) — consumed by Task 5's `payInstalment()`/`sweepPremiumFinancing()`.

- [ ] **Step 1: Add the column**

In `packages/db/src/schema/ledger.ts`, change the `paymentPlans` table definition:

```typescript
export const paymentPlans = sqliteTable(
  "ledger_payment_plans",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    subjectRef: text("subject_ref").notNull(), // policy id
    financierRef: text("financier_ref"),
    totalMinor: integer("total_minor").notNull(),
    currency: text("currency").notNull(),
    instalments: integer("instalments").notNull(),
    scheduleJson: text("schedule_json").notNull(),
    state: text("state").notNull().default("active"), // active|completed|defaulted|cancelled
    missedStreak: integer("missed_streak").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [index("ledger_payment_plans_idx").on(t.tenantId, t.state)]
);
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @lyra/db generate`
Expected: a new file `packages/db/migrations/00NN_<name>.sql` containing `ALTER TABLE ledger_payment_plans ADD ... missed_streak integer DEFAULT 0 NOT NULL;` (or equivalent). Note: if the generated number collides with a sibling group branch's migration at merge time, that's a known, already-tracked cross-branch renumbering step (per Group C's progress ledger) — not a blocker here.

- [ ] **Step 3: Apply migration locally and run db package tests**

Run: `pnpm --filter @lyra/db test`
Expected: all green (migration applies cleanly against the test D1/libSQL instance).

- [ ] **Step 4: Regenerate the SDK if it references this table's shape**

Run: `pnpm --filter @lyra/sdk generate` then `pnpm --filter @lyra/sdk typecheck`
Expected: clean regeneration, no errors. (Group C hit a stale-SDK issue from an earlier migration; regenerate proactively rather than discover it later.)

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/ledger.ts packages/db/migrations packages/sdk/src/generated.ts
git commit -m "feat(db): add missed_streak to ledger_payment_plans"
```

---

### Task 4: `createPlan()` — open a financing plan, chain the commission

**Files:**
- Create: `apps/api/src/engines/premium-financing.ts`
- Test: `apps/api/src/premium-financing.test.ts`

**Interfaces:**
- Consumes: `schema.axisPolicies` (`PolicyRow` shape per `packages/db/src/schema/axis.ts`), `schema.ledgerPaymentPlans`, `runTxn`/`buildRecipe` from `@lyra/ledger`, `fxRateFor` from `@lyra/ledger` (Task 1), `id as newId`/`schema` from `@lyra/db`, `scoped`/`badRequest`/`type Ctx` from `@lyra/core`.
- Produces:
  - `export interface CreatePlanInput { financierRef?: string; totalMinor: number; currency: string; instalments: number; startAt: number; frequencyDays: number; commissionMinor: number; commissionTaxMinor?: number; }`
  - `export interface ScheduleRow { seq: number; dueAt: number; amountMinor: number; state: "pending" | "paid" | "missed"; }`
  - `export async function createPlan(ctx: Ctx, policy: PolicyRow, input: CreatePlanInput): Promise<{ plan: typeof schema.ledgerPaymentPlans.$inferSelect; txn: { id: string } }>` — consumed by Task 5 (route wiring) and reused directly by tests.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@lyra/db";
import { createPlan } from "./engines/premium-financing.js";
import { seedTenantAndPolicy, testCtx } from "./axis-lifecycle.test.js"; // read this file first: if these helpers aren't exported, copy their bodies locally instead — this test file follows the flat/local-helper convention, not shared fixtures

describe("createPlan", () => {
  it("opens a non-financial PLAN-CREATE txn, chains a balanced FIN-CMSN commission, and stores the schedule", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const now = ctx.now;

    const { plan, txn } = await createPlan(ctx, policy, {
      totalMinor: 120_000,
      currency: "AED",
      instalments: 12,
      startAt: now,
      frequencyDays: 30,
      commissionMinor: 15_000,
      commissionTaxMinor: 700
    });

    expect(plan.subjectRef).toBe(policy.id);
    expect(plan.totalMinor).toBe(120_000);
    expect(plan.state).toBe("active");
    expect(plan.missedStreak).toBe(0);
    const schedule = JSON.parse(plan.scheduleJson);
    expect(schedule).toHaveLength(12);
    expect(schedule[0]).toEqual({ seq: 1, dueAt: now, amountMinor: 10_000, state: "pending" });
    expect(schedule[11].dueAt).toBe(now + 11 * 30 * 86_400_000);

    const lines = await ctx.db
      .select()
      .from(schema.ledgerJournalLines)
      .where(eq(schema.ledgerJournalLines.txnId, txn.id));
    // PLAN-CREATE itself is non-financial (no lines); the chained FIN-CMSN txn
    // carries the balanced double-entry, so look it up via parentTxnId.
    const child = await ctx.db
      .select()
      .from(schema.ledgerTxns)
      .where(eq(schema.ledgerTxns.parentTxnId, txn.id));
    expect(child).toHaveLength(1);
    expect(child[0].type).toBe("FIN-CMSN");

    const childLines = await ctx.db
      .select()
      .from(schema.ledgerJournalLines)
      .where(eq(schema.ledgerJournalLines.txnId, child[0].id));
    const byAccount = Object.fromEntries(childLines.map((l) => [l.accountCode, { side: l.side, amountMinor: l.amountMinor }]));
    expect(byAccount["1150"]).toEqual({ side: "debit", amountMinor: 15_000 });
    expect(byAccount["4080"]).toEqual({ side: "credit", amountMinor: 14_300 });
    expect(byAccount["2200"]).toEqual({ side: "credit", amountMinor: 700 });
  });

  it("throws badRequest when the plan currency has no fx rate to the tenant base currency", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    await expect(
      createPlan(ctx, policy, {
        totalMinor: 120_000,
        currency: "JPY",
        instalments: 12,
        startAt: ctx.now,
        frequencyDays: 30,
        commissionMinor: 15_000
      })
    ).rejects.toThrow(/no.*fx rate|fx rate/i);
  });
});
```

Read `apps/api/src/axis-lifecycle.test.ts` and `apps/api/src/axis-claim-lifecycle.test.ts` first for the exact local seed-helper shape (tenant + policy creation, `Ctx` construction, `schema.ledgerTxns`/`schema.ledgerJournalLines` table names) and adapt the test above to match exactly — do not invent table or column names not already confirmed in those files.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- premium-financing.test.ts`
Expected: FAIL — `Cannot find module './engines/premium-financing.js'`.

- [ ] **Step 3: Implement `createPlan()`**

Create `apps/api/src/engines/premium-financing.ts`:

```typescript
import { and, eq } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { badRequest, scoped, type Ctx } from "@lyra/core";
import { buildRecipe, fxRateFor, runTxn } from "@lyra/ledger";

export type PolicyRow = typeof schema.axisPolicies.$inferSelect;
export type PaymentPlanRow = typeof schema.ledgerPaymentPlans.$inferSelect;

export interface ScheduleRow {
  seq: number;
  dueAt: number;
  amountMinor: number;
  state: "pending" | "paid" | "missed";
}

export interface CreatePlanInput {
  financierRef?: string;
  totalMinor: number;
  currency: string;
  instalments: number;
  startAt: number;
  frequencyDays: number;
  commissionMinor: number;
  commissionTaxMinor?: number;
}

/** Three consecutive missed instalments cascade into policy lapse. */
export const DUNNING_LAPSE_THRESHOLD = 3;

function buildSchedule(input: CreatePlanInput): ScheduleRow[] {
  const perInstalment = Math.round(input.totalMinor / input.instalments);
  return Array.from({ length: input.instalments }, (_, i) => ({
    seq: i + 1,
    dueAt: input.startAt + i * input.frequencyDays * 86_400_000,
    amountMinor: perInstalment,
    state: "pending" as const
  }));
}

export async function createPlan(
  ctx: Ctx,
  policy: PolicyRow,
  input: CreatePlanInput
): Promise<{ plan: PaymentPlanRow; txn: { id: string } }> {
  const fxRatePpm = await fxRateFor(ctx, input.currency);
  if (!fxRatePpm) {
    throw badRequest(`no fx rate supplied for ${input.currency} -> ${ctx.policy.currency}`);
  }

  const planId = newId("finplan", ctx.now);
  const schedule = buildSchedule(input);

  const txn = await runTxn(ctx, {
    type: "PLAN-CREATE",
    idempotencyKey: `finance.plan_create:${planId}`,
    currency: input.currency,
    subjectRefs: { policy: policy.id, plan: planId }
  });

  await ctx.db.insert(schema.ledgerPaymentPlans).values({
    id: planId,
    tenantId: ctx.tenantId,
    subjectRef: policy.id,
    financierRef: input.financierRef ?? null,
    totalMinor: input.totalMinor,
    currency: input.currency,
    instalments: input.instalments,
    scheduleJson: JSON.stringify(schedule),
    state: "active",
    missedStreak: 0,
    createdAt: ctx.now,
    updatedAt: ctx.now
  });

  const commissionLines = buildRecipe("FIN-CMSN", {
    grossMinor: input.commissionMinor,
    taxMinor: input.commissionTaxMinor ?? 0,
    memo: `financing commission: plan ${planId}`,
    dims: { policy: policy.id }
  });

  await runTxn(ctx, {
    type: "FIN-CMSN",
    idempotencyKey: `finance.plan_commission:${planId}`,
    currency: input.currency,
    parentTxnId: txn.id,
    subjectRefs: { policy: policy.id, plan: planId }
  }, { recipe: { lines: commissionLines, currency: input.currency, fxRatePpm } });

  const [plan] = await ctx.db
    .select()
    .from(schema.ledgerPaymentPlans)
    .where(scoped(ctx, schema.ledgerPaymentPlans, eq(schema.ledgerPaymentPlans.id, planId)));

  return { plan, txn: { id: txn.id } };
}
```

Before finalizing: read `packages/ledger/src/txn.ts`'s `runTxn()` signature in full (already confirmed in this session to take `(ctx, input: OpenTxnInput, opts?: RunOptions)` where `RunOptions` includes `recipe?: Recipe`) and `buildRecipe`'s exact export path (`packages/ledger/src/recipes.ts`, re-exported from the package root — confirm via `packages/ledger/src/index.ts`) — adjust the two `runTxn` call shapes above only if the actual signature differs from what's written here, keeping the same field names (`type`, `idempotencyKey`, `currency`, `parentTxnId`, `subjectRefs`, and `opts.recipe.{lines,currency,fxRatePpm}`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- premium-financing.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 5: Run full api + ledger suites and typecheck**

Run: `pnpm --filter api test && pnpm --filter @lyra/ledger test && pnpm --filter api typecheck`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/engines/premium-financing.ts apps/api/src/premium-financing.test.ts
git commit -m "feat(api): premium financing createPlan with chained commission"
```

---

### Task 5: `payInstalment()` + `sweepPremiumFinancing()` + cron wiring

**Files:**
- Modify: `apps/api/src/engines/premium-financing.ts` (add functions)
- Modify: `apps/api/src/index.ts:5,189-190` (import + cron call)
- Test: `apps/api/src/premium-financing.test.ts` (extend)

**Interfaces:**
- Consumes: Task 4's `PaymentPlanRow`, `ScheduleRow`, `DUNNING_LAPSE_THRESHOLD`; `SWEEP_MAX` from `apps/api/src/engines/sweep.ts`; `emit` from `@lyra/core`.
- Produces:
  - `export async function payInstalment(ctx: Ctx, plan: PaymentPlanRow, now: number): Promise<void>` — collects every due-and-pending schedule row, posts `PREM-INSTALMENT` per success or `DUNNING` per miss, persists the updated schedule/`missedStreak`, emits `ledger.financing.lapse_due` once the streak crosses the threshold. Consumed by `sweepPremiumFinancing()` and directly by tests.
  - `export async function sweepPremiumFinancing(ctx: Ctx): Promise<number>` — selects up to `SWEEP_MAX` active plans and calls `payInstalment()` on each, returning the count processed. Consumed by `apps/api/src/index.ts`'s cron `scheduled()` handler and directly by tests.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/premium-financing.test.ts`:

```typescript
import { payInstalment, sweepPremiumFinancing, DUNNING_LAPSE_THRESHOLD } from "./engines/premium-financing.js";

describe("payInstalment", () => {
  it("collects a due instalment via PREM-INSTALMENT and marks the row paid", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const { plan } = await createPlan(ctx, policy, {
      totalMinor: 120_000, currency: "AED", instalments: 12,
      startAt: ctx.now, frequencyDays: 30, commissionMinor: 15_000
    });

    await payInstalment(ctx, plan, ctx.now);

    const [after] = await ctx.db.select().from(schema.ledgerPaymentPlans).where(eq(schema.ledgerPaymentPlans.id, plan.id));
    const schedule = JSON.parse(after.scheduleJson);
    expect(schedule[0].state).toBe("paid");
    expect(after.missedStreak).toBe(0);

    const txns = await ctx.db.select().from(schema.ledgerTxns).where(eq(schema.ledgerTxns.type, "PREM-INSTALMENT"));
    expect(txns).toHaveLength(1);
  });

  it("posts DUNNING and increments missedStreak when fx rate is missing for the plan currency, without throwing", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const { plan } = await createPlan(ctx, policy, {
      totalMinor: 120_000, currency: "AED", instalments: 12,
      startAt: ctx.now, frequencyDays: 30, commissionMinor: 15_000
    });
    // Force the plan into a currency with no fx rate on file, simulating the
    // guard's target scenario without needing a second seeded currency.
    await ctx.db.update(schema.ledgerPaymentPlans).set({ currency: "JPY" }).where(eq(schema.ledgerPaymentPlans.id, plan.id));
    const [jpyPlan] = await ctx.db.select().from(schema.ledgerPaymentPlans).where(eq(schema.ledgerPaymentPlans.id, plan.id));

    await expect(payInstalment(ctx, jpyPlan, ctx.now)).resolves.not.toThrow();

    const [after] = await ctx.db.select().from(schema.ledgerPaymentPlans).where(eq(schema.ledgerPaymentPlans.id, plan.id));
    expect(after.missedStreak).toBe(1);
    const schedule = JSON.parse(after.scheduleJson);
    expect(schedule[0].state).toBe("missed");
    const dunning = await ctx.db.select().from(schema.ledgerTxns).where(eq(schema.ledgerTxns.type, "DUNNING"));
    expect(dunning).toHaveLength(1);
  });

  it("emits ledger.financing.lapse_due once missedStreak reaches the threshold", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const { plan } = await createPlan(ctx, policy, {
      totalMinor: 120_000, currency: "AED", instalments: 12,
      startAt: ctx.now, frequencyDays: 30, commissionMinor: 15_000
    });
    await ctx.db.update(schema.ledgerPaymentPlans)
      .set({ currency: "JPY", missedStreak: DUNNING_LAPSE_THRESHOLD - 1 })
      .where(eq(schema.ledgerPaymentPlans.id, plan.id));
    const [row] = await ctx.db.select().from(schema.ledgerPaymentPlans).where(eq(schema.ledgerPaymentPlans.id, plan.id));

    await payInstalment(ctx, row, ctx.now);

    const events = await ctx.db.select().from(schema.eventOutbox).where(eq(schema.eventOutbox.type, "ledger.financing.lapse_due"));
    expect(events).toHaveLength(1);
  });
});

describe("sweepPremiumFinancing", () => {
  it("processes every active plan due for collection and does not throw when one plan's currency has no fx rate", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const good = await createPlan(ctx, policy, {
      totalMinor: 120_000, currency: "AED", instalments: 12,
      startAt: ctx.now, frequencyDays: 30, commissionMinor: 15_000
    });
    const bad = await createPlan(ctx, policy, {
      totalMinor: 60_000, currency: "AED", instalments: 6,
      startAt: ctx.now, frequencyDays: 30, commissionMinor: 6_000
    });
    await ctx.db.update(schema.ledgerPaymentPlans).set({ currency: "JPY" }).where(eq(schema.ledgerPaymentPlans.id, bad.plan.id));

    const count = await sweepPremiumFinancing(ctx);

    expect(count).toBe(2);
    const [goodAfter] = await ctx.db.select().from(schema.ledgerPaymentPlans).where(eq(schema.ledgerPaymentPlans.id, good.plan.id));
    const [badAfter] = await ctx.db.select().from(schema.ledgerPaymentPlans).where(eq(schema.ledgerPaymentPlans.id, bad.plan.id));
    expect(JSON.parse(goodAfter.scheduleJson)[0].state).toBe("paid");
    expect(badAfter.missedStreak).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api test -- premium-financing.test.ts`
Expected: FAIL — `payInstalment`/`sweepPremiumFinancing` not exported.

- [ ] **Step 3: Implement `payInstalment()` and `sweepPremiumFinancing()`**

Append to `apps/api/src/engines/premium-financing.ts` (add `emit` to the `@lyra/core` import and `SWEEP_MAX` import):

```typescript
import { badRequest, emit, scoped, type Ctx } from "@lyra/core";
import { SWEEP_MAX } from "./sweep.js";
```

(Merge this into the existing import lines from Task 4 rather than duplicating the `@lyra/core` import.)

```typescript
export async function payInstalment(ctx: Ctx, plan: PaymentPlanRow, now: number): Promise<void> {
  const schedule: ScheduleRow[] = JSON.parse(plan.scheduleJson);
  let missedStreak = plan.missedStreak;
  let dueDunned = false;

  for (const row of schedule) {
    if (row.state !== "pending" || row.dueAt > now) continue;

    let fxRatePpm: number | undefined;
    try {
      fxRatePpm = await fxRateFor(ctx, plan.currency);
      if (!fxRatePpm) throw badRequest(`no fx rate supplied for ${plan.currency} -> ${ctx.policy.currency}`);

      const lines = buildRecipe("PREM-INSTALMENT", {
        amountMinor: row.amountMinor,
        memo: `instalment ${row.seq}/${plan.instalments}: plan ${plan.id}`,
        dims: { policy: plan.subjectRef }
      });
      await runTxn(
        ctx,
        {
          type: "PREM-INSTALMENT",
          idempotencyKey: `finance.instalment:${plan.id}:${row.seq}`,
          currency: plan.currency,
          subjectRefs: { policy: plan.subjectRef, plan: plan.id }
        },
        { recipe: { lines, currency: plan.currency, fxRatePpm } }
      );
      row.state = "paid";
      missedStreak = 0;
    } catch (err) {
      // A missing fx rate (or any other posting failure) must not throw out of
      // the sweep loop — every other plan in this tenant's tick, and every
      // other cron job after sweepPremiumFinancing, has to keep running.
      row.state = "missed";
      missedStreak += 1;
      dueDunned = true;
      await runTxn(ctx, {
        type: "DUNNING",
        idempotencyKey: `finance.dunning:${plan.id}:${row.seq}`,
        currency: plan.currency,
        subjectRefs: { policy: plan.subjectRef, plan: plan.id },
        metadata: { reason: err instanceof Error ? err.message : String(err), seq: row.seq }
      });
    }
  }

  await ctx.db
    .update(schema.ledgerPaymentPlans)
    .set({ scheduleJson: JSON.stringify(schedule), missedStreak, updatedAt: now })
    .where(scoped(ctx, schema.ledgerPaymentPlans, eq(schema.ledgerPaymentPlans.id, plan.id)));

  if (dueDunned && missedStreak >= DUNNING_LAPSE_THRESHOLD) {
    const missedSeq = [...schedule].reverse().find((r) => r.state === "missed")?.seq ?? 0;
    await emit(ctx, {
      module: "ledger",
      type: "ledger.financing.lapse_due",
      subject: `plan:${plan.id}`,
      data: { policyId: plan.subjectRef, planId: plan.id, missedStreak, missedSeq }
    });
  }
}

export async function sweepPremiumFinancing(ctx: Ctx): Promise<number> {
  const plans = await ctx.db
    .select()
    .from(schema.ledgerPaymentPlans)
    .where(scoped(ctx, schema.ledgerPaymentPlans, eq(schema.ledgerPaymentPlans.state, "active")))
    .limit(SWEEP_MAX);

  for (const plan of plans) {
    // One plan's fully-caught failure (fx guard above) must not stop the rest
    // of this tenant's plans, or the rest of the tenant's cron tick.
    try {
      await payInstalment(ctx, plan, ctx.now);
    } catch (err) {
      console.error("premium-financing: sweep failed for plan", { planId: plan.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return plans.length;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter api test -- premium-financing.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Wire the cron sweep**

In `apps/api/src/index.ts`, add the import near the other engine imports (after line 5):

```typescript
import { sweepPolicyLifecycle } from "./engines/axis-lifecycle.js";
import { sweepPremiumFinancing } from "./engines/premium-financing.js";
```

Then insert the call after line 189 (`await sweepPolicyLifecycle(ctx);`), before line 190 (`await sweepRenewals(ctx, env.WF);`):

```typescript
            await sweepPolicyLifecycle(ctx);
            // Collect due instalments and detect dunning cascades before renewals
            // look at this tenant's policies this tick.
            await sweepPremiumFinancing(ctx);
            await sweepRenewals(ctx, env.WF);
```

- [ ] **Step 6: Run full api suite and typecheck**

Run: `pnpm --filter api test && pnpm --filter api typecheck`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/engines/premium-financing.ts apps/api/src/premium-financing.test.ts apps/api/src/index.ts
git commit -m "feat(api): instalment collection, dunning, and premium-financing cron sweep"
```

---

### Task 6: Dunning-to-lapse cascade

**Files:**
- Modify: `apps/api/src/engines/axis-lifecycle.ts` (add `onFinancingLapseDue`)
- Modify: `apps/api/src/dispatch.ts` (wire the new event)
- Test: `apps/api/src/axis-lifecycle.test.ts` (extend) or `apps/api/src/premium-financing.test.ts`, whichever already imports both `onFinancingLapseDue` and `dispatch`'s `consume` helper more naturally — check both files first, pick the one with less new plumbing

**Interfaces:**
- Consumes: `lapsePolicy(ctx, policy: PolicyRow, missedSeq: number, reason: string)` (already exists, `apps/api/src/engines/axis-lifecycle.ts`), `schema.axisPolicies`, `Envelope` type from `@lyra/core`, the `ledger.financing.lapse_due` event shape from Task 5 (`data: { policyId, planId, missedStreak, missedSeq }`).
- Produces: `export async function onFinancingLapseDue(ctx: Ctx, envelope: Envelope): Promise<void>` — consumed by `dispatch.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
import { onFinancingLapseDue } from "./engines/axis-lifecycle.js";
import { sweepPremiumFinancing, createPlan, DUNNING_LAPSE_THRESHOLD } from "./engines/premium-financing.js";

describe("onFinancingLapseDue", () => {
  it("lapses the policy via the existing lapsePolicy cascade", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const { plan } = await createPlan(ctx, policy, {
      totalMinor: 120_000, currency: "AED", instalments: 12,
      startAt: ctx.now, frequencyDays: 30, commissionMinor: 15_000
    });
    await ctx.db.update(schema.ledgerPaymentPlans)
      .set({ currency: "JPY", missedStreak: DUNNING_LAPSE_THRESHOLD - 1 })
      .where(eq(schema.ledgerPaymentPlans.id, plan.id));

    await sweepPremiumFinancing(ctx); // this tick's miss crosses the threshold and emits

    const [event] = await ctx.db.select().from(schema.eventOutbox).where(eq(schema.eventOutbox.type, "ledger.financing.lapse_due"));
    const envelope = { ...event, data: JSON.parse(event.data as unknown as string) }; // adapt to however eventOutbox rows actually deserialize — read dispatch.ts's consume() call site first for the exact envelope shape passed to handlers

    await onFinancingLapseDue(ctx, envelope as never);

    const [after] = await ctx.db.select().from(schema.axisPolicies).where(eq(schema.axisPolicies.id, policy.id));
    expect(after.status).toBe("lapsed");
  });
});
```

Read `apps/api/src/axis-lifecycle.test.ts`'s existing event-driven consumer tests (e.g. any test that already builds an `Envelope` by hand to call a `on*` handler directly) for the exact envelope-construction idiom, and use that instead of the ad-hoc JSON.parse above if one already exists in this codebase.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- axis-lifecycle.test.ts` (or wherever the test landed)
Expected: FAIL — `onFinancingLapseDue` not exported.

- [ ] **Step 3: Implement `onFinancingLapseDue()`**

In `apps/api/src/engines/axis-lifecycle.ts`, add near `lapsePolicy` (same file already imports `schema`, `scoped`, `eq`, `type Ctx`, `type Envelope` — reuse, don't re-import):

```typescript
export async function onFinancingLapseDue(ctx: Ctx, envelope: Envelope): Promise<void> {
  const data = envelope.data as { policyId: string; planId: string; missedStreak: number; missedSeq: number };
  const [policy] = await ctx.db
    .select()
    .from(schema.axisPolicies)
    .where(scoped(ctx, schema.axisPolicies, eq(schema.axisPolicies.id, data.policyId)));
  if (!policy) return; // policy already gone (deleted/merged) — nothing to lapse
  if (policy.status === "lapsed") return; // already lapsed, e.g. by a concurrent path

  await lapsePolicy(ctx, policy, data.missedSeq, `premium financing plan ${data.planId}: ${data.missedStreak} consecutive missed instalments`);
}
```

- [ ] **Step 4: Wire the dispatch consumer**

In `apps/api/src/dispatch.ts`, add the import alongside the existing engine imports:

```typescript
import { onFinancingLapseDue } from "./engines/axis-lifecycle.js";
```

(If `axis-lifecycle.js` is already imported in this file for another handler, merge into that import line instead of adding a new one.)

Then add a branch alongside the existing `if (event.type === "...")` consumer branches:

```typescript
  if (event.type === "ledger.financing.lapse_due") {
    await consume(ctx.db, event, "axis.lifecycle", (e) => onFinancingLapseDue(ctx, e), ctx.now);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter api test -- axis-lifecycle.test.ts` (or wherever landed)
Expected: PASS.

- [ ] **Step 6: Run full api suite and typecheck**

Run: `pnpm --filter api test && pnpm --filter api typecheck`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/engines/axis-lifecycle.ts apps/api/src/dispatch.ts apps/api/src/axis-lifecycle.test.ts apps/api/src/premium-financing.test.ts
git commit -m "feat(api): cascade financing dunning into existing policy lapse path"
```

(Adjust the `git add` test paths to whichever file actually received the new test.)

---

### Task 7: Route + resource lockdown

**Files:**
- Modify: `apps/api/src/routes/axis.ts` (add route)
- Modify: `apps/api/src/resources.ts:815` (lock down `payment-plans`)
- Test: `apps/api/src/premium-financing.test.ts` (extend, route-level test) and `apps/api/src/axis.test.ts` if resource-route regression tests already live there — check first

**Interfaces:**
- Consumes: `createPlan()` (Task 4), `withIdempotency` (`packages/core/src/idempotency.ts`), the existing `withIdempotency(ctx, key, path, input, handler)` call pattern already used 10+ times in `apps/api/src/routes/axis.ts` (e.g. the lapse route).
- Produces: `POST /v1/axis/policies/:id/premium-financing-plan` — new HTTP route.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/premium-financing.test.ts` (adapt to however `axis.ts`'s existing route tests construct a request — read one existing route test in `apps/api/src/axis.test.ts` first, e.g. the lapse route's test, for the exact `app.request(...)` / auth-header shape):

```typescript
describe("POST /v1/axis/policies/:id/premium-financing-plan", () => {
  it("creates a plan and is idempotent under a repeated idempotency key", async () => {
    const { ctx, policy, headers } = await seedTenantAndPolicy({ currency: "AED" }); // adapt: use whatever this test file's existing route-test helper returns for auth headers
    const body = {
      totalMinor: 120_000, currency: "AED", instalments: 12,
      startAt: ctx.now, frequencyDays: 30, commissionMinor: 15_000
    };
    const key = "idem-plan-1";

    const first = await app.request(`/v1/axis/policies/${policy.id}/premium-financing-plan`, {
      method: "POST",
      headers: { ...headers, "idempotency-key": key, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    expect(first.status).toBe(200);
    const firstJson = await first.json();

    const second = await app.request(`/v1/axis/policies/${policy.id}/premium-financing-plan`, {
      method: "POST",
      headers: { ...headers, "idempotency-key": key, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const secondJson = await second.json();
    expect(secondJson.plan.id).toBe(firstJson.plan.id);

    const plans = await ctx.db.select().from(schema.ledgerPaymentPlans).where(eq(schema.ledgerPaymentPlans.subjectRef, policy.id));
    expect(plans).toHaveLength(1); // not 2 — the replay didn't insert a second row
  });
});

describe("payment-plans resource route (regression)", () => {
  it("rejects a direct create against the generic CRUD route", async () => {
    const { headers } = await seedTenantAndPolicy({ currency: "AED" });
    const res = await app.request("/v1/ledger/payment-plans", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ subjectRef: "pol_x", totalMinor: 1000, currency: "AED", instalments: 1, scheduleJson: "[]" })
    });
    expect(res.status).toBe(403);
  });
});
```

Read `apps/api/src/axis.test.ts`'s existing route tests and `apps/api/src/resources.test.ts` (or wherever the generic-CRUD permission tests live — check with `grep -rn "403" apps/api/src/*.test.ts | grep -i resource`) for the exact `app` import and auth-header helper, and adapt both tests above to match precisely.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api test -- premium-financing.test.ts`
Expected: FAIL — 404 on the new route (not yet mounted); the resource test currently passes with 200/201 (proves the live gap the brief describes) rather than 403.

- [ ] **Step 3: Add the route**

In `apps/api/src/routes/axis.ts`, add near the other policy-lifecycle routes (same file, same conventions as the lapse route at line ~1146-1153 — reuse its imports: `withIdempotency`, `createPlan` needs a new import from `../engines/premium-financing.js`):

```typescript
import { createPlan, type CreatePlanInput } from "../engines/premium-financing.js";
```

```typescript
axisRoutes.post("/policies/:id/premium-financing-plan", async (c) => {
  const ctx = c.get("ctx");
  const policyId = c.req.param("id");
  const [policy] = await ctx.db
    .select()
    .from(schema.axisPolicies)
    .where(scoped(ctx, schema.axisPolicies, eq(schema.axisPolicies.id, policyId)));
  if (!policy) throw notFound(`policy ${policyId}`);

  const input = (await c.req.json()) as CreatePlanInput;
  const key = c.req.header("idempotency-key");
  const out = await withIdempotency(ctx, key, `POST ${c.req.path}`, input, () => createPlan(ctx, policy, input));
  return c.json(out);
});
```

Match this to the file's actual imports already in scope (`scoped`, `eq`, `notFound`, `withIdempotency`, `schema` are all already imported in `axis.ts` per the lapse route's own usage — confirm exact names before adding a duplicate import) and to the file's actual router variable name (confirmed as `axisRoutes` from `apps/api/src/index.ts`'s `import { axisRoutes } from "./routes/axis.js"`).

- [ ] **Step 4: Lock down the `payment-plans` resource**

In `apps/api/src/resources.ts`, change line 815 from:

```typescript
  r("payment-plans", schema.ledgerPaymentPlans, "ppl", "ledger", {
```

(and its wide-open permission object) to match the adjacent `payments` line's style exactly:

```typescript
  r("payment-plans", schema.ledgerPaymentPlans, "ppl", "ledger", ro("ledger:payments:read")),
```

Delete the old multi-line permission object entirely — `ro()` is already imported/defined in this file (confirmed: `const ro = (perm: string) => ({ read: perm });` at line 60).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter api test -- premium-financing.test.ts`
Expected: PASS — plan-create route returns 200 and is idempotent; direct CRUD create now 403s.

- [ ] **Step 6: Run full api suite, typecheck, lint**

Run: `pnpm --filter api test && pnpm --filter api typecheck && pnpm --filter api lint`
Expected: all green. Also regenerate the OpenAPI/SDK surface since a new route was added:

Run: `pnpm --filter @lyra/sdk generate && pnpm --filter @lyra/sdk typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/axis.ts apps/api/src/resources.ts apps/api/src/premium-financing.test.ts packages/sdk/src/generated.ts
git commit -m "feat(api): idempotent premium-financing-plan route, lock down payment-plans CRUD"
```

---

## Post-implementation

After Task 7 is reviewed clean: run the full monorepo suite (`pnpm test`, `pnpm typecheck`, `pnpm lint`) once more at the branch tip, then proceed to a final whole-branch review per `superpowers:subagent-driven-development`, followed by `superpowers:finishing-a-development-branch`. Do not push, open a PR, or merge without explicit user confirmation.
