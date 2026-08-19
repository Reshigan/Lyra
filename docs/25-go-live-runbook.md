# 25 — Production go-live runbook

Companion to [`docs/25-go-live-checklist.md`](25-go-live-checklist.md) (what must
be *true* before go-live) and
[`docs/handover/03-operations-runbook.md`](handover/03-operations-runbook.md)
(steady-state operations). This file is the *sequence*: what you run, in what
order, on the day.

**Rule of this document.** Every step cites the file and line it came from. Where
the repository contains no evidence for something a go-live needs, the step says
**UNVERIFIED — no evidence in repo** instead of guessing. A step you cannot cite
is a step you must confirm with a human before running.

Line numbers are as of the commit that added this file. If a citation does not
match what you read, trust the file and fix the citation — a stale citation is
how [`docs/25-go-live-checklist.md`](25-go-live-checklist.md) came to point at
`apps/api/src/auth.ts:420` for a function that now lives at line 454.

---

## 0. What "production" is here

| | Production | Staging |
|---|---|---|
| API worker | `lyra-api` (`apps/api/wrangler.jsonc:6`) | `lyra-api-staging` (`:84`) |
| Web worker | `lyra-web` (`apps/web/wrangler.jsonc:6`) | `lyra-web-staging` (`:27`) |
| API host | `api.lyra.vantax.co.za` (`apps/api/wrangler.jsonc:81`) | `api-staging.lyra.vantax.co.za` (`:145`) |
| Web host | `lyra.vantax.co.za` (`apps/web/wrangler.jsonc:24`) | `staging.lyra.vantax.co.za` (`:39`) |
| D1 | `lyra` / `e1f4ed16-86ee-49be-9c46-7c21915eccd2` (`apps/api/wrangler.jsonc:34-36`) | `lyra-staging` / `81d1ede7-08fc-4941-a3aa-7e342bbbc0fb` (`:107-108`) |
| Cron | `*/5 * * * *` (`apps/api/wrangler.jsonc:80`) | `*/15 * * * *` (`:144`) |
| Trigger | `workflow_dispatch` only (`.github/workflows/deploy.yml:64`) | push to `main` (`:26`) |

### 0.1 Every var that differs between the two environments

API (`apps/api/wrangler.jsonc`):

| Var | Production | Staging |
|---|---|---|
| `ENVIRONMENT` | `"demo"` (`:20`) | `"staging"` (`:86`) |
| `APP_ORIGIN` | `https://lyra.vantax.co.za` (`:21`) | `https://staging.lyra.vantax.co.za` (`:87`) |
| `SESSION_COOKIE` | `lyra_session` (`:22`) | `lyra_session_staging` (`:95`) |
| `SESSION_COOKIE_DOMAIN` | `lyra.vantax.co.za` (`:28`) | `lyra.vantax.co.za` — **identical** (`:101`) |

Web (`apps/web/wrangler.jsonc`):

| Var | Production | Staging |
|---|---|---|
| `ENVIRONMENT` | `"production"` (`:16`) | `"staging"` (`:29`) |
| `API_ORIGIN` | `https://api.lyra.vantax.co.za` (`:17`) | `https://api-staging.lyra.vantax.co.za` (`:30`) |
| `SESSION_COOKIE` | `lyra_session` (`:18`) | `lyra_session_staging` (`:33`) |
| `SESSION_COOKIE_DOMAIN` | `lyra.vantax.co.za` (`:22`) | `lyra.vantax.co.za` — **identical** (`:37`) |

Three consequences worth holding in your head before you touch anything:

1. The API's `ENVIRONMENT` is `"demo"` in production and the web worker's is
   `"production"`. They disagree on purpose, and the web value is nearly inert —
   `docs/handover/02-environments-and-access.md` §6 says it "is currently read by
   nothing outside tests. Do not use it to infer the API's mode." (One real
   reader exists: `apps/web/app/routes/signal-dev.tsx:110`.) The API value is the
   one that gates behaviour — see §5.1.
2. Because `SESSION_COOKIE_DOMAIN` is the same parent domain in both
   environments, the cookie *name* is the only thing separating a staging session
   from a production one (`apps/api/wrangler.jsonc:88-94`). Never normalise those
   names.
