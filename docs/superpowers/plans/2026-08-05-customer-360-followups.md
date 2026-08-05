# Customer 360 Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the six follow-up findings from the customer-360 depth final review: Timeline locale support, readable audit titles, accessible open-links, ConfidenceMeter width, loader URL pin test, and the missing claims customer index.

**Architecture:** Four small independent changes — one in `@lyra/ui` (Timeline gains `locale`), one polish pass in the web route, one new loader test, one Drizzle index + generated migration — followed by a full-suite gate. No API changes, no new components, no new label keys.

**Tech Stack:** React 19, React Router v7, Vitest, Drizzle (SQLite dialect), pnpm + turbo.

## Global Constraints

- All user-facing strings via LABELS/i18n keys, en + ar parity (this plan adds **no** new label keys — verify none sneak in).
- Logical CSS properties only (`ps-*`, `insetInlineStart`, never `left`/`margin-left`).
- No hard-coded brand strings.
- Migrations forward-only; generate via `pnpm db:generate`, never hand-edit an applied migration.
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Repo precedent: commit directly on `main` (linear, always-HEAD-deploy).
- Neither `packages/ui` nor `apps/web` has render-test infrastructure (ui tests are source scans; web tests exercise exported functions). JSX-only changes carry no new tests; exported-function changes do.

---

### Task 1: Timeline locale prop in @lyra/ui

**Files:**
- Modify: `packages/ui/src/data.tsx` (TimelineProps ~line 450, Timeline ~line 457)

**Interfaces:**
- Produces: `TimelineProps.locale?: string`, forwarded to the internal `DateTime` (which already accepts `locale` and defaults to `"en"` in `packages/ui/src/format.tsx`).

- [ ] **Step 1: Add the prop and forward it**

In `packages/ui/src/data.tsx`, change:

```tsx
export interface TimelineProps {
  events: TimelineEvent[];
  label: string;
  timeZone?: string;
  className?: string;
}

export function Timeline({ events, label, timeZone, className }: TimelineProps) {
```

to:

```tsx
export interface TimelineProps {
  events: TimelineEvent[];
  label: string;
  locale?: string;
  timeZone?: string;
  className?: string;
}

export function Timeline({ events, label, locale, timeZone, className }: TimelineProps) {
```

and change the `DateTime` call inside the event map from:

```tsx
<DateTime value={e.at} precision="minute" {...(timeZone ? { timeZone } : {})} />
```

to:

```tsx
<DateTime value={e.at} precision="minute" {...(locale ? { locale } : {})} {...(timeZone ? { timeZone } : {})} />
```

(The conditional-spread idiom matches the existing `timeZone` handling and survives `exactOptionalPropertyTypes`.)

- [ ] **Step 2: Verify**

