# Customer 360 Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cases panel, activity timeline, chip rendering, open-in-module links, CSAT sparkline, offer confidence meter, and a server-side position aggregate endpoint to the Customer 360 screen.

**Architecture:** One new hand-written GET on the existing core module router (`apps/api/src/routes/core.ts`, mounted before generated CRUD so it wins), documented in `HAND_WRITTEN` in `apps/api/src/openapi.ts` and regenerated into `packages/sdk`. All web work stays in `apps/web/app/routes/customer-360.tsx` + its test, reusing `@lyra/ui` components (Timeline, Sparkline, ConfidenceMeter, Badge) and `detail-kit` helpers.

**Tech Stack:** Hono, Drizzle (SQLite via libsql in tests), React Router v7, Vitest, Zod, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-05-customer-360-depth-design.md`

## Global Constraints

- TDD: failing test before production code, red → green, in every task.
- Every new UI string exists in BOTH `en` and `ar` in the route `LABELS` table (existing parity test enforces).
- Logical CSS only (`margin-inline-start` etc.); Tailwind utilities used here (`gap`, `p-4`) are logical-safe.
- No provider SDKs, no new dependencies, no schema changes, no new migrations.
- Commit messages end with trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Run commands from repo root `/Users/reshigan/Lyra`.

**Spec deviations (deliberate, note in PR):**
1. Spec says audit query `subjectRef=customer:{id}`. Wrong: generated CRUD audits with the raw row id (`apps/api/src/crud.ts:441` — `subjectRef: rowId`). Query uses `subjectRef={id}` raw.
2. Spec's "soft-delete exclusion" test: `axis_policies`/`axis_claims` have no `deletedAt` column, so there is nothing to exclude there. The customer row does; the test soft-deletes the customer directly in the DB and expects 404 (via `must()`, which is soft-delete aware).

---

### Task 1: Position endpoint (`GET /v1/core/customers/:id/position`)

**Files:**
- Create: `apps/api/src/customer-position.test.ts`
- Modify: `apps/api/src/routes/core.ts` (append route at end of file; extend imports)

**Interfaces:**
- Consumes: existing harness pattern from `apps/api/src/axis-audit-bundle.test.ts`; `must()` from `apps/api/src/rows.ts`; `require_`, `can` from `@lyra/core`; `schema.customers`, `schema.axisPolicies`, `schema.axisClaims` from `@lyra/db`.
- Produces: JSON `{ positions: Array<{ currency: string; premiumMinor: number | null; commissionMinor: number | null; settledMinor: number | null }>, ltvMinor: number, currency: string }`. Positions sorted by `premiumMinor` desc; `currency` = `positions[0]?.currency ?? "AED"`; a permission the actor lacks makes that field `null` on every line, never 0. Tasks 2 and 3 rely on this exact shape.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/customer-position.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { seed, totpAt, TOTP_STEP_SEC } from "@lyra/core";
import { schema, type Db } from "@lyra/db";
import { app } from "./index.js";
import type { Env } from "./env.js";

// The 360 screen's Position card summed the first CRUD page client-side —
// wrong money past 50 rows, wrong currency for multi-currency customers.
// This endpoint aggregates in SQL, grouped by currency, and degrades per
// permission the same way the screen's panels do: a sum the actor may not
// see is null, never 0.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const exec = { waitUntil() {}, passThroughOnException() {} };

/** axis.lead holds policies+claims reads; orbit.agent holds policies but not claims. */
const PEOPLE: Record<string, string> = {
  lead: "omar.farouk",
  agent: "sara.nasser"
};

let env: Env;
let database: Db;
let tokens: Record<string, string>;

interface Res<T = any> {
  status: number;
  body: T;
}

async function call<T = any>(who: string | null, method: string, path: string, payload?: unknown): Promise<Res<T>> {
  const token = who ? tokens[who] : undefined;
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
    }),
    env as never,
    exec as never
  );
  const text = res.headers.get("content-type")?.includes("json") ? await res.text() : "";
  return { status: res.status, body: text ? (JSON.parse(text) as T) : (null as T) };
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
  await seed(database as never, { mfaSecret: DEMO_TOTP_SECRET });

  env = {
    DB_CLIENT: database,
    ENVIRONMENT: "development",
    APP_ORIGIN: "http://localhost:5173"
  } as unknown as Env;

  tokens = {};
  for (const [who, local] of Object.entries(PEOPLE)) {
    const login = await call(null, "POST", "/v1/auth/login", { email: `${local}@gonxt.ae`, password: PASSWORD, tenantSlug: "gonxt" });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const verified = await app.fetch(
      new Request("http://api.test/v1/auth/mfa/verify", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: await totpAt(DEMO_TOTP_SECRET, Math.floor(Date.now() / 1000 / TOTP_STEP_SEC)) })
      }),
      env as never,
      exec as never
    );
    expect(verified.status).toBe(200);
    tokens[who] = token;
  }
}, 120_000);

interface Position {
  positions: Array<{ currency: string; premiumMinor: number | null; commissionMinor: number | null; settledMinor: number | null }>;
  ltvMinor: number;
  currency: string;
}

async function newCustomer(suffix: string): Promise<string> {
  const created = await call("lead", "POST", "/v1/core/customers", { nameJson: { en: `Position ${suffix}` } });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

async function newPolicy(customerId: string, policyNo: string, currency: string, premiumMinor: number, commissionMinor: number): Promise<string> {
  const created = await call("lead", "POST", "/v1/axis/policies", {
    customerId,
    providerId: "prv_test",
    policyNo,
    startAt: 1,
    endAt: 2,
    premiumMinor,
    commissionMinor,
    currency
  });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

describe("GET /v1/core/customers/:id/position", () => {
  it("sums per currency in SQL and names the largest-premium currency dominant", async () => {
    const customerId = await newCustomer("multi");
    const policyId = await newPolicy(customerId, "POS-AED-1", "AED", 120_000, 9_600);
    await newPolicy(customerId, "POS-AED-2", "AED", 80_000, 4_000);
    await newPolicy(customerId, "POS-USD-1", "USD", 50_000, 2_500);
    const claim = await call("lead", "POST", "/v1/axis/claims", {
      policyId,
      customerId,
      claimNo: "POS-CLM-1",
      reportedAt: 3,
      currency: "AED",
      settledMinor: 40_000
    });
    expect(claim.status).toBe(201);

    const res = await call<Position>("lead", "GET", `/v1/core/customers/${customerId}/position`);
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe("AED");
    expect(res.body.ltvMinor).toBe(0);
    expect(res.body.positions).toEqual([
      { currency: "AED", premiumMinor: 200_000, commissionMinor: 13_600, settledMinor: 40_000 },
      { currency: "USD", premiumMinor: 50_000, commissionMinor: 2_500, settledMinor: 0 }
    ]);
  });

  it("nulls the sums an actor may not read, never zeroing them", async () => {
    const customerId = await newCustomer("degraded");
    const policyId = await newPolicy(customerId, "POS-DEG-1", "AED", 70_000, 3_500);
    const claim = await call("lead", "POST", "/v1/axis/claims", {
      policyId,
      customerId,
      claimNo: "POS-CLM-2",
      reportedAt: 3,
      currency: "AED",
      settledMinor: 10_000
    });
    expect(claim.status).toBe(201);

    // orbit.agent: axis:policies:read yes, axis:claims:read no (packages/core/src/rbac.ts).
    const res = await call<Position>("agent", "GET", `/v1/core/customers/${customerId}/position`);
    expect(res.status).toBe(200);
    expect(res.body.positions).toEqual([
      { currency: "AED", premiumMinor: 70_000, commissionMinor: 3_500, settledMinor: null }
    ]);
  });

  it("404s an id that does not exist in the tenant", async () => {
    const res = await call("lead", "GET", "/v1/core/customers/cus_nope/position");
    expect(res.status).toBe(404);
  });

  it("404s a soft-deleted customer", async () => {
    const customerId = await newCustomer("gone");
    await database
      .update(schema.customers)
      .set({ deletedAt: Date.now() })
      .where(and(eq(schema.customers.id, customerId)));
    const res = await call("lead", "GET", `/v1/core/customers/${customerId}/position`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lyra/api test -- customer-position`
