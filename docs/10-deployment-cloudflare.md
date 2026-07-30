# 10 — Deployment: Cloudflare

## 1. Accounts & projects

Two Cloudflare accounts: `lyra-staging`, `lyra-prod` (blast isolation).
Workers: `web`, `api`, `agents`, `jobs` (cron), plus `pages-hosted` (tenant
hosted pages). Custom domains per tenant via Cloudflare for SaaS (SSL for
SaaS custom hostnames) → `web` worker; API on `api.lyra.app` + tenant
CNAMEs.

## 2. Bindings (wrangler.jsonc per app — canonical list)

```jsonc
{
  "d1_databases": [{ "binding": "DB", "database_name": "lyra-core" }],
  // dedicated tenant DBs bound dynamically via env service map (registry in KV)
  "kv_namespaces": [{ "binding": "CONFIG" }, { "binding": "CACHE" }],
  "r2_buckets": [{ "binding": "FILES" }, { "binding": "EXPORTS" }, { "binding": "LOGS" }],
  "queues": { "producers": [{ "binding": "EVENTS", "queue": "lyra-events" }],
              "consumers": [{ "queue": "lyra-events", "max_batch_size": 25 }] },
  "durable_objects": { "bindings": [
    { "name": "AGENT_ROOM", "class_name": "AgentRoom" },
    { "name": "RATE", "class_name": "RateCounter" },
    { "name": "REALTIME", "class_name": "UserChannel" },
    { "name": "AIBUDGET", "class_name": "BudgetCounter" } ] },
  "workflows": [{ "binding": "WF", "name": "lyra-workflows" }],
  "ai": { "binding": "AI" },
  "vectorize": [{ "binding": "VEC_KB" }, { "binding": "VEC_MARKET" }, { "binding": "VEC_CONVO" }],
  "analytics_engine_datasets": [{ "binding": "TELEMETRY" }],
  "browser": { "binding": "BROWSER" },
  "assets": { "directory": "./build/client" } // web worker
}
```

Secrets (wrangler secret): `ANTHROPIC_KEY` (via AI Gateway URL), `RESEND_KEY`,
`BSP_*`, `STRIPE_*`, `AUTH_SECRET`, `WEBHOOK_SIGNING_ROOT`. Never in vars.

## 3. AI Gateway

All external model traffic through Cloudflare AI Gateway (`gateway.ai.cloudflare
.com/v1/{acct}/lyra/anthropic`): per-tenant metadata headers for cost
attribution, caching for deterministic calls (extraction prompts), retries,
rate limiting, and full request logging (bodies excluded in prod; hashes only).

## 4. Environments & promotion

`local` → `staging` (auto on main merge) → `prod` (manual approve).
PR = preview deployment (Workers versions + preview URL, seeded sandbox
tenant). Migrations: `wrangler d1 migrations apply` run by CI before deploy;
forward-only; `db:check` job diffs schema drift. Feature flags in KV gate
risky paths; kill switches are flags, deployable-free.

## 5. CI/CD (GitHub Actions)

Jobs: `lint` → `typecheck` → `test` (vitest, workers pool) → `e2e` (Playwright
vs preview) → `build` → `migrate+deploy staging` → smoke suite (synthetic
journeys J-C1, J-O1, J-E1 headless) → manual gate → `prod`. Mobile: EAS build
on tag; OTA update channel per env. SBOM + dependency audit weekly.

## 6. Ops

- Observability: Workers Logs + Logpush→R2 (Parquet), Analytics Engine
  dashboards (in NORTH's platform section), Sentry for web/mobile.
- SLOs: API 99.9%, p95 <150ms non-AI; error budget policy documented in
  runbooks/.
- Backups: D1 time-travel + nightly export to R2 (30d), R2 versioning on
  FILES, KV config snapshot nightly; quarterly restore drill (runbook R-03).
- DR: multi-region by default (Workers); dedicated-D1 tenants: documented
  RPO 24h/RTO 4h v1.
- Rotation: API keys 90d nudge; webhook secrets rotation UI; secrets audit.
- Security headers, WAF managed rules, Turnstile on public forms, bot fight
  on hosted pages.

## 7. Cost guards

Per-tenant AI budget DO (hard stop) · Logpush sampling on verbose categories ·
R2 lifecycle (exports 90d, logs 400d) · alerting on unit-cost drift (cost per
case / per conversation / per brief) in Platform Admin cost explorer.