3. Everything else — KV ids, R2 buckets, queue names, Vectorize indexes,
   Analytics dataset, Workflow name — is `-staging`-suffixed and distinct
   (`apps/api/wrangler.jsonc:112-132`). There is no shared state between the two
   environments except the cookie domain.

### 0.2 What the API worker actually requires at runtime

`apps/api/src/env.ts` types exactly two bindings as required: `DB: D1Database`
and `AGENT_ROOM: DurableObjectNamespace<AgentRoom>`. Every other binding and var
is optional (`?`), so a missing one is a degraded feature, not a boot failure.
The ones with go-live consequences:

- `FIELD_KEY?` (`apps/api/src/env.ts:82`) — field-level encryption. `fieldKey()`
  (`env.ts:96-99`) throws `internal("FIELD_KEY is not configured")` when unset,
  so every route that opens an encrypted envelope 500s. Callers:
  `apps/api/src/resources.ts:296,547`,
  `apps/api/src/engines/orbit-channel-outbound.ts:55`,
  `apps/api/src/routes/channels.ts:35`, `apps/api/src/routes/portal.ts:683`,
  `apps/api/src/routes/axis.ts:315,370`.
  `docs/handover/03-operations-runbook.md` §7.2 records it as set on both
  environments on 2026-08-10 and states it has **no rotation path** — changing it
  makes every existing envelope unopenable.
- `TURNSTILE_SECRET?` (`apps/api/src/env.ts:88`) — see §5.2. Its absence is
  meaningful: no secret, no challenge.
- `SESSION_COOKIE_DOMAIN?` — unset means a host-only cookie, which breaks every
  direct-to-API download (`apps/api/wrangler.jsonc:23-27`).
- `ANTHROPIC_API_KEY?` / `OPENAI_COMPAT_API_KEY?` — set with `wrangler secret
  put` out of band, not GitHub secrets (`.github/workflows/deploy.yml:107-108`).

---

## 1. Preflight

Every command here is read-only. Run them from the repo root on `main` unless a
step says otherwise. None of them writes to Cloudflare.

### 1.1 You are on the commit you think you are

```bash
git fetch origin && git status -sb && git log --oneline -1 origin/main
```

The `production` Environment only deploys off `main`
(`.github/workflows/deploy.yml:69-72`).

### 1.2 The local toolchain matches CI

```bash
node --version    # must satisfy >=22 (package.json:6-8)
pnpm --version    # 9.15.9 (package.json:5)
```

CI pins node 22 and takes pnpm's version from `packageManager`
(`.github/workflows/ci.yml:22-28`).

### 1.3 Which Cloudflare identity your shell holds

```bash
pnpm exec wrangler whoami
```

Required by `docs/handover/03-operations-runbook.md` §1.2 before any deploy. Note
the account id: production expects `08596e523c096f04b56d7ae43f7821f4`
(`infra/cloudflare/README.md`).

### 1.4 The checks that gate the deploy are green on this commit

```bash
gh run list --workflow=deploy.yml --branch=main --limit 5
gh run list --workflow=ci.yml --limit 5
```

`production` is `needs: checks` (`.github/workflows/deploy.yml:65`), and `checks`
is the whole of `ci.yml` via `workflow_call` (`:21-23`): `check` (lint,
typecheck, test, web build — `ci.yml:33-40`), `eval` (`:52`), `eval-live`
(`:60-77`), `e2e` (`:79-99`) and `mutation` for both `core` and `model-gateway`
(`:109-182`).