Expected: FAIL — the four `position` calls return 404-with-wrong-shape / non-200 (route absent; the generated CRUD record route does not match `/position`). The seeding calls (login, customer, policy, claim creates) must PASS their inline expects — if one of those fails, fix the test, not the API.

- [ ] **Step 3: Write the route**

In `apps/api/src/routes/core.ts`:

Change line 2 from:

```ts
import { and, eq, gt, isNull } from "drizzle-orm";
```

to:

```ts
import { and, eq, gt, isNull, sql } from "drizzle-orm";
```

Append at end of file:

```ts
/* ------------------------------------------------------------- position */

// The 360 screen's Position card needs real sums, not the first CRUD page
// added up client-side. SQL SUM grouped by currency; a permission the actor
// lacks nulls that field on every line — null reads "may not see", 0 would
// read "nothing there". axis_policies/axis_claims carry no deletedAt, so
// there is no soft-delete branch to mirror; the customer row itself is
// soft-delete-checked by `must`.
coreRoutes.get("/customers/:id/position", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "core:customers:read", { tenantId: ctx.tenantId, module: "core" });
  const id = c.req.param("id");
  const customer = await must(ctx, schema.customers, id, "customers");

  const mayPolicies = can(ctx.actor, "axis:policies:read", { tenantId: ctx.tenantId });
  const mayClaims = can(ctx.actor, "axis:claims:read", { tenantId: ctx.tenantId });

  const policyAgg = mayPolicies
    ? await ctx.db
        .select({
          currency: schema.axisPolicies.currency,
          premiumMinor: sql<number>`coalesce(sum(${schema.axisPolicies.premiumMinor}), 0)`,
          commissionMinor: sql<number>`coalesce(sum(${schema.axisPolicies.commissionMinor}), 0)`
        })
        .from(schema.axisPolicies)
        .where(and(eq(schema.axisPolicies.tenantId, ctx.tenantId), eq(schema.axisPolicies.customerId, id)))
        .groupBy(schema.axisPolicies.currency)
    : [];
  const claimAgg = mayClaims
    ? await ctx.db
        .select({
          currency: schema.axisClaims.currency,
          settledMinor: sql<number>`coalesce(sum(${schema.axisClaims.settledMinor}), 0)`
        })
        .from(schema.axisClaims)
        .where(and(eq(schema.axisClaims.tenantId, ctx.tenantId), eq(schema.axisClaims.customerId, id)))
        .groupBy(schema.axisClaims.currency)
    : [];

  interface Line {
    currency: string;
    premiumMinor: number | null;
    commissionMinor: number | null;
    settledMinor: number | null;
  }
  const byCurrency = new Map<string, Line>();
  const line = (currency: string): Line => {
    const found = byCurrency.get(currency) ?? {
      currency,
      premiumMinor: mayPolicies ? 0 : null,
      commissionMinor: mayPolicies ? 0 : null,
      settledMinor: mayClaims ? 0 : null
    };
    byCurrency.set(currency, found);
    return found;
  };
  for (const row of policyAgg) {
    const entry = line(row.currency);
    entry.premiumMinor = Number(row.premiumMinor);
    entry.commissionMinor = Number(row.commissionMinor);
  }
  for (const row of claimAgg) line(row.currency).settledMinor = Number(row.settledMinor);

  const positions = [...byCurrency.values()].sort((a, b) => (b.premiumMinor ?? 0) - (a.premiumMinor ?? 0));
  return c.json({
    positions,
    ltvMinor: customer.ltvCached ?? 0,
    currency: positions[0]?.currency ?? "AED"
  });
});
```