Run: `pnpm --filter @lyra/ui test && pnpm --filter @lyra/ui typecheck`
Expected: PASS (source-scan tests unaffected; no render infra, so no new test — the prop is exercised by Task 2's caller and the web suite).

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/data.tsx
git commit -m "feat(ui): Timeline forwards locale to DateTime"
```

---

### Task 2: Web polish — locale, readable audit titles, link a11y, meter width

**Files:**
- Modify: `apps/web/app/routes/customer-360.tsx` (Timeline usage ~line 835, Panel ~line 896, ConfidenceMeter ~line 951, imports ~top)

**Interfaces:**
- Consumes: Task 1's `TimelineProps.locale`; `humanise` from `apps/web/app/modules/spec.ts` (`humanise("pending_settlement") → "Pending settlement"`; dots are NOT split, hence the `replaceAll` below).

- [ ] **Step 1: Import humanise**

Add to the imports in `apps/web/app/routes/customer-360.tsx`:

```tsx
import { humanise } from "../modules/spec";
```

- [ ] **Step 2: Timeline gets locale + readable titles**

Change the Activity block (~line 835) from:

```tsx
          <Timeline
            label={l("activityCaption")}
            events={loaded.activity.map((row) => ({
              id: row.id,
              title: row.action,
              at: row.ts,
              actor: row.actorRef
            }))}
          />
```

to:

```tsx
          <Timeline
            label={l("activityCaption")}
            locale={locale}
            events={loaded.activity.map((row) => ({
              id: row.id,
              // ponytail: audit actions are an open set of `module.resource.verb`
              // codes — humanise beats a label table nobody maintains; add
              // `action.*` keys per-code if a translated verb ever matters.
              title: humanise(row.action.replaceAll(".", " ")),
              at: row.ts,
              actor: row.actorRef
            }))}
          />
```

(`locale` is already in scope — the surrounding panels pass it to `Money`/`DateTime`.)

- [ ] **Step 3: Panel open-link gets a distinct accessible name**

In the local `Panel` component (~line 896), change:

```tsx
          <Link to={href} className="font-ui text-12 text-accent underline-offset-2 hover:underline">
            {open}
          </Link>
```

to:

```tsx
          <Link
            to={href}
            aria-label={`${open} · ${title}`}
            className="font-ui text-12 text-accent underline-offset-2 hover:underline"
          >
            {open}
          </Link>
```

(Five panels render the same visible "Open" label; WCAG 2.4.4 wants list-distinguishable names. Both label parts already exist in both languages.)

- [ ] **Step 4: Constrain the ConfidenceMeter**

Change (~line 951):

```tsx
        <ConfidenceMeter value={offer.score / 100} label={l("colScore")} />
```

to:

```tsx
        <ConfidenceMeter value={offer.score / 100} label={l("colScore")} className="w-32" />
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @lyra/web test -- customer-360 && pnpm --filter @lyra/web typecheck`
Expected: PASS (JSX-only; no exported-function behaviour changed, no new label keys).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/routes/customer-360.tsx
git commit -m "fix(web): customer 360 polish — timeline locale, readable audit titles, link a11y, meter width"
```

---

### Task 3: Loader URL pin test

**Files:**
- Modify: `apps/web/app/routes/customer-360.test.ts` (append a `describe("loader")`; extend imports)

**Interfaces:**
- Consumes: `loader` export from `./customer-360` (already exported); the file's existing `env` const and `as unknown as` casting convention.

**Why:** `safe()` only swallows 403/404 — a renamed query param would 400 and 500 the whole screen; nothing pins the request URLs today.

- [ ] **Step 1: Write the failing-by-construction test**

Extend the import at the top of `apps/web/app/routes/customer-360.test.ts`:

```ts
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { LABELS, PERM, action, chips, labelsIn, loader } from "./customer-360";
```

Append this describe block at the end of the file:

```ts
describe("loader", () => {
  it("pins every request URL, because safe() re-throws a 400 from a renamed param", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", (input: URL | string) => {
      const url = String(input);
      urls.push(url);
      const body = url.endsWith("/v1/me")
        ? { permissions: Object.values(PERM) }
        : url.includes("/position")
          ? { positions: [], ltvMinor: 0, currency: "AED" }
          : url.includes("/v1/core/customers/")
            ? { id: "cus_1" }
            : { rows: [] };
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
      );
    });

    await loader({
      request: new Request("https://web.test/admin/customers/cus_1/360"),
      context: { get: () => ({ env, ctx: null }) },
      params: { id: "cus_1" }
    } as unknown as LoaderFunctionArgs);

    const expected = [
      "https://api.test/v1/core/customers/cus_1",
      "https://api.test/v1/axis/policies?customerId=cus_1&limit=50",
      "https://api.test/v1/axis/claims?customerId=cus_1&limit=50",
      "https://api.test/v1/axis/cases?customerId=cus_1&limit=50",
      "https://api.test/v1/core/audit-log?subjectRef=cus_1&limit=20&sort=ts&order=desc",
      "https://api.test/v1/core/customers/cus_1/position",
      "https://api.test/v1/orbit/conversations?customerId=cus_1&limit=50",
      "https://api.test/v1/dist/quote-requests?customerId=cus_1&limit=50",
      "https://api.test/v1/core/consents?customerId=cus_1&limit=50",
      "https://api.test/v1/core/files?subjectRef=customer%3Acus_1&limit=50",
      "https://api.test/v1/dist/next-best-offers?customerId=cus_1&limit=50"
    ];
    for (const url of expected) expect(urls, url).toContain(url);
    expect(urls).toHaveLength(expected.length + 1); // + /v1/me — nothing extra, nothing doubled
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @lyra/web test -- customer-360`
Expected: PASS. If any URL assertion fails, the TEST's expected URL is wrong — read the loader (`apps/web/app/routes/customer-360.tsx:330-411`) and fix the test to pin what the loader actually sends; the loader itself was review-verified and must not change in this task.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/routes/customer-360.test.ts
git commit -m "test(web): pin customer 360 loader request URLs"
```

---

### Task 4: axis_claims customer index

**Files:**
- Modify: `packages/db/src/schema/axis.ts` (claims table indexes, ~line 247)
- Create (generated): `packages/db/migrations/00NN_*.sql` via drizzle-kit — never hand-written

**Why:** The position endpoint and the CRUD `?customerId=` filter scan the tenant's whole claims table; policies already have `axis_policies_customer_idx` on `(tenant_id, customer_id)`.

- [ ] **Step 1: Add the index**

In `packages/db/src/schema/axis.ts`, change the claims table's index list from:

```ts
  (t) => [
    index("axis_claims_tenant_idx").on(t.tenantId, t.status, t.reportedAt),
    uniqueIndex("axis_claims_no_uq").on(t.tenantId, t.claimNo)
  ]
```

to:

```ts
  (t) => [
    index("axis_claims_tenant_idx").on(t.tenantId, t.status, t.reportedAt),
    index("axis_claims_customer_idx").on(t.tenantId, t.customerId),
    uniqueIndex("axis_claims_no_uq").on(t.tenantId, t.claimNo)
  ]
```

(Mirrors `axis_policies_customer_idx` / `axis_cases_customer_idx` naming and column order exactly.)

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: one new file in `packages/db/migrations/` containing only `CREATE INDEX \`axis_claims_customer_idx\` ON \`axis_claims\` (\`tenant_id\`,\`customer_id\`);`. If the generated file contains anything else, STOP and report BLOCKED — do not commit a migration with surprise contents.

- [ ] **Step 3: Verify migrations still apply**

Run: `pnpm --filter @lyra/db test && pnpm --filter @lyra/api test -- customer-position`
Expected: PASS (the api harness runs all migrations against libsql :memory:, so a broken migration fails here).

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/axis.ts packages/db/migrations
git commit -m "perf(db): index axis_claims by (tenant_id, customer_id)"
```

---

### Task 5: Full-suite gate

**Files:** none new.

- [ ] **Step 1: Run everything**

Run: `pnpm test && pnpm typecheck`
Expected: PASS across the board.

- [ ] **Step 2: Commit any stragglers**

Only if a fix was needed in Step 1; otherwise nothing to commit.