Locally, the same gates in `ci.yml`'s order:

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @lyra/web build
```

`pnpm eval` cannot be invoked by script name inside a worktree (the guard rejects
any command containing `eval` — `CLAUDE.md`). Run it as:

```bash
pnpm --filter @lyra/model-gateway exec tsx evals/run.ts
```

### 1.5 The mutation gate will scope itself sanely on a dispatch

Nothing to run; read and confirm. On `workflow_dispatch` there is no
`github.event.before`, so `STRYKER_SINCE` falls back to `HEAD^`
(`.github/workflows/ci.yml:182`). The comment at `:176-179` warns that an *empty*
value sweeps the whole tree — a ~45h run — "i.e. the production dispatch could
never go green". If the `mutation` job runs past its `timeout-minutes: 60`
(`:123`), read the scope; do not raise the ceiling (`:115-122`).

### 1.6 Staging is running the commit you are about to promote

```bash
# from apps/api
pnpm exec wrangler deployments list --env staging
curl -s https://api-staging.lyra.vantax.co.za/health
```

`docs/handover/03-operations-runbook.md` §2.2 requires this by hand and states
plainly that "a green `checks` run does **not** currently guarantee this". The
reason is §2.5 there: the CI `CLOUDFLARE_API_TOKEN` lost `workers_routes (write)`
and `zone (read)`, the `staging` job has been failing on that, and staging has
been deployed from a maintainer's local wrangler OAuth session instead.

> **UNVERIFIED — no evidence in repo:** whether that token has since regained
> those scopes. The repo records the defect, not its repair. If it has not, the
> `production` job's `wrangler deploy` steps fail the same way — *after* the
> migration step has already run (§2.2).

### 1.7 Staging smoke

```bash
pnpm smoke:staging
```

`package.json:17` → `tsx scripts/lyra.ts staging smoke`. It targets
`STAGING_API_ORIGIN` / `STAGING_WEB_ORIGIN` from `e2e/sim/env.ts`, hardcoded,
with no CLI override, and checks `api:health` 200, `web:root-redirect` 302,
`web:login` 200, plus nine authenticated module reads each preceded by a
`POST /v1/auth/demo/login`.

**It is not a production tool.** It is pinned to the staging hosts and it POSTs.
There is no production-safe equivalent in the repo — see §5.6.

### 1.8 The production database's migration state

```bash
# from apps/api
pnpm exec wrangler d1 migrations list lyra --remote
```

Read-only; the command is given in `docs/handover/03-operations-runbook.md` §4.
The repo ships 29 migrations, `0000_dark_screwball` through
`0028_exotic_nighthawk` (`packages/db/migrations/`), with the order recorded in
`packages/db/migrations/meta/_journal.json`.

> **UNVERIFIED — no evidence in repo:** which of those 29 the production `lyra`
> database has actually applied. Nothing in the repository records production's
> applied state; this command is the only answer. Run it *before* dispatching,
> because the deploy applies them without asking (§2.2).

### 1.9 Whether any pending migration can fail on production data

D1 applies migrations one file at a time and does not roll the batch back, so a
failure at file *n* leaves files 0..*n*-1 committed. Two pending files can fail on
data alone, and both destroy a constraint before they try to rebuild it.

**`packages/db/migrations/0008_solid_domino.sql`** (13 statements) drops each
unique index and recreates it partial. The six that can fail, with the exact
condition:

| Index (line) | Fails if |
|---|---|
| `core_users_tenant_email_uq` (`:3`) | two rows in `core_users` share `(tenant_id, email)` with `deleted_at IS NULL` |
| `axis_cases_ref_uq` (`:5`) | two live `axis_cases` share `(tenant_id, ref)` |
| `core_identity_providers_domain_uq` (`:7`) | two rows share `(tenant_id, email_domain)` — this one is **not** partial, so soft-deleted rows count too |
| `dist_channels_key_uq` (`:9`) | two live `dist_channels` share `(tenant_id, key)` |
| `dist_offerings_code_uq` (`:11`) | two live `dist_offerings` share `(tenant_id, provider_id, code)` |
| `dist_commission_entries_accrual_uq` (`:13`) | two `dist_commission_entries` share `(tenant_id, policy_id, kind)` where `kind != 'clawback'` |

Because the `DROP` precedes the `CREATE` in every case, a failure leaves that
table with **no** unique constraint at all until a human fixes the data and
re-runs.

**`packages/db/migrations/0027_empty_garia.sql`** (3 statements) adds
`missed_streak` to `ledger_payment_plans` (`:1`), then creates
`ledger_payment_plans_live_uq ON (tenant_id, subject_ref) WHERE state IN
('active','defaulted')` (`:2`). It fails if any tenant has two plans for the same
`subject_ref` both in `active` or `defaulted`. The `ALTER` at `:1` has already
committed by then.

**`packages/db/migrations/0009_renewals_per_term.sql`** drops
`orbit_renewals_policy_uq` and creates a non-partial
`orbit_renewals_policy_term_uq (tenant_id, policy_ref, expiry_at)` — same
drop-first hazard, with no `WHERE` to narrow it.

To check before you dispatch, run the matching `SELECT … GROUP BY … HAVING
count(*) > 1` against production. SELECT only, no writes:

```bash
# from apps/api
pnpm exec wrangler d1 execute lyra --remote --command \
  "SELECT tenant_id, email, count(*) c FROM core_users WHERE deleted_at IS NULL GROUP BY 1,2 HAVING c > 1"
