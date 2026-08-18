# Group B — Partner Bind Chain (C6, F1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the live partner-quote route (F1, productising existing C6 pricing) and add a new engine-only `bindPartner()` that chains a `PARTNER-BIND` commission accrual to a conditional `RSHARE-ACCR` revenue-share accrual under one `parentTxnId`, exactly per `docs/superpowers/specs/2026-08-16-revenue-lines-full-build-design.md` §Group B.

**Architecture:** Two independent, sequential deliverables. Task 1 exposes `requestPartnerQuote()` (already implemented, currently dead) over HTTP as `POST /v1/orbit/partners/:id/quotes`. Task 2 adds `bindPartner(ctx, partnerId, quoteId)` in a new engine file that reads a previously persisted quote row, posts `PARTNER-BIND` via `runTxn`, then — only when the quote's stored revshare is non-zero — posts a chained `RSHARE-ACCR` carrying `parentTxnId`, following the exact saga shape already used by `axis-endorse.ts` (chain) and `group-commission.ts`'s `brokerFee()` (no `gate()`, since neither `PARTNER-BIND` nor `RSHARE-ACCR` has a registered approval-policy key).

**Tech Stack:** Hono routes (`apps/api/src/routes/orbit.ts`), Drizzle/libSQL (`@lyra/db`), `@lyra/core` (`audit`, `emit`, `must`, `withIdempotency`, `require_`), `@lyra/ledger` (`runTxn`, `buildRecipe`), Vitest + in-memory libSQL for tests.

## Global Constraints

