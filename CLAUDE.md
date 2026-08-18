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

## Current status (2026-08-17)

Executing the revenue-lines build via `docs/superpowers/specs/2026-08-16-revenue-lines-full-build-design.md`,
worked group-by-group (A→B→C→D→E) inside isolated worktrees, each via
`superpowers:subagent-driven-development`. Progress ledgers live at
`.superpowers/sdd/progress.md` per worktree — read that first on resume.

- **Group A** (accrual-only: BIND-GROUP, FEE-BROK, REFERRAL-QUAL, REFERRAL-SETL,
  AD-PLACEMENT, DISCLOSURE-PRESENT) — worktree `revenue-lines-group-a`, branch
  `worktree-revenue-lines-group-a`. Tasks 1-5 complete. Two whole-branch review
  passes done: first found 4 Important findings (RBAC gap, test coverage gap,
  subjectRef reconciliation gap, missing OpenAPI/SDK docs), all fixed; second
  (re-review of the fix range) found 2 more Important findings (wrong
  `axis.policy.group_issued` event name, DISCLOSURE-PRESENT idempotency gap)
  plus 3 Minor doc/wording issues, all fixed (commits `02d29eb`, `b9f4319`,
  `56ba868`, plus a self-caught stale-SDK regen `7dd4cfc`). 0 Critical/Important
  findings remain open; 6 Minor findings triaged as non-blocking follow-ups.
  Next: `superpowers:finishing-a-development-branch`, then start Group B.
- **Groups B-E** (partner bind chain; whitelabel billing + data products;
  premium financing; telematics/UBI) not yet started.

Running under a self-paced `/loop` toward "full roadmap to production"
(M0-M6, through deployment to lyra.vantax.co.za). Loop iteration is
autonomous, but `pnpm deploy:prod` and any git push stay gated on explicit
user confirmation at the moment they'd happen — autonomy covers task
execution cadence, not irreversible/shared-system actions.
