# Revenue Lines Group A (Accrual-Only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the six Group A revenue-line transaction types (BIND-GROUP, FEE-BROK, REFERRAL-QUAL, REFERRAL-SETL, AD-PLACEMENT, DISCLOSURE-PRESENT) from docs/superpowers/specs/2026-08-16-revenue-lines-full-build-design.md so each posts a real, tested ledger transaction through existing `runTxn`/`buildRecipe` machinery.

**Architecture:** Two new engine files (`group-commission.ts`, `referral-settlement.ts`) exposing plain async functions that call `runTxn`, mirroring the existing `bindPolicy()`/`requestClaimPayment()`/`lapsePolicy()` patterns exactly. One precondition function added to the existing `TXN_PRECONDITIONS` registry gates AD-PLACEMENT on a fresh disclosure row. One new route writes that disclosure row. Two RBAC permission grants make the new disclosure route usable by the roles that need it. No new ledger types, no new recipes, no new database tables — `TXN_TYPES`/`RECIPES` already have all six Group A entries registered.

**Tech Stack:** Hono routes (`apps/api/src/routes/*.ts`), Drizzle ORM over SQLite (D1/libSQL), Zod validation, `@lyra/ledger`'s `runTxn`/`buildRecipe`, `@lyra/core`'s `audit`/`emit`/`require_`/`gate`, Vitest + `@libsql/client` in-memory DB for integration tests.

## Global Constraints

- Tenancy first: every DB write and query goes through the request's `Ctx` (`ctx.tenantId`), using `scoped()` for updates — per CLAUDE.md #1.
- Model access is not touched by this plan (no AI calls in Group A).
- Human-in-the-loop: BIND-GROUP is `consequential` via its existing `axis.bind_group` approval policy — do not bypass `gate`/`runTxn`'s automatic approval check, do not add `preApproved: true` to it.
- Ledger integrity: every financial call goes through `runTxn` with an idempotency key; never write `ledger_journal_lines`/`ledger_txns` directly. Ledger invariants (balanced debits/credits) are already enforced inside `runTxn`/`commissionAccrual` — do not relax them.
- Migrations are forward-only — this plan needs **zero** schema migrations (no new tables, no new columns).
- No new third-party services.
- No hard-coded industry nouns in new user-facing strings beyond what already exists in the routes being extended (this plan touches no domain-pack-facing copy).
- Recipe registration rule: `BIND-GROUP`, `FEE-BROK`, `REFERRAL-QUAL`, `REFERRAL-SETL`, `AD-PLACEMENT`, `DISCLOSURE-PRESENT` are already present in `packages/ledger/src/types.ts` (`TXN_TYPES`) and `packages/ledger/src/recipes.ts` (`RECIPES`, for the four financial ones). **Do not add or edit `TXN_TYPES`/`RECIPES` entries in this plan** — confirmed already registered.

---

### Task 1: `group-commission.ts` — BIND-GROUP and FEE-BROK

**Files:**
- Create: `apps/api/src/engines/group-commission.ts`
- Modify: `apps/api/src/routes/axis.ts` (add two routes near the existing `/policies/:id/bind` route around line 1059-1069)
- Test: `apps/api/src/axis-bind-group.test.ts`

**Interfaces:**
- Consumes: `runTxn`, `buildRecipe` from `@lyra/ledger`; `assertPolicyTransition`, `isPolicyState`, `audit`, `badRequest`, `conflict`, `emit`, `actorRef`, `scoped`, `require_`, `withIdempotency`, `type Ctx` from `@lyra/core`; `id as newId`, `schema` from `@lyra/db`; `must`/`body` helpers already used elsewhere in `routes/axis.ts`.
- Produces: `bindGroup(ctx: Ctx, policy: PolicyRow, opts: { channelMinor?: number; terms?: Record<string, unknown> }): Promise<{ policy: PolicyRow; version: typeof schema.axisPolicyVersions.$inferInsert; txn: Awaited<ReturnType<typeof runTxn>> }>` and `brokerFee(ctx: Ctx, policy: PolicyRow, input: { feeMinor: number }): Promise<{ txn: Awaited<ReturnType<typeof runTxn>> }>`, both exported from `apps/api/src/engines/group-commission.ts`. Later tasks do not depend on these.

- [ ] **Step 1: Write the failing route-level tests**

Create `apps/api/src/axis-bind-group.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { schema, type Db } from "@lyra/db";
import { seed, totpAt, TOTP_STEP_SEC, type SeedResult } from "@lyra/core";
import { app } from "./index.js";
import type { Env } from "./env.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const DAY = 86_400_000;
const exec = { waitUntil() {}, passThroughOnException() {} };

let env: Env;
let database: Db;
let seeded: SeedResult;
let token: string;
let customerId: string;

interface Res<T = any> {
  status: number;
  body: T;
}

async function call<T = any>(
  method: string,
  path: string,
  payload?: unknown,
  headers: Record<string, string> = {}
): Promise<Res<T>> {
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
    }),
    env as never,
    exec as never
  );
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  return { status: res.status, body: (isJson ? await res.json() : await res.arrayBuffer()) as T };
}

function ok<T>(res: Res<T>, ...accept: number[]): T {
  const allowed = accept.length ? accept : [200, 201, 204];
  if (!allowed.includes(res.status)) {
    throw new Error(`expected ${allowed.join("|")}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function insertDraftPolicy(policyNo: string) {
  const start = Date.now();
  const row = {
    id: `pol_${policyNo.toLowerCase()}`,
    tenantId: seeded.tenantId,
    customerId,
    providerId: seeded.providers.falcon,
    policyNo,
    startAt: start,
    endAt: start + 365 * DAY,
    premiumMinor: 500_000_00,
    currency: "AED",
    commissionMinor: 50_000_00,
    grossMinor: 500_000_00,
    status: "draft" as const,
    createdAt: start,
    updatedAt: start
  };
  await database.insert(schema.axisPolicies).values(row);
  return row;
}

