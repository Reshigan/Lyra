# Customer 360 — depth, features and UI

Date: 2026-08-05
Status: approved
Scope: `apps/web/app/routes/customer-360.tsx` (+ its test), one new API route in
`apps/api`, OpenAPI in `packages/sdk`. No schema changes, no new UI primitives —
Timeline, AuditTrail, Sparkline, ConfidenceMeter and Badge already exist in
`@lyra/ui`.

## Problem

The 360 screen omits data the platform already holds and renders some of what it
has poorly:

- In-flight cases (`axis_cases`, indexed by `tenant_id, customer_id`, CRUD-listed
  at `GET /v1/axis/cases`) never appear — quoting/underwriting work on a customer
  is invisible from their record.
- The audit trail (`core_audit_log`, exposed read-only at `GET /v1/core/audit-log`
  with a `subject_ref` column) never appears — no "who touched this record".
- Tags, risk flags and consent purposes render as `JSON.stringify` output.
- The Position card sums the first page (limit 50) of policies/claims client-side,
  so any customer past the page limit shows wrong money. Multi-currency customers
  are mis-summed into one currency.
- Offer propensity is a bare number; `ConfidenceMeter` exists for exactly this.

## Design

### 1. Cases panel

Loader fan-out gains, behind a new `PERM.cases = "axis:cases:read"` entry:

```
GET /v1/axis/cases?customerId={id}&limit=50
```

`CaseSummaryRow` interface: `id, ref, kind, productLine, status, priority,
slaDueAt, valueMinor, currency`. Panel columns: ref (link to
`/axis/cases/{id}/detail` per the registered case-detail route), status badge,
kind, product line, priority badge, SLA due (`DateTime` day precision), value
(`Money`). Same `Panel` + `Table` + `EmptyState` shape as every other panel; a
403 degrades to an absent panel via `safe()`.

### 2. Activity timeline

Behind new `PERM.audit = "core:audit:read"`:

```
GET /v1/core/audit-log?subjectRef=customer:{id}&limit=20&order=desc
```

(If the generic list does not honour `order`, take the default ordering and sort
descending by `ts` in the loader — the panel contract is "newest first, max 20".)

Rendered with `Timeline` from `@lyra/ui`: `title` = `action`, `actor` =
`actorRef`, `at` = `ts`. No detail node — hashes are not user-facing. Panel
hidden entirely (not empty-stated) when the permission is absent, like offers.

### 3. Chips, not JSON

A local `chips(value: unknown): string[]` helper: returns the array if the JSON
column is an array of strings, else `[]`. Used for:

- `tagsJson` → default `Badge size="sm"` per tag
- `riskFlagsJson` → `Badge size="sm" tone="danger"` per flag
- consent `purposesJson` → `Badge size="sm"` per purpose in the table cell

Empty arrays render "—". `JSON.stringify` leaves the file.

### 4. Open-in-module links

`Panel` gains optional `href`; when present the Card's `actions` slot renders a
`Link` labelled with the shared `open` label. Applied to: policies
(`/axis/policies`), claims (`/axis/claims`), cases (`/axis/cases`),
conversations (`/orbit/conversations`), quote requests
(`/distribution/quote-requests`) — whatever list paths `routes.ts` actually
registers; verify at implementation time and drop any link whose list route does
not exist.

### 5. CSAT sparkline

In the Conversations panel, when ≥2 rows carry a numeric `csat`: a `Sparkline`
of csat values ordered ascending by `lastMessageAt`, labelled with the existing
`colCsat` label. Screen-derived; no API change. Fewer than 2 points: no
sparkline.

### 6. Offer confidence meter

In `OfferCard`, replace the bare propensity `Stat` with
`ConfidenceMeter value={score / 100}` (score is 0–100 per
`dist_next_best_offers.score`), label = `colScore`. Default floor 0.7 stands.

### 7. Position endpoint

New hand-written route (core module router):

```
GET /v1/core/customers/:id/position
```

- Requires `core:customers:read`; 404 via the usual tenant-scoped `must`.
- Aggregates with SQL `SUM ... GROUP BY currency` — never a paged read:
  - `axis_policies` by `customer_id`: `premiumMinor`, `commissionMinor`
  - `axis_claims` by `customer_id`: `settledMinor`
- Cross-permission degradation mirrors the screen: policy sums included only if
  the actor also holds `axis:policies:read`, claim sums only with
  `axis:claims:read`; absent permission → those fields `null` (not 0).
- Response:

```json
{
  "positions": [
    { "currency": "AED", "premiumMinor": 120000, "commissionMinor": 9600, "settledMinor": 40000 }
  ],
  "ltvMinor": 250000,
  "currency": "AED"
}
```

`ltvMinor`/`currency` echo `ltv_cached` and the dominant (largest-premium)
currency, so the card needs no second read. Soft-deleted rows excluded the same
way the CRUD reader excludes them.

- OpenAPI: path + schema added in `packages/sdk`; contract test per DoD.
- Web: loader calls the endpoint through `safe()`; Position card renders one
  Stat row per currency (usually one). Null fields render "—" rather than a
  zero `Money`. Fallback when the endpoint 403/404s: the current client-side
  `sumBy` derivation stays as-is (the hint label already discloses it is
  screen-derived).

## Labels

Every new string lands in both `en` and `ar` in the route's `LABELS` table
(cases title/caption, activity title/caption, SLA column, product-line column,
value column reuse where shared keys exist). The existing labels test enforces
en/ar key parity and distinctness, so new keys fail the suite until both
languages exist.

## Testing (TDD order)

1. API: failing tests for `GET /v1/core/customers/:id/position` — happy path,
   currency grouping, permission-degraded nulls, cross-tenant 404, soft-delete
   exclusion. Then the route.
2. SDK: contract test for the new OpenAPI path.
3. Web route test additions: `PERM` uniqueness now covers `cases` + `audit`;
   labels parity picks up new keys automatically; `chips()` unit cases (array,
   non-array JSON, null). Action tests untouched — no new writes.
4. Existing suites stay green; no eval changes (no model behaviour touched).

## Out of scope

Ledger-backed LTV recomputation, audit-log pagination beyond 20, editing
tags/flags from this screen, mobile parity work beyond noting it in the PR.
