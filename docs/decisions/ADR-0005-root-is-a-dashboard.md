# ADR-0005 — `/` is a dashboard, not a redirect into a module

- Status: accepted
- Date: 2026-07-30
- Context: docs/07 §3 (home per role), docs/06 (roles and journeys)

## Context

docs/07-ui-design-system.md:39-41 says: "Home per role = their primary workspace
(docs/06): exec lands on NORTH Today; ops on Production Board; agent on Console.
Role-based routing map in apps/web/app/routing.ts."

That routing map was built. `landingFor(roles, nav)`
(`apps/web/app/routing.ts:60-70`) resolves a role list to a landing path, with a
prefix table for the non-module roles (`apps/web/app/routing.ts:49-54`) and a
fail-safe that never sends an actor to a path their nav does not offer.

It is not wired to `/`. `apps/web/app/routes.ts:13` declares
`index("routes/home.tsx")` — a real screen — and the workspace loader records
the change in place (`apps/web/app/routes/workspace.tsx:38-40`):

> "`/` used to redirect to the actor's primary workspace. It is now a real
> screen (routes/home.tsx): what is waiting on me, how the business is doing,
> where I go next — which beats being teleported into a list."

The argument for the dashboard is that a redirect answers a question nobody
asked. Landing an actor in `/axis` shows them one module's list; it does not
show them the approvals blocking other people, the notifications they have not
read, or what the agents did overnight. `routes/home.tsx` answers three
questions in one paint, and every panel on it is gated on a permission the actor
actually holds (`apps/web/app/routes/home.tsx:259-275`), so a role with fewer
permissions gets fewer panels rather than a wall of denials — a denied panel
renders nothing at all (`apps/web/app/routes/home.tsx:781`).

It also removes a failure mode the redirect had: a landing redirect can only
ever be as correct as the role→path table, and a stale table lands someone on a
403. The dashboard cannot land anyone anywhere.

## Decision

`/` renders `routes/home.tsx` for every signed-in actor. There is no role-based
landing redirect.

The dashboard composes: KPI wall (approvals waiting, unread, 30-day revenue and
delivered volume), the decisions waiting on this actor with inline
approve/reject, unread notifications, this actor's own recent audit trail,
recent agent runs, delivery by area, and a link grid of the workspaces their nav
offers (`apps/web/app/routes/home.tsx:463-751`). Six API endpoints feed it, all
listed at `apps/web/app/routes/home.tsx:35-41`.

An actor with nothing waiting and nothing readable gets an `EmptyState` with a
door into their first workspace, not a blank page
(`apps/web/app/routes/home.tsx:456-461`, `:733-750`).

docs/07 §3's "home per role = their primary workspace" no longer describes the
product and should be amended. That edit is not made here.

## Consequences

- **`landingFor()` is dead production code.** It is referenced only by
  `apps/web/app/shell.test.ts:7` and its five assertions at `:36-42`. Nothing in
  `apps/web/app/routes/` imports it. The tests pass, so the dead code is
  invisible to CI — the suite is asserting the behaviour of a function the
  product does not call. Either delete it, or wire it to a "take me to my
  workspace" affordance; leaving it as-is means the next reader believes
  role-based landing works.
- Two extra round trips on the most-visited route. `routes/workspace.tsx:25`
  fetches `/v1/me` for the shell, and `routes/home.tsx:253` fetches it *again*
  because a sibling loader's value is not readable — the comment at
  `apps/web/app/routes/home.tsx:250-252` names this explicitly. On top of that,
  four further API calls fan out in parallel
  (`apps/web/app/routes/home.tsx:259-275`). The old redirect cost one call and a
  302.
- The dashboard is the widest permission surface in the app: it touches
  `/v1/me/inbox`, `/v1/analytics/unit-economics`, `/v1/core/audit-log` and
  `/v1/ai/runs`. Every one of those endpoints' authorization rules now shows up
  on the home screen, so a regression in any of them is a regression on the
  first screen every user sees.
- Roles whose real work is one screen (`north.board`, read-only board pack
  readers — `packages/core/src/rbac.ts:403-406`) now take one extra click to
  reach it. They hold `analytics:dashboards:read` but not
  `analytics:reports:read`, `core:audit:read` or `ai:runs:read`, so three of the
  four panels render nothing for them and their dashboard is close to bare.
- The revenue KPI sums only the tenant's first-reported currency and silently
  drops rows in other currencies (`apps/web/app/routes/home.tsx:330-338`). That
  is a deliberate refusal to add unlike amounts, but it means a multi-currency
  tenant sees a total that is smaller than their business. Nothing on the screen
  says so.