(`require_`, `can`, `must`, `schema` are already imported at the top of the file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lyra/api test -- customer-position`
Expected: PASS, 4 tests.

- [ ] **Step 5: Full API suite + typecheck**

Run: `pnpm --filter @lyra/api test && pnpm --filter @lyra/api typecheck`
Expected: PASS. (`apps/api` openapi test may fail here if it asserts route↔spec parity — if it does, that is Task 2's red step arriving early; note it and continue to Task 2 before committing, then commit both together.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/customer-position.test.ts apps/api/src/routes/core.ts
git commit -m "feat(api): customer position aggregate endpoint

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: OpenAPI entry + SDK regeneration

**Files:**
- Modify: `apps/api/src/openapi.ts` (HAND_WRITTEN array, after the `/v1/core/webhooks/{id}/rotate` entry at ~line 74)
- Regenerate: `packages/sdk/src/generated.ts` (via script — do not hand-edit)

**Interfaces:**
- Consumes: Task 1's route path `/v1/core/customers/{id}/position`, permission `core:customers:read`.
- Produces: SDK client method for the path; `packages/sdk` contract test green.

- [ ] **Step 1: Verify the contract test fails first**

Run: `pnpm --filter @lyra/sdk test`
If it FAILS on a missing `/v1/core/customers/{id}/position` op — good, that is the red state. If it PASSES (the contract test only checks doc↔SDK agreement, not route coverage), the red signal is instead: `grep -c "customers/{id}/position" packages/sdk/src/generated.ts` prints `0`.

- [ ] **Step 2: Add the HAND_WRITTEN entry**

In `apps/api/src/openapi.ts`, directly after:

```ts
  { method: "post", path: "/v1/core/webhooks/{id}/rotate", summary: "Rotate a webhook's signing secret to a fresh, server-generated one", permission: "core:webhooks:write", tag: "core" },
```

insert:

```ts
  // SQL aggregate for the 360 screen's Position card — never a paged read.
  { method: "get", path: "/v1/core/customers/{id}/position", summary: "Financial position: premium, commission and settled claims summed per currency", permission: "core:customers:read", tag: "core" },
```

- [ ] **Step 3: Regenerate the SDK**

Run: `pnpm --filter @lyra/sdk generate`
Expected: `packages/sdk/src/generated.ts` diff includes the new path.
Verify: `grep -c "customers/{id}/position" packages/sdk/src/generated.ts` prints ≥ 1.

- [ ] **Step 4: Contract tests green**

Run: `pnpm --filter @lyra/sdk test && pnpm --filter @lyra/api test && pnpm --filter @lyra/sdk typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/openapi.ts packages/sdk/src/generated.ts
git commit -m "feat(sdk): document customer position endpoint in OpenAPI + SDK

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Web route logic — `chips`, PERM, interfaces, labels, loader

**Files:**
- Modify: `apps/web/app/routes/customer-360.test.ts`
- Modify: `apps/web/app/routes/customer-360.tsx` (exports/loader only; JSX is Task 4)

**Interfaces:**
- Consumes: Task 1's response shape; existing `safe`, `rowsOf`, `Page` from `./detail-kit`.
- Produces (Task 4 relies on these exact names):
  - `export function chips(value: unknown): string[]`
  - `PERM.cases = "axis:cases:read"`, `PERM.audit = "core:audit:read"`
  - `export interface CaseSummaryRow { id: string; ref: string; kind: string; productLine?: string | null; status: string; priority: string; slaDueAt?: number | null; valueMinor?: number | null; currency?: string | null }`
  - `export interface AuditRow { id: string; action: string; actorRef: string; ts: number }`
  - `export interface PositionLine { currency: string; premiumMinor: number | null; commissionMinor: number | null; settledMinor: number | null }`
  - `export interface PositionResponse { positions: PositionLine[]; ltvMinor: number; currency: string }`
  - Loader returns gain `cases: CaseSummaryRow[]`, `activity: AuditRow[]`, `position: PositionResponse | null`
  - New label keys (en+ar): `casesTitle, casesCaption, activityTitle, activityCaption, colRef, colKind, colProductLine, colPriority, colSla, colCaseValue, positionHintLedger`

- [ ] **Step 1: Write the failing tests**

In `apps/web/app/routes/customer-360.test.ts`, change the import line to:

```ts
import { LABELS, PERM, action, chips, labelsIn } from "./customer-360";
```

Inside the existing `describe("panel permissions", ...)` block, add:

```ts
  it("covers the cases panel and the activity timeline", () => {
    expect(PERM.cases).toBe("axis:cases:read");
    expect(PERM.audit).toBe("core:audit:read");
  });
```

After that describe block, add:

```ts
describe("chips", () => {
  it("passes string arrays through and answers everything else with empty", () => {
    expect(chips(["vip", "fleet"])).toEqual(["vip", "fleet"]);
    expect(chips(["ok", 7, null])).toEqual(["ok"]);
    expect(chips({ not: "an array" })).toEqual([]);
    expect(chips("vip")).toEqual([]);
    expect(chips(null)).toEqual([]);
    expect(chips(undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @lyra/web test -- customer-360`
Expected: FAIL — `chips` is not exported; `PERM.cases`/`PERM.audit` undefined.

- [ ] **Step 3: Implement in `customer-360.tsx`**

3a. Extend `PERM` (keep existing entries):

```ts
export const PERM = {
  read: "core:customers:read",
  policies: "axis:policies:read",
  claims: "axis:claims:read",
  cases: "axis:cases:read",
  audit: "core:audit:read",
  conversations: "orbit:conversations:read",
  consents: "core:consents:read",
  files: "core:files:read",
  offers: "dist:offers:read",
  surface: "dist:offers:surface",
  decide: "dist:offers:override",
  quotes: "dist:quote_requests:read"
} as const;
```

3b. After the `QuoteRequestRow` interface, add:

```ts
export interface CaseSummaryRow {
  id: string;
  ref: string;
  kind: string;
  productLine?: string | null;
  status: string;
  priority: string;
  slaDueAt?: number | null;
  valueMinor?: number | null;
  currency?: string | null;
}

export interface AuditRow {
  id: string;
  action: string;
  actorRef: string;
  ts: number;
}

export interface PositionLine {
  currency: string;
  premiumMinor: number | null;
  commissionMinor: number | null;
  settledMinor: number | null;
}

export interface PositionResponse {
  positions: PositionLine[];
  ltvMinor: number;
  currency: string;
}

/** JSON columns arrive as unknown; only an array of strings earns chips. */
export function chips(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
```

3c. Labels — add to `LABELS.en` (before `surface:`):

```ts
    casesTitle: "Cases",
    casesCaption: "Work in flight for this customer: quoting, underwriting, renewals.",
    activityTitle: "Activity",
    activityCaption: "Who touched this record, newest first.",
    colRef: "Reference",
    colKind: "Kind",
    colProductLine: "Product line",
    colPriority: "Priority",
    colSla: "SLA due",
    colCaseValue: "Value",
    positionHintLedger: "Summed on the server from every agreement and claim on record.",
```

and the same keys to `LABELS.ar` (before `surface:`):

```ts
    casesTitle: "الحالات",
    casesCaption: "الأعمال الجارية لهذا العميل: التسعير، الاكتتاب، التجديدات.",
    activityTitle: "النشاط",
    activityCaption: "من تعامل مع هذا السجل، الأحدث أولًا.",
    colRef: "المرجع",
    colKind: "الصنف",
    colProductLine: "خط المنتج",
    colPriority: "الأولوية",
    colSla: "موعد اتفاقية الخدمة",
    colCaseValue: "القيمة",
    positionHintLedger: "محسوب على الخادم من كل الوثائق والمطالبات المسجّلة.",
```

3d. Loader — extend `empty`:

```ts
  const empty = {
    customer: null as Customer | null,
    policies: [] as PolicyRow[],
    claims: [] as ClaimRow[],
    cases: [] as CaseSummaryRow[],
    activity: [] as AuditRow[],
    position: null as PositionResponse | null,
    conversations: [] as ConversationRow[],
    quotes: [] as QuoteRequestRow[],
    consents: [] as ConsentRow[],
    documents: [] as FileRow[],
    offers: [] as OfferRow[],
    may,
    idempotencyKey: crypto.randomUUID()
  };
```

3e. Loader fan-out — replace the destructure + `Promise.all` array with (three additions, existing entries untouched):

```ts
  const scope = `?customerId=${encodeURIComponent(id)}&limit=50`;
  const [customer, policies, claims, cases, activity, position, conversations, quotes, consents, documents, offers] =
    await Promise.all([
      safe(() => api<Customer>(`/v1/core/customers/${id}`, options), null),
      held.has(PERM.policies)
        ? safe(() => api<Page<PolicyRow>>(`/v1/axis/policies${scope}`, options), null)
        : null,
      held.has(PERM.claims)
        ? safe(() => api<Page<ClaimRow>>(`/v1/axis/claims${scope}`, options), null)
        : null,
      held.has(PERM.cases)
        ? safe(() => api<Page<CaseSummaryRow>>(`/v1/axis/cases${scope}`, options), null)
        : null,
      // Generated CRUD audits with the row's own id as subjectRef (crud.ts),
      // and core_audit_log has no createdAt — order on ts explicitly.
      held.has(PERM.audit)
        ? safe(
            () =>
              api<Page<AuditRow>>(
                `/v1/core/audit-log?subjectRef=${encodeURIComponent(id)}&limit=20&sort=ts&order=desc`,
                options
              ),
            null
          )
        : null,
      safe(() => api<PositionResponse>(`/v1/core/customers/${id}/position`, options), null),
      held.has(PERM.conversations)
        ? safe(() => api<Page<ConversationRow>>(`/v1/orbit/conversations${scope}`, options), null)
        : null,
      held.has(PERM.quotes)
        ? safe(() => api<Page<QuoteRequestRow>>(`/v1/dist/quote-requests${scope}`, options), null)
        : null,
      held.has(PERM.consents)
        ? safe(() => api<Page<ConsentRow>>(`/v1/core/consents${scope}`, options), null)
        : null,
      // Files hang off a subject reference rather than a column (core_files).
      held.has(PERM.files)
        ? safe(
            () =>
              api<Page<FileRow>>(
                `/v1/core/files?subjectRef=${encodeURIComponent(`customer:${id}`)}&limit=50`,
                options
              ),
            null
          )
        : null,
      held.has(PERM.offers)
        ? safe(() => api<Page<OfferRow>>(`/v1/dist/next-best-offers${scope}`, options), null)
        : null
    ]);

  return {
    ...empty,
    customer,
    policies: rowsOf(policies),
    claims: rowsOf(claims),
    cases: rowsOf(cases),
    activity: rowsOf(activity),
    position,
    conversations: rowsOf(conversations),
    quotes: rowsOf(quotes),
    consents: rowsOf(consents),
    documents: rowsOf(documents),
    offers: rowsOf(offers)
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lyra/web test -- customer-360`
Expected: PASS — chips tests, PERM tests, and the labels-parity test (which now also covers the 11 new keys in both languages).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/routes/customer-360.tsx apps/web/app/routes/customer-360.test.ts
git commit -m "feat(web): customer 360 loader gains cases, activity and server position

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Web UI — panels, chips, links, sparkline, confidence meter, position card

**Files:**
- Modify: `apps/web/app/routes/customer-360.tsx` (component + `Panel` + `OfferCard`)

**Interfaces:**
- Consumes: Task 3's `chips`, `CaseSummaryRow`, `AuditRow`, `PositionResponse`, `loaded.cases`, `loaded.activity`, `loaded.position`, new label keys; `Timeline`, `Sparkline`, `ConfidenceMeter` from `@lyra/ui` (`TimelineProps: { events, label }`; `SparklineProps: { values, label }`; `ConfidenceMeterProps: { value: 0–1, label }`); shared labels `open`, `none`, `status.*`, `priority.*` from `detail-kit`'s SHARED table.
- Produces: final screen. No new exports.

- [ ] **Step 1: Extend imports**

Change the `@lyra/ui` import block to:

```ts
import {
  AGENT_MARK,
  AgentBadge,
  Badge,
  Button,
  Card,
  ConfidenceMeter,
  DateTime,
  EmptyState,
  Money,
  Sparkline,
  Stat,
  Table,
  Timeline,
  type Column
} from "@lyra/ui";
```

- [ ] **Step 2: `Panel` gains `href` + `open`**

Replace the `Panel` function with:

```tsx
function Panel({
  title,
  href,
  open,
  children
}: {
  title: string;
  /** List route for "see all"; rendered in the Card's actions slot. */
  href?: string;
  /** The shared `open` label — Panel sits outside the component, so it is passed in. */
  open?: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      title={title}
      padded={false}
      actions={
        href && open ? (
          <Link to={href} className="font-ui text-12 text-accent underline-offset-2 hover:underline">
            {open}
          </Link>
        ) : undefined
      }
    >
      {children}
    </Card>
  );
}
```

- [ ] **Step 3: Chips replace JSON.stringify**

Inside `Customer360`, after `const l = labelsIn(...)` add:

```tsx
  const chipList = (values: string[], tone?: "danger") =>
    values.length === 0 ? (
      <span>—</span>
    ) : (
      <span className="flex flex-wrap gap-1">
        {values.map((value) => (
          <Badge key={value} size="sm" {...(tone ? { tone } : {})}>
            {value}
          </Badge>
        ))}
      </span>
    );
```

Replace the tags/riskFlags entries in the profile card:

```tsx
          <Entry term={l("tags")}>{chipList(chips(customer.tagsJson))}</Entry>
          <Entry term={l("riskFlags")}>{chipList(chips(customer.riskFlagsJson), "danger")}</Entry>
```

Replace the consent `purposesJson` column render:

```tsx
    {
      key: "purposesJson",
      header: l("colPurposes"),
      render: (row) => chipList(chips(row.purposesJson))
    },
```

- [ ] **Step 4: Cases panel**

After `claimColumns`, add:

```tsx
  const caseColumns: Array<Column<CaseSummaryRow>> = [
    {
      key: "ref",
      header: l("colRef"),
      render: (row) => (
        <Link to={`/axis/cases/${row.id}/detail`} className="font-mono text-12 text-accent hover:underline">
          {row.ref}
        </Link>
      )
    },
    { key: "status", header: l("colStatus"), render: (row) => <Badge size="sm">{tag(l, "status", row.status)}</Badge> },
    { key: "kind", header: l("colKind"), render: (row) => <span className="font-ui text-12">{tag(l, "kind", row.kind)}</span> },
    {
      key: "productLine",
      header: l("colProductLine"),
      render: (row) => <span className="font-ui text-12">{row.productLine ?? "—"}</span>
    },
    { key: "priority", header: l("colPriority"), render: (row) => <Badge size="sm">{tag(l, "priority", row.priority)}</Badge> },
    {
      key: "slaDueAt",
      header: l("colSla"),
      render: (row) => (row.slaDueAt ? <DateTime value={row.slaDueAt} locale={locale} precision="day" /> : <span>—</span>)
    },
    {
      key: "valueMinor",
      header: l("colCaseValue"),
      numeric: true,
      render: (row) =>
        row.valueMinor != null ? (
          <Money amountMinor={row.valueMinor} currency={row.currency ?? "AED"} locale={locale} />
        ) : (
          <span>—</span>
        )
    }
  ];
```

In the JSX, after the claims `</Panel>` add:

```tsx
      <Panel title={l("casesTitle")} href="/axis/cases" open={l("open")}>
        <Table
          caption={l("casesCaption")}
          columns={caseColumns}
          rows={loaded.cases}
          rowKey={(row) => row.id}
          empty={<EmptyState title={l("none")} />}
        />
      </Panel>
```

- [ ] **Step 5: Open-in-module links on existing panels**

Update the opening tags of the four existing panels (children unchanged):

```tsx
      <Panel title={l("policies")} href="/axis/policies" open={l("open")}>
```

```tsx
      <Panel title={l("claims")} href="/axis/claims" open={l("open")}>
```

```tsx
      <Panel title={l("conversationsTitle")} href="/orbit/conversations" open={l("open")}>
```

```tsx
      <Panel title={l("quotesTitle")} href="/distribution/quote-requests" open={l("open")}>
```

(Consents and documents keep no href — no standalone list route registered for them under a module path; verified against `apps/web/app/routes.ts`.)

- [ ] **Step 6: Activity timeline**

After the cases `</Panel>` in the JSX (hidden when empty or unpermitted, like offers):

```tsx
      {loaded.activity.length > 0 ? (
        <Card title={l("activityTitle")}>
          <Timeline
            label={l("activityCaption")}
            events={loaded.activity.map((row) => ({
              id: row.id,
              title: row.action,
              at: row.ts,
              actor: row.actorRef
            }))}
          />
        </Card>
      ) : null}
```

- [ ] **Step 7: CSAT sparkline**

Before `return (`, add:

```tsx
  const csatPoints = [...loaded.conversations]
    .filter((row) => typeof row.csat === "number")
    .sort((a, b) => (a.lastMessageAt ?? 0) - (b.lastMessageAt ?? 0))
    .map((row) => row.csat as number);
```

Inside the conversations Panel, before `<Table`:

```tsx
        {csatPoints.length >= 2 ? (
          <div className="p-4">
            <Sparkline values={csatPoints} label={l("colCsat")} />
          </div>
        ) : null}
```

- [ ] **Step 8: Offer confidence meter**

In `OfferCard`, replace:

```tsx
        <Stat label={l("colScore")} value={<span className="tabular-nums">{offer.score}</span>} />
```

with:

```tsx
        <ConfidenceMeter value={offer.score / 100} label={l("colScore")} />
```

- [ ] **Step 9: Position card from the server aggregate**

Replace the whole Position `<Card title={l("positionTitle")}>...</Card>` block with:

```tsx
      <Card title={l("positionTitle")}>
        {loaded.position && loaded.position.positions.length > 0 ? (
          <>
            <div className="flex flex-col gap-4">
              {loaded.position.positions.map((line) => (
                <div key={line.currency} className="grid grid-cols-2 gap-6 md:grid-cols-3">
                  <Stat
                    label={l("premiumWritten")}
                    value={
                      line.premiumMinor === null ? (
                        <span>—</span>
                      ) : (
                        <Money amountMinor={line.premiumMinor} currency={line.currency} locale={locale} />
                      )
                    }
                  />
                  <Stat
                    label={l("commissionEarned")}
                    value={
                      line.commissionMinor === null ? (
                        <span>—</span>
                      ) : (
                        <Money amountMinor={line.commissionMinor} currency={line.currency} locale={locale} />
                      )
                    }
                  />
                  <Stat
                    label={l("claimsSettled")}
                    value={
                      line.settledMinor === null ? (
                        <span>—</span>
                      ) : (
                        <Money amountMinor={line.settledMinor} currency={line.currency} locale={locale} />
                      )
                    }
                  />
                </div>
              ))}
              <Stat
                label={l("lifetimeValue")}
                value={
                  <Money amountMinor={loaded.position.ltvMinor} currency={loaded.position.currency} locale={locale} />
                }
              />
            </div>
            <p className="mt-3 font-ui text-11 text-subtle">{l("positionHintLedger")}</p>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
              <Stat label={l("premiumWritten")} value={<Money amountMinor={premium} currency={currency} locale={locale} />} />
              <Stat
                label={l("commissionEarned")}
                value={<Money amountMinor={commission} currency={currency} locale={locale} />}
              />
              <Stat label={l("claimsSettled")} value={<Money amountMinor={settled} currency={currency} locale={locale} />} />
              <Stat
                label={l("lifetimeValue")}
                value={<Money amountMinor={customer.ltvCached ?? 0} currency={currency} locale={locale} />}
              />
            </div>
            <p className="mt-3 font-ui text-11 text-subtle">{l("positionHint")}</p>
          </>
        )}
      </Card>
```

(The `currency`/`premium`/`commission`/`settled` derivations above the JSX stay — they are the documented fallback when the endpoint 403/404s.)

- [ ] **Step 10: Verify**

Run: `pnpm --filter @lyra/web test -- customer-360 && pnpm --filter @lyra/web typecheck && pnpm --filter @lyra/web lint`
Expected: PASS. If `tone="danger"` is not a member of `BadgeTone`, check `packages/ui/src/primitives.tsx` for the exact danger-toned member name and use that instead.

- [ ] **Step 11: Commit**

```bash
git add apps/web/app/routes/customer-360.tsx
git commit -m "feat(web): customer 360 cases panel, activity timeline, chips, links, sparkline, confidence meter, server position

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Full-suite gate

**Files:** none new.

- [ ] **Step 1: Run everything**

Run: `pnpm --filter @lyra/api test && pnpm --filter @lyra/web test && pnpm --filter @lyra/sdk test && pnpm typecheck`
Expected: PASS across the board.

- [ ] **Step 2: Commit any stragglers**

Only if a fix was needed in Step 1; otherwise nothing to commit.
