# 24 — Build Execution Playbook (Claude Code, maximum speed)

Target: **lyra.vantax.co.za** live from day one, then thickened milestone by
milestone. This document is the operating plan for building Lyra fast without
buying speed with rework. Read with `CLAUDE.md`, `docs/13` (TDD/EDD),
`docs/14` (milestones) and `docs/IMPLEMENTATION.md` (the M0 skeleton).

## 1. Speed doctrine — what actually makes this fast

1. **Freeze contracts before parallelising.** Speed comes from many streams
   working at once; that only works if the interfaces cannot move. Phase 1
   freezes six artifacts (§4). Everything after runs in parallel against them.
2. **Generate, never hand-write, anything derivable.** One source of truth
   (Drizzle schema) generates types, zod validators, OpenAPI, SDK and fixtures.
   Hand-written CRUD is the single biggest waste in a build this size.
3. **Write the module generator early.** `pnpm gen:module <name>` scaffolds
   router + admin console + dev console + events + tests + nav entry. Five
   modules × ~15 surfaces each is only survivable with a generator.
4. **Deploy on day one.** A walking skeleton on the real domain surfaces DNS,
   bindings, auth-cookie, CORS and cold-start problems while they are trivial.
5. **Fixtures before UI.** The deterministic Aldebaran dataset lands in Phase 1
   so every UI stream builds against real-shaped data and never waits.
6. **Acceptance tests as the backlog.** Each phase opens by committing its
   failing `@accept:Mx` / `@journey:J-XX` suite. Progress is measured by tests
   going green, not by opinion.
7. **Batch prompts by pattern, not by file.** "Build all five module admin
   consoles from admin-kit" beats five separate conversations.
8. **Boring technology, ruthlessly.** Every novel dependency costs an ADR and a
   day. The approved list (docs/02 §9) is the budget.
9. **Never trade a guardrail for velocity.** Tenancy, audit, consent, approvals,
   ledger invariants and eval gates are load-bearing; bypassing them creates
   rework with interest.

## 2. Domain & environment topology (lyra.vantax.co.za)

| Host | Serves | Notes |
|---|---|---|
| `lyra.vantax.co.za` | production web app (apps/web) | apex of the platform |
| `api.lyra.vantax.co.za` | production API (apps/api) | versioned under `/v1` |
| `dev.lyra.vantax.co.za` | developer portal + API reference | public docs, sandbox keys |
| `admin.lyra.vantax.co.za` | platform admin (goNXT staff) | behind Cloudflare Access, MFA |
| `*.lyra.vantax.co.za` | tenant workspaces (e.g. `aldebaran.lyra.vantax.co.za`) | wildcard → web worker; tenant resolved by hostname |
| `staging.lyra.vantax.co.za` + `api.staging…` | staging | separate Cloudflare account/zone config |
| `mail.lyra.vantax.co.za` | transactional email identity | SPF, DKIM, DMARC before first send |
| tenant custom domains | e.g. `compare.yallacompare.com` | Cloudflare for SaaS custom hostnames, later phase |

**DNS setup (once):** delegate or manage `vantax.co.za` on Cloudflare; create
proxied records for `lyra`, `api.lyra`, `dev.lyra`, `admin.lyra`, `*.lyra`,
`staging.lyra`, `api.staging.lyra`. Workers custom domains handle certificates
automatically; the wildcard needs a proxied wildcard record plus a Workers route.

**wrangler routes (apps/web):**
```jsonc
"routes": [
  { "pattern": "lyra.vantax.co.za", "custom_domain": true },
  { "pattern": "*.lyra.vantax.co.za/*", "zone_name": "vantax.co.za" }
]
```
**wrangler routes (apps/api):**
```jsonc
"routes": [ { "pattern": "api.lyra.vantax.co.za", "custom_domain": true } ]
```

**Residency caveat (state it to tenants):** a `.co.za` domain says nothing about
where data lives. Cloudflare serves from the global edge; for tenants requiring
in-region storage use a dedicated database with regional placement, or the
on-prem deployment (docs/11). Do not imply residency you have not configured.

## 3. Phases (compressed from docs/14 for execution)

