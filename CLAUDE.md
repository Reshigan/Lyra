# CLAUDE.md — Operating manual for Claude Code on LYRA

You are building LYRA, a multi-tenant AI platform. Read this file fully before
any work. Specs live in /docs; treat them as the source of truth. When a spec is
ambiguous, choose the simplest option consistent with docs/02-architecture.md and
record the decision in docs/decisions/ADR-NNNN.md (create the folder on first use).

## Repository layout (target)

```
/apps
  /web            # React Router v7 (framework mode) on Cloudflare Workers — all web UIs
  /mobile         # Expo (React Native) app
  /api            # Hono on Workers — API gateway + module routers
  /agents         # Durable Objects + Workflows: agent runtime, schedulers
/packages
  /core           # domain logic shared by modules (tenancy, RBAC, audit, events)
  /db             # Drizzle schema + migrations (SQLite dialect: D1 + libSQL)
  /model-gateway  # LLM/provider abstraction (Workers AI, Anthropic, vLLM/Ollama)
  /ui             # Constellation design system (React, Tailwind v4 tokens)
  /sdk            # typed client SDK (generated from OpenAPI) + webhooks helpers
  /config         # eslint, tsconfig, tailwind preset
/infra
  /cloudflare     # wrangler.jsonc per app, Terraform for accounts/zones (optional)
  /onprem         # docker-compose.yml, Dockerfiles, Caddyfile, model configs
/docs             # this pack
```

Package manager: **pnpm** (workspaces) + **turbo**. Node 22. TypeScript strict.

## Commands (keep these working at all times)

- `pnpm i` — install
- `pnpm dev` — turbo dev: web + api locally (wrangler dev with local D1/KV/R2)
- `pnpm test` — vitest unit + integration (uses miniflare/workers pool)
- `pnpm e2e` — Playwright against local stack
- `pnpm lint` / `pnpm typecheck`
- `pnpm db:generate` / `pnpm db:migrate` — Drizzle kit
- `pnpm deploy:staging` / `pnpm deploy:prod` — wrangler deploy (CI only for prod)
- `pnpm onprem:up` — docker compose -f infra/onprem/docker-compose.yml up

## Development method — TDD, non-negotiable

LYRA is built test-first. The order is law:

1. **Acceptance first.** At the start of every milestone, encode that
   milestone's acceptance criteria (module doc §8 + journey J-IDs) as
   *failing* executable tests — Playwright specs tagged `@journey:J-XX` and
   integration specs tagged `@accept:Mx`. This failing suite IS the milestone
   backlog. CI runs it with `--allow-fail=accept` until the milestone closes.
2. **Red → Green → Refactor** for every unit of behaviour. No production code
   without a failing test that demands it. Commits should show test-first
   history (test commit or same-commit test+impl; reviewers reject impl-only
   diffs on new behaviour).
3. **Outside-in double loop:** start from the failing journey/acceptance test,
   drop down into unit cycles (packages/core, db, gateway), surface back up.
4. **AI features are eval-first.** Before writing any prompt, agent, or model
   integration: author the golden set + thresholds in
   packages/model-gateway/evals. The eval is the failing test. Prompt/agent
   changes that don't move a measured eval are refactors and must not change
   eval outputs.
5. **Bugs reproduce before they die.** Every bugfix starts with a failing
   regression test named after the issue.
6. **Contracts are tests.** OpenAPI schemas, event envelopes, webhook payloads
   and the SDK are verified by contract tests (consumer-driven for partner
   surfaces); breaking a contract test means a version bump, never a silent
   change.
7. **Quality ratchets:** mutation testing (Stryker) on packages/core and
   model-gateway with score ≥ 70% and raise-only; coverage is informational,
   mutation score gates. Flaky tests are Sev-2: quarantine + fix within 48h.

Full strategy: docs/13-testing-quality.md. Execution plan and
prompt playbook: docs/24-build-execution.md. Live target: lyra.vantax.co.za. If a spec and its acceptance test
disagree, fix the test to match the spec and note it in the PR — the spec
wins.