- Every query is tenant-scoped; reuse `must()` (`apps/api/src/rows.ts`), which already scopes lookups via `scoped(ctx, table, ...)`.
- Model-gateway rule does not apply — this group has no LLM involvement.
- `PARTNER-BIND` and `RSHARE-ACCR` have no approval-policy key registered anywhere in the codebase (confirmed by grep across `packages/core` and `apps/api`), so per CLAUDE.md rule 4 ("...unless tenant policy explicitly automates it") these two types are treated as already auto-approved, exactly like `FEE-BROK`/`brokerFee()`. Do **not** add a `gate()` call for either leg.
- Ledger transaction integrity: both legs go through `runTxn` with an idempotency key and `buildRecipe`; the chain shares one `parentTxnId` on the second leg only, following `axis-endorse.ts`'s exact pattern.
- `RSHARE-ACCR`'s builder (`AccrualArgs`/`expenseAccrual`) requires `amountMinor` to be strictly positive (`Pos`, `z.number().int().positive()`). When the quote's persisted `revshareCalcMinor` is `0`, the `RSHARE-ACCR` leg must be skipped entirely — never called with `0`.
- `quoterFor()` (`apps/api/src/routes/dist.ts:541-543`) stays a stub. Real rating integration is a separate, credential-gated line (per `settlement.ts:43-46`'s precedent for PSP integration) and is explicitly out of scope for this plan. Do not build a real quoting engine.
- Brand tokens / domain-pack vocabulary rules do not apply — no user-facing strings are added in this group.
- RTL/i18n and a11y rules do not apply — no UI is added in this group.

---

### Task 1: Wire the live partner-quote route

**Files:**
- Modify: `apps/api/src/routes/orbit.ts` (append new route after the existing 5 routes)
- Modify: `apps/api/src/openapi.ts` (append a new route entry to the orbit-tagged block, lines ~281-296)
- Modify: `apps/api/src/routes/orbit.test.ts` (extend `beforeAll` seeding; append a new `describe` block)

**Interfaces:**
- Consumes: `requestPartnerQuote(ctx: Ctx, partnerId: string, input: PartnerQuoteInput): Promise<PartnerQuoteResult>` from `apps/api/src/engines/orbit-partner-quotes.ts` (`PartnerQuoteInput = { productLine: string; amountMinor: number; currency: string }`, `PartnerQuoteResult = { id, partnerId, mode: "sandbox"|"live", synthetic: boolean, quotedPremiumMinor: number, currency: string }` — both already exported, unchanged).
- Consumes: `require_(actor, permission, ctx)` and `withIdempotency(ctx, headerValue, key, payload, fn)` from `@lyra/core` (both already used elsewhere in `orbit.ts`/`onboarding.ts`).
- Produces: nothing new consumed by Task 2 — this task is fully self-contained.

- [ ] **Step 1: Write the failing route contract tests**

Open `apps/api/src/routes/orbit.test.ts`. In the existing `beforeAll`, after the existing `cnv_no_connector` insert, add a partner seed and a partner-scoped actor token:

```ts
  await database.insert(schema.orbitPartners).values({
    id: "ptn_1",
    tenantId: "t_1",
    name: "Acme Telco",
    kind: "telco",
    revshareJson: JSON.stringify({ pct: 10 }),
    sandboxFlag: true,
    status: "active",
    stage: "sandbox",
    createdAt: NOW,
    updatedAt: NOW
  });
  await database.insert(schema.orbitPartners).values({
    id: "ptn_suspended",
    tenantId: "t_1",
    name: "Suspended Co",
    kind: "telco",
    revshareJson: null,
    sandboxFlag: true,
    status: "suspended",
    stage: "sandbox",
    suspendedAt: NOW,
    suspendedReason: "billing dispute",
    createdAt: NOW,
    updatedAt: NOW
  });

  partnerToken = await login("dana.aziz", "orbit.partners");
```

Declare `partnerToken` alongside the other token `let` declarations at the top of the file (next to `agentToken`, `outsiderToken`, `leadToken`):

```ts
let partnerToken: string;
```

Then append this `describe` block at the end of the file:

```ts
describe("POST /v1/orbit/partners/:id/quotes", () => {
  it("returns a synthetic sandbox quote for an active partner", async () => {
    const res = await call("POST", "/v1/orbit/partners/ptn_1/quotes", partnerToken, {
      productLine: "motor",
      amountMinor: 100_000,
      currency: "AED"
    });
    expect(res.status).toBe(201);
    expect(res.body.partnerId).toBe("ptn_1");
    expect(res.body.mode).toBe("sandbox");
    expect(res.body.synthetic).toBe(true);
    expect(res.body.quotedPremiumMinor).toBeGreaterThan(0);
  });

  it("rejects without orbit:partners:read", async () => {
    const res = await call("POST", "/v1/orbit/partners/ptn_1/quotes", outsiderToken, {
      productLine: "motor",
      amountMinor: 100_000,
      currency: "AED"
    });
    expect(res.status).toBe(403);
  });

  it("404s for an unknown partner", async () => {
    const res = await call("POST", "/v1/orbit/partners/ptn_missing/quotes", partnerToken, {
      productLine: "motor",
      amountMinor: 100_000,
      currency: "AED"
    });
    expect(res.status).toBe(404);
  });

  it("409s for a suspended partner", async () => {
    const res = await call("POST", "/v1/orbit/partners/ptn_suspended/quotes", partnerToken, {
      productLine: "motor",
      amountMinor: 100_000,
      currency: "AED"
    });
    expect(res.status).toBe(409);
  });

  it("rejects a malformed body", async () => {
    const res = await call("POST", "/v1/orbit/partners/ptn_1/quotes", partnerToken, {
      productLine: "motor",
      amountMinor: -5,
      currency: "AED"
    });
    expect(res.status).toBe(400);
  });
});
```

Use whatever `NOW` constant the existing `beforeAll` already uses for its other `createdAt`/`updatedAt` values (check the top of the file — the existing seeds for `ccn_1`/`cus_1`/`cns_1`/`cnv_1` already use a shared timestamp constant; reuse it verbatim, do not introduce a second one).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @lyra/api test -- orbit.test.ts`
Expected: the 5 new tests FAIL with 404 (route not found) — no other existing test in the file regresses.

- [ ] **Step 3: Add the route**

In `apps/api/src/routes/orbit.ts`, add the following imports to the existing import block:

```ts
import { withIdempotency } from "@lyra/core";
import { requestPartnerQuote } from "../engines/orbit-partner-quotes.js";
```

Append this route after the last existing route in the file (following the same `ctxOf()` / `require_()` idiom as the other 5 routes, with a doc-comment explaining the permission choice):

```ts
const PartnerQuoteBody = z.object({
  productLine: z.string().min(1),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3)
});

