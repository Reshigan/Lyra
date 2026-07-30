# ADR-0006 — `actorColumns` stamps creation only, and never a later action

- Status: accepted
- Date: 2026-07-30
- Context: docs/12 §1 (audit), CLAUDE.md §15 (build to the seams),
  CLAUDE.md guardrail "do not weaken tenancy, audit, or approval flows"

## Context

`apps/api/src/crud.ts` generates CRUD for every registered resource — 120-odd
tables from one implementation (`apps/api/src/crud.ts:28-31`). Many of those
tables carry a column recording *who did this*: `createdBy`, `placedBy`,
`openedBy`, `requestedBy`, `setBy`, `scoredBy`.

If a client can put a value in that column, the column is worthless. A caller
who can type `placedBy` can attribute a legal hold to a colleague. The value has
to come from the authenticated session, not the body.

docs/12-security-compliance.md:24-25 states the platform's position on audit
data: "`core_audit_log` + `ai_audit_log` append-only; hash-chained daily anchors
stored to R2 EXPORTS for tamper evidence." Actor columns on business rows are
the same class of claim — a statement about who did something — and a
server-controlled value is the only kind worth chaining.

## Decision

`Resource.actorColumns` (`apps/api/src/crud.ts:74`) is a per-resource list of
columns the platform owns. The seam has exactly three behaviours:

**1. Refused from the client.** `actorColumns` are merged into the same `owned`
set as `id`, `tenantId`, `createdAt`, `updatedAt` and `deletedAt`
(`apps/api/src/crud.ts:36`, `:188-193`). `shapeOf()` skips owned keys when
building the zod shape (`apps/api/src/crud.ts:102`) and closes the object with
`.strict()` (`apps/api/src/crud.ts:120`). A client that sends `createdBy` gets a
400 from schema validation — not a silent drop, and not a silent overwrite. The
comment at `apps/api/src/crud.ts:189-191` states this is deliberate.

**2. Not required.** Because they are excluded from the shape entirely, a
`notNull` actor column with no default never becomes a required request field.
The OpenAPI generator applies the same exclusion so the published contract
matches (`apps/api/src/openapi.ts:273`, `:281`).

**3. Stamped on CREATE only.** `apps/api/src/crud.ts:306`:

```ts
...Object.fromEntries(actorColumns.map((k) => [k, actorRef(ctx)])),
```

That line sits inside the POST handler and has no counterpart in PATCH/PUT
(`apps/api/src/crud.ts:354-393`) or DELETE (`apps/api/src/crud.ts:404-425`).
`actorRef(ctx)` returns `` `${ctx.actor.kind}:${ctx.actor.id}` ``
(`packages/core/src/context.ts:76-78`), giving `user:us_…` or `agent:<key>`.

Misconfiguration fails at boot, not at runtime: a listed column that does not
exist on the table throws while the router is being built
(`apps/api/src/crud.ts:197`), and `apps/api/src/resources.test.ts:31` asserts the
same across the whole registry.

### Why "who did a *later* thing" columns are excluded — the load-bearing part

Several tables carry a second actor column that records a subsequent action.
These are **deliberately not** in any `actorColumns` list:

| Column | Table | What it records |
| --- | --- | --- |
| `approvedBy` | `packages/db/src/schema/analytics.ts:93` (exports), `packages/db/src/schema/compliance.ts:136` (DSAR), `packages/db/src/schema/north.ts:61`, `:116`, `packages/db/src/schema/ledger.ts:445`, `packages/db/src/schema/signal.ts:104` | who approved it, afterwards |
| `releasedBy` | `packages/db/src/schema/compliance.ts:117` (legal holds) | who released the hold, afterwards |
| `handledBy` | `packages/db/src/schema/compliance.ts:25` (DSAR requests) | who worked the request, afterwards |
| `pausedBy` | `packages/db/src/schema/ai.ts:23` (AI runs) | who paused the run, afterwards |
| `verifiedBy` | `packages/db/src/schema/axis.ts:75` (documents) | who verified the document, afterwards |

The rule is a factual one, not a stylistic one: **a create-time stamp on one of
these columns would be a false audit record.** `releasedBy` filled at creation
says a legal hold was released by the person who placed it, at the moment they
placed it. Nobody released anything. `approvedBy` filled at creation says the
requester approved their own request — which is exactly the dual-control
violation the approval machinery exists to prevent
(`apps/api/src/crud.ts:312-323` gates creation behind `gate()`), recorded in the
row as if it had passed.

The contrast is visible inside a single resource. `legal-holds`
(`apps/api/src/resources.ts:429-432`) declares `actorColumns: ["placedBy"]` and
leaves `releasedBy` alone; releasing is a `DELETE` behind the
`compliance.legal_hold_release` approval policy, and whoever completes it is a
different question with a different answer. Likewise `analytics/exports`
(`apps/api/src/resources.ts:460-463`) stamps `requestedBy` and leaves
`approvedBy` — required when `piiMasked = false`
(`packages/db/src/schema/analytics.ts:93`) — for the approval path to fill.

Columns for a *business assignment* ("assigned to") are also not actor columns.
The docstring at `apps/api/src/crud.ts:68-73` says so: an assignment is data a
client is entitled to set.

Filling a later-action column is therefore always the job of the hand-written
route that performs that action, alongside its own `audit()` row — never the
generic CRUD generator, which has no way to know that the action happened.

## Consequences

- Ten resources currently declare `actorColumns`
  (`apps/api/src/resources.ts:140`, `:175`, `:190`, `:215`, `:227`, `:237`,
  `:387`, `:430`, `:436`, `:438`, `:445`, `:459`, `:463`, `:465`). Every one
  stamps a creation-time column, and none stamps a later-action column. The
  consistency is currently maintained by review, not by a test.
- **There is no automated guard against the mistake this ADR exists to prevent.**
  `apps/api/src/resources.test.ts:31` only checks that a listed column exists on
  the table; nothing fails if someone adds `approvedBy` to an `actorColumns`
  list. A lint-style test asserting that no `actorColumns` entry matches a
  known later-action column name would close it, and would be a few lines.
- Later-action columns are `nullable` and stay null until a hand-written route
  fills them. Any route that performs an approval, release, pause or
  verification without writing its column leaves the row silently
  under-attributed. That is a per-route obligation with no central enforcement.
- Correcting a wrong actor value has no API path at all: the column is refused
  on create and never accepted on update. Repair requires a migration or direct
  data access. This is the intended trade — an editable actor column is not an
  actor column — but it means a genuine mis-attribution (an operator acting on a
  shared account, say) cannot be fixed through the product.
- A row created by an agent is stamped `agent:<key>`, so the same column mixes
  human and non-human actors. Any UI rendering it must handle both forms;
  nothing in the type system enforces that, since the column is plain `text`.
- `resolvedBy` does not exist anywhere in the schema and is therefore not part
  of this rule. `compliance_incidents` has `resolvedAt`
  (`packages/db/src/schema/compliance.ts:161`) but no matching actor column — so
  who resolved an incident is currently not recorded at all. That is a gap
  worth closing, and closing it means adding a later-action column, not an
  `actorColumns` entry.