## Non-negotiable conventions

1. **Tenancy first.** Every table has `tenant_id`; every query goes through
   `withTenant(db, tenantId)` in packages/core. No raw cross-tenant queries.
2. **One schema, two homes.** Drizzle SQLite dialect only. Anything that works on
   D1 must work on libSQL in Docker. No D1-only SQL features without a shim.
3. **Model access only via packages/model-gateway.** Never call a provider SDK
   directly from app code. Every call carries: tenant, module, purpose, actor,
   and is written to `ai_audit_log`.
4. **Human-in-the-loop:** any action tagged `consequential: true` (pricing,
   claims guidance, regulated advice, outbound send, payment) requires an
   approval step unless tenant policy explicitly automates it AND the action
   type is on the tenant's `auto_approve` allowlist.
5. **Brand tokens, not brand strings.** UI reads name/logo/colors from tenant
   config. Hard-coded "LYRA" in a user-facing surface is a bug.
6. **Events over calls.** Modules integrate through the event bus (Queues topic
   `lyra-events`, envelope in docs/04-api.md §7). Direct cross-module imports
   are forbidden except from packages/core.
7. **RTL + i18n from day one.** All strings via i18n keys (en, ar to start).
   Logical CSS properties only (`margin-inline-start`, not `margin-left`).
8. **Accessibility:** WCAG 2.2 AA. Interactive elements keyboard-reachable,
   focus visible, contrast ≥ 4.5:1 body text.
9. **Migrations are forward-only** and reviewed. Never edit an applied migration.
10. **Secrets** via wrangler secrets / Docker env — never in code or docs.
11. **Ambient AI grammar (docs/15).** AI renders as ghost text, quiet chips
    and background drafts — never modals, never auto-send outside autonomy
    policy. Every AI artifact carries the single ✦ marker and an inspectable
    "why". New AI surfaces must map to a pattern in docs/15 §4 or add one via
    ADR.
12. **Transaction integrity (docs/19).** Anything that changes money or
    contractual state is a transaction with an idempotency key, a state machine,
    approvals and (if financial) balanced double-entry journal lines. Never
    write money-affecting state directly. Ledger invariants are property-tested
    and may not be relaxed to make a test pass.
13. **Self-sufficiency (docs/20).** The business runs inside Lyra. Do not add a
    third-party marketing/production/management tool to fill a gap — build the
    capability. Platform APIs (social networks, ad networks, insurers, PSPs) are
    channels and are allowed; management suites are not.
14. **Domain-pack vocabulary (docs/21).** Never hard-code industry nouns
    ("policy", "premium", "insurer") in UI strings or system prompts. Read them
    from the active domain pack so the same code sells outside insurance.
15. **Build to the seams (docs/16).** Reserved enums, interface seams and
    schema fields for future horizons are load-bearing: implement interfaces
    against the seam (e.g. `Channel`, `IdentityVerifier`, `AutonomyEnvelope`),
    never hard-code today's single case. Removing or bypassing a documented
    seam requires an ADR.

## Definition of done (every PR)

- Typecheck + lint + unit tests green; new logic has tests.
- If UI: story added to the design-system playground; mobile parity noted.
- If API: OpenAPI updated in packages/sdk; breaking changes versioned (/v1).
- If model behaviour: eval case added under packages/model-gateway/evals.
- Audit log entries verified for consequential actions.
- Docs touched if behaviour diverges from /docs (spec-first, code follows).

## Guardrails for you (Claude)

- Do not invent regulatory claims; compliance copy comes from docs/12 only.
- Do not add third-party services beyond the approved list in docs/02 §9
  without an ADR.
- Do not weaken tenancy, audit, or approval flows to make tests pass.
- Prefer boring technology; novelty needs an ADR.
- When context is missing, read the relevant /docs file before asking.

## Build order

Follow docs/14-roadmap.md milestones M0→M6. Do not start a milestone before the
previous one's acceptance checklist passes (checklists are in that file).