| Phase | Content | Exit |
|---|---|---|
| **P0 — Skeleton & live domain** | Monorepo, configs, core schema, tenancy guard, API `/health`, web shell, first deploy to staging **and** production domain | `lyra.vantax.co.za` serves a branded, authenticated shell; CI green |
| **P1 — Contract freeze & spine** | The six frozen artifacts (§4), RBAC, audit, consent, events + DLQ, model gateway + evals, ledger core + invariants, fixtures, module generator, admin/dev shells | All contracts published; `pnpm gen:module` works; ledger property tests green |
| **P2 — AXIS + transactions** | Cases, documents/extraction, quoting, board, exceptions, approvals, recon, `BIND`/`CMSN-*`/client-money transactions | J-O1/O2/O3, J-C1 green; ledger flows A & B proven |
| **P3 — ORBIT** | Agent runtime, channels, console, renewals, journeys, partner platform + embedded APIs, `PARTNER-*`/`RSHARE-*` | J-C2/C3, J-X1/X2/X3 green; injection suite 100% |
| **P4 — SIGNAL + social engine** | Creative/visual/video studios, compliance pre-flight, publishing + calendar, inbox/listening, creators, paid media, launch cockpit, `PUBLISH`/`MEDIA-*` | J-M1/M2 green; assisted-publish fallbacks demonstrated |
| **P5 — SCOUT** | Sensing, clustering, radar, dossiers, panel bench, experiments, data products + k-anonymity | J-P1/P2 green; k-anon tests green |
| **P6 — NORTH + mobile + on-prem** | Metric layer, brief with verification gate, anomalies, scenarios, packs, compliance posture; mobile app; Docker/on-prem twin with internal model | J-E1/E2/E3, J-CO1 green; `onprem smoke` green |
| **P7 — Editions & hardening** | Domain packs, edition packaging matrix, standalone smoke per edition, load/chaos/pen, a11y, accessibility of Arabic surfaces, GA gates | Every edition boots standalone; docs/17 Must items ☑ |

## 4. The six frozen artifacts (end of P1 — nothing parallel starts before these)

1. **Database schema** (`packages/db/src/schema.ts`) — core + all module tables
   and the horizon-seam fields (docs/03, docs/16). Additive changes only after.
2. **OpenAPI contract** — generated from route zod schemas; published to
   `dev.lyra.vantax.co.za`. Breaking changes require a version bump.
3. **Event catalogue** (`packages/core/events.ts`) — envelope + every event type
   in docs/04 §7 and docs/20 §7, with consumer idempotency helpers.
4. **Design tokens & component contracts** (`packages/ui`) — Constellation
   tokens, the 10 primitives, and the shell layout API.
5. **Ledger chart of accounts + transaction envelope** (`packages/ledger`) —
   docs/19 §2 and §5.1, with the ten property tests wired.
6. **Fixtures & domain-pack shape** (`packages/core/fixtures`) — deterministic
   Aldebaran (insurance) + one non-insurance pack (retail) so genericity is
   proven from the start, not retrofitted.

## 5. Parallel streams (ownership boundaries prevent collisions)

Run each stream in its own **git worktree** with its own Claude Code session.
A stream may read anything but only writes inside its own paths.

| Stream | Owns (write scope) | Depends on |
|---|---|---|
| **A — Spine** | `packages/db`, `packages/core`, `packages/ledger` | — |
| **B — API & SDK** | `apps/api`, `packages/sdk`, dev portal routes | A (schema) |
| **C — Design system & shell** | `packages/ui`, `apps/web/app/(shell)` | tokens |
| **D1–D5 — Modules** | `apps/api/src/modules/<m>`, `apps/web/app/routes/<m>`, `apps/agents/<m>` | A, B, C + generator |
| **E — Mobile** | `apps/mobile` | B (SDK), C (tokens) |
| **F — Platform & infra** | `infra/*`, `.github/workflows`, wrangler configs, on-prem stack | — |
| **G — AI & evals** | `packages/model-gateway`, `evals/*` | A |

Rules: cross-stream changes are requested, not made. Schema changes go through
Stream A only. Merge order per day: A → B → C → D* → E. Rebase before merge;
`pnpm check` must pass in the worktree before a merge request.

## 6. Claude Code prompt playbook (copy-paste, in order)

### P0.1 — Orient and plan (do not let it code yet)
```
Read CLAUDE.md fully, then docs/14-roadmap.md, docs/24-build-execution.md and
docs/IMPLEMENTATION.md. Produce: (1) the P0 file list you will create, (2) the
failing tests you will commit first, (3) any contradiction you find between
docs. Do not write code yet. Be concise.
```

### P0.2 — Skeleton in one shot
```
Create the P0 skeleton exactly per docs/IMPLEMENTATION.md §3 (root configs,
packages/config, packages/db with the core schema, packages/core with the
tenancy guard and RBAC, apps/api with /health + tenancy middleware, the failing
tests, .vscode, CI). Then run pnpm install, pnpm db:generate, pnpm test and
pnpm typecheck. Fix only what you broke. Report the tree and test output.
```

