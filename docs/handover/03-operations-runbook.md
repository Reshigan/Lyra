# 03 — Operations Runbook

**Audience:** whoever is on call for LYRA. Assumes you have read
[`01-system-overview.md`](01-system-overview.md) and
[`02-environments-and-access.md`](02-environments-and-access.md), and that you
have a terminal, `git`, Node 22 and `pnpm` installed. It assumes **no** prior
knowledge of this codebase.

**What this document is:** the day-2 manual. Deploying, rolling back, touching
the database, watching the system, the jobs that run on their own, the routine
chores, and what to do at 3am.

**A warning about honesty.** Several things this runbook would normally tell you
to do are *not wired up yet* — there is no Sentry project, no Logpush, no AI
Gateway resource, and no alerting of any kind. Those sections say so plainly and
list what the owner has to do. Do not go looking for a dashboard that does not
exist. Every command below has been read out of the repository as it stands at
handover; nothing here is aspirational unless it is explicitly labelled
**OPEN ITEM**.

Describes commit `c7f1f57` on `main` (2026-08-18). Previous revision described
`a295218`/`8afd07d` (2026-08-13); [`README.md` §7](README.md#7-revision-history)
lists what changed in between, and which work is still on unmerged branches.

---

## Contents

1. [Ground rules and prerequisites](#1-ground-rules-and-prerequisites)
2. [Deploying](#2-deploying)
3. [Rollback](#3-rollback)
4. [Database operations](#4-database-operations)
5. [Monitoring and observability](#5-monitoring-and-observability)
6. [Scheduled and background work](#6-scheduled-and-background-work)
7. [Routine maintenance](#7-routine-maintenance)
8. [Incident procedure](#8-incident-procedure)
9. [Consolidated list of open items for the owner](#9-consolidated-list-of-open-items-for-the-owner)

---

## 1. Ground rules and prerequisites

### 1.1 What runs where

| Thing | Production | Staging |
|---|---|---|
| API Worker | `lyra-api` at `https://api.lyra.vantax.co.za` | `lyra-api-staging` at `https://api-staging.lyra.vantax.co.za` |
| Web Worker | `lyra-web` at `https://lyra.vantax.co.za` | `lyra-web-staging` at `https://staging.lyra.vantax.co.za` |
| Database (D1) | `lyra` | `lyra-staging` |
| Event queue | `lyra-events` | `lyra-events-staging` |
| R2 buckets | `lyra-files`, `lyra-exports`, `lyra-logs` | same names with `-staging` |
| Analytics Engine dataset | `lyra_telemetry` | `lyra_telemetry_staging` |
| Cron schedule | every 5 minutes | every 15 minutes |

Source of truth for all of the above: [`apps/api/wrangler.jsonc`](../../apps/api/wrangler.jsonc)
(production is the top-level block, staging is under `env.staging`) and
[`apps/web/wrangler.jsonc`](../../apps/web/wrangler.jsonc).

There is also an **on-prem twin** — the same code on libSQL/Docker — described
in [`docs/11-deployment-onprem.md`](../11-deployment-onprem.md) and driven by
[`ops/docker-compose.yml`](../../ops/docker-compose.yml). Note that
[`CLAUDE.md`](../../CLAUDE.md) still says `infra/onprem/docker-compose.yml`;
that path is stale, the real one is `ops/`.

### 1.2 Tools you need

```bash
node --version    # must be >= 22 (package.json "engines")
pnpm --version    # 9.15.9 is pinned via "packageManager" in package.json
```

Wrangler is **not** installed globally — it is a dev dependency (`^4.120.1`) of
both `apps/api` and `apps/web`. Always invoke it through pnpm so you get the
pinned version:

```bash
cd /path/to/Lyra/apps/api
pnpm exec wrangler whoami
```

`pnpm exec wrangler whoami` prints which Cloudflare account you are on and, more
importantly, **which permissions your token carries**. Read that list before any
deploy — a missing scope is the single most common failure here (see §2.5).

### 1.3 The golden rules

1. **Production deploys run from CI, never from a laptop.** The exception is a
   documented emergency (§2.5), and it is logged as an incident.
2. **Migrations are forward-only.** Never edit a migration that has been applied
   anywhere. To undo, write a new migration. See §4.4.
3. **Never print a secret.** Do not add `set -x`, `echo $SECRET`, or
   `--verbose` to any step that handles a secret. Wrangler secrets are
   write-only by design; if you need to know a value, you rotate it instead of
   reading it.
4. **Do not weaken tenancy, audit or approval flows to unblock someone.** If a
   controller cannot post a journal, the answer is an approval, not a code
   change.

---

## 2. Deploying

### 2.1 Who may deploy

| Target | Who | How |
|---|---|---|
| Local | anyone | `pnpm dev` |
| Staging | anyone who can push to `main` | automatic — every push to `main` runs the `staging` job in [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) |
| Production | a GitHub Environment reviewer (currently **`Reshigan`** only) | manual `workflow_dispatch` on the `deploy` workflow, from `main` only |

The gating is in the workflow file itself:

- the `staging` job is `if: github.event_name == 'push'` and carries
  `environment: staging`;
- the `production` job is `if: github.event_name == 'workflow_dispatch'` and
  carries `environment: production`. Its required-reviewer rule lives in GitHub
  repository settings, not in the repo — that is why nothing in the code stops a
  laptop from deploying, and why rule 1 in §1.3 is a rule rather than a
  mechanism.

### 2.2 CI gates that must be green first

The `deploy` workflow starts with a `checks` job that calls
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) with
`secrets: inherit`. Neither `staging` nor `production` runs unless `checks`
passes. `ci.yml` has five jobs:

| Job | What it runs | Notes |
|---|---|---|
| `check` | `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter @lyra/web build` | The web build is a real gate: typecheck cannot see a server-only module leaking into the client bundle, only the bundler can. |
| `eval` | `pnpm eval` | The AI golden-set evaluation (`packages/model-gateway/evals`). Deterministic, no network. |
| `eval-live` | `pnpm --filter @lyra/model-gateway eval:live` | Calls the real model. Skipped on pull requests (`if: github.event_name != 'pull_request'`) because it costs money and needs credentials that forks do not get. |
| `e2e` | `pnpm exec playwright install --with-deps chromium` then `pnpm e2e` | Playwright journeys. Accessibility (axe-core, WCAG 2.2 AA) runs *inside* these specs via [`e2e/a11y.ts`](../../e2e/a11y.ts) — there is no separate a11y job. On failure it uploads `test-results/` as the `e2e-failures` artifact, 7-day retention. |
| `mutation` | `pnpm mutation` with `STRYKER_SINCE` set to the base ref | Stryker mutation testing on `packages/core` and `packages/model-gateway`, break threshold 70%. Diff-scoped — a whole-tree run takes ~10 hours and gets killed by the runner. |

**Change since the first edition of this pack:** the `e2e` job no longer runs
the journeys against `vite dev`. [`playwright.config.ts`](../../playwright.config.ts)
now builds `apps/web` and serves the built Worker under `wrangler dev`. This is
closer to production and catches server-only-module leaks the dev server hid,
but it means an `e2e` failure can now be a *build* failure wearing an e2e
costume. When `e2e` goes red, read the top of the job log for the build step
before reading the spec failures.

Before a **production** dispatch, additionally confirm by hand:

- staging is actually running the commit you are about to promote (see §2.5 —
  a green `checks` run does **not** currently guarantee this);
- `pnpm smoke:staging` is green (§2.6);
- nothing in [`docs/25-go-live-checklist.md`](../25-go-live-checklist.md) has
  been reopened since the last deploy.

### 2.3 Deploying to staging

Normally you do nothing: merging to `main` deploys staging. What the job runs,
in order, is worth knowing because you may have to reproduce it by hand:

```bash
# from apps/api (the workflow sets working-directory: apps/api)
pnpm exec wrangler d1 migrations apply lyra-staging --env staging --remote
pnpm exec wrangler deploy --env staging

# then, from the repo root
pnpm --filter @lyra/web deploy:staging
```

**Migrations run before the deploy, deliberately.** New code must never meet an
old schema.

The equivalent root-level convenience script exists but skips the migration
step, so it is only safe when you know there is nothing to migrate:

```bash
pnpm deploy:staging
# = pnpm --filter @lyra/api deploy:staging && pnpm --filter @lyra/web deploy:staging
```

Under the hood (`apps/*/package.json`):

- `@lyra/api` `deploy:staging` → `wrangler deploy --env staging`
- `@lyra/web` `deploy:staging` → `CLOUDFLARE_ENV=staging pnpm build && wrangler deploy -c build/server/wrangler.json`

### 2.4 Deploying to production

1. Confirm §2.2.
2. In GitHub → Actions → **deploy** → *Run workflow*, select branch `main`.
   The workflow only accepts `main`.
3. The `production` job pauses for environment approval. A reviewer approves.
4. The job then runs:

```bash
# working-directory: apps/api
pnpm exec wrangler d1 migrations apply lyra --remote
pnpm exec wrangler deploy

# repo root
pnpm --filter @lyra/web run deploy
```

Note the `run` in the last line. `pnpm deploy` without `run` is pnpm's own
built-in `deploy` command and will do something entirely different. This has
bitten before; leave it as written.

5. Verify:

```bash
curl -s https://api.lyra.vantax.co.za/health
# {"ok":true,"environment":"demo","ts":1760000000000}
curl -s -o /dev/null -w '%{http_code}\n' https://lyra.vantax.co.za/login
# 200
```

`"environment":"demo"` is **currently correct and currently a problem** — see
§7.6.

### 2.5 The CI token scope defect (read this before your first deploy)

**Status: OPEN ITEM, live at handover.**

The CI `CLOUDFLARE_API_TOKEN` lost two scopes — `workers_routes (write)` and
`zone (read)`. The `staging` job therefore fails with:

```
A request to the Cloudflare API (/zones/bf309894b764e179f0299ddcc266ca7a/workers/routes) failed.
Authentication error [code: 10000]
```

The consequence is nasty and quiet: **every `checks` run is green, and staging
silently stays several commits behind `main`.** On 2026-08-11 staging was
brought up to date by deploying from the maintainer's local `wrangler` OAuth
session, which does carry both scopes. That was a workaround, not a fix.

**What the owner must do:** re-grant *Zone → Workers Routes → Edit* and
*Zone → Read* on the CI token (or issue a new token with them and update the
`CLOUDFLARE_API_TOKEN` repository secret).

**Until then**, before trusting staging, check what is actually deployed:

```bash
cd apps/api && pnpm exec wrangler deployments list --env staging
```

and compare the version to `git log --oneline -1 main`.

### 2.6 Post-deploy smoke test

```bash
pnpm smoke:staging          # = tsx scripts/lyra.ts staging smoke
```

Implemented in [`scripts/lyra-staging.ts`](../../scripts/lyra-staging.ts). It
runs 12 checks: three unauthenticated (`api:health` expecting 200,
`web:root-redirect` expecting 302, `web:login` expecting 200) and nine
authenticated module reads, logging in through `POST /v1/auth/demo/login`. Exit
code 0 means all 12 returned `ok`. Last recorded green run: 2026-08-10.

There is **no production smoke script.** For production, use the two `curl`
commands in §2.4 plus a manual login. **OPEN ITEM:** a `smoke:prod` equivalent
does not exist, because the demo-login shortcut it relies on must not exist in a
real production tenant.

### 2.7 On-prem deployment

For a customer-hosted install, the sequence lives in
[`scripts/lyra-onprem.ts`](../../scripts/lyra-onprem.ts):

```bash
pnpm lyra onprem init      # writes ops/.env from .env.example, generating AUTH_SECRET,
                           # MINIO_ROOT_PASSWORD and RENDER_TOKEN
pnpm onprem:up             # docker compose -f ops/docker-compose.yml up -d
pnpm lyra onprem migrate
pnpm lyra onprem seed      # optional; --password to set the initial admin password
pnpm lyra onprem smoke
pnpm onprem:down           # tear down
```

Upgrades are: pull the new image tag → `pnpm lyra onprem migrate` → rolling
restart. The compose file will refuse to start without `AUTH_SECRET`,
`APP_ORIGIN`, `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` (hard `:?` failures,
by design).

---

## 3. Rollback

### 3.1 Decide what actually broke

Rollback is three different procedures depending on the layer:

| Symptom | Roll back | Section |
|---|---|---|
| Bad code, schema unchanged | the Worker version | §3.2 |
| Bad code, schema changed | Worker version **and** a forward-fix migration | §3.4 |
| Data damaged, code fine | the database, not the Worker | §3.3 / §4.6 |
| One tenant affected, one feature | a feature flag or the AI kill switch, not a deploy | §3.5 |

Prefer the smallest one that works. A Worker rollback is seconds; a database
restore is not.

### 3.2 Rolling back a Worker

> **Caveat, stated plainly:** the repository contains no record of a Worker
> rollback ever having been performed on this project. The commands below are
> standard Wrangler 4 and the worker names and environments are verified against
> [`apps/api/wrangler.jsonc`](../../apps/api/wrangler.jsonc), but the procedure
> itself is untested here. Rehearse it on staging before you need it in anger —
> that rehearsal is an **OPEN ITEM**.

```bash
cd apps/api

# What is deployed now, and what was deployed before?
pnpm exec wrangler deployments list                 # production
pnpm exec wrangler deployments list --env staging   # staging

# Roll back to a specific earlier version id
pnpm exec wrangler rollback <VERSION_ID>
pnpm exec wrangler rollback <VERSION_ID> --env staging
```

For the web app the config is generated into the build output, so a rollback
must name it:

```bash
cd apps/web
pnpm exec wrangler deployments list -c build/server/wrangler.json
pnpm exec wrangler rollback <VERSION_ID> -c build/server/wrangler.json
```

If `build/` is not present (fresh clone), run `pnpm build` first.

Version ids from past deploys are recorded in
[`docs/25-go-live-checklist.md`](../25-go-live-checklist.md) — for example
`lyra-api-staging` `ff7cdf03-6242-4c43-9f28-7c3c8767ca80` and `lyra-web-staging`
`ab1c26de-8664-4e91-af30-2190973583f7` from 2026-08-11. Keeping that habit up is
worth the thirty seconds.

**Alternative that is always available:** revert the commit on `main` and let
the pipeline deploy the revert. Slower (full CI), but it leaves git and the
running system in agreement, which a `wrangler rollback` does not.

### 3.3 Rolling back a bad migration

**You cannot.** Migrations in LYRA are forward-only by convention
([`CLAUDE.md`](../../CLAUDE.md) §9) and Drizzle's D1 migration runner has no
`down`. There is no `pnpm db:rollback` and adding one would be a mistake.

What to do instead, in order of preference:

1. **Roll the Worker back and leave the schema alone.** Additive migrations —
   a new table, a new nullable column — are almost always backward compatible
   with the previous code. This is the normal answer and it is why additive
   migrations are the house style.

2. **Write a forward-fix migration.** Generate a new migration that undoes the
   damage (drop the column, correct the default, backfill the wrong value) and
   deploy it the ordinary way:

   ```bash
   pnpm db:generate      # after editing packages/db/src/schema
   # review the generated SQL under packages/db/migrations by hand — always
   pnpm db:migrate       # local
   ```

   Then let CI apply it (§2.3/§2.4).

3. **Restore the database** — only if the migration destroyed data. See §4.6.
   This loses every write since the restore point, so it is a last resort and an
   incident (§8).

**Never** edit a migration file that has already been applied to staging or
production. Wrangler tracks applied migrations by filename in D1; editing one
means the two environments disagree about what "applied" means, and the next
`migrations apply` will not fix it.

### 3.4 If code and schema both moved

Deploy order is forward: migrate, then deploy. Rollback order is the reverse and
is therefore only safe if the migration was additive:

1. Roll the Worker back (§3.2).
2. Confirm the old code tolerates the new schema. If it does not — for example
   the migration made a column `NOT NULL` that old code does not write — you are
   in case 3.3(2): write the forward fix, do not try to reverse.

### 3.5 Rollbacks that are not deploys

Often the right "rollback" is a switch, not a deploy:

- **AI misbehaving** — hit the kill switch instead of rolling back:
  `POST /v1/platform/ai/kill` (requires `admin:flags:write`; audited as
  `platform.ai.killed`). Release with `POST /v1/platform/ai/release`. Scope is
  global, per tenant or per module. Blocked calls return **503** and still land
  in `ai_audit_log` with outcome `killed`. See §5.5 and
  [`packages/model-gateway/src/kill.ts`](../../packages/model-gateway/src/kill.ts).
- **A single feature misbehaving** — `PATCH /v1/platform/flags/:id` (feature
  flags live in `core_feature_flags`).
- **Runaway AI spend** — lower the tenant's budget via
  `POST /v1/ai/budget/limits`. `0` turns AI off for that tenant; `null` means
  unlimited.

---

## 4. Database operations

The database is SQLite in both homes: Cloudflare D1 in the cloud, libSQL in the
on-prem container. One Drizzle schema serves both
([`packages/db`](../../packages/db)). Anything that only works on D1 is a bug.

### 4.1 Generating a migration

Edit the schema under `packages/db/src/schema/`, then:

```bash
pnpm db:generate     # = pnpm --filter @lyra/db generate  (drizzle-kit generate)
```

This writes a new SQL file into `packages/db/migrations/`. **Read it.**
drizzle-kit occasionally chooses a table rebuild where you expected an
`ALTER TABLE`; on a large table that is a very different operation. Commit the
generated file with the schema change in the same commit.

**Migration numbers are allocated by whoever generates first, and that collides
across branches.** `main` currently ends at `0024_sharp_hiroim.sql`. Two
unmerged revenue-line branches each generated their own `0025` and `0026`
against that same base, so the second one to merge will carry filenames that
already exist. The fix is done at merge time, not later: renumber the
second branch's files past the first branch's highest number, then re-run
`pnpm db:generate` so the journal matches. **This is only legal because neither
set has ever been applied to any database.** Once a migration has run anywhere —
staging included — it is frozen (§1.3), and the correct response to a collision
becomes a new forward migration, never a rename.

### 4.2 Applying migrations

```bash
pnpm db:migrate      # = pnpm --filter @lyra/db migrate  — local development DB
```

Against Cloudflare, migrations go through Wrangler, and `migrations_dir` in
[`apps/api/wrangler.jsonc`](../../apps/api/wrangler.jsonc) points at
`../../packages/db/migrations`, so these must be run from `apps/api`:

```bash
cd apps/api

# See what is pending — always do this first, it is read-only
pnpm exec wrangler d1 migrations list lyra-staging --env staging --remote
pnpm exec wrangler d1 migrations list lyra --remote

# Apply (CI does this for you; run by hand only when CI cannot)
pnpm exec wrangler d1 migrations apply lyra-staging --env staging --remote
pnpm exec wrangler d1 migrations apply lyra --remote
```

`--remote` is the difference between the real database and a local emulated one.
Omitting it on a production incident call is an easy and confusing mistake.

### 4.3 Inspecting D1

```bash
cd apps/api

# Read-only query against staging
pnpm exec wrangler d1 execute lyra-staging --env staging --remote \
  --command "select count(*) from core_tenants"

# Longer queries from a file
pnpm exec wrangler d1 execute lyra-staging --env staging --remote --file ./query.sql

# Production — treat every one of these as a production change even when SELECT
pnpm exec wrangler d1 execute lyra --remote --command "select code, state from ledger_periods order by code desc limit 6"
```

Useful tables when triaging (all are `tenant_id`-scoped — always filter by it):

| Table | Why you would look |
|---|---|
| `core_event_outbox` | unpublished events (`published_at is null`) |
| `core_event_dlq` | dead-lettered events awaiting replay (`replayed_at is null`) |
| `core_event_inbox` | per-consumer processing status: `done` / `failed` / `dead` |
| `webhook_deliveries` | outbound webhook attempts: `delivered` / `failed` / `dead` / `superseded` |
| `approvals` | anything stuck: `decision = 'pending'` |
| `ai_audit_log` | every model call, with outcome `ok` / `refused` / `error` / `budget_exceeded` / `killed` |
| `ai_budgets` | per tenant/day/module spend counters |
| `ledger_periods` | `open` / `soft_closed` / `hard_closed` per `YYYY-MM` |
| `ledger_client_money_checks` | client-money breaches (`breach = 1 and resolved_at is null`) |
| `core_audit_log` | the hash-chained audit trail |

**Writes against a live database are an incident-grade action.** There is
precedent in this repo (a stray `scope_json` overlay corrected by a one-off
`UPDATE` on 2026-08-10) and it was documented in the go-live checklist as it
happened. Do the same: record the exact statement, the reason and the row ids in
the incident note, and prefer privilege-*reducing* changes.

There is one such statement still pending an owner (see §9).

### 4.4 Seeding

```bash
pnpm seed                 # = pnpm --filter @lyra/core seed — local/dev only
```

Never against production. The demo seed creates the `gonxt` tenant and its
personas; those exist on staging deliberately and are what
`pnpm smoke:staging` and the e2e suite log in as.

### 4.5 On-prem / libSQL equivalents

There is no `wrangler` on-prem. The compose stack runs a one-shot `migrate`
service that executes `pnpm db:migrate` against libSQL, so an upgrade is:

```bash
pnpm lyra onprem migrate
```

For ad-hoc inspection, connect to the libSQL container directly (its health
endpoint is `http://localhost:8080/health`). Backups on-prem are a libSQL
snapshot plus a MinIO mirror to the tenant's own storage, per
[`docs/11-deployment-onprem.md`](../11-deployment-onprem.md).

> **OPEN ITEM.** `docs/11` points at a restore runbook `R-11`. **That file does
> not exist** — [`runbooks/`](../../runbooks) contains only
> [`R-03-restore-drill.md`](../../runbooks/R-03-restore-drill.md) and
> [`slo-error-budget.md`](../../runbooks/slo-error-budget.md). The on-prem
> restore path has never been drilled. Owner action: write and drill it before
> the first on-prem customer goes live.

### 4.6 Backup and restore

Two independent mechanisms, both real and both verified on 2026-08-01 in
[`runbooks/R-03-restore-drill.md`](../../runbooks/R-03-restore-drill.md)
(125 tables, 1,144 rows, both paths PASS):

**(a) D1 Time Travel** — Cloudflare's own point-in-time recovery, 30-day
retention, nothing for us to maintain:

```bash
cd apps/api
pnpm exec wrangler d1 time-travel info lyra-staging --env staging
pnpm exec wrangler d1 time-travel restore lyra-staging --env staging --timestamp <ISO8601>
```

This restores the **whole database**. It is the right tool for "a migration or a
bulk write destroyed everything", and the wrong tool for "one tenant's data is
wrong".

**(b) Nightly per-tenant JSON export** — `backupTenant()` runs inside the cron
window (02:00–02:15 UTC) and writes one object per tenant per day to the
`EXPORTS` R2 bucket:

```bash
cd apps/api
pnpm exec wrangler r2 object get lyra-exports-staging/backups/<tenantId>/<YYYY-MM-DD>.json \
  --file ./restore.json
```

The matching `restoreTenant(ctx, bucket, day)` is deliberately **engine-only —
it is not exposed as an API route.** Restoring a single tenant therefore
requires a developer, on purpose: a one-click tenant restore is a one-click way
to destroy a tenant.

**Retention expectations.** D1 Time Travel is 30 days, fixed by Cloudflare. The
R2 exports were *designed* to age out at 90 days and the logs bucket at 400 days
via lifecycle rules drafted in
[`infra/cloudflare/r2_lifecycle.tf`](../../infra/cloudflare/r2_lifecycle.tf) —
**those rules have never been applied.** Today nothing expires and the bucket
grows forever. **OPEN ITEM.**

**R2 versioning on the `FILES` bucket** is called for in
[`docs/10-deployment-cloudflare.md`](../10-deployment-cloudflare.md) §6 but has
not been confirmed enabled. **OPEN ITEM** — check it in the dashboard.

---

## 5. Monitoring and observability

**Start here: there is no alerting.** Nothing pages anyone. Every mechanism
below is something a human has to go and look at. Building alerting is the
single biggest gap in this section, and it is an **OPEN ITEM** for the owner.

### 5.1 Health endpoints

```bash
curl -s https://api.lyra.vantax.co.za/health
curl -s https://api-staging.lyra.vantax.co.za/health
```

Returns `{ "ok": true, "environment": "...", "ts": <epoch ms> }`
([`apps/api/src/index.ts`](../../apps/api/src/index.ts)). It is a liveness check
only — it does not touch D1, the queue or any provider. A green `/health` with a
broken database is entirely possible.

The web app has no dedicated health route; `GET /login` returning 200 is the
equivalent, and that is what `pnpm smoke:staging` checks.

### 5.2 Logs

`observability: { enabled: true }` is set in both wrangler configs, so
**Workers Logs** is on and retains recent invocations in the Cloudflare
dashboard (Workers & Pages → the worker → Logs).

For live tailing:

```bash
cd apps/api
pnpm exec wrangler tail                    # production
pnpm exec wrangler tail --env staging      # staging
```

What is deliberately logged, and what is not:

- `onError` in [`apps/api/src/mw.ts`](../../apps/api/src/mw.ts) logs **only**
  responses with `status >= 500 && status !== 503`. A 503 is the AI kill switch
  doing its job, not a fault. 4xx are never logged — a user being told "no" is
  not an error.
- `console.error("lyra-events: dropping poison message", { attempts, eventId, error })`
  — a queue message that failed 3 times (`MAX_QUEUE_ATTEMPTS = 3`).
- `console.error("scheduled tick failed for tenant", { tenantId, error })` — a
  cron sweep threw for one tenant. Other tenants continue.
- `console.error("audit chain broken", { tenantId, breaks })` — the daily audit
  anchor found a hash-chain break. **This one is serious.** See §8.3.

Grep the dashboard or `wrangler tail` output for those three strings; they are
the closest thing to an alert catalogue that exists today.

> **OPEN ITEM — Logpush.** [`docs/10`](../10-deployment-cloudflare.md) §6
> specifies Logpush to R2 in Parquet for long-term retention. **It is not
> enabled.** The API token needs `logs:edit` and nobody has configured the job.
> Until then, log retention is whatever Workers Logs keeps (days, not months),
> and you cannot answer a question about last month from logs — only from
> `core_audit_log` and `ai_audit_log`, which are in the database and do persist.

### 5.3 Metrics

Every request writes one Analytics Engine data point, in `withHeaders`
([`apps/api/src/mw.ts`](../../apps/api/src/mw.ts)):

- `blobs`: method, route path, status, tenant id (or `"anonymous"`)
- `doubles`: latency in ms
- `indexes`: tenant id (or `"anonymous"`)

The model gateway writes its own points for AI usage. Datasets are
`lyra_telemetry` and `lyra_telemetry_staging`.

You can query these with SQL from the Cloudflare dashboard's Analytics Engine
section. In-product, the same data surfaces in:

- the **NORTH platform section** of the web app (`/platform`);
- the **cost explorer** at `/admin/cost-explorer`
  ([`apps/web/app/routes/cost-explorer.tsx`](../../apps/web/app/routes/cost-explorer.tsx));
- `GET /v1/platform/slo`.

### 5.4 The operations overview (the one screen worth bookmarking)

```
GET /v1/platform/ops/overview        # requires admin:diagnostics:read
```

Returns, per tenant: `outboxPending`, `dlqDepth`, `pendingApprovals`, plus a
global `lastSnapshotAt`
([`apps/api/src/routes/platform.ts`](../../apps/api/src/routes/platform.ts)).

Read it as:

| Field | Healthy | What a bad number means |
|---|---|---|
| `outboxPending` | small and falling | events are not being drained — the cron is not running, or the queue binding is broken (§6) |
| `dlqDepth` | 0 | events failed 5 times and were dead-lettered. Investigate before replaying (§6.4) |
| `pendingApprovals` | steady | a growing number may just mean an approver is on leave — check before treating it as a fault |
| `lastSnapshotAt` | within ~24h | the nightly NORTH snapshotter has not run |

Also useful: `GET /v1/platform/slo`, `GET /v1/platform/incidents` (kind
`outage`), `GET /v1/platform/deployments`.

### 5.5 AI-specific observability

- `GET /v1/ai/kill-switches` — what is currently paused, and by whom.
- `GET /v1/ai/audit` and `GET /v1/ai/audit/spend` — every model call and its
  cost.
- `GET /v1/ai/budget` — the per-tenant budget position. The counter is a D1 row
  per tenant/day/module
  ([`packages/model-gateway/src/budget.ts`](../../packages/model-gateway/src/budget.ts));
  it warns at 80% (`WARN_AT = 0.8`) and hard-stops at 100% with a **429**
  carrying `retry_after` set to the next UTC midnight.
- `GET /v1/ai/suggestions/acceptance` — whether users are actually taking the
  AI's suggestions. A collapse here is a quality regression that no test will
  catch.

Every model call is written to `ai_audit_log` **before** the kill-switch and
budget checks run, so refused, killed and budget-exceeded calls are all visible
there, not just successful ones.

### 5.6 SLOs and error budget

Defined in [`runbooks/slo-error-budget.md`](../../runbooks/slo-error-budget.md):

| Surface | Target |
|---|---|
| API (non-AI routes) | 99.9% availability, p95 < 150 ms |
| AI routes | 99.5% |
| Web | 99.9% |

Rolling 28-day window. That gives a budget of 40.3 minutes (99.9%) and 3h21m
(99.5%). Burning more than 50% of a budget freezes feature work until
reliability work brings it back — only reliability, bugfix and rollback changes
merge during a freeze.

> **OPEN ITEM.** There is no burn-rate alert. The runbook prescribes a manual
> weekly check against the TELEMETRY dataset. Put it in someone's calendar or it
> will not happen.

### 5.7 What is *not* wired — do not go looking

| Thing | Status |
|---|---|
| **Sentry** (web and mobile error tracking) | No account, no project, **no DSN**. Nothing is wired. `docs/10` §6 describes it as intended, not as built. |
| **Logpush → R2 Parquet** | Not enabled; token lacks `logs:edit`. |
| **AI Gateway** | The `AI_GATEWAY_URL` plumbing exists end-to-end in code, but the `lyra` gateway resource was never provisioned. `wrangler` has no `ai-gateway` subcommand and the current token has no AI Gateway scope. Owner must create it in the dashboard (Account Home → AI → AI Gateway) or reissue the token with *AI Gateway: Edit*. Until then there is no per-provider caching, rate limiting or request log in front of Anthropic. |
| **WAF managed rules, Bot Fight Mode, Turnstile zone settings** | Drafted in `infra/cloudflare/waf.tf` and `infra/cloudflare/turnstile.tf`, **never applied**. Turnstile's application side was wired on 2026-08-11 but stays dormant until `TURNSTILE_SITE_KEY` (a web var) and `TURNSTILE_SECRET` (an API secret) exist. |
| **Any paging/alerting** | None. |
| **Prompt-injection red-team suite (SEC-019)** | The suite exists but has no CI runner. |

---

## 6. Scheduled and background work

### 6.1 The cron tick

One cron trigger drives almost everything:

- production: `*/5 * * * *` (every 5 minutes)
- staging: `*/15 * * * *` (every 15 minutes)

It enters `scheduled()` in [`apps/api/src/index.ts`](../../apps/api/src/index.ts),
which first runs two global housekeeping jobs — `pruneSessions` and
`pruneIdempotency` — and then loops **every tenant**, running each of these
inside its own try/catch:

| Job | What it does |
|---|---|
| `drainOutbox(ctx, env.EVENTS)` | publishes unpublished `core_event_outbox` rows onto the `lyra-events` queue |
| `sweepPolicyLifecycle` | advances policy lifecycle state |
| `sweepRenewals(ctx, env.WF)` | starts a `RenewalWorkflow` instance per due renewal |
| `sweepRouting` | work routing |
| `runBudgetAutopilot` | AI budget autopilot |
| `runDueSchedules(ctx, env.FILES, env.BROWSER)` | scheduled reports/exports, including PDF rendering |
| `expireDelegations` | expires approval delegations that have run out |
| `sweepConversationDrafts(ctx, gatewayFor(env))` | background AI drafting for ORBIT conversations |

A failure in one tenant logs `scheduled tick failed for tenant` and does **not**
stop the others. That is deliberate, and it also means a single tenant can be
quietly broken for a long time. Check the log string, not just the overall
health.

**The order in that table is load-bearing, and the try/catch is what makes it
survivable.** Every sweep in the loop shares one tenant iteration, so an
uncaught throw from an early sweep skips every sweep below it *for that tenant,
that tick*. The classic source is a currency-dependent posting reaching
`fxRateFor()` with no rate configured — the error message is
`no fx rate supplied for <A> -> <B>`. If a tenant reports that "the renewals
stopped" and nothing else changed, look for that string first: the fault is
usually in a sweep that runs *before* renewals, not in renewals.

**Two more sweeps join this loop when the in-flight revenue lines merge**
(see [`README.md` §7](README.md#7-revision-history)):

| Job | Line | Where it slots in | What to watch |
|---|---|---|---|
| `sweepBilling` | F2/F3 — whitelabel billing and data products | with the other billing work | invoices, overages and revenue recognition all post from here; a stalled sweep means unbilled usage, not lost usage |
| `sweepPremiumFinancing` | F4 — premium financing | **between `sweepPolicyLifecycle` and `sweepRenewals`** | it collects due instalments and escalates dunning before renewals look at the same policies |

`sweepPremiumFinancing` has a consequence worth knowing before the first
ticket: **three refused collection attempts on a financing plan lapse the
policy.** It does this by emitting `ledger.financing.lapse_due` onto the event
bus, which cascades into the existing policy-lapse path — the same path a
manual lapse uses. So a customer can lose cover because their debit order
failed three times, and the lapse will look, in the policy's own audit trail,
like an ordinary lapse. The evidence that it was dunning-driven is the
`DUNNING` transaction records on the plan. Reinstating the policy resets the
plan's missed-attempt streak and writes a
`ledger.financing.plan.reinstate` audit row.

### 6.2 The nightly window

Four more jobs run only when the UTC hour is 2 and the minute is under 15
(`isBackupWindow`) — i.e. the 02:00–02:15 UTC ticks:

| Job | What it does | How you know it ran |
|---|---|---|
| `backupTenant(ctx, env.EXPORTS)` | per-tenant JSON backup to R2 | an object at `backups/<tenantId>/<YYYY-MM-DD>.json` |
| `anchorAudit` | verifies and anchors the audit hash chain | absence of `audit chain broken` in the logs |
| `nudgeApiKeyRotation` | notifies the owner of any API key older than 90 days ([`apps/api/src/engines/api-key-rotation.ts`](../../apps/api/src/engines/api-key-rotation.ts)) | a `core.apiKey.rotationDue` notification, deduped so it fires once per key |
| `runSnapshotter` | writes the NORTH daily metric snapshot | `lastSnapshotAt` in `/v1/platform/ops/overview` |

On staging the tick is every 15 minutes, so the window catches one tick per
night. On production it catches three; the jobs are idempotent.

### 6.3 The event queue

Events are written to `core_event_outbox` in the same transaction as the
business change (outbox pattern), then drained onto the Cloudflare queue
`lyra-events` by the cron.

- The queue consumer retries a message up to `MAX_QUEUE_ATTEMPTS = 3`, then logs
  `lyra-events: dropping poison message` and drops it. **There is no Cloudflare
  dead-letter queue configured on the consumer** — the durable record of a
  failed event is the `core_event_dlq` table, not a Cloudflare DLQ.
- On the publish side, `pendingOutbox` dead-letters any outbox row that has
  failed `MAX_ATTEMPTS = 5` times into `core_event_dlq` with
  `consumer = "outbox.publish"`, and stamps `published_at` so it stops blocking
  newer events ([`packages/core/src/events.ts`](../../packages/core/src/events.ts)).
- On the consume side, `consume()` records per-(event, consumer) status in
  `core_event_inbox` (`done` / `failed` / `dead`) and dead-letters after 5
  attempts.

**How to tell it stalled:** `outboxPending` in `/v1/platform/ops/overview` rising
and not falling. Confirm with:

```sql
select count(*) from core_event_outbox where published_at is null;
select created_at, type, attempts, last_error
  from core_event_outbox where published_at is null
  order by created_at limit 20;
```

`last_error` tells you whether the queue binding is failing or a handler is.

### 6.4 Replaying dead-lettered events

Read the DLQ:

```
GET /v1/core/event-dlq          # requires admin:dlq:read
```

> **OPEN ITEM.** `replayDlq()` exists in
> [`packages/core/src/events.ts`](../../packages/core/src/events.ts) and works
> (it clears the inbox marker and re-runs the handler), but **no API route calls
> it.** Replaying a dead event today requires a developer. The DLQ is readable
> by support; it is not actionable by support. Owner action: expose a
> `POST /v1/core/event-dlq/:id/replay` behind `admin:dlq:read` + an approval, or
> accept that DLQ drain is a developer task and staff for it.

### 6.5 Webhook delivery

Outbound webhooks are separate from the internal queue
([`apps/api/src/dispatch.ts`](../../apps/api/src/dispatch.ts)). Delivery is
retried on this schedule:

```
BACKOFF_MS = [0, 30s, 5m, 30m, 2h, 6h]     # MAX_ATTEMPTS = 6
```

Each attempt writes a `webhook_deliveries` row with status `delivered`,
`failed`, or — at attempt 6 — `dead`. Requests carry:

```
x-lyra-event, x-lyra-event-id, x-lyra-timestamp,
x-lyra-signature: v1=<hmac-sha256 of "<timestamp>.<payload>" keyed by the hook secret>
```

with a 10-second timeout. Only `webhooks` rows with `status = 'active'` whose
subscription matches (`*`, an exact type, or a `prefix.*`) are delivered to.

### 6.6 Durable Objects and Workflows

| Binding | Class | One instance per |
|---|---|---|
| `AGENT_ROOM` | `AgentRoom` | ORBIT conversation |
| `RATE` | `RateCounter` | throttle key (login attempts etc.) |
| `REALTIME` | `UserChannel` | user, for server-sent-event push |
| `WF` | `RenewalWorkflow` | renewal row, started by `sweepRenewals` |

Durable Objects have no schedule of their own — they wake when called. A
Workflow instance that is stuck can be inspected in the Cloudflare dashboard
(Workers & Pages → Workflows → `lyra-workflows`).

---

## 7. Routine maintenance

### 7.1 Secret rotation

Policy is **90 days** ([`docs/12-security-compliance.md`](../12-security-compliance.md)).
Worker secrets are set out-of-band and are never GitHub secrets:

```bash
cd apps/api
pnpm exec wrangler secret list                     # names only, never values
pnpm exec wrangler secret list --env staging
pnpm exec wrangler secret put ANTHROPIC_API_KEY                  # production
pnpm exec wrangler secret put ANTHROPIC_API_KEY --env staging
```

The secrets the API expects ([`apps/api/src/env.ts`](../../apps/api/src/env.ts)):

| Secret | Purpose | Safe to rotate? |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic provider | Yes |
| `OPENAI_COMPAT_API_KEY` | OpenAI-compatible / vLLM provider | Yes |
| `FIELD_KEY` | field-level encryption (ADR-0032) | **No — see §7.2** |
| `TURNSTILE_SECRET` | Turnstile verification; its absence means "no challenge" | Yes (not yet set) |

GitHub repository secrets are separate: `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, and optionally `CF_ACCOUNT_ID` / `CF_AI_TOKEN` for the
live-eval job.

> **OPEN ITEM.** Rotation of the Cloudflare API token is overdue, and is tangled
> with the missing scopes in §2.5 — fix both in one pass.

### 7.2 `FIELD_KEY` — the one you must not rotate yet

`FIELD_KEY` encrypts personal data fields at rest. It was set on staging and
production on 2026-08-10 with:

```bash
openssl rand -base64 32 | npx wrangler secret put FIELD_KEY --env staging
```

**There is no key-rotation path.** Changing the value makes every existing
encrypted envelope unopenable — there is no re-wrap job, no key id in the
envelope, no dual-key read window (ADR-0032). If the key must change, someone
has to build re-wrapping first. **OPEN ITEM.**

If the secret is missing entirely, writes fail loudly with
`FIELD_KEY is not configured` (a 500) rather than silently storing data in the
clear. That is deliberate.

### 7.3 API key rotation (tenant-facing)

Tenant API keys are nudged automatically at 90 days (§6.2). The plaintext is
shown **once**, at mint, and never again — `keyHash` is never readable through
the API, because handing it out turns a read permission into an offline guessing
oracle.

```
POST   /v1/core/api-keys        # mint (returns the plaintext once)
DELETE /v1/core/api-keys/:id    # revoke (sets revoked_at; it is not a hard delete)
```

Webhook signing secrets rotate with
`POST /v1/core/webhooks/:id/rotate` (audited as `core.webhooks.rotate`).
`POST /v1/core/webhooks/:id/test` fires a test delivery.

### 7.4 Ledger period close (monthly)

This is a finance activity, but operations gets called when it fails, so know
the shape ([`packages/ledger/src/periods.ts`](../../packages/ledger/src/periods.ts)).

Periods are UTC months (`YYYY-MM`), created automatically on first posting, and
move `open → soft_closed → hard_closed`. You cannot jump straight to
`hard_closed`; the error is exactly:

```
period 2026-07 must be soft closed before it is hard closed
```

Four checks run before a close, each named with the period appended:

| Check | Fails when |
|---|---|
| `trial_balance_zero@YYYY-MM` | base debits ≠ credits |
| `batches_match_lines@YYYY-MM` | a batch header disagrees with its own lines |
| `no_pending_external@YYYY-MM` | transactions still sit in `pending_external` |
| `no_open_client_money_breach@YYYY-MM` | an unresolved client-money breach exists |

Any failure gives `close checks failed: <names>` (409). The close itself is
gated by the approval policy `ledger.period_close`, or
`ledger.period_close_force` when forcing — forcing is a *different* decision
from signing off a clean month and is audited with the failing checks attached.

Endpoints: `POST /v1/ledger/periods/:code/close`,
`POST /v1/ledger/periods/:code/reopen`, `GET /v1/ledger/period/:code`. UI at
`/ledger/period-close`.

Reopening needs `ledger:periods:reopen` plus the `ledger.period_reopen`
approval, and is audited as `ledger.period.reopen`. It is never a side effect of
anything.

### 7.5 Year end

`GET /v1/ledger/year-end/:year` previews, `POST` executes. UI at
`/ledger/year-end`. Preconditions are enforced in
[`packages/ledger/src/preconditions.ts`](../../packages/ledger/src/preconditions.ts)
and produce these exact messages:

```
fiscal year 2026 is already closed
fiscal year 2026 still has open periods: 2026-11, 2026-12
fiscalYear is required
```

So the running order is: close every month first, then run year end. The
year-end close is gated by the `ledger.year_end_close` approval policy.

If balances look wrong, `POST /v1/ledger/balances/rebuild` re-derives the
balances table from journal lines (requires `ledger:journals:post`). It is safe
and idempotent, and it is the standard first move when `trial_balance_zero`
fails.

### 7.6 Retention runs

```
POST /v1/compliance/retention/run    # requires compliance:retention:run
body: { "policyKey": "messages", "dryRun": true }
```

`dryRun` defaults to **true**, because a purge is irreversible and holds no
approval (ADR-0002). Run it dry, read the count, then run it for real.

Only one retention class exists today: `messages` (table `orbit_messages`, floor
24 months). A bad `policyKey` returns
`policyKey must be one of messages`. The effective cutoff is the *later* of the
tenant's configured retention and the class floor — it is never taken from the
request. Legal holds (`compliance_legal_holds`) freeze deletion for their
subject, whether the hold names the conversation or the person.

It purges 500 rows per call (`RETENTION_BATCH`), so **call it repeatedly while
the affected count equals 500.**

Files, `ai_audit` and `consent` are deliberately *not* purgeable: files need the
object store purged alongside the row (unbuilt, PLAT-038), and the other two are
evidence the platform is required to keep.

### 7.7 Production is still in demo mode

**OPEN ITEM, and the highest-priority one in this document.**

`apps/api/wrangler.jsonc` sets `ENVIRONMENT: "demo"` on the *production* worker.
That leaves live on `api.lyra.vantax.co.za`:

- `POST /v1/auth/demo/login` — issues a real session for any seeded persona,
  with `mfaAsserted: true`, no password;
- `POST /v1/auth/demo/clock` — moves the simulated clock by writing KV
  `sim:clock:offsetMs`, which `simNow()` in
  [`apps/api/src/clock.ts`](../../apps/api/src/clock.ts) uses for **every**
  timestamp;
- `POST /v1/auth/demo/seed` — writes tenant data;
- `POST /v1/auth/demo/resync-roles`;
- `POST /v1/signal/demo/spend-tick`;

and all of them are advertised in the published `/openapi.json`.

`demoOnly(env)` closes every one of them the moment `ENVIRONMENT` is
`"production"` — it throws `notFound("route")`. The fix is a one-word edit plus a
deploy, and password sign-in is unaffected either way.

**This must be flipped the day a real tenant lands.** Until then, treat the
production host as a demonstration environment, not as a system holding
customer data.

---

## 8. Incident procedure

### 8.1 Severity

| Sev | Definition | Examples | Response |
|---|---|---|---|
| **Sev-1** | Platform down, data loss or corruption, or a confidentiality breach | `/health` failing; cross-tenant data visible; `audit chain broken`; money posted twice; credentials leaked | Immediate. Wake people. Start the clock on the 72-hour breach notification checklist in [`docs/12`](../12-security-compliance.md) if personal data is involved. |
| **Sev-2** | A module or a whole tenant is unusable, or a control has failed open | ledger postings rejected for everyone; the queue has stalled; a permission grant is wider than intended; a flaky test in CI | Same business day. |
| **Sev-3** | Degraded but usable; a workaround exists | AI budget exhausted for one tenant; one webhook endpoint dead-lettering; slow reports | Next working day. |
| **Sev-4** | Cosmetic or single-user | a mistranslated string; one user's stuck approval | Normal backlog. |

Two standing rules from the build team, inherited:

- **A flaky test is Sev-2.** Quarantine it and fix it within 48 hours
  ([`docs/13-testing-quality.md`](../13-testing-quality.md)). A test nobody
  trusts is worse than no test.
- **Error-budget burn over 50% freezes feature work** until reliability work
  restores it (§5.6).

### 8.2 First 15 minutes

Work top to bottom. Do not skip ahead to a fix.

1. **Declare.** Post in the incident channel: severity, one-line symptom, who is
   leading. If you are alone, you are leading — say so anyway, so the timestamp
   exists.

2. **Establish blast radius — one tenant or all?**
   ```bash
   curl -s https://api.lyra.vantax.co.za/health
   curl -s -o /dev/null -w '%{http_code}\n' https://lyra.vantax.co.za/login
   ```
   Then `GET /v1/platform/ops/overview` and look at whether one tenant's numbers
   are odd or all of them are.

3. **Establish "did we just change something?"**
   ```bash
   cd apps/api && pnpm exec wrangler deployments list
   git log --oneline -10 main
   ```
   Most incidents are the last deploy. If the timing lines up, go to §3.

4. **Look at the logs for the four known strings** (§5.2):
   ```bash
   cd apps/api && pnpm exec wrangler tail
   ```
   `audit chain broken`, `scheduled tick failed for tenant`,
   `lyra-events: dropping poison message`, and any 5xx.

5. **Stop the bleeding with the smallest available lever** (§3.5): kill switch,
   feature flag, budget, or Worker rollback. Prefer a switch over a deploy;
   prefer a deploy over a database write.

6. **Preserve evidence before you fix.** Copy the failing request ids
   (`x-request-id` is on every response), the exact error strings, and the
   relevant `core_audit_log` / `ai_audit_log` rows into the incident note. A
   restore or a rollback destroys the state you will want at the review.

7. **Only then, fix.**

### 8.3 Two specific incidents worth pre-reading

**`audit chain broken`.** The daily anchor found that the hash chain in
`core_audit_log` does not verify for a tenant. This means either a bug wrote
audit rows out of order, or somebody edited the table. It is Sev-1 by default —
the audit trail is the evidence that everything else in the platform is
trustworthy. Do **not** "fix" the chain. Capture it, escalate to the platform
owner, and preserve the rows.

**Client-money breach.** Every ledger posting runs `clientMoneyCheck`
([`packages/ledger/src/posting.ts`](../../packages/ledger/src/posting.ts)). If
client-money assets fall below the corresponding liability it writes an evidence
row to `ledger_client_money_checks` and *then* throws:

```
client money shortfall of 12345 AED: asset 100000 < liability 112345
```

The evidence row is written **before** the throw, on purpose — the breach is
recorded even though the posting is rejected. This is a regulatory matter, not
just a failed request: escalate to finance and compliance the same day, and do
not attempt to make the posting succeed. It will also block the month-end close
via `no_open_client_money_breach` until it is resolved.

### 8.4 Communications

- **Internal:** the incident channel, updated at least every 30 minutes for a
  Sev-1 even when the update is "still investigating".
- **Tenant-facing:** `GET /v1/platform/incidents` (kind `outage`) is the
  in-product incident surface. **OPEN ITEM:** there is no external status page
  and no automated customer notification; today, telling customers is a manual
  act by the account owner.
- **Regulatory:** if personal data may have been exposed, the 72-hour
  notification checklist in [`docs/12`](../12-security-compliance.md) starts
  from *discovery*, not from resolution. Start it in parallel with the technical
  work, not after.

### 8.5 After the incident

Within five working days:

1. Write the timeline — detection, diagnosis, mitigation, resolution — with real
   timestamps.
2. **Write the failing regression test first.** House rule: bugs reproduce
   before they die ([`CLAUDE.md`](../../CLAUDE.md) §5). The test is named after
   the incident and lands before the fix.
3. Record any decision that changes how the system is built as an ADR in
   [`docs/decisions/`](../decisions/).
4. Update this runbook if the procedure you actually followed differs from the
   one written here. A runbook that lied once will be ignored forever.

---

## 9. Consolidated list of open items for the owner

Everything below is a real gap at handover, not a caveat. Ordered by what will
hurt first.

| # | Item | Where |
|---|---|---|
| 1 | **Production runs `ENVIRONMENT: "demo"`** — the demo login, seed and clock-shift routes are live on `api.lyra.vantax.co.za`. Flip before the first real tenant. | §7.7 |
| 2 | **CI token lost `workers_routes (write)` and `zone (read)`** — staging silently stops updating behind green checks. | §2.5 |
| 3 | **No alerting of any kind**, and no Sentry project/DSN. Every check in §5 is manual. | §5, §5.7 |
| 4 | **R2 lifecycle rules never applied** — exports and logs never expire. Terraform is drafted in `infra/cloudflare/r2_lifecycle.tf`. | §4.6 |
| 5 | **Logpush not enabled** — log retention is days, not months. Needs `logs:edit` on the token. | §5.2 |
| 6 | **AI Gateway resource never provisioned** — code plumbing is complete and waiting. | §5.7 |
| 7 | **WAF / Bot Fight / Turnstile zone settings never applied**; `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` unset. | §5.7 |
| 8 | **`FIELD_KEY` cannot be rotated** — no re-wrap path exists (ADR-0032). | §7.2 |
| 9 | **Cloudflare API token rotation overdue** (90-day policy). | §7.1 |
| 10 | **DLQ replay has no route** — `replayDlq()` is developer-only. | §6.4 |
| 11 | **Worker rollback never rehearsed** on this project. Drill it on staging. | §3.2 |
| 12 | **On-prem restore runbook `R-11` does not exist** and the path has never been drilled. | §4.5 |
| 13 | **No production smoke script**, because the demo-login shortcut it would use must not exist in production. | §2.6 |
| 14 | **No SLO burn-rate alert** — weekly manual check prescribed. | §5.6 |
| 15 | **R2 versioning on `FILES` unconfirmed.** | §4.6 |
| 16 | **Pending privilege-reducing SQL** on `core_user_roles` id `url_01KE953T02K8D0NXM37R35MW1H` (an `axis.agent` grant that is tenant-wide instead of team-scoped, from a since-fixed seed bug). The exact statement is in [`docs/25-go-live-checklist.md`](../25-go-live-checklist.md); it is blocked on the account owner running it. | §4.3 |
| 17 | **Prompt-injection red-team suite (SEC-019) has no CI runner.** | §5.7 |
| 18 | **Arabic native-speaker review of the `ar` catalogue** is outstanding. | — |