## Current status (2026-08-22)

The revenue-lines build (`docs/superpowers/specs/2026-08-16-revenue-lines-full-build-design.md`)
is merged through PR #34, nothing left on a branch. Production answers:
`curl https://api.lyra.vantax.co.za/health` returns 200
`{"ok":true,"environment":"demo",…}` — the path is `/health`, not `/v1/health` —
and `pnpm e2e:live` passed 18/18 against it.

This worktree is on `claude-md-status`, clean, five commits ahead of
`origin/main` and unpushed: `6b0e0e5` docs, `f4dfaa4` the staff-status key fix
below, `a2d2f4b` nine ORBIT/desk routes translating into the reader's chosen
language rather than their profile's, `e314a7d` the tenant's time zone as a real
setting rather than an `"Asia/Dubai"` default, `6cb9b22` docs/29.

Blocked on the user, not on code: seed-history run `32352805879` waits on the
`production` Environment review, which is why `/v1/orbit/teams` still answers
`{"data":[]}`; #32/#33/#34 plus these five commits are not on
lyra.vantax.co.za until a `workflow_dispatch` of `deploy.yml` runs; and
`staging.lyra.vantax.co.za` needs a Cloudflare-side fix before it verifies
anything web-side (see Deployment).

Running under a self-paced `/loop` toward the full roadmap (M0-M6) in
production. Loop iteration is autonomous; `pnpm deploy:prod` and any `git push`
stay gated on explicit user confirmation at the moment they would happen.

Changelog, demoted: #23-#26 landed groups A-E (162 commits, +46,782/-355) over
eighteen review rounds — unguarded-`Date`/NaN family closed, mutation score to
76.96% by testing builders and not only parsers (`893dd1f`), `stripFence` ReDoS
killed (`c0a2144`); #27-#29 the Horizon/Instrument UI pass (ADR-0068,
`packages/ui/src/flow.tsx`), ORBIT portals, SCOUT commentary, seeded history,
`/design`, the live quoter (ADR-0069/70); #30-#34 gap-fill and NORTH.

## Operational traps

`pnpm eval` cannot be invoked by script name in a worktree — the guard rejects
any command whose text contains `eval`. Run
`pnpm --filter @lyra/model-gateway exec tsx evals/run.ts`.

The same guard refuses commands it cannot statically prove stay inside the
worktree — compound `git … && …` chains, heredocs feeding `git commit -F -`,
`if`/loop blocks with a redirect — reporting "too complex to verify that it
stays inside the worktree". Use plain separate commands: write a long commit
message to a file, then `git commit -F <absolute-path>`.

Before `pnpm e2e` in a worktree, check nothing already listens on 5173/8797
(`lsof -nP -iTCP:5173 -iTCP:8797 -sTCP:LISTEN`). `reuseExistingServer` is on
locally, so a dev server left by the main checkout is silently reused and the
suite tests *that* tree against a DB this one seeded. It reads as thirteen
unrelated journey failures, not a wrong-server error.

The repo has no required status checks, so `gh pr merge --auto` merges
immediately instead of queuing behind them. Read `gh pr checks` and wait for
green yourself.

## The recurring defect: dead seams

A dead seam is a declared contract nothing routes through: a web type assumed
rather than mirrored, a parameter no caller passes, a column holding something
other than what its name says. It tests green because the unit test calls the
function directly and the fixture mocks the assumption instead of the server.
Fix it at the seam every reader routes through, grep the call sites in the same
commit, verify on a deployed environment. Six sightings so far.

1. `apps/web/app/components/whitespace-commentary.tsx`, typed against an assumed
   contract while the API was built in parallel, shared one field with what
   `GET /v1/scout/whitespaces/commentary` returns and rendered `undefined`
   everywhere. A web type mirroring an API type belongs beside a comment naming
   the file it mirrors, its fixture in the server's shape.