### P0.3 — Web shell + brand
```
Create apps/web (React Router v7 on Workers) with: Constellation tokens from
docs/01 §3 as CSS variables, the app shell from docs/07 §3 (left rail with the
five module glyphs, top bar with tenant mark and ⌘K stub), a login route, en+ar
i18n with logical CSS properties only, and the Vega mark from docs/01 §2 as an
inline SVG component. Brand strings must come from tenant config — no
hard-coded "LYRA" in any user-facing string. Add a smoke test and a /playground
route rendering the first ten components from docs/07 §2.
```

### P0.4 — Deploy to the live domain (do this before building features)
```
Configure deployment for lyra.vantax.co.za per docs/24 §2: wrangler custom
domains and routes for apps/web (apex + wildcard) and apps/api
(api.lyra.vantax.co.za), staging equivalents, and the GitHub Actions deploy job
(staging auto on main, production manual gate). List every DNS record I must
create in Cloudflare and every secret I must set, then dry-run the deploy and
tell me exactly what to run.
```

### P1.1 — Freeze the contracts (the highest-leverage prompt in the build)
```
Implement the six frozen artifacts in docs/24 §4, in this order:
1. Full Drizzle schema: core + AXIS/ORBIT/SIGNAL/SCOUT/NORTH tables per
   docs/03 and docs/20 §6, plus every horizon-seam field per docs/16.
2. Event catalogue with envelope + idempotent consumer helper (docs/04 §7,
   docs/20 §7).
3. packages/ledger: transaction envelope (docs/19 §2), state machine (§3),
   chart of accounts (§5.1), posting engine, and the ten property tests (§11)
   written FIRST and failing.
4. packages/ui tokens + the ten primitives with stories, RTL and density variants.
5. OpenAPI generation from zod route schemas + packages/sdk client.
6. packages/core/fixtures: deterministic Aldebaran (insurance) and a retail
   domain-pack dataset per docs/21 §3.
TDD throughout. Stop when the ledger property tests pass and the SDK builds.
```

### P1.2 — The module generator (buy back days)
```
Create a code generator `pnpm gen:module <name>`: scaffolds apps/api module
router with CRUD from the schema, an admin console using admin-kit (docs/09 §1),
a dev console, event wiring, the module's analytics home shell, nav entry,
i18n keys, and a failing acceptance test file tagged @accept. Then regenerate
AXIS as a proof and show me the diff. The generator must read the schema — no
duplicated field lists.
```

### P1.3 — Spine services, TDD, batched
```
TDD, one commit per item: RBAC bundles for all roles in docs/06 §1 with the
auto-generated authz matrix test; audit + AI-audit logs with hash-chaining and
signed bundle export; consent ledger with <15min suppression propagation test;
event bus + DLQ with replay; model gateway (docs/02 §5) with three adapters,
tiers, budget counter and the eval harness (docs/13 §3) including ar+en
extraction golden sets; notification channel; ⌘K search. Report each as it goes
green.
```

### P1.4 — Admin, dev portal, entitlements
```
Build Tenant Admin (people/roles, brand studio with live contrast validation,
policies, entitlements view, usage meters, consent search, data tools, audit
search), Platform Admin (tenant lifecycle, flags, DLQ, gateway ops, cost
explorer, consented impersonation), and the Developer Portal on
dev.lyra.vantax.co.za (keys, generated docs, sandbox, webhook studio, logs).
Implement the entitlement model from docs/21 §2 including the dormant-seam
behaviour and its tests for licensed AND unlicensed paths.
```

### P2 — AXIS (pattern to repeat for every module)
```
Build AXIS to docs/modules/axis.md + docs/05 §4, transactions per docs/19 §4.1
and the worked ledger flows A and B in §5.2.
Order: (1) commit the failing @accept:M2 suite and journey specs J-O1/O2/O3 and
J-C1; (2) generate the module with gen:module; (3) implement cases, board,
case room, document extraction (evals first per docs/13 §3), quoting with three
connector types + mock providers, exceptions, approvals, reconciliation
workbench (docs/22 §1.4), admin and dev consoles; (4) wire AXIS metrics into the
analytics fabric; (5) make every test green. Do not weaken tenancy, ledger
invariants or approval gates to pass a test.
```
Repeat with `docs/modules/orbit.md` (P3), `signal.md` + `docs/20` (P4),
`scout.md` (P5), `north.md` (P6) — each time: acceptance suite first, generator,
implement, metrics, green.