beforeAll(async () => {
  const client = createClient({ url: ":memory:" });
  const statements = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) await client.execute(stmt);
  database = drizzle(client) as unknown as Db;
  seeded = await seed(database as never, { mfaSecret: DEMO_TOTP_SECRET });
  env = { DB_CLIENT: database, ENVIRONMENT: "development", APP_ORIGIN: "http://localhost:5173" } as unknown as Env;

  const login = await call("POST", "/v1/auth/login", {
    email: "omar.farouk@gonxt.ae",
    password: PASSWORD,
    tenantSlug: "gonxt"
  });
  token = ok(login).token as string;
  const verified = await call("POST", "/v1/auth/mfa/verify", {
    code: await totpAt(DEMO_TOTP_SECRET, Math.floor(Date.now() / 1000 / TOTP_STEP_SEC))
  });
  expect(verified.status).toBe(200);

  const customer = (await database.select().from(schema.customers).limit(1))[0]!;
  customerId = customer.id;
}, 120_000);

describe("AXIS bind-group (docs/superpowers/specs/2026-08-16-revenue-lines-full-build-design.md, Group A)", () => {
  it("refuses BIND-GROUP without axis.bind_group on the tenant's autoApprove allowlist", async () => {
    const policy = await insertDraftPolicy("POL-GROUP-REFUSED");
    const res = await call("POST", `/v1/axis/policies/${policy.id}/bind-group`, {});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("approval_required");

    const pending = await database
      .select()
      .from(schema.approvals)
      .where(and(eq(schema.approvals.tenantId, seeded.tenantId), eq(schema.approvals.subjectRef, `axis_policy:${policy.id}`)));
    expect(pending.some((a) => a.policyKey === "axis.bind_group")).toBe(true);
  });

  it("binds a group policy with a commission accrual once axis.bind_group is auto-approved", async () => {
    const tenantRow = (await database.select().from(schema.tenants).where(eq(schema.tenants.id, seeded.tenantId)))[0]!;
    const policy0 = JSON.parse(tenantRow.policyJson as string) as { autoApprove: string[] };
    await database
      .update(schema.tenants)
      .set({ policyJson: JSON.stringify({ ...policy0, autoApprove: [...policy0.autoApprove, "axis.bind_group"] }) })
      .where(eq(schema.tenants.id, seeded.tenantId));

    const policy = await insertDraftPolicy("POL-GROUP-1");
    const out = ok(await call("POST", `/v1/axis/policies/${policy.id}/bind-group`, { channelMinor: 10_000_00 }), 201);

    expect(out.policy.status).toBe("bound");
    expect(out.policy.versionSeq).toBe(1);
    expect(out.policy.currentVersionId).toBe(out.version.id);
    expect(out.txn.state).toBe("settled");

    const legs = await database
      .select()
      .from(schema.ledgerJournalLines)
      .where(eq(schema.ledgerJournalLines.batchId, out.txn.ledgerBatchId as string));
    const debit = legs.filter((l) => l.side === "debit").reduce((n, l) => n + l.amountMinor, 0);
    const credit = legs.filter((l) => l.side === "credit").reduce((n, l) => n + l.amountMinor, 0);
    expect(debit).toBe(credit);
    expect(legs.some((l) => l.accountCode === "2100" && l.amountMinor === 10_000_00)).toBe(true);

    const audits = await database
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, seeded.tenantId), eq(schema.auditLog.action, "axis.policy.bind_group")));
    expect(audits.some((a) => a.subjectRef === out.policy.id)).toBe(true);

    const events = await database.select().from(schema.eventOutbox).where(eq(schema.eventOutbox.type, "axis.policy.group_issued"));
    expect(events.some((e) => e.envelopeJson.includes(out.policy.id))).toBe(true);
  });

  it("posts a broker fee with no approval gate", async () => {
    const policy = await insertDraftPolicy("POL-GROUP-FEE");
    const out = ok(await call("POST", `/v1/axis/policies/${policy.id}/broker-fee`, { feeMinor: 5_000_00 }), 201);

    expect(out.txn.state).toBe("settled");
    const legs = await database
      .select()
      .from(schema.ledgerJournalLines)
      .where(eq(schema.ledgerJournalLines.batchId, out.txn.ledgerBatchId as string));
    const debit = legs.filter((l) => l.side === "debit").reduce((n, l) => n + l.amountMinor, 0);
    const credit = legs.filter((l) => l.side === "credit").reduce((n, l) => n + l.amountMinor, 0);
    expect(debit).toBe(credit);
    expect(legs.some((l) => l.accountCode === "4020")).toBe(true);
    expect(legs.some((l) => l.accountCode === "1160")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lyra/api test axis-bind-group.test.ts`
Expected: FAIL — `/v1/axis/policies/:id/bind-group` and `/v1/axis/policies/:id/broker-fee` return 404 (routes don't exist yet).

- [ ] **Step 3: Write `group-commission.ts`**

```ts
import { eq } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { actorRef, assertPolicyTransition, audit, badRequest, conflict, emit, isPolicyState, scoped, type Ctx } from "@lyra/core";
import { buildRecipe, runTxn } from "@lyra/ledger";

type PolicyRow = typeof schema.axisPolicies.$inferSelect;

export async function bindGroup(
  ctx: Ctx,
  policy: PolicyRow,
  opts: { channelMinor?: number; terms?: Record<string, unknown> }
) {
  if (!isPolicyState(policy.status)) throw conflict(`policy is in unknown state ${policy.status}`);
  assertPolicyTransition(policy.status, "bound");
  if (policy.currentVersionId) throw conflict("policy already has a version history");
  if (policy.commissionMinor <= 0) throw badRequest("cannot bind-group with no commission: BIND-GROUP posts a commission accrual");
  const channelMinor = Math.min(Math.max(opts.channelMinor ?? 0, 0), policy.commissionMinor);

  const txn = await runTxn(
    ctx,
    {
      type: "BIND-GROUP",
      idempotencyKey: `axis.bind_group:${policy.id}`,
      currency: policy.currency,
      grossMinor: policy.grossMinor,
      subjectRefs: { policy: policy.id }
    },
    {
      recipe: { lines: buildRecipe("BIND-GROUP", { grossMinor: policy.commissionMinor, channelMinor }), currency: policy.currency },
      approvalSubjectRef: `axis_policy:${policy.id}`
    }
  );

  const version = {
    id: newId("pver", ctx.now),
    tenantId: ctx.tenantId,
    policyId: policy.id,
    versionSeq: 1,
    reason: "issue" as const,
    effectiveFrom: policy.startAt,
    effectiveTo: policy.endAt,
    premiumMinor: policy.premiumMinor,
    taxMinor: policy.taxMinor,
    feesMinor: policy.feesMinor,
    commissionMinor: policy.commissionMinor,
    currency: policy.currency,
    premiumDeltaMinor: 0,
    termsJson: JSON.stringify(opts.terms ?? {}),
    quoteResponseId: null,
    txnId: txn.id,
    state: "effective" as const,
    issuedBy: actorRef(ctx),
    issuedAt: ctx.now,
    createdAt: ctx.now,
    updatedAt: ctx.now
  };
  await ctx.db.insert(schema.axisPolicyVersions).values(version);

  const stamp = { status: "bound" as const, currentVersionId: version.id, versionSeq: 1, lastTxnId: txn.id, updatedAt: ctx.now };
  await ctx.db.update(schema.axisPolicies).set(stamp).where(scoped(ctx, schema.axisPolicies, eq(schema.axisPolicies.id, policy.id)));
  const after = { ...policy, ...stamp };

  await audit(ctx, { action: "axis.policy.bind_group", subjectRef: policy.id, before: policy, after });
  await emit(ctx, {
    module: "axis",
    type: "axis.policy.group_issued",
    subject: policy.id,
    data: {
      policyId: policy.id,
      customerId: policy.customerId,
      providerId: policy.providerId,
      premiumMinor: policy.premiumMinor,
      grossMinor: policy.grossMinor,
      currency: policy.currency,
      txnId: txn.id
    }
  });
  return { policy: after, version, txn };
}

export async function brokerFee(ctx: Ctx, policy: PolicyRow, input: { feeMinor: number }) {
  const feeId = newId("bfee", ctx.now);
  const txn = await runTxn(
    ctx,
    {
      type: "FEE-BROK",
      idempotencyKey: `axis.broker_fee:${feeId}`,
      currency: policy.currency,
      grossMinor: input.feeMinor,
      subjectRefs: { policy: policy.id }
    },
    {
      recipe: { lines: buildRecipe("FEE-BROK", { grossMinor: input.feeMinor }), currency: policy.currency }
    }
  );

  await audit(ctx, {
    action: "axis.policy.broker_fee",
    subjectRef: policy.id,
    after: { feeId, txnId: txn.id, feeMinor: input.feeMinor }
  });
  await emit(ctx, {
    module: "axis",
    type: "axis.policy.broker_fee_charged",
    subject: policy.id,
    data: { policyId: policy.id, feeMinor: input.feeMinor, currency: policy.currency, txnId: txn.id }
  });
  return { txn };
}
```

- [ ] **Step 4: Add the two routes in `routes/axis.ts`**

In `apps/api/src/routes/axis.ts`, add near the existing `/policies/:id/bind` route (around line 1059-1069). First add the import alongside the existing engine import (near line 42, following the `axis-endorse.js` import convention):

```ts
import { bindGroup, brokerFee } from "../engines/group-commission.js";
```

Then add the routes:

```ts
axisRoutes.post("/policies/:id/bind-group", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "axis:policies:bind", { tenantId: ctx.tenantId, module: "axis" });
  const before = await must(ctx, schema.axisPolicies, c.req.param("id"), "policies");
  const input = await body(
    c,
    z.object({
      channelMinor: z.number().int().nonnegative().optional(),
      terms: z.record(z.string(), z.unknown()).optional()
    })
  );
  const out = await withIdempotency(ctx, c.req.header("idempotency-key"), `POST ${c.req.path}`, input, () =>
    bindGroup(ctx, before, input)
  );
  return c.json(out, 201);
});

axisRoutes.post("/policies/:id/broker-fee", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "axis:policies:bind", { tenantId: ctx.tenantId, module: "axis" });
  const before = await must(ctx, schema.axisPolicies, c.req.param("id"), "policies");
  const input = await body(c, z.object({ feeMinor: z.number().int().positive() }));
  const out = await withIdempotency(ctx, c.req.header("idempotency-key"), `POST ${c.req.path}`, input, () =>
    brokerFee(ctx, before, input)
  );
  return c.json(out, 201);
});
```

(`must`, `body`, `withIdempotency`, `require_`, `schema`, `z` are already imported/available in `routes/axis.ts` — reuse them, do not re-import.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @lyra/api test axis-bind-group.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors introduced.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/engines/group-commission.ts apps/api/src/routes/axis.ts apps/api/src/axis-bind-group.test.ts
git commit -m "feat(axis): add BIND-GROUP and FEE-BROK engines and routes"
```

