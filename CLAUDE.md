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

## Current status (2026-08-19)

The revenue-lines build (`docs/superpowers/specs/2026-08-16-revenue-lines-full-build-design.md`)
is **merged**. Groups A-E all landed on `main`: A and B as PRs #23/#24, C as #25,
and C/D/E's stacked branch `group-e-telematics-ubi` as **PR #26** (162 commits,
138 files, +46,782/-355). No revenue-lines work remains on a branch.

Eighteen whole-branch review rounds ran. The last two waves closed the
unguarded-`Date`/NaN-instant family (`4f115cd eee6f44 4925eaf 21e7d69 cecc256
ed32020 2e0dd89 09a3299`), lifted `@lyra/model-gateway`'s mutation score from
64.73% to 76.96% by testing the schema/prompt builders and not just the parsers
(`893dd1f`), and killed the shared `stripFence` ReDoS that CodeQL reported five
times over (`c0a2144`).

Deployment: merging #26 fired `deploy.yml` on push, which runs full CI then the
staging deploy. The production job is `workflow_dispatch`-only and additionally
gated on the `production` GitHub Environment (review from Reshigan). Both runs
share concurrency group `deploy-deploy-refs/heads/main` with
`cancel-in-progress: false`, so a dispatched production run queues *behind*
staging rather than racing it.

After a deploy, verify with `pnpm e2e:live` — `playwright.live.config.ts` points
at https://lyra.vantax.co.za, or set `LIVE_BASE_URL` for staging. Those specs
are read-only by construction; never add a writing spec under `e2e/live`.

Note: `pnpm eval` cannot be invoked by script name in an isolated worktree (the
guard rejects any command containing `eval`). Run it as
`pnpm --filter @lyra/model-gateway exec tsx evals/run.ts`.

Note: before `pnpm e2e` in a worktree, check nothing else already listens on
5173/8797 (`lsof -nP -iTCP:5173 -iTCP:8797 -sTCP:LISTEN`). `reuseExistingServer`
is on locally, so a dev server left running by the main checkout is silently
reused and the whole suite then tests *that* tree against a DB this one seeded.
It reads as thirteen unrelated journey failures, not as a wrong-server error.

Note: the repo has no required status checks, so `gh pr merge --auto` merges
immediately instead of queuing behind the checks. Read `gh pr checks` and wait
for green yourself before merging.

Running under a self-paced `/loop` toward "full roadmap to production"
(M0-M6, through deployment to lyra.vantax.co.za). Loop iteration is
autonomous, but `pnpm deploy:prod` and any git push stay gated on explicit
user confirmation at the moment they'd happen — autonomy covers task
execution cadence, not irreversible/shared-system actions.