```

> **UNVERIFIED — no evidence in repo:** whether production data currently
> violates any of these. The repo describes the constraints, never the rows.

### 1.10 Secrets exist (names only, never values)

```bash
# from apps/api
pnpm exec wrangler secret list
```

`wrangler secret list` prints names only
(`docs/handover/03-operations-runbook.md` §7.1). Expect `FIELD_KEY`,
`ANTHROPIC_API_KEY`, `OPENAI_COMPAT_API_KEY`; `TURNSTILE_SECRET` is documented as
**not set** (`docs/handover/02-environments-and-access.md` §6). The web worker has
no secrets at all (same section, and `apps/web/wrangler.jsonc:3-4`).

A missing `FIELD_KEY` is not a boot failure — it is a 500 on the six call sites
listed in §0.2. Confirm it is present before the deploy, and **never** change it
(§5.4).

### 1.11 Seeding — only if this is a first-ever fill

The production database is already populated
(`e2e/live/ledger-history.spec.ts` asserts more than 18 rows on
`/ledger/transactions`), so a normal go-live seeds nothing. Recorded for
completeness:

- `packages/core/src/seed-cli.ts` is **libsql only** — it builds
  `makeLibsqlDb(process.env.DATABASE_URL ?? "http://127.0.0.1:8080", …)`. It
  cannot target D1. Invoked as `pnpm --filter @lyra/core seed`
  (`packages/core/package.json`), reading `SEED_PASSWORD` from the environment.
- `packages/core/src/seed.ts:39` defaults the password to `Gonxt-Demo-2026!`;
  `:134` refuses that default when `opts.environment === "production"` and no
  password is given; `:143` throws `gonxt tenant already seeded — drop the
  database first` on a second run. Tenant slug is `gonxt` (`:2215`).
- `packages/core/src/seed-history-cli.ts` is the only D1-capable path, via a
  drizzle sqlite-proxy against the D1 REST API. Exact invocation:

```bash
CF_ACCOUNT_ID=… CF_API_TOKEN=… \
  pnpm --filter @lyra/core seed:history --database <d1-database-id> [--days 365] [--tenant <id>]
```

  `--database` is required; `--days` defaults to 365; the token comes from
  `CF_API_TOKEN ?? CLOUDFLARE_API_TOKEN` and needs D1 Write. Omitting `--tenant`
  when there is not exactly one tenant throws, listing `slug=id`. Both
  `seedHistory` and `seedModuleHistory` are idempotent. The file's own comment:
  never pass the token on the command line, it would land in shell history.

> **UNVERIFIED — no evidence in repo:** whether the production `lyra` database
> was ever seeded, and whether `seed:history` has been run against it. No file
> records either event.

### 1.12 Nothing in the checklist has been reopened

```bash
grep -n "^- \[ \]" docs/25-go-live-checklist.md
```

Required by `docs/handover/03-operations-runbook.md` §2.2. The unchecked items
that block a *real-tenant* go-live are consolidated in §5 below.

---

## 2. The deploy

### 2.1 Dispatch

Production is `workflow_dispatch` only (`.github/workflows/deploy.yml:64`); a
push to `main` runs the `staging` job instead (`:26`). Both share the concurrency
group `deploy-${{ github.workflow }}-${{ github.ref }}` with
`cancel-in-progress: false` (`:10-12`), so a production dispatch queues *behind* a
staging run rather than racing it.

```bash
gh workflow run deploy.yml --ref main
gh run watch
```

GitHub UI equivalent: Actions → **deploy** → *Run workflow*, branch `main`
(`docs/handover/03-operations-runbook.md` §2.4).

The job then pauses on the `production` GitHub Environment
(`.github/workflows/deploy.yml:73`). Its approval gate — required review from
Reshigan, `main`-only — lives in repo Settings → Environments, not in the
workflow file (`:67-72`). `can_admins_bypass` is still true, so a repo admin can
override; there is no zero-gate path through `workflow_dispatch` alone.

### 2.2 What the job runs, in order

Reproduced from `.github/workflows/deploy.yml:74-102`. **Do not run these by hand
unless the workflow itself is unusable** — they write to production.

```bash
# working-directory: apps/api
pnpm exec wrangler d1 migrations apply lyra --remote     # deploy.yml:88
pnpm exec wrangler deploy                                # deploy.yml:95