---

### Task 2: `referral-settlement.ts` — REFERRAL-QUAL and REFERRAL-SETL

**Files:**
- Create: `apps/api/src/engines/referral-settlement.ts`
- Modify: `apps/api/src/routes/dist.ts` (add two routes near other `distRoutes.post` calls)
- Test: `apps/api/src/dist-referral-settlement.test.ts`

**Interfaces:**
- Consumes: `runTxn`, `buildRecipe` from `@lyra/ledger`; `audit`, `conflict`, `emit`, `require_`, `withIdempotency`, `type Ctx` from `@lyra/core`; `schema` from `@lyra/db`.
- Produces: `qualifyReferral(ctx: Ctx, input: { referralRef: string; channelId?: string }): Promise<{ txn: Awaited<ReturnType<typeof runTxn>> }>` and `settleReferral(ctx: Ctx, input: { referralRef: string; currency: string; grossMinor: number; channelMinor?: number }): Promise<{ txn: Awaited<ReturnType<typeof runTxn>> }>`, exported from `apps/api/src/engines/referral-settlement.ts`. No later task depends on these.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/dist-referral-settlement.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { schema, type Db } from "@lyra/db";
import { seed, totpAt, TOTP_STEP_SEC, type SeedResult } from "@lyra/core";
import { app } from "./index.js";
import type { Env } from "./env.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const exec = { waitUntil() {}, passThroughOnException() {} };