2. `91d1085`: `labelsFrom(LABELS)` has taken a domain pack all along; three
   routes called `labelsIn(locale)` and dropped it, so no pack could rename a
   noun on the quote desk, settlement or orbit-dev. A seam keyed `policyNo`
   whose callers spell it `issue.policyNo` is unreachable, not wrongly called.
3. NORTH, twice in one column (#32 `25f3f4f`, #33 `aae8be0`): `narrativeRef` is
   documented as the briefing prose (`packages/db/src/schema/north.ts:55`) but
   rows seeded before `f506bf7` hold a storage key `briefings/<tenant>/<id>.md`
   for which no bucket was ever bound, so the text exists nowhere; the journey
   step printed the key, the brief headlined its `<h1>` with it. The guard is
   now `narrative()` at `apps/web/app/routes/north-shared.tsx:171`, where both
   readers route. That uncovered what it masked (#34 `0536513`): NORTH narrates
   per audience *and* per locale, both screens took `rows[0]` — newest in any
   language — so an English reader got Arabic highlights. `chosen(rows, id,
   locale)` is the shared pick: newest in the reader's language, else newest at
   all, an explicit `?id=` winning. Invisible until the first fix was live.
4. Detail-route sweep, 2026-08-22, against `staging.lyra.vantax.co.za` — which
   serves the production worker's build, see Deployment: `/admin/staff/:id` rendered
   the literal i18n key `admin.status.active` where the list screen beside it
   translated the same column. Fixed in the shared detail kit (`f4dfaa4`,
   `apps/web/app/routes/detail-kit.tsx`), not in the route that showed it.
5. Same sweep: `/journey/north?productLine=motor` printed a `briefings/….md` key
   as its narrative again and `/journey/north` printed a date as `1,990-08-12`,
   a year comma-grouped as a quantity. Both readers do route through
   `narrative()`, so this is that guard's limit: it decides by the *shape* of the
   value (`/^[\w/-]+\.md$/`), which holds only for shapes it was shown. The
   sharper reason, found later: the build answering that hostname predates the
   guard entirely. A seam guard green in the tree says nothing about the rows
   already in a database, and nothing at all about a hostname serving an older
   build — re-sweep the deployed environment after a contract fix, and confirm
   *which* build answered.

One more, from writing docs/29 rather than from a screen: its draft headline
("every posting hard-codes 5% tax") was wrong because citations inherited from a
summary were never opened — those literals live in `packages/core/src/seed/`
while the engines take `taxPpm` as a parameter all the way down
(`apps/api/src/engines/rating.ts:169`, `packages/ledger/src/recipes.ts:48`).
Open every `file:line` before publishing it.

## Deployment

A push to `main` fires `deploy.yml`: full CI, then the **staging** deploy
(`staging.lyra.vantax.co.za` / `api-staging.lyra.vantax.co.za`).
**lyra.vantax.co.za is production, not staging** — production is a
`workflow_dispatch` of the same workflow gated on the `production` GitHub
Environment (review from Reshigan), so a fix merged to `main` is not on the demo
site until that dispatch runs. Both share concurrency group
`deploy-deploy-refs/heads/main`, `cancel-in-progress: false`, so production
queues *behind* staging rather than racing it.

CI has a job that only runs on push, so **a green PR proves less than it
looks**: `eval-live` is `if: github.event_name != 'pull_request'`, reported
"skipping" on #29, then 401'd on `main` and took the staging deploy with it (run
32289549099) because a fallback treated `CLOUDFLARE_API_TOKEN` as a copy of
`CF_AI_TOKEN` — the account id is one value, the token is not, and a
deploy-scoped token cannot call `ai/run`. That fallback is gone (`99c64ab`) and
the gate passes real thresholds on every push. After any push to `main`, read
`gh run view <id> --json jobs`.

Verify a deploy with `pnpm e2e:live` — `playwright.live.config.ts` targets
https://lyra.vantax.co.za, `LIVE_BASE_URL` for staging. Those specs are
read-only by construction; never add a writing spec under `e2e/live`.

**`staging.lyra.vantax.co.za` serves the production worker's assets, so no
web-side fix has ever been verified there.** Both hostnames list byte-identical
asset hashes (`manifest-f61f016b.js`) and `/portal/demo` is 5416 bytes on both;
the chunk staging serves, `assets/journey-north-oot-d5sB.js`, still filters
highlights with `typeof e === "string"` and renders `{body:t.narrativeRef}` —
pre-#32 source, and exactly what the production deploy built (run `32349797112`,
head `ebae5a8`). The staging run after it (`32369451060`, head `0536513`) built
`assets/journey-north-CkYcefhK.js` and printed `Deployed lyra-web-staging
triggers → staging.lyra.vantax.co.za`, version
`30653f65-0091-489e-bbc7-558b0aa42264` — yet `curl` on that chunk path returns
**302**, so it is absent from the manifest the hostname actually serves. Not an
edge cache (no `cf-cache-status`; a cache-busting query returns the same old
manifest) and web-only: `api-staging…/health` reports `"staging"` while
`api…/health` reports `"demo"`. Ruled out: a stale committed `packages/ui/dist`
(none exists), a staging job that skips the web build (it runs `pnpm build`
first), a later overwriting deploy, turbo cache. What remains needs Cloudflare
access — either the hostname is attached to `lyra-web` rather than
`lyra-web-staging`, or `lyra-web-staging`'s live version is pinned older than
`30653f65`. Check `wrangler deployments list --name lyra-web-staging`, the same
for `lyra-web`, and the zone's route/DNS record for the `staging` hostname.
Until then, **verify a web change locally or on production, never on staging.**
Note that `apps/web` selects its env through `CLOUDFLARE_ENV=staging` plus a
generated `build/server/wrangler.json`, not the `--env staging` flag the API
uses — but the CI log proves the env *was* honored (worker `lyra-web-staging`,
`API_ORIGIN "https://api-staging.lyra.vantax.co.za"`), so that asymmetry is not
the cause.