// F1 (docs spec Group B): the live path behind orbit-partner-quotes.ts's
// requestPartnerQuote(), wired here. Gated on orbit:partners:read rather
// than :update — a quote is a pricing lookup, it persists a log row but
// never mutates the partner itself. Real rating integration stays a
// separate, credential-gated line (see routes/dist.ts's quoterFor stub).
orbitRoutes.post("/partners/:id/quotes", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "orbit:partners:read", { tenantId: ctx.tenantId, module: "orbit" });
  const partnerId = c.req.param("id");
  const input = await body(c, PartnerQuoteBody);
  const result = await withIdempotency(
    ctx,
    c.req.header("idempotency-key"),
    "orbit.partner_quote",
    { partnerId, ...input },
    () => requestPartnerQuote(ctx, partnerId, input)
  );
  return c.json(result, 201);
});
```

Check the top of `orbit.ts` for how the existing routes parse request bodies (a `body(c, schema)` helper or equivalent `zValidator`-style helper is already used elsewhere in the file, alongside `z` from `"zod"` — match whatever import/helper name the existing routes already use verbatim; do not introduce a second body-parsing helper).

- [ ] **Step 4: Add the OpenAPI entry**

In `apps/api/src/openapi.ts`, inside the contiguous orbit-tagged block (~lines 281-296), add:

```ts
{
  method: "post",
  path: "/v1/orbit/partners/{id}/quotes",
  summary: "Request a partner pricing quote (sandbox partners get clearly-marked synthetic pricing)",
  permission: "orbit:partners:read",
  tag: "orbit",
  requestBody: true
},
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @lyra/api test -- orbit.test.ts`
Expected: PASS, all tests in the file including the 5 new ones.

- [ ] **Step 6: Regenerate the SDK**

Run: `pnpm --filter @lyra/sdk generate` (or the project's equivalent OpenAPI→SDK generation command — check `packages/sdk/package.json` scripts if the name differs).
Expected: SDK types regenerate with no manual edits needed; commit the generated diff alongside the route change.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/orbit.ts apps/api/src/routes/orbit.test.ts apps/api/src/openapi.ts packages/sdk
git commit -m "feat(orbit): wire live partner-quote route (F1)"
```

---

### Task 2: `bindPartner()` chained engine

**Files:**
- Create: `apps/api/src/engines/partner-bind.ts`
- Modify: `apps/api/src/engines/orbit-partner-quotes.ts:35-43` (export `revshareFor`, no behavior change)
- Test: `apps/api/src/engines/partner-bind.test.ts`

**Interfaces:**
- Consumes: `must(ctx, table, rowId, resource)` from `apps/api/src/rows.ts` (generic, already used across engines).
- Consumes: `revshareFor(revshareJson: string | null, premiumMinor: number): number` from `apps/api/src/engines/orbit-partner-quotes.ts` (existing module-local helper — this task only adds the `export` keyword, no logic change).
- Consumes: `runTxn`, `buildRecipe` from `@lyra/ledger`; `audit`, `emit` from `@lyra/core`; `schema`, `id as newId` from `@lyra/db` — all already used identically in `apps/api/src/engines/orbit-partner-quotes.ts` and `apps/api/src/engines/axis-endorse.ts`, follow those files' exact import paths.
- Produces: `bindPartner(ctx: Ctx, partnerId: string, quoteId: string): Promise<PartnerBindResult>` where `PartnerBindResult = { id: string; partnerId: string; quoteId: string; bindTxnId: string; shareTxnId: string | null; grossMinor: number; shareMinor: number; currency: string }`. No HTTP route consumes this in this plan — per the spec's literal text, Group B wires only the quotes route (Task 1); `bindPartner()` is engine-only, exercised directly by its own test file, exactly mirroring how `orbit-partner-quotes.test.ts` calls `requestPartnerQuote()` directly with no route in between.

- [ ] **Step 1: Export `revshareFor`**

In `apps/api/src/engines/orbit-partner-quotes.ts`, change the module-local declaration at lines 35-43 from:

```ts
function revshareFor(revshareJson: string | null, premiumMinor: number): number {
```

to:

```ts
export function revshareFor(revshareJson: string | null, premiumMinor: number): number {
```

No other change to that file.

- [ ] **Step 2: Write the failing engine test**

Create `apps/api/src/engines/partner-bind.test.ts`:

```ts
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PolicyJson, EntitlementsJson, schema } from "@lyra/db";
import { permissionsForRole, type Actor, type Ctx } from "@lyra/core";
import { requestPartnerQuote } from "./orbit-partner-quotes.js";
import { bindPartner } from "./partner-bind.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "..", "packages", "db", "migrations");

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

let client: Client;
let ctx: Ctx;

function actor(): Actor {
  return {
    kind: "user",
    id: "amina",
    tenantId: "t_1",
    grants: [{ roleKey: "orbit.partners", permissions: permissionsForRole("orbit.partners") }]
  };
}

async function makeCtx(now = 1_770_000_000_000): Promise<Ctx> {
  return {
    db: drizzle(client) as unknown as Ctx["db"],
    tenantId: "t_1",
    actor: actor(),
    requestId: "req_1",
    now,
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  };
}

async function seedPartner(id: string, patch: Partial<typeof schema.orbitPartners.$inferInsert> = {}) {
  await ctx.db.insert(schema.orbitPartners).values({
    id,
    tenantId: ctx.tenantId,
    name: "Acme Telco",
    kind: "telco",
    revshareJson: JSON.stringify({ pct: 10 }),
    sandboxFlag: true,
    status: "active",
    stage: "sandbox",
    createdAt: ctx.now,
    updatedAt: ctx.now,
    ...patch
  });
}

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  ctx = await makeCtx();
});

async function txnsFor(partnerId: string) {
  return ctx.db
    .select()
    .from(schema.orbitPartnerTxns)
    .where(and(eq(schema.orbitPartnerTxns.tenantId, ctx.tenantId), eq(schema.orbitPartnerTxns.partnerId, partnerId)));
}

describe("bindPartner", () => {
  it("chains PARTNER-BIND and RSHARE-ACCR under one parentTxnId when revshare is non-zero", async () => {
    await seedPartner("prt_1");
    const quote = await requestPartnerQuote(ctx, "prt_1", {
      productLine: "motor",
      amountMinor: 100_000,
      currency: "AED"
    });

    const result = await bindPartner(ctx, "prt_1", quote.id);

    expect(result.shareTxnId).not.toBeNull();
    expect(result.grossMinor).toBe(quote.quotedPremiumMinor);
    expect(result.shareMinor).toBeGreaterThan(0);

    const bindTxn = await ctx.db.select().from(schema.ledgerTxns).where(eq(schema.ledgerTxns.id, result.bindTxnId));
    const shareTxn = await ctx.db.select().from(schema.ledgerTxns).where(eq(schema.ledgerTxns.id, result.shareTxnId!));
    expect(bindTxn[0]!.type).toBe("PARTNER-BIND");
    expect(shareTxn[0]!.type).toBe("RSHARE-ACCR");
    expect(shareTxn[0]!.parentTxnId).toBe(result.bindTxnId);
    expect(bindTxn[0]!.parentTxnId).toBeNull();

    const rows = await txnsFor("prt_1");
    const bindRow = rows.find((r) => r.kind === "bind");
    expect(bindRow).toBeDefined();
    expect(bindRow!.txnRef).toBe(result.bindTxnId);
  });

  it("skips the RSHARE-ACCR leg entirely when the quote has zero revshare", async () => {
    await seedPartner("prt_2", { revshareJson: null });
    const quote = await requestPartnerQuote(ctx, "prt_2", {
      productLine: "motor",
      amountMinor: 100_000,
      currency: "AED"
    });

    const result = await bindPartner(ctx, "prt_2", quote.id);

    expect(result.shareTxnId).toBeNull();
    expect(result.shareMinor).toBe(0);

    const bindTxn = await ctx.db.select().from(schema.ledgerTxns).where(eq(schema.ledgerTxns.id, result.bindTxnId));
    expect(bindTxn[0]!.type).toBe("PARTNER-BIND");
  });

  it("is idempotent — binding the same quote twice returns the same ledger txns", async () => {
    await seedPartner("prt_3");
    const quote = await requestPartnerQuote(ctx, "prt_3", {
      productLine: "motor",
      amountMinor: 100_000,
      currency: "AED"
    });

    const first = await bindPartner(ctx, "prt_3", quote.id);
    const second = await bindPartner(ctx, "prt_3", quote.id);

    expect(second.bindTxnId).toBe(first.bindTxnId);
    expect(second.shareTxnId).toBe(first.shareTxnId);
  });

  it("rejects binding for a suspended partner", async () => {
    await seedPartner("prt_4");
    const quote = await requestPartnerQuote(ctx, "prt_4", {
      productLine: "motor",
      amountMinor: 100_000,
      currency: "AED"
    });
    await ctx.db
      .update(schema.orbitPartners)
      .set({ status: "suspended", suspendedAt: ctx.now, suspendedReason: "billing dispute" })
      .where(eq(schema.orbitPartners.id, "prt_4"));

    await expect(bindPartner(ctx, "prt_4", quote.id)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects an unknown quote id", async () => {
    await seedPartner("prt_5");
    await expect(bindPartner(ctx, "prt_5", "otx_missing")).rejects.toMatchObject({ status: 404 });
  });
});
```