# repo root
pnpm --filter @lyra/web run deploy                       # deploy.yml:102
```

Three things the workflow is explicit about:

- **Migrations run before the deploy, deliberately** — "New code must never meet
  an old schema" (`docs/handover/03-operations-runbook.md` §2.3). This is also
  why a data-driven migration failure (§1.9) leaves a partly-migrated schema with
  the *old* code still serving.
- **API before web.** The web worker calls the API, so a schema change should
  already be live by the time the new UI serves
  (`.github/workflows/deploy.yml:55-56`, stated for staging; the production job
  follows the same order).
- **The `run` keyword in the last line is load-bearing.** Bare `pnpm deploy` is
  pnpm's builtin, not this repo's script (`.github/workflows/deploy.yml:101`).
  `@lyra/web`'s `deploy` is `pnpm build && wrangler deploy -c
  build/server/wrangler.json` (`apps/web/package.json`); with `CLOUDFLARE_ENV`
  unset the build takes the top-level (production) vars, which is what
  distinguishes it from `deploy:staging`.

The root convenience script `pnpm deploy:prod` (`package.json:25` →
`pnpm --filter @lyra/api deploy && pnpm --filter @lyra/web deploy`) **skips the
migration step**. It is only safe when you know there is nothing to migrate.
`CLAUDE.md` gates it on explicit user confirmation at the moment it would run.

### 2.3 Do not add logging to a deploy step

Secrets reach wrangler through `env:` on the step and are never expanded into a
shell command. Do not add `set -x`, `echo` or `--verbose`: Actions only masks
values it knows verbatim (`.github/workflows/deploy.yml:104-106`).

---

## 3. Post-deploy verification

### 3.1 The two-command check

```bash
curl -s https://api.lyra.vantax.co.za/health
# {"ok":true,"environment":"demo","ts":...}
curl -s -o /dev/null -w '%{http_code}\n' https://lyra.vantax.co.za/login
# 200
```

From `docs/handover/03-operations-runbook.md` §2.4. `/health` is served by
`apps/api/src/index.ts:60-62` and reports `c.env.ENVIRONMENT ?? "production"`, so
the deployment's mode is externally observable with a GET. `/health` is in the
unauthenticated `PUBLIC` set (`apps/api/src/mw.ts:20`).

### 3.2 The live suite

```bash
pnpm e2e:live                                                  # package.json:15
LIVE_BASE_URL=https://staging.lyra.vantax.co.za pnpm e2e:live
```

`playwright.live.config.ts`: `testDir: "./e2e/live"`, no `webServer`, no DB wipe,
no seed, `baseURL: process.env.LIVE_BASE_URL ?? "https://lyra.vantax.co.za"`
(`:18`), retries 1, workers 3, chromium only, 90s timeout. Read-only by
construction; `CLAUDE.md` forbids adding a writing spec under `e2e/live`.

**What it covers:**

- `e2e/live/smoke.spec.ts` — a11y on `/login` and the home screen, then a
  per-persona pass over `/`, `/approvals`, `/settings` asserting a non-blank
  `<main>`, no raw i18n keys and no error-boundary copy.
- `e2e/live/export-download.spec.ts` — the one check `pnpm e2e` structurally
  cannot make (there, web and api are the same host — `:10-11`): the trial-balance
  CSV link must point at a *different host* (`:26-28`) and `context.request.get()`
  must return 200 with a non-empty body (`:32-34`). A 401 here is
  `SESSION_COOKIE_DOMAIN` not reaching the API host.
- `e2e/live/ledger-history.spec.ts` — seven finance screens render without an
  error boundary; `/ledger/year-end` contains `"3100"` (Retained Earnings,
  proving `syncChartOfAccounts` reached the tenant); `/ledger/transactions` has
  more than 18 rows (proving the history backfill landed).
- `e2e/live/show-filter.spec.ts` — the `/north/anomalies` combobox label is not
  `"…"`.

**What it does NOT cover:** any write path; the API in isolation (only the one
export GET); the mobile app; the public portal and DSAR forms; Turnstile;
migrations; cron, queue, Durable Object or Workflow behaviour.

**And it cannot run at all against a non-demo build.** Every spec authenticates
through `e2e/live/sign-in.ts`, which clicks a demo persona button and asserts
"the deployment offers no demo door — is this a demo build?" (`:20-21`). Personas
and the seed password live in `e2e/env.ts`. Closing the demo door (§5.1)
therefore removes the entire post-deploy verification suite at the same moment.
Plan the replacement before the flip, not after.

### 3.3 Confirm the version that is now live

```bash
# from apps/api
pnpm exec wrangler deployments list
# for the web worker, from apps/web (run pnpm build first if build/ is absent)
pnpm exec wrangler deployments list -c build/server/wrangler.json
```

`docs/handover/03-operations-runbook.md` §3.2. Record the version id — §4 needs
it, and the previous one.

---

## 4. Rollback

Read `docs/handover/03-operations-runbook.md` §3 in full before using any of
this. Its §3.2 carries an OPEN ITEM: **no Worker rollback has ever been performed
on this project.**

### 4.1 Worker rollback

```bash
# from apps/api
pnpm exec wrangler deployments list
pnpm exec wrangler rollback <VERSION_ID>

