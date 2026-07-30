# LYRA

LYRA is a multi-tenant, whitelabel AI platform for financial-services
distribution — aggregators, brokers, banks and embedded partners. It replaces
human minutes per transaction, paid acquisition spend and lagging management
information with governed AI on a single data spine (docs/00-vision.md).

Five modules sit on that spine. Each is meant to demo, deploy and bill on its
own; the shared core is not a prerequisite purchase.

| Module | Pillar | Scope |
|---|---|---|
| **AXIS** | AI Operations | Quote-to-bind automation, document intelligence, compliance ops |
| **ORBIT** | AI Customer & Partners | Agentic CX, renewal defence, embedded-insurance partner APIs |
| **SIGNAL** | AI Marketing | Generative creative, audience/LTV intelligence, SEO+AEO, budgets |
| **SCOUT** | AI Products | Whitespace detection, panel/price intelligence, product experiments |
| **NORTH** | AI Insights | Narrated executive briefing, anomalies, simulations, board packs |

One codebase, two deployment homes:

1. **Cloud (primary)** — Cloudflare Workers, D1, KV, R2, Queues, Durable
   Objects, Workflows, Vectorize, Workers AI, AI Gateway. See
   docs/10-deployment-cloudflare.md.
2. **On-prem** — Docker Compose with an internal LLM (vLLM or Ollama),
   libSQL, MinIO, Redis, Qdrant, for tenants requiring data residency. See
   docs/11-deployment-onprem.md.

Capability flags switch the adapters (`RUNTIME=node` on-prem); the domain code
does not branch on which home it is running in.

Security, privacy and AI-governance controls are specified in
docs/12-security-compliance.md. That document is engineering-facing: it names
target regulatory regimes and the controls built for them, and it is explicit
that regulatory positions must be confirmed by counsel. Do not restate it as a
claim of compliance.

> Trademark: LYRA passed preliminary knock-out screening only. Formal registry
> clearance via counsel is required before public launch (docs/23).

## Layout

```
apps/api            Hono on Cloudflare Workers — API gateway + module routers
apps/web            React Router v7 (framework mode) on Workers
packages/core       Domain logic: tenancy, RBAC, audit, events, fixtures
packages/db         Drizzle schema + forward-only migrations (SQLite dialect)
packages/ledger     Double-entry ledger and transaction state machines
packages/model-gateway  LLM provider abstraction + eval suite
packages/ui         Constellation design system
packages/config     Shared eslint / tsconfig
ops/                On-prem Docker stack (compose, Dockerfile, Caddyfile)
.github/workflows/  CI and deploy pipelines
docs/               Specs. Source of truth — the spec wins over the code.
```

Not yet built out: `apps/mobile` (Expo), `apps/agents` (Durable Objects +
Workflows), `packages/sdk`. The target layout is in CLAUDE.md.

pnpm workspaces + turbo. Node 22, TypeScript strict. The pnpm version is
pinned by `packageManager` in the root `package.json` — use `corepack enable`
rather than a global install.

## Run locally

```sh
corepack enable
pnpm install
cp .env.example .env.local     # fill in AUTH_SECRET at minimum
pnpm dev                       # turbo dev -> wrangler dev for apps/api
```

`wrangler dev` runs against local D1/KV/R2 simulators, so no Cloudflare
account is needed for day-to-day work. `GET /health` and `GET /openapi.json`
are the two unauthenticated routes.

Schema changes:

```sh
pnpm db:generate               # drizzle-kit generate, writes packages/db/migrations
LIBSQL_URL=file:./.data/lyra.db pnpm db:migrate
```

Migrations are forward-only. Never edit one that has been applied.

## Run the tests

```sh
pnpm test        # vitest across the workspace
pnpm typecheck   # tsc --noEmit per package
pnpm lint        # eslint per package
pnpm check       # all three, in that order — same gates as CI
```

`pnpm test:watch` is the inner loop. LYRA is built test-first: the method, the
pyramid and the merge gates are in docs/13-testing-quality.md, and the AI
surfaces are eval-first (`packages/model-gateway/evals`).

Known gap: `pnpm lint` currently fails in every package. ESLint 9 resolves its
flat config from the package it is invoked in, and only `packages/config` has
an `eslint.config.js`. Each package needs one re-exporting `@lyra/config/eslint`
before the lint gate can go green.

## Deploy

### Cloudflare

Naming is fixed by the wrangler configs: workers `lyra-api` / `lyra-web` and
`lyra-api-staging` / `lyra-web-staging`, D1 database `lyra` / `lyra-staging`,
migrations read from `packages/db/migrations`.

| Environment | Trigger | Workers | Hosts |
|---|---|---|---|
| staging | push to `main` (automatic) | `lyra-api-staging`, `lyra-web-staging` | api-staging / staging.lyra.vantax.co.za |
| production | `deploy` workflow, manual dispatch | `lyra-api`, `lyra-web` | api.lyra.vantax.co.za, lyra.vantax.co.za |

`.github/workflows/deploy.yml` runs lint/typecheck/test, applies D1 migrations,
then deploys. Production additionally waits on the `production` GitHub
Environment's approval gate. Both need two repository secrets:
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

To deploy by hand from a workstation:

```sh
cd apps/api
pnpm exec wrangler d1 migrations apply lyra-staging --env staging --remote
pnpm exec wrangler deploy --env staging
```

Runtime secrets are set on the worker, not in CI:

```sh
pnpm exec wrangler secret put ANTHROPIC_API_KEY --env staging
pnpm exec wrangler secret put AUTH_SECRET --env staging
```

### On-prem

```sh
cp .env.example .env           # LYRA_DOMAIN, AUTH_SECRET, MINIO_*, RENDER_TOKEN
docker compose -f ops/docker-compose.yml up -d
```

The `migrate` service runs the Drizzle migrations against libSQL before `app`
and `worker` start. Only `caddy` publishes a port; every other service stays on
the internal network. Optional profiles: `--profile gpu` swaps Ollama for vLLM,
`--profile observability` adds the bundled OTEL/Grafana stack.

Upgrades are pull tag → migrate → rolling restart; the app is stateless.

**On-prem status:** `app` and `worker` run on plain Node 22 via
`apps/api/src/node.ts` — the `RUNTIME=node` entrypoint (docs/11 §3). It binds
libSQL instead of D1, an in-process rate counter instead of KV, and the
`files-data` volume instead of R2, then serves the same Hono router; with
`MODE=jobs` it runs the same `scheduled` handler on `CRON_INTERVAL_MS`.
Models already go to the internal `llm` service through the gateway's
`openai-compat` provider, so there is no AI adapter.

Not yet wired to the on-prem twin: `redis` (the KV stand-in is per-container,
so run one `app` replica until it is), `minio` (files land on a shared volume),
`qdrant` and `render`. Each is a stack service with no caller in `apps/api`
today; see the `ponytail:` notes in `apps/api/src/node.ts`.

## Conventions

CLAUDE.md is the operating manual: tenancy, model-gateway-only provider access,
human-in-the-loop on consequential actions, brand tokens over brand strings,
events over cross-module calls, RTL/i18n and accessibility from day one. Read
it before contributing.

---

© goNXT Technology (Pty) Ltd — a Vanta X Holdings company. Confidential.