Three habits that finding cost. A green deploy job proves an upload happened,
not that a hostname serves it — compare the content-hashed chunk the build
printed against the one the served HTML links. Two SSR pages never `md5`-match,
because the CSP header carries a per-request `nonce-<hex>`; compare byte length
instead. And wrangler truncates its asset listing at 100 `+ /assets/…` lines, so
a filename missing from a log reporting `Uploaded 151 files` is not evidence.

## Reference

`ui.md` at the repo root is the full UI inventory — every screen, its route,
layout, loader data, interactions, permission and approval gates, AI surfaces
and i18n/a11y obligations, plus Constellation and the Horizon/Instrument layout
language. Read it before changing a screen; keep it current as you would `/docs`.

`docs/27-feature-gap-register.md` is what eight domain experts found reading the
code as written, closed items marked not deleted; `docs/29-global-launch-readiness.md`
(`6cb9b22`) does the same for selling outside the UAE, `file:line` per claim:
three dead seams (`tenants.region` routes nothing, `invoiceNumber()` is a
reference not a statutory series, no PSP connector on any rail) and three
missing *dimensions* (tax treatment for Europe, tax jurisdiction for the US, a
legal entity to hang an invoice series on). Findings, not backlogs — each item
needs an ADR or spec update first.

The route sweeps live in the session scratchpad, not in `e2e/`: `sweep.mjs` walks
the 76 static routes, `sweep-detail.mjs` harvests the ones behind an `:id` by
following `main a[href]` from those pages instead of hard-coding them (38 last
run). Both sign in as the demo administrator, read only, and grep the rendered
`main` for text that is not prose: `[object Object]`, a bare `undefined`/`NaN`,
an untranslated i18n key, a storage key, a comma-grouped year, Arabic prose on
an English session. `SWEEP_BASE` picks the environment; false positives are
permission scopes, curl examples, bilingual-by-design screens, labels like
"Locale: ar", Arabic customer messages in seeded ORBIT threads.
