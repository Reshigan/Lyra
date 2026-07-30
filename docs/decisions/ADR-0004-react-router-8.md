# ADR-0004 — React Router 8, not 7

- Status: accepted
- Date: 2026-07-30
- Context: CLAUDE.md "Repository layout" (`/apps/web` — React Router v7),
  CLAUDE.md guardrail "prefer boring technology; novelty needs an ADR"

## Context

CLAUDE.md:12 describes `apps/web` as "React Router v7 (framework mode) on
Cloudflare Workers". Two other documents repeat it: README.md:44 and
docs/IMPLEMENTATION.md:90, :769-771.

The repo runs React Router 8. `apps/web/package.json:19` pins
`"react-router": "^8.3.0"` and `apps/web/package.json:24` pins
`"@react-router/dev": "^8.3.0"`.

The repository has a single commit (`Initial commit`), so there is no history
recording when or why the bump happened, and this ADR does not invent one. What
is verifiable is the toolchain the app is built against — Vite 7
(`apps/web/package.json:31`), `@cloudflare/vite-plugin` ^1.48
(`apps/web/package.json:22`), Wrangler ^4.115
(`apps/web/package.json:33`), React 19 (`apps/web/package.json:17-18`) — and
that the application code is written against RR8 APIs that do not exist in v7.
Reverting to v7 is therefore not a version-range edit; it is a rewrite of the
server entry and of every loader and action in the app.

## Decision

`apps/web` targets React Router 8 (framework mode). CLAUDE.md:12, README.md:44
and docs/IMPLEMENTATION.md:90/:769-771 are stale and should be corrected to say
8. Those edits are not made here.

Three RR8 API changes are now load-bearing:

**1. Typed contexts replace an augmented `AppLoadContext`.** RR8 removed the
single module-augmented load-context object. The Cloudflare binding is declared
once with `createContext` (`apps/web/app/context.ts:1`, `:14`):

```ts
export const cloudflare = createContext<{ env: Env; ctx: ExecutionCtx }>();
```

It is populated in the Worker entry by constructing a `RouterContextProvider`
per request and setting the key on it (`apps/web/workers/app.ts:18-20`), and
read in every loader and action as `context.get(cloudflare).env` — for example
`apps/web/app/routes/workspace.tsx:22`, `apps/web/app/routes/home.tsx:249` and
`:390`, `apps/web/app/routes/analytics-dashboard.tsx:138`.

**2. `MetaArgs.data` is now `loaderData`.** Both meta functions in the app
destructure the new name: `apps/web/app/routes/workspace.tsx:58` and
`apps/web/app/routes/login.tsx:120`, each written
`({ loaderData: loaded }) => [...]`.

**3. Route matching ranks static segments above dynamic `:param`s.** The flat
URL scheme (ADR-0003) depends on this: eight static routes are declared above
the dynamic `:module` trio in `apps/web/app/routes.ts:15-26`, and the comment at
`apps/web/app/routes.ts:6-8` states the dependency outright. Honest caveat: this
ranking is not new in RR8 — React Router has ranked static above dynamic since
v6. It is listed here because the codebase now *relies* on it without a test,
not because RR8 introduced it.

## Consequences

- CLAUDE.md, README.md and docs/IMPLEMENTATION.md currently state a version the
  repo does not run. Anyone following the spec literally — including a future
  agent instructed that "the spec wins" — will try to write v7 code against an
  RR8 app. This is the single most expensive consequence of the drift and is the
  reason this ADR exists.
- Downgrading is now a rewrite, not a pin change: `apps/web/workers/app.ts`,
  `apps/web/app/context.ts`, both `meta` exports and every loader/action that
  reads `env` would all change.
- RR8 is newer than the "boring technology" default CLAUDE.md asks for. The
  offsetting argument is that the Cloudflare Workers integration
  (`@cloudflare/vite-plugin` + Vite 7 + React 19) is the path Cloudflare
  documents, and pinning the router back while holding the rest of the toolchain
  forward is the less boring position, not the more boring one.
- The `ExecutionCtx` interface is hand-declared in `apps/web/app/context.ts:4-7`
  rather than imported from `@cloudflare/workers-types`. It will silently drift
  from workerd's real `ExecutionContext` if that grows a member the app starts
  using.
- No test asserts the static-over-dynamic ranking. A future router upgrade that
  changed ranking would break `/approvals`, `/settings` and six other screens by
  routing them into the generic module screen, and the failure would surface as a
  wrong render rather than an error.