# web: add -c build/server/wrangler.json (run pnpm build first if build/ is absent)
pnpm exec wrangler rollback <VERSION_ID> -c build/server/wrangler.json
```

Add `--env staging` for the staging workers. The always-available alternative,
and the one with a track record here, is reverting the commit on `main` and
dispatching again (`docs/handover/03-operations-runbook.md` §3.2).

> **UNVERIFIED — no evidence in repo:** that `wrangler rollback` works on these
> workers. The repo states it has never been exercised.

### 4.2 Migrations cannot be rolled back

Forward-only (`CLAUDE.md` §9). There is no `down`, and no `pnpm db:rollback`
(`docs/handover/03-operations-runbook.md` §3.3). In order of preference:

1. Roll the Worker back and leave the schema — safe only if the migration was
   additive.
2. Write a forward-fix migration.
3. Restore from backup. That is an incident, not a rollback. The nightly D1→R2
   backup exists and the R-03 restore drill passed on 2026-08-01
   (`docs/25-go-live-checklist.md` §6).

### 4.3 Order

Reverse of the deploy order — web first, then API
(`docs/handover/03-operations-runbook.md` §3.4) — and only safe if the migration
was additive.

### 4.4 Rollbacks that are not deploys

For bad AI or feature behaviour, do not redeploy
(`docs/handover/03-operations-runbook.md` §3.5):

- `POST /v1/platform/ai/kill` and `POST /v1/platform/ai/release` — needs
  `admin:flags:write`; blocked calls answer 503; audited as `platform.ai.killed`.
- `PATCH /v1/platform/flags/:id` — feature flags.
- `POST /v1/ai/budget/limits` — spend caps.

---

## 5. Known risks

### 5.1 Production runs in demo mode, and five demo routes are unauthenticated — CONFIRMED

`apps/api/wrangler.jsonc:20` sets `"ENVIRONMENT": "demo"` in production. The gate
is `apps/api/src/auth.ts:454-456`:

```ts
export function demoOnly(env: Env): void {
  if ((env.ENVIRONMENT ?? "production") === "production") throw notFound("route");
}
```

It rejects only when the value is exactly `"production"` (defaulting to
`"production"` when unset). `"demo"` is not `"production"`, so every guarded route
is mounted and answering on the live host. Call sites:

| Route | Gate |
|---|---|
| `GET /v1/auth/demo/personas` | `apps/api/src/auth.ts:471` |
| `POST /v1/auth/demo/login` | `apps/api/src/auth.ts:503` |
| `POST /v1/auth/demo/clock` | `apps/api/src/auth.ts:539` |
| `POST /v1/auth/demo/seed` | `apps/api/src/auth.ts:554` |
| `POST /v1/auth/demo/resync-roles` | `apps/api/src/auth.ts:579` |
| `POST /v1/signal/demo/spend-tick` | `apps/api/src/routes/signal.ts:231` |

Five of the six are also in the unauthenticated `PUBLIC` set
(`apps/api/src/mw.ts:29-33`), on the stated assumption at `:27-28` that "the
routes themselves 404 outside a demo deployment (auth.ts §demoOnly), so being
listed here costs nothing in production". That assumption does not hold on this
deployment.

The exposure is wider than sign-in alone: `/demo/login` issues a full session
from an email address with `{ mfaAsserted: true, via: "demo" }` — an explicit
credential and second-factor bypass; `/demo/seed` writes tenant data;
`/demo/resync-roles` mutates RBAC and the chart of accounts; `/demo/clock` shifts
every timestamp the system produces via the KV `sim:clock:offsetMs`; and
`/v1/signal/demo/spend-tick` inserts spend rows. `/health` publishes the mode
(`apps/api/src/index.ts:60-62`).

`docs/25-go-live-checklist.md` §6 already carries the flip as an unchecked gate
and records `GET https://api.lyra.vantax.co.za/v1/auth/demo/personas` answering
200 on the live host.