let env: Env;
let database: Db;
let seeded: SeedResult;
let token: string;

interface Res<T = any> {
  status: number;
  body: T;
}

async function call<T = any>(
  method: string,
  path: string,
  payload?: unknown,
  headers: Record<string, string> = {}
): Promise<Res<T>> {
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
    }),
    env as never,
    exec as never
  );
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  return { status: res.status, body: (isJson ? await res.json() : await res.arrayBuffer()) as T };
}

function ok<T>(res: Res<T>, ...accept: number[]): T {
  const allowed = accept.length ? accept : [200, 201, 204];
  if (!allowed.includes(res.status)) {
    throw new Error(`expected ${allowed.join("|")}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

beforeAll(async () => {
  const client = createClient({ url: ":memory:" });
  const statements = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) await client.execute(stmt);
  database = drizzle(client) as unknown as Db;
  seeded = await seed(database as never, { mfaSecret: DEMO_TOTP_SECRET });
  env = { DB_CLIENT: database, ENVIRONMENT: "development", APP_ORIGIN: "http://localhost:5173" } as unknown as Env;

  const login = await call("POST", "/v1/auth/login", {
    email: "faisal.omar@gonxt.ae",
    password: PASSWORD,
    tenantSlug: "gonxt"
  });
  token = ok(login).token as string;
  const verified = await call("POST", "/v1/auth/mfa/verify", {
    code: await totpAt(DEMO_TOTP_SECRET, Math.floor(Date.now() / 1000 / TOTP_STEP_SEC))
  });
  expect(verified.status).toBe(200);
}, 120_000);

describe("dist referral settlement (docs/superpowers/specs/2026-08-16-revenue-lines-full-build-design.md, Group A)", () => {
  it("refuses to settle a referral that was never qualified", async () => {
    const res = await call("POST", "/v1/dist/referrals/settle", {
      referralRef: "ref-never-qualified",
      currency: "AED",
      grossMinor: 10_000_00
    });
    expect(res.status).toBe(409);
  });

  it("qualifies then settles a referral, chaining REFERRAL-SETL off REFERRAL-QUAL", async () => {
    const referralRef = "ref-001";
    const qualified = ok(await call("POST", "/v1/dist/referrals/qualify", { referralRef, channelId: seeded.channels.web }), 201);
    expect(qualified.txn.state).toBe("settled");

    const settled = ok(
      await call("POST", "/v1/dist/referrals/settle", {
        referralRef,
        currency: "AED",
        grossMinor: 8_000_00,
        channelMinor: 1_000_00
      }),
      201
    );
    expect(settled.txn.state).toBe("settled");
    expect(settled.txn.parentTxnId).toBe(qualified.txn.id);

    const legs = await database
      .select()
      .from(schema.ledgerJournalLines)
      .where(eq(schema.ledgerJournalLines.batchId, settled.txn.ledgerBatchId as string));
    const debit = legs.filter((l) => l.side === "debit").reduce((n, l) => n + l.amountMinor, 0);
    const credit = legs.filter((l) => l.side === "credit").reduce((n, l) => n + l.amountMinor, 0);
    expect(debit).toBe(credit);
    expect(legs.some((l) => l.accountCode === "2100" && l.amountMinor === 1_000_00)).toBe(true);

    const audits = await database
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, seeded.tenantId), eq(schema.auditLog.action, "dist.referral.settle")));
    expect(audits.some((a) => a.subjectRef === referralRef)).toBe(true);
  });

  it("is idempotent on qualify replay", async () => {
    const referralRef = "ref-002";
    const first = ok(await call("POST", "/v1/dist/referrals/qualify", { referralRef }), 201);
    const second = ok(await call("POST", "/v1/dist/referrals/qualify", { referralRef }), 201);
    expect(second.txn.id).toBe(first.txn.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lyra/api test dist-referral-settlement.test.ts`
Expected: FAIL — `/v1/dist/referrals/qualify` and `/v1/dist/referrals/settle` return 404.

- [ ] **Step 3: Write `referral-settlement.ts`**

```ts
import { and, eq } from "drizzle-orm";
import { schema } from "@lyra/db";
import { audit, conflict, emit, type Ctx } from "@lyra/core";
import { buildRecipe, runTxn } from "@lyra/ledger";

export interface QualifyReferralInput {
  referralRef: string;
  channelId?: string;
}

export async function qualifyReferral(ctx: Ctx, input: QualifyReferralInput) {
  const txn = await runTxn(ctx, {
    type: "REFERRAL-QUAL",
    idempotencyKey: `dist.referral.qualify:${input.referralRef}`,
    subjectRefs: { referral: input.referralRef, ...(input.channelId ? { channel: input.channelId } : {}) }
  });

  await audit(ctx, {
    action: "dist.referral.qualify",
    subjectRef: input.referralRef,
    after: { txnId: txn.id, channelId: input.channelId ?? null }
  });
  await emit(ctx, {
    module: "dist",
    type: "dist.referral.qualified",
    subject: input.referralRef,
    data: { referralRef: input.referralRef, channelId: input.channelId ?? null, txnId: txn.id }
  });
  return { txn };
}

export interface SettleReferralInput {
  referralRef: string;
  currency: string;
  grossMinor: number;
  channelMinor?: number;
}

export async function settleReferral(ctx: Ctx, input: SettleReferralInput) {
  const qualifyKey = `dist.referral.qualify:${input.referralRef}`;
  const rows = await ctx.db
    .select({ id: schema.ledgerTxns.id, state: schema.ledgerTxns.state })
    .from(schema.ledgerTxns)
    .where(and(eq(schema.ledgerTxns.tenantId, ctx.tenantId), eq(schema.ledgerTxns.idempotencyKey, qualifyKey)))
    .limit(1);
  const qualifyTxn = rows[0];
  if (!qualifyTxn || qualifyTxn.state !== "settled") {
    throw conflict(`referral ${input.referralRef} has not been qualified`);
  }

  const txn = await runTxn(
    ctx,
    {
      type: "REFERRAL-SETL",
      idempotencyKey: `dist.referral.settle:${input.referralRef}`,
      currency: input.currency,
      grossMinor: input.grossMinor,
      parentTxnId: qualifyTxn.id,
      subjectRefs: { referral: input.referralRef }
    },
    {
      recipe: {
        lines: buildRecipe("REFERRAL-SETL", { grossMinor: input.grossMinor, channelMinor: input.channelMinor ?? 0 }),
        currency: input.currency
      }
    }
  );

  await audit(ctx, {
    action: "dist.referral.settle",
    subjectRef: input.referralRef,
    after: { txnId: txn.id, grossMinor: input.grossMinor }
  });
  await emit(ctx, {
    module: "dist",
    type: "dist.referral.settled",
    subject: input.referralRef,
    data: {
      referralRef: input.referralRef,
      grossMinor: input.grossMinor,
      channelMinor: input.channelMinor ?? 0,
      currency: input.currency,
      txnId: txn.id
    }
  });
  return { txn };
}
```

Note: the spec's prose (line 41) describes REFERRAL-SETL settling via `receivableSettlement`; the already-registered `RECIPES["REFERRAL-SETL"]` entry actually uses `commissionAccrual`. This function calls `buildRecipe("REFERRAL-SETL", ...)` agnostic to which builder backs the registry entry, so no code change is needed to accommodate this — noted here only so a future reader isn't confused by the discrepancy.

- [ ] **Step 4: Add the two routes in `routes/dist.ts`**

In `apps/api/src/routes/dist.ts`, add the import alongside the file's other engine-adjacent code:

```ts
import { qualifyReferral, settleReferral } from "../engines/referral-settlement.js";
```

Then add the routes near the other `distRoutes.post` calls:

```ts
const QualifyReferralBody = z.object({
  referralRef: z.string().min(1).max(200),
  channelId: z.string().min(1).max(64).optional()
});

distRoutes.post("/referrals/qualify", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "dist:commissions:adjust", { tenantId: ctx.tenantId, module: "dist" });
  const input = await body(c, QualifyReferralBody);
  const out = await withIdempotency(ctx, c.req.header("idempotency-key"), "dist.referral.qualify", input, () =>
    qualifyReferral(ctx, input)
  );
  return c.json(out, 201);
});

const SettleReferralBody = z.object({
  referralRef: z.string().min(1).max(200),
  currency: z.string().length(3),
  grossMinor: z.number().int().positive(),
  channelMinor: z.number().int().nonnegative().optional()
});

distRoutes.post("/referrals/settle", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "dist:commissions:settle", { tenantId: ctx.tenantId, module: "dist" });
  const input = await body(c, SettleReferralBody);
  const out = await withIdempotency(ctx, c.req.header("idempotency-key"), "dist.referral.settle", input, () =>
    settleReferral(ctx, input)
  );
  return c.json(out, 201);
});
```

(`require_`, `withIdempotency`, `body`, `z`, `schema` are already imported in `routes/dist.ts` — reuse them.) Both routes use the existing `dist:commissions:adjust`/`dist:commissions:settle` permissions, already granted to `finance.controller` via its `dist:commissions:*` wildcard — no RBAC change needed for this task.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @lyra/api test dist-referral-settlement.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors introduced.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/engines/referral-settlement.ts apps/api/src/routes/dist.ts apps/api/src/dist-referral-settlement.test.ts
git commit -m "feat(dist): add REFERRAL-QUAL/REFERRAL-SETL chained settlement engine"
```

---

### Task 3: `packages/core/src/rbac.ts` — new `compliance:disclosures:present` permission

**Files:**
- Modify: `packages/core/src/rbac.ts`
- Test: `packages/core/src/rbac.test.ts` (extend if it exists; otherwise add a focused assertion in the Task 4 route test instead — this task's own step 4 below covers verification either way)

**Interfaces:**
- Consumes: nothing new.
- Produces: permission string literal `"compliance:disclosures:present"` in the `PERMISSIONS` catalogue, granted to `axis.lead` and `signal.lead`. Task 4's route depends on this permission existing and being grantable.

- [ ] **Step 1: Read current state to confirm insertion points**

Run: `grep -n '"compliance:disclosures:read"' packages/core/src/rbac.ts`
Expected: one match, inside the `PERMISSIONS` array/catalogue definition.

Run: `grep -n 'axis.lead\|signal.lead' packages/core/src/rbac.ts`
Expected: two role definitions, each with a permissions array.

- [ ] **Step 2: Add the permission to the catalogue**

In `packages/core/src/rbac.ts`, find the line containing `"compliance:disclosures:read"` in the `PERMISSIONS` catalogue and add the new permission directly after it:

```ts
  "compliance:disclosures:read",
  "compliance:disclosures:present",
```

- [ ] **Step 3: Grant the permission to `axis.lead` and `signal.lead`**

In the `axis.lead` role's permissions array, add `"compliance:disclosures:present"` as a new entry (append to the array, comma-separated like its neighbors — do not remove or reorder existing entries). Do the same for the `signal.lead` role's permissions array.

- [ ] **Step 4: Verify via typecheck and existing RBAC tests**

Run: `pnpm typecheck && pnpm --filter @lyra/core test rbac`
Expected: no errors; if an existing test enumerates permission counts per role, update its expected count by +1 for both `axis.lead` and `signal.lead` (locate via `grep -n "axis.lead" packages/core/src/*.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rbac.ts
git commit -m "feat(rbac): add compliance:disclosures:present permission for axis.lead and signal.lead"
```

---

### Task 4: `routes/compliance.ts` — disclosure-present route

**Files:**
- Modify: `apps/api/src/routes/compliance.ts` (add route; no new imports needed — `id`, `schema`, `sha256Hex`, `audit`, `emit`, `require_`, `body` are already imported in this file)
- Test: `apps/api/src/compliance-disclosure-present.test.ts`

**Interfaces:**
- Consumes: `id`, `schema` from `@lyra/db`; `audit`, `emit`, `require_`, `sha256Hex`, `type Ctx` from `@lyra/core`; `body` from `../http.js` — all already imported in `routes/compliance.ts`.
- Produces: `POST /v1/compliance/disclosures/present` route inserting a row into `schema.disclosures`. Task 5's precondition test depends on this route existing to create disclosure rows.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/compliance-disclosure-present.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { schema, type Db } from "@lyra/db";
import { seed, totpAt, TOTP_STEP_SEC, type SeedResult } from "@lyra/core";
import { app } from "./index.js";
import type { Env } from "./env.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const exec = { waitUntil() {}, passThroughOnException() {} };

let env: Env;
let database: Db;
let seeded: SeedResult;
let token: string;

interface Res<T = any> {
  status: number;
  body: T;
}

async function call<T = any>(method: string, path: string, payload?: unknown): Promise<Res<T>> {
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
    }),
    env as never,
    exec as never
  );
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  return { status: res.status, body: (isJson ? await res.json() : await res.arrayBuffer()) as T };
}

function ok<T>(res: Res<T>, ...accept: number[]): T {
  const allowed = accept.length ? accept : [200, 201, 204];
  if (!allowed.includes(res.status)) {
    throw new Error(`expected ${allowed.join("|")}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

beforeAll(async () => {
  const client = createClient({ url: ":memory:" });
  const statements = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) await client.execute(stmt);
  database = drizzle(client) as unknown as Db;
  seeded = await seed(database as never, { mfaSecret: DEMO_TOTP_SECRET });
  env = { DB_CLIENT: database, ENVIRONMENT: "development", APP_ORIGIN: "http://localhost:5173" } as unknown as Env;

  const login = await call("POST", "/v1/auth/login", {
    email: "omar.farouk@gonxt.ae",
    password: PASSWORD,
    tenantSlug: "gonxt"
  });
  token = ok(login).token as string;
  const verified = await call("POST", "/v1/auth/mfa/verify", {
    code: await totpAt(DEMO_TOTP_SECRET, Math.floor(Date.now() / 1000 / TOTP_STEP_SEC))
  });
  expect(verified.status).toBe(200);
}, 120_000);

describe("compliance disclosure present (docs/superpowers/specs/2026-08-16-revenue-lines-full-build-design.md, Group A)", () => {
  it("presents a disclosure and writes a disclosures row", async () => {
    const out = ok(
      await call("POST", "/v1/compliance/disclosures/present", {
        subjectRef: "campaign:xyz",
        key: "ad_placement",
        wording: "This is a sponsored placement.",
        channel: "web"
      }),
      201
    );
    expect(out.subjectRef).toBe("campaign:xyz");
    expect(out.key).toBe("ad_placement");
    expect(out.wordingHash).toBeTruthy();

    const rows = await database
      .select()
      .from(schema.disclosures)
      .where(and(eq(schema.disclosures.tenantId, seeded.tenantId), eq(schema.disclosures.subjectRef, "campaign:xyz")));
    expect(rows.length).toBe(1);

    const audits = await database
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, seeded.tenantId), eq(schema.auditLog.action, "compliance.disclosure.present")));
    expect(audits.some((a) => a.subjectRef === "campaign:xyz")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lyra/api test compliance-disclosure-present.test.ts`
Expected: FAIL — `/v1/compliance/disclosures/present` returns 404.

- [ ] **Step 3: Add the route in `routes/compliance.ts`**

Add near the existing `/screenings/run` route:

```ts
const DisclosurePresentBody = z
  .object({
    subjectRef: z.string().min(1).max(200),
    key: z.string().min(1).max(64),
    locale: z.string().min(2).max(10).default("en"),
    wording: z.string().min(1),
    wordingRef: z.string().min(1).max(200).optional(),
    criteria: z.record(z.string(), z.unknown()).optional(),
    channel: z.string().min(1).max(64),
    customerId: z.string().min(1).max(64).optional()
  })
  .strict();

complianceRoutes.post("/disclosures/present", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "compliance:disclosures:present", { tenantId: ctx.tenantId, module: "compliance" });
  const input = await body(c, DisclosurePresentBody);

  const wordingHash = await sha256Hex(input.wording);
  const row = {
    id: id("dsc", ctx.now),
    tenantId: ctx.tenantId,
    key: input.key,
    locale: input.locale,
    subjectRef: input.subjectRef,
    customerId: input.customerId ?? null,
    wordingHash,
    wordingRef: input.wordingRef ?? null,
    criteriaJson: input.criteria ? JSON.stringify(input.criteria) : null,
    channel: input.channel,
    acknowledgedAt: null,
    ts: ctx.now
  };
  await ctx.db.insert(schema.disclosures).values(row);
  await audit(ctx, { action: "compliance.disclosure.present", subjectRef: input.subjectRef, after: row });
  await emit(ctx, {
    module: "compliance",
    type: "compliance.disclosure.presented",
    subject: input.subjectRef,
    data: { disclosureId: row.id, key: row.key, channel: row.channel }
  });
  return c.json(row, 201);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lyra/api test compliance-disclosure-present.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors introduced.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/compliance.ts apps/api/src/compliance-disclosure-present.test.ts
git commit -m "feat(compliance): add disclosure-present route writing to disclosures table"
```

---

### Task 5: `packages/ledger/src/preconditions.ts` — AD-PLACEMENT freshness gate

**Files:**
- Modify: `packages/ledger/src/preconditions.ts`
- Test: `packages/ledger/src/preconditions.test.ts` (extend existing file)
- Test: `apps/api/src/ledger-ad-placement.test.ts` (new, route-level)

**Interfaces:**
- Consumes: `schema.disclosures` (already exists); `conflict` from `@lyra/core`; the file's own existing `Precondition` type and `TXN_PRECONDITIONS` registry.
- Produces: `TXN_PRECONDITIONS["AD-PLACEMENT"]` entry. No later task depends on this.

- [ ] **Step 1: Write the failing unit test**

Add to `packages/ledger/src/preconditions.test.ts` (following the file's existing test setup pattern for the other entries in `TXN_PRECONDITIONS`):

```ts
describe("AD-PLACEMENT precondition", () => {
  it("refuses when no disclosure has been presented for the subjectRef", async () => {
    const precondition = TXN_PRECONDITIONS["AD-PLACEMENT"]!;
    await expect(precondition(ctx, { subjectRef: "campaign:no-disclosure" })).rejects.toThrow();
  });

  it("refuses when the disclosure is older than 24 hours", async () => {
    await db.insert(schema.disclosures).values({
      id: "dsc_stale",
      tenantId: ctx.tenantId,
      key: "ad_placement",
      locale: "en",
      subjectRef: "campaign:stale",
      customerId: null,
      wordingHash: "deadbeef",
      wordingRef: null,
      criteriaJson: null,
      channel: "web",
      acknowledgedAt: null,
      ts: ctx.now - 25 * 60 * 60 * 1000
    });
    const precondition = TXN_PRECONDITIONS["AD-PLACEMENT"]!;
    await expect(precondition(ctx, { subjectRef: "campaign:stale" })).rejects.toThrow();
  });

  it("passes when a fresh disclosure exists for the subjectRef", async () => {
    await db.insert(schema.disclosures).values({
      id: "dsc_fresh",
      tenantId: ctx.tenantId,
      key: "ad_placement",
      locale: "en",
      subjectRef: "campaign:fresh",
      customerId: null,
      wordingHash: "deadbeef",
      wordingRef: null,
      criteriaJson: null,
      channel: "web",
      acknowledgedAt: null,
      ts: ctx.now - 60 * 60 * 1000
    });
    const precondition = TXN_PRECONDITIONS["AD-PLACEMENT"]!;
    await expect(precondition(ctx, { subjectRef: "campaign:fresh" })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lyra/ledger test preconditions.test.ts`
Expected: FAIL — `TXN_PRECONDITIONS["AD-PLACEMENT"]` is `undefined`.

- [ ] **Step 3: Add the precondition**

In `packages/ledger/src/preconditions.ts`, add `gte` to the existing `drizzle-orm` import:

```ts
import { and, eq, gte } from "drizzle-orm";
```

Add the helper and precondition function (following the file's existing `fiscalYearOf`-style helper convention), and register it:

```ts
function subjectRefOf(args: Record<string, unknown>): string {
  const s = args["subjectRef"];
  if (typeof s !== "string" || !s) throw conflict("subjectRef is required");
  return s;
}

const AD_PLACEMENT_STALENESS_MS = 24 * 60 * 60 * 1000;

const freshAdPlacementDisclosure: Precondition = async (ctx, args) => {
  const subjectRef = subjectRefOf(args);
  const rows = await ctx.db
    .select({ id: schema.disclosures.id })
    .from(schema.disclosures)
    .where(
      and(
        eq(schema.disclosures.tenantId, ctx.tenantId),
        eq(schema.disclosures.subjectRef, subjectRef),
        eq(schema.disclosures.key, "ad_placement"),
        gte(schema.disclosures.ts, ctx.now - AD_PLACEMENT_STALENESS_MS)
      )
    )
    .limit(1);
  if (!rows.length) {
    throw conflict(`no disclosure presented for ${subjectRef} in the last 24h; present one before placing this ad`);
  }
};
```

Then add `"AD-PLACEMENT": freshAdPlacementDisclosure` as a new entry in the `TXN_PRECONDITIONS` object (alongside the existing `"OPEN-BAL"` and `"YEAR-END-CLOSE"` entries).

- [ ] **Step 4: Run unit test to verify it passes**

Run: `pnpm --filter @lyra/ledger test preconditions.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing route-level integration test**

Create `apps/api/src/ledger-ad-placement.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeAll, describe, expect, it } from "vitest";
import { schema, type Db } from "@lyra/db";
import { seed, totpAt, TOTP_STEP_SEC, type SeedResult } from "@lyra/core";
import { app } from "./index.js";
import type { Env } from "./env.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const exec = { waitUntil() {}, passThroughOnException() {} };

let env: Env;
let database: Db;
let seeded: SeedResult;
let token: string;

interface Res<T = any> {
  status: number;
  body: T;
}

async function call<T = any>(
  method: string,
  path: string,
  payload?: unknown,
  headers: Record<string, string> = {}
): Promise<Res<T>> {
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
    }),
    env as never,
    exec as never
  );
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  return { status: res.status, body: (isJson ? await res.json() : await res.arrayBuffer()) as T };
}

function ok<T>(res: Res<T>, ...accept: number[]): T {
  const allowed = accept.length ? accept : [200, 201, 204];
  if (!allowed.includes(res.status)) {
    throw new Error(`expected ${allowed.join("|")}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

beforeAll(async () => {
  const client = createClient({ url: ":memory:" });
  const statements = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) await client.execute(stmt);
  database = drizzle(client) as unknown as Db;
  seeded = await seed(database as never, { mfaSecret: DEMO_TOTP_SECRET });
  env = { DB_CLIENT: database, ENVIRONMENT: "development", APP_ORIGIN: "http://localhost:5173" } as unknown as Env;

  const login = await call("POST", "/v1/auth/login", {
    email: "faisal.omar@gonxt.ae",
    password: PASSWORD,
    tenantSlug: "gonxt"
  });
  token = ok(login).token as string;
  const verified = await call("POST", "/v1/auth/mfa/verify", {
    code: await totpAt(DEMO_TOTP_SECRET, Math.floor(Date.now() / 1000 / TOTP_STEP_SEC))
  });
  expect(verified.status).toBe(200);
}, 120_000);

describe("AD-PLACEMENT precondition (docs/superpowers/specs/2026-08-16-revenue-lines-full-build-design.md, Group A)", () => {
  it("refuses to post AD-PLACEMENT with no prior disclosure", async () => {
    const res = await call("POST", "/v1/ledger/txn/AD-PLACEMENT", {
      idempotencyKey: "ad-placement-no-disclosure",
      currency: "AED",
      subjectRefs: { campaign: "campaign:no-disclosure" },
      args: { grossMinor: 5_000_00, subjectRef: "campaign:no-disclosure" }
    });
    expect(res.status).toBe(409);

    const txns = await database.select().from(schema.ledgerTxns).where(eq(schema.ledgerTxns.idempotencyKey, "ad-placement-no-disclosure"));
    expect(txns.length).toBe(0);
  });

  it("posts AD-PLACEMENT once a fresh disclosure exists", async () => {
    ok(
      await call("POST", "/v1/compliance/disclosures/present", {
        subjectRef: "campaign:ready",
        key: "ad_placement",
        wording: "This is a sponsored placement.",
        channel: "web"
      }),
      201
    );

    const out = ok(
      await call("POST", "/v1/ledger/txn/AD-PLACEMENT", {
        idempotencyKey: "ad-placement-ready",
        currency: "AED",
        subjectRefs: { campaign: "campaign:ready" },
        args: { grossMinor: 5_000_00, subjectRef: "campaign:ready" }
      }),
      201
    );
    expect(out.txn.state).toBe("settled");
  });
});
```

Add the missing `eq` import from `drizzle-orm` at the top of this file alongside the other imports.

- [ ] **Step 6: Run test to verify it fails, then passes**

Run: `pnpm --filter @lyra/api test ledger-ad-placement.test.ts`
Expected first: FAIL (no `Task 3` permission needed here — this route uses the generic ledger route with `ledger:*:*`/relevant permission already granted to `finance.controller`; failure is due to the precondition not yet existing before Step 3, or passes immediately if Task run order already completed Step 3-4 above). After Steps 3-4 are in place: PASS (2 tests).

- [ ] **Step 7: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors introduced.

- [ ] **Step 8: Commit**

```bash
git add packages/ledger/src/preconditions.ts packages/ledger/src/preconditions.test.ts apps/api/src/ledger-ad-placement.test.ts
git commit -m "feat(ledger): gate AD-PLACEMENT on a fresh disclosure precondition"
```

---

## Self-Review Notes

- **Spec coverage:** All six types (BIND-GROUP, FEE-BROK — Task 1; REFERRAL-QUAL, REFERRAL-SETL — Task 2; AD-PLACEMENT — Task 5; DISCLOSURE-PRESENT — Task 4) are covered. The RBAC prerequisite for DISCLOSURE-PRESENT is its own task (Task 3) since it must land before Task 4's route is usable by non-`finance.controller` actors. All three spec-mandated test types are present: dual-control test for BIND-GROUP (Task 1, test 1), precondition-refusal test for AD-PLACEMENT (Task 5, tests 5-6), settlement-lifecycle test for REFERRAL-QUAL/SETL (Task 2, tests 1-3).
- **No new `TXN_TYPES`/`RECIPES` entries added** — all six were already registered before this plan, confirmed by direct inspection.
- **No new database tables or migrations** — `disclosures` already exists and is already read-only in `apps/api/src/resources.ts`, so no CRUD-lockdown step is needed for Group A (unlike Groups C/D per the spec, which do need lockdown steps for tables introduced or newly owned by their engines).
- **Task order matters:** Task 3 (RBAC) must run before Task 4 (route) for the route's `require_` check to have a grantable permission; Task 4 must run before Task 5's route-level test (Step 5-6) since it calls `POST /v1/compliance/disclosures/present` to create the fresh disclosure row. Tasks 1 and 2 are independent of 3/4/5 and of each other.
