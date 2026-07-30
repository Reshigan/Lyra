# ADR-0003 — Flat `/{module}/{resource}/{id}` URLs, no `/m/` prefix

- Status: accepted
- Date: 2026-07-30
- Context: docs/07 §3 (URL scheme), CLAUDE.md (simplest option consistent with docs/02)

## Context

docs/07-ui-design-system.md:42 specifies the URL scheme as
`/m/{module}/{area}/{id}`.

What shipped is flat. `apps/web/app/routes.ts:24-26` declares:

```
route(":module", "routes/module.tsx"),
route(":module/:resource", "routes/module.tsx", { id: "module-resource" }),
route(":module/:resource/:id", "routes/record.tsx")
```

No `/m/` segment exists anywhere in `apps/web` — a repo-wide search for the
literal returns only docs/07 itself. The spec's `{area}` is named `:resource` in
the code, which is a rename, not a structural difference.

The `/m/` prefix exists in specs of this shape to reserve the root namespace, so
that `/settings`, `/login` or a future marketing path can never collide with a
module named `settings`. LYRA does not need the reservation, because the module
list is closed and enumerated: `WORKSPACE_PATHS`
(`apps/web/app/routing.ts:7-19`) is the authority on which top-level segments
exist, and `isRouted()` (`apps/web/app/routing.ts:72-74`) is the only thing that
turns a nav item into a link. A module cannot appear at the root without being
added to that array first, which is a reviewed edit with a test behind it
(`apps/web/app/shell.test.ts:22-30`).

Against that, the prefix costs three characters on every URL a user reads,
types, bookmarks or pastes into a ticket, and adds a segment that carries no
information.

Collision safety is not left to convention. Every screen that is genuinely its
own thing gets a static path declared *above* the dynamic routes
(`apps/web/app/routes.ts:15-22`: `settings`, `approvals`, `admin/ai/console`,
`ledger/reports/:report`, `analytics/report/:id`, `analytics/dashboard/:id`,
`distribution/quote-requests/:id/compare`, `orbit/conversations/:id/thread`).
React Router ranks a static segment above a dynamic `:param` at the same depth,
so these win the match against `:module` without ordering ceremony. That ranking
rule is what makes the flat scheme safe; see ADR-0004 for the router version
this depends on.

## Decision

URLs are flat: `/{module}`, `/{module}/{resource}`, `/{module}/{resource}/{id}`.
No `/m/` prefix. Screens that are not a list or a record get a static path
declared before the dynamic trio in `apps/web/app/routes.ts`.

docs/07 §3 is wrong on this point and should be amended to the flat form. That
edit is not made here.

## Consequences

- The root namespace is genuinely shared between modules and one-off screens. A
  future module named `settings` or `approvals` is impossible without renaming an
  existing screen. This is a real constraint, not a theoretical one: `admin` is
  simultaneously a workspace (`apps/web/app/routing.ts:17`) and the parent of a
  static path (`admin/ai/console`, `apps/web/app/routes.ts:17`).
- The static-over-dynamic ranking is now load-bearing and invisible. Nothing in
  `apps/web/app/routes.ts` fails loudly if a router upgrade changes ranking
  semantics; the symptom would be `routes/module.tsx` rendering where
  `routes/approvals.tsx` should. There is no test asserting that
  `/approvals` resolves to the approvals route rather than the generic module
  route. Adding one is cheap and is the obvious follow-up.
- Every static path added later is a new reserved word at the root. The list in
  `HIDDEN_ROUTES` (`apps/web/app/routing.ts:27-41`) documents each one and why
  it is not in the nav, which is the closest thing to a registry that exists.
- Migration cost, if `/m/` is ever wanted: mechanically small, operationally
  awkward. The route table is 3 lines plus 8 static routes
  (`apps/web/app/routes.ts:15-26`); `WORKSPACE_PATHS` and `HIDDEN_ROUTES`
  (`apps/web/app/routing.ts:7-41`) would need the prefix; `landingFor()` builds
  paths by string concatenation (`apps/web/app/routing.ts:64`) and would need
  one edit; `labelKeyFor()` strips a single leading slash
  (`apps/web/app/routing.ts:78`) and would need to strip two segments. The
  expensive part is not the code — it is that every bookmark, every link pasted
  into an audit record, and every deep link in an email notification breaks
  unless a permanent redirect layer is added and kept forever. That redirect
  layer is the actual cost of the migration.
- Mobile parity: `apps/mobile` does not consume web URLs, so this decision does
  not bind it. If deep links are added later they must be built against this
  scheme.
