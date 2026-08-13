# ADR-0059 — The companion rail is opt-in, lazy and permission-scoped

Status: accepted · 2026-08-13

## Context

The Horizon comp (docs/superpowers/specs/2026-08-06-horizon-frontend-design.md
§4) puts a companion toggle in the header's right cluster and a collapsible
rail on the right of the workspace, footed by the autonomy envelope. The
product had neither: agent activity was only visible by navigating to
`/admin/ai/console`.

The rail reads two lists that already exist — `/v1/ai/runs` and `/v1/ai/agents`
— but both are behind the session cookie, which is server-only. It also shows
what an actor is not always entitled to see: `ai:runs:read` is granted to
`platform.support`, `tenant.compliance` and the two admin wildcards, not to
every role that has a workspace.

## Decision

A resource route (`app/routes/companion.ts`) fetches the newest eight runs and
the agent roster; the component (`app/components/companion.tsx`) renders them
in an `<aside>` with an envelope footer, and links to the AI console rather
than carrying pause or autonomy controls of its own.

Three things diverge from the comp:

1. **It opens closed.** The header toggle holds the state; the rail is not
   part of the first paint.
2. **It fetches on first open.** `<Companion>` mounts only when open, so the
   `useFetcher().load("/companion")` effect *is* the first-open fetch. A rail
   nobody opens costs zero requests. Re-opening reloads, which is right for a
   live activity list.
3. **It is absent, not disabled, without `ai:runs:read`.** No toggle renders at
   all — the same rule `PostureChips` already follows.

The envelope's ceiling is the freest rung any *active* agent sits on; paused
agents are counted separately and excluded from the ceiling. An autonomy level
the ladder does not recognise reads as `suggest`, the most cautious rung.

## Alternatives rejected

**Render the rail open by default.** It is the widest piece of chrome in the
shell and it is not the work. Opening it is a deliberate act, like opening the
console.

**Fetch in the workspace loader.** Every screen would then pay for two extra
API calls whether or not anyone looks at the rail.

**Import the autonomy ladder from `routes/ai-console.tsx`.** It exports
`autonomyRung()`, but importing from a route module pulls an entire route into
the shell bundle. The four-element ladder is duplicated locally instead, with
the same unknown-reads-as-cautious doctrine.

**Show a disabled toggle to actors without the permission.** Disabled chrome
advertises a capability the actor will never have; absence says nothing and is
honest.

## Consequences

- `/companion` has no UI, so it is registered in `HIDDEN_ROUTES`
  (`app/routing.ts`) — `app/shell.test.ts` requires every route to have either
  a nav label or a documented reason to be hidden.
- `<Shell>` gained a `permissions` prop, threaded from the workspace loader.
  `/v1/me` already expands wildcards, so `permissions.includes(...)` is safe.
- `envelopeOf` is pure and unit-tested (`app/components/companion.test.ts`);
  the rail itself is presentational.
- The rail shows no timestamps — the list is newest-first, and a rendered date
  would have meant plumbing the locale into shell chrome for no added meaning.