**The flip is one var** (`apps/api/wrangler.jsonc:20` → `"production"`) plus a
redeploy of the API worker; `apps/api/wrangler.jsonc:15-19` notes password
sign-in is unaffected either way. **But it also disables `pnpm e2e:live`
entirely** (§3.2) and the nine module checks in `pnpm smoke:staging` (§1.7), both
of which authenticate through the demo door. Sequence the flip with a replacement
verification path, or you will be flying blind at exactly the moment you stop
being a demo.

### 5.2 Turnstile: nothing enforces "both or neither" — CORRECTION

The claim that `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` "must be set together
or not at all" is **not enforced by any code**. It exists only as prose, in
`infra/cloudflare/README.md:72-74`: "Set both or neither: a site key with no
secret challenges visitors and verifies nothing; a secret with no site key
rejects every submission, because no widget is rendered to produce a token."

What the code actually does:

- `apps/api/src/turnstile.ts:19` — `if (!secret) return;` — **fails open**. No
  secret, no verification, no error. This is the current production state:
  `docs/handover/02-environments-and-access.md` §6 records `TURNSTILE_SECRET` as
  not set, and `docs/handover/08-known-gaps-and-backlog.md:446` says "the public
  portal has no bot protection today."
- `apps/api/src/turnstile.ts:20` — `if (!token) throw forbidden("turnstile");` —
  **fails closed** the moment a secret exists but no token arrives.
- `apps/web/app/components/turnstile.tsx:10-11` — `if (!siteKey) return null;` —
  no site key, no widget, therefore no token.

And the trap: **`TURNSTILE_SITE_KEY` is not declared anywhere in
`apps/web/wrangler.jsonc`.** It is typed at `apps/web/app/env.ts:21` and passed
through at `apps/web/app/routes/portal.$tenantSlug.tsx:165` and
`apps/web/app/routes/portal.$tenantSlug.privacy.tsx:102`, but with no binding it
is always `undefined` in production — corroborated by
`docs/handover/07-data-and-integrations.md:708-709` and
`docs/handover/08-known-gaps-and-backlog.md:168`.

So running the infra README's own turn-on snippet — `wrangler secret put
TURNSTILE_SECRET` — **and nothing else** takes portal lead capture (J-C1) and
public DSAR intake (J-C4) offline with 403s, because the web app cannot render a
widget to produce the token the API now demands. Turning Turnstile on is a
two-part change: add `TURNSTILE_SITE_KEY` to `apps/web/wrangler.jsonc` and deploy
the web worker *before* setting the API secret. The CSP already admits
`https://challenges.cloudflare.com` (`apps/web/app/entry.server.tsx:18,23,26,27`).

### 5.3 The CI token has lost scopes the production job needs

`docs/25-go-live-checklist.md` §6 and `docs/handover/03-operations-runbook.md`
§2.5: the GitHub Actions `CLOUDFLARE_API_TOKEN` no longer carries
`workers_routes (write)` or `zone (read)`, the `staging` job has been failing on
that, and staging has been deployed from a maintainer's local wrangler OAuth
session — a workaround, not a fix. The `production` job uses the same secret
(`.github/workflows/deploy.yml:86-87,93-94,99-100`) and its migration step runs
*first*, so a scope failure lands after the schema has already moved.