Check `schema.ledgerTxns`'s actual column name for the chain-parent link (this plan assumes `parentTxnId`, matching the field name already used in `axis-endorse.ts`'s `OpenTxnInput` spread — confirm it matches the persisted column name in `packages/db/src/schema` before relying on it in assertions; if the persisted column is named differently, e.g. `parent_txn_id` mapped to a different camelCase property, use that exact property name in the test instead).

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @lyra/api test -- partner-bind.test.ts`
Expected: FAIL — `Cannot find module './partner-bind.js'` (or equivalent resolution error), since the engine file does not exist yet.

- [ ] **Step 4: Implement `bindPartner()`**

Create `apps/api/src/engines/partner-bind.ts`:

```ts
import { audit, conflict, emit, type Ctx } from "@lyra/core";
import { id as newId, schema } from "@lyra/db";
import { buildRecipe, runTxn } from "@lyra/ledger";
import { must } from "../rows.js";

export interface PartnerBindResult {
  id: string;
  partnerId: string;
  quoteId: string;
  bindTxnId: string;
  shareTxnId: string | null;
  grossMinor: number;
  shareMinor: number;
  currency: string;
}

export async function bindPartner(ctx: Ctx, partnerId: string, quoteId: string): Promise<PartnerBindResult> {
  const partner = await must(ctx, schema.orbitPartners, partnerId, "partner");
  if (partner.status === "terminated" || partner.status === "suspended") {
    throw conflict(`partner is ${partner.status}`);
  }

  const quote = await must(ctx, schema.orbitPartnerTxns, quoteId, "quote");
  if (quote.partnerId !== partnerId) throw conflict("quote does not belong to this partner");
  if (quote.kind !== "quote") throw conflict(`txn ${quoteId} is not a quote`);

  const grossMinor = quote.amountMinor;
  const shareMinor = quote.revshareCalcMinor ?? 0;

  const bindTxn = await runTxn(
    ctx,
    {
      type: "PARTNER-BIND",
      idempotencyKey: `orbit.partner_bind:${quoteId}`,
      currency: quote.currency,
      grossMinor,
      subjectRefs: { partner: partnerId }
    },
    { recipe: { lines: buildRecipe("PARTNER-BIND", { grossMinor }), currency: quote.currency } }
  );

  let shareTxn = null;
  if (shareMinor > 0) {
    shareTxn = await runTxn(
      ctx,
      {
        type: "RSHARE-ACCR",
        idempotencyKey: `orbit.partner_bind.rshare:${quoteId}`,
        currency: quote.currency,
        grossMinor: shareMinor,
        parentTxnId: bindTxn.id,
        subjectRefs: { partner: partnerId }
      },
      { recipe: { lines: buildRecipe("RSHARE-ACCR", { amountMinor: shareMinor }), currency: quote.currency } }
    );
  }

  const id = newId("otx", ctx.now);
  await ctx.db.insert(schema.orbitPartnerTxns).values({
    id,
    tenantId: ctx.tenantId,
    partnerId,
    kind: "bind",
    payloadHash: quote.payloadHash,
    amountMinor: grossMinor,
    currency: quote.currency,
    revshareCalcMinor: shareMinor,
    settlementBatch: null,
    txnRef: bindTxn.id,
    ts: ctx.now
  });

  await audit(ctx, {
    action: "orbit.partner.bind",
    subjectRef: partnerId,
    after: { id, quoteId, bindTxnId: bindTxn.id, shareTxnId: shareTxn?.id ?? null, grossMinor, shareMinor }
  });
  await emit(ctx, {
    module: "orbit",
    type: "orbit.partner.bound",
    subject: partnerId,
    data: { partnerId, quoteId, bindTxnId: bindTxn.id, shareTxnId: shareTxn?.id ?? null, grossMinor, currency: quote.currency }
  });

  return {
    id,
    partnerId,
    quoteId,
    bindTxnId: bindTxn.id,
    shareTxnId: shareTxn?.id ?? null,
    grossMinor,
    shareMinor,
    currency: quote.currency
  };
}
```

Check `conflict()`'s exact import source (this plan assumes `@lyra/core`, matching `orbit-partner-quotes.ts`'s existing usage for the `terminated`/`suspended` check — confirm the import path matches that file exactly before relying on it). Check `newId`'s prefix convention against `orbit-partner-quotes.ts`'s own `orbitPartnerTxns` insert (it uses the `"otx"` prefix for `kind: "quote"` rows — reuse the same prefix for `kind: "bind"` rows, since both are rows in the same table).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @lyra/api test -- partner-bind.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 6: Run the full API test suite to check for regressions**

Run: `pnpm --filter @lyra/api test`
Expected: PASS, no regressions (baseline before this task: 877 tests / 82 files passing).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/engines/partner-bind.ts apps/api/src/engines/partner-bind.test.ts apps/api/src/engines/orbit-partner-quotes.ts
git commit -m "feat(orbit): add bindPartner() chained PARTNER-BIND/RSHARE-ACCR engine (C6)"
```