### P4 special — social engine
```
Build the docs/20 engine inside SIGNAL. Priorities: the compliance pre-flight
gate that makes publishing physically impossible without a pass token; the
composer with live per-platform previews (docs/22 §2.1) in ar and en; the
channel connector framework with the reality matrix from docs/20 §9 including
the assisted-publish fallback; PUBLISH/MEDIA-* transactions; the calendar; the
inbox; the launch cockpit gate rail. Every connector declares its permissions
and policy limits. No inauthentic-engagement features — refuse and explain if
asked.
```

### P6 special — NORTH verification gate
```
Implement the numeric-verification gate first as a failing test: generated
narrative prose may only contain figures that match the metric layer exactly;
any mismatch fails closed and alerts. Then build the brief, anomalies with
driver decomposition, scenarios with mandatory ranges/assumptions, board packs
with PDF render, decision log and compliance posture tile. en + ar briefs.
```

### P7 — Editions, packs, hardening
```
Implement domain packs (docs/21 §3) with vocabulary injected at render AND
prompt time, plus a lint rule failing hard-coded domain nouns. Add the packaging
matrix test: every edition (Bots, Ops, Social, Radar, Insights, Suite) boots,
seeds, and passes its own smoke journeys with all other modules disabled. Then
run load, chaos drills, ZAP, a11y and the full docs/17 benchmark; produce the
scorecard by prefix.
```

### Continuous — the bench
```
Update docs/traceability.csv: for every requirement you satisfied this session,
fill spec_ref, test_ref, evidence_ref and set status. Then print the scorecard
(☑ Must / total Must) per prefix. Do not mark anything ☑ without a test or
evidence reference.
```

## 7. Session hygiene (this is where speed is won or lost)

- **Plan first, always.** Ask for the plan, approve it, then let it build. The
  five minutes spent reading a plan saves hours of wrong direction.
- **One prompt, one commit, one concern.** Small diffs review fast and revert
  cleanly.
- **Clear context between phases.** Long sessions drift; start each phase fresh
  with the phase prompt and let `CLAUDE.md` re-anchor it.
- **Keep `CLAUDE.md` tight.** It is read every session; bloat costs tokens on
  every turn. Specs live in `/docs`, referenced not inlined.
- **Use subagents for breadth, one session for depth.** Parallel independent
  files: subagents. Deep refactor of one package: single focused session.
- **Reject silently-weakened guardrails.** If a diff disables a check to go
  green, that is a defect, not progress.
- **Demand the test output.** "Show me the failing test, then the passing test"
  is the fastest way to keep it honest.
- **ADR anything novel.** New dependency, new service, new pattern → one page in
  `docs/decisions/` before the code.

## 8. Anti-rework guardrails (cheap now, expensive later)

| Do now | Because |
|---|---|
| Seam fields and interfaces (docs/16) | retrofitting schema across a live multi-tenant DB is the most expensive thing on this list |
| Ledger invariants as property tests | money bugs found after go-live are reputational, not just technical |
| Tenancy lint + isolation tests in CI | one cross-tenant leak ends the enterprise conversation |
| i18n keys + logical CSS from line one | retrofitting RTL is a full re-layout |
| Domain-pack vocabulary indirection | hard-coded "policy" blocks every non-insurance sale |
| Eval gates before prompts | otherwise prompt changes are unmeasurable and regressions invisible |
| Deploy to the real domain in P0 | deploy problems are cheapest when there is nothing to deploy |

## 9. Verification commands (every phase, before declaring done)

```bash
pnpm check                     # lint + typecheck + unit/integration
pnpm test --filter @lyra/ledger    # money invariants
pnpm e2e --grep "@accept:Px"    # phase acceptance suite
pnpm e2e --grep "@journey"      # journeys for shipped modules
pnpm eval                       # AI golden sets + injection suite
pnpm gen:openapi && pnpm build  # contract + build integrity
pnpm deploy:staging && pnpm smoke:staging
```

## 10. Known risks to manage actively

1. **Platform API approvals** (TikTok posting, Meta app review, X API tier) have
   lead times measured in weeks — start applications in P1, not P4.
2. **Payment and BSP onboarding** (PSP, WhatsApp provider) similarly gate P2/P3
   demos; begin commercial paperwork immediately.
3. **The house mark is unresolved** (docs/23). Keep `brand.houseMark` config-only
   and avoid printed/public assets until counsel clears.
4. **Arabic quality is a gate, not a garnish.** Budget native review time in
   every phase; it cannot be compressed at the end.
5. **Scope gravity around SIGNAL** — the social engine is the largest surface in
   the pack. Ship the compliance gate, composer, calendar and one paid channel
   before breadth.
6. **On-prem model hardware** must be specified with the first regulated tenant;
   eval thresholds decide the model, not preference.