> **UNVERIFIED — no evidence in repo:** whether the token has been repaired.
> Check before dispatching.

### 5.4 `FIELD_KEY` has no rotation path

`docs/handover/03-operations-runbook.md` §7.2: set on staging and production on
2026-08-10, and changing it makes every existing envelope unopenable. Missing →
500 `FIELD_KEY is not configured` (`apps/api/src/env.ts:96-99`) on the six call
sites in §0.2. ADR-0032 records the absence of a rotation design. Treat the value
as immutable until that ADR is superseded.

### 5.5 A failed migration leaves production without the constraint it was dropping

Detailed in §1.9. `0008_solid_domino.sql` and `0009_renewals_per_term.sql` drop
before they create; `0027_empty_garia.sql` commits an `ALTER` before its unique
index. D1 does not roll the file back for you, and the workflow applies them
unattended (`.github/workflows/deploy.yml:88`).

### 5.6 There is no production smoke script

`package.json` has `smoke:staging` (`:17`) and no production counterpart.
`scripts/lyra.ts` reads its origins from `e2e/sim/env.ts` with no CLI override,
and its module checks POST to `/v1/auth/demo/login`. The only production-safe
verification in the repo is the two curls in §3.1 and `pnpm e2e:live` (§3.2), and
the latter dies with the demo door.

> **UNVERIFIED — no evidence in repo:** any production smoke path that does not
> depend on `ENVIRONMENT != "production"`.

### 5.7 Infrastructure Terraform has never been applied

`infra/cloudflare/README.md`: "Status: drafted, not applied … has never been run
against a real account." Contents: `versions.tf`, `variables.tf`, `waf.tf`,
`r2_lifecycle.tf`, `turnstile.tf`. Applying it needs a token with `Zone.Zone
Settings:Edit`, `Zone.Firewall Services:Edit` and `Account.Workers R2
Storage:Edit` — the project's current token carries none of the R2 or
zone-firewall scopes per `wrangler whoami` — plus a gitignored `terraform.tfvars`
holding `cloudflare_api_token`, `account_id`
(`08596e523c096f04b56d7ae43f7821f4`) and `zone_id`. Two workspaces, staging and
prod. Nothing in CI applies it; `terraform init && terraform plan` first.

Consequences carried in `docs/25-go-live-checklist.md` §6 and
`docs/handover/03-operations-runbook.md` §9 (risk register items 7 and 11): WAF
rules, Turnstile and Bot Fight Mode were never applied; the R2 lifecycle
(exports 90d, logs 400d) was never applied; `lyra-files*` is deliberately absent
from the lifecycle config and its versioning must be enabled by hand in the
dashboard.

> **UNVERIFIED — no evidence in repo:** whether R2 versioning on the `FILES`
> bucket was ever enabled.

### 5.8 Observability gaps

`docs/25-go-live-checklist.md` §6: the AI Gateway resource was never provisioned,
and neither Sentry nor Logpush is wired. Worker observability itself is on
(`apps/api/wrangler.jsonc:13`, `apps/web/wrangler.jsonc:13`), so you have Workers
logs and nothing beyond them.

### 5.9 One privilege-reducing change was never applied

`docs/25-go-live-checklist.md` §6 records an unapplied `UPDATE` on
`core_user_roles` id `url_01KE953T02K8D0NXM37R35MW1H`. It reduces a privilege, so
leaving it unapplied leaves the privilege in place.

---

## 6. Summary of unverifiable-from-repo items

These are the go-live blockers in the strict sense: the repo cannot tell you the
answer, so a human must check before the dispatch.

1. Which migrations the production `lyra` D1 has applied (§1.8).
2. Whether production data would fail `0008` / `0009` / `0027` (§1.9, §5.5).
3. Whether the CI `CLOUDFLARE_API_TOKEN` has regained `workers_routes (write)`
   and `zone (read)` (§1.6, §5.3).
4. Whether the production D1 was ever seeded, and whether `seed:history` has run
   against it (§1.11).
5. Whether `wrangler rollback` works on these workers — never exercised (§4.1).
6. Whether R2 versioning is enabled on the `FILES` bucket (§5.7).
7. Whether any production-safe smoke path exists that survives closing the demo
   door (§5.6).