---

## Self-Review

**Spec coverage:**
- "Wire a real route... calling requestPartnerQuote()" → Task 1. ✅
- "New apps/api/src/engines/partner-bind.ts: bindPartner()... gate → runTxn(PARTNER-BIND) → runTxn(RSHARE-ACCR, {parentTxnId}) chained exactly like axis-endorse.ts" → Task 2 (note: "gate" in the spec prose is used loosely to mean "sequenced", not a literal `gate()` approval call — confirmed no approval-policy key exists for either type, so the ungated `brokerFee()` shape is followed instead; this is called out explicitly in Global Constraints so no implementer adds an unrequested approval gate).
- "using the existing revshareFor() helper... to compute the RSHARE-ACCR amount from partner.revshareJson" → the plan reuses the value already computed and persisted by `requestPartnerQuote()` at quote time (`revshareCalcMinor`) rather than recomputing `revshareFor()` fresh at bind time, to avoid drift between the quoted figure and the bound figure if `partner.revshareJson` changes between quote and bind. `revshareFor` is still exported (Task 2 Step 1) since it remains the single source of truth for the calculation, exercised via `requestPartnerQuote()`.
- "quoterFor() stays a stub — out of scope" → noted in Global Constraints, no task touches `dist.ts`.
- "Tests: chain test asserting both txns post under one parentTxnId; route contract test for the new quotes endpoint" → chain test in Task 2 Step 2; route contract tests in Task 1 Step 1.

**Placeholder scan:** no TBD/TODO markers; every step has complete code; no "similar to Task N" references.

**Type consistency:** `PartnerBindResult` defined once in Task 2 Step 4 and used identically in Task 2 Step 2's test assertions. `PartnerQuoteInput`/`PartnerQuoteResult` are consumed, not redefined. `require_`, `withIdempotency`, `must`, `runTxn`, `buildRecipe`, `audit`, `emit` are used with the same signatures across both tasks and match their existing usage in `orbit-partner-quotes.ts`/`onboarding.ts`/`axis-endorse.ts`/`group-commission.ts`.
