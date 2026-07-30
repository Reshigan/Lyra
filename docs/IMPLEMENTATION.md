# LYRA — Implementation Guide for VS Code + Claude Code

**One document to go from empty folder → running, test-driven monorepo.**

This is the hands-on companion to the spec pack (`LYRA_Build_Pack.zip`).
The pack tells Claude Code *what* to build and *why*; this document gives you
the exact files, commands, and prompts to *start building it today*, test-first,
in the M0 order defined in `docs/14-roadmap.md`.

How to use it:
1. Create an empty repo, drop the `LYRA_Build_Pack.zip` contents in (so
   `CLAUDE.md` and `/docs` sit at the root).
2. Add this file as `docs/IMPLEMENTATION.md`.
3. Create the files in §3 exactly as written (or paste the prompt in §6.1 and
   let Claude Code create them, then review against §3).
4. Run the commands in §4. You should reach a **red** test suite — that is
   correct; M0 is about making it green.
5. Work the prompts in §6 one at a time. Never start a prompt while the
   previous one's tests are red unless the prompt is "make them green."

Live target: **lyra.vantax.co.za** (domain topology in docs/24 §2; deploy in P0.4).

Contents: §1 prerequisites · §2 repo tree · §3 the actual files · §4 commands
· §5 the failing M0 acceptance tests · §6 Claude Code prompt playbook · §7
VS Code setup · §8 environment & secrets · §9 troubleshooting · §10 the
"definition of done" gate.

---

## 1. Prerequisites

- **Node 22+** (`node -v`), **pnpm 9+** (`corepack enable && corepack prepare pnpm@9.12.0 --activate`).
- **Cloudflare account** (free tier is fine to start) + **Wrangler** (`pnpm dlx wrangler login`).
- **Docker Desktop** (only needed later for the on-prem twin / local Postgres-free stack).
- **VS Code** with the extensions in §7.1.
- **Claude Code** (`npm i -g @anthropic-ai/claude-code`) or the Claude Code
  view inside VS Code. Point it at the repo root so it reads `CLAUDE.md`.
- An **Anthropic API key** for the model gateway (added as a secret, never in code — see §8).

---

## 2. Repository tree (M0 target)

You are creating this. Files marked ✎ are given verbatim in §3; the rest are
created by Claude Code against the specs during the prompts in §6.

```
lyra/
├─ CLAUDE.md                      ← from the pack (operating manual)
├─ package.json                   ✎ root workspace + turbo scripts
├─ pnpm-workspace.yaml            ✎
├─ turbo.json                     ✎
├─ tsconfig.base.json             ✎
├─ vitest.workspace.ts            ✎
├─ .gitignore                     ✎
├─ .editorconfig                  ✎
├─ .env.example                   ✎ (never commit real .env)
├─ .vscode/
│  ├─ settings.json               ✎
│  ├─ extensions.json             ✎
│  └─ launch.json                 ✎
├─ .github/workflows/ci.yml       ✎ CI gate (lint→typecheck→test→e2e)
├─ docs/                          ← from the pack + this file
├─ packages/
│  ├─ config/                     ✎ shared tsconfig/eslint presets
│  │  ├─ package.json             ✎
│  │  └─ tsconfig.json            ✎
│  ├─ db/                         ← Drizzle schema + migrations
│  │  ├─ package.json             ✎
│  │  ├─ drizzle.config.ts        ✎
│  │  └─ src/
│  │     ├─ schema.ts             ✎ core_ tables (M0 subset)
│  │     ├─ json.ts               ✎ zod shapes for JSON columns
│  │     └─ index.ts              ✎ db factory (D1 + libSQL)
│  └─ core/                       ← domain logic
│     ├─ package.json             ✎
│     └─ src/
│        ├─ tenancy.ts            ✎ withTenant guard
│        ├─ tenancy.test.ts       ✎ FAILING first (unit)
│        ├─ rbac.ts               ✎ permission bundles (M0 subset)
│        └─ index.ts              ✎
├─ apps/
│  ├─ api/                        ← Hono on Workers (API gateway)
│  │  ├─ package.json             ✎
│  │  ├─ wrangler.jsonc           ✎ bindings (D1/KV/R2/Queues stubs)
│  │  ├─ vitest.config.ts         ✎ workers pool
│  │  └─ src/
│  │     ├─ index.ts              ✎ app + /health + tenancy middleware
│  │     └─ index.test.ts         ✎ FAILING first (integration)
│  └─ web/                        ← React Router v7 (added in prompt 6.5)
│     └─ (scaffolded by Claude Code)
├─ tests/e2e/
│  └─ m0.spec.ts                  ✎ FAILING first (journey J-A2)
└─ infra/onprem/                  ← docker-compose (added in M6 prompt)
```

---

## 3. The files (create these verbatim)

> These are intentionally minimal but **real** — they install, typecheck and
> run. They encode the pack's non-negotiables (tenancy, SQLite-dialect,
> test-first) so Claude Code extends a correct skeleton instead of inventing one.

### 3.1 `package.json` (root)
```json
{
  "name": "lyra",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "db:generate": "pnpm --filter @lyra/db generate",
    "db:migrate": "pnpm --filter @lyra/db migrate",
    "onprem:up": "docker compose -f infra/onprem/docker-compose.yml up -d",
    "check": "pnpm lint && pnpm typecheck && pnpm test"
  },
  "devDependencies": {
    "turbo": "^2.1.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@vitest/coverage-v8": "^2.1.0",
    "@playwright/test": "^1.47.0"
  }
}
```

### 3.2 `pnpm-workspace.yaml`
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### 3.3 `turbo.json`
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".wrangler/**"] },
    "dev": { "cache": false, "persistent": true },
    "test": { "dependsOn": ["^build"] },
    "lint": {},
    "typecheck": { "dependsOn": ["^build"] },
    "e2e": { "dependsOn": ["^build"], "cache": false }
  }
}
```

### 3.4 `tsconfig.base.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "declaration": true,
    "composite": true,
    "esModuleInterop": true,
    "types": []
  }
}
```

### 3.5 `vitest.workspace.ts`
```ts
export default ["packages/*/vitest.config.ts", "apps/*/vitest.config.ts"];
```

### 3.6 `.gitignore`
```
node_modules
dist
.wrangler
.turbo
coverage
.env
.env.*
!.env.example
*.local
.DS_Store
playwright-report
test-results
```

### 3.7 `.editorconfig`
```
root = true
[*]
charset = utf-8
indent_style = space
indent_size = 2
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
```

### 3.8 `.env.example`
```
# Copy to .env.local for local dev. NEVER commit real values.
ENVIRONMENT=local
# Model gateway (added in M1). Use Cloudflare AI Gateway URL in staging/prod.
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_API_KEY=sk-ant-REPLACE_ME
# Auth
AUTH_SECRET=generate-a-long-random-string
# On-prem/local libSQL (optional in M0; D1-local is default)
LIBSQL_URL=file:./.data/lyra.db
```

### 3.9 `packages/config/package.json`
```json
{
  "name": "@lyra/config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { "./tsconfig.json": "./tsconfig.json" }
}
```

### 3.10 `packages/config/tsconfig.json`
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "composite": false } }
```

### 3.11 `packages/db/package.json`
```json
{
  "name": "@lyra/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "generate": "drizzle-kit generate",
    "migrate": "drizzle-kit migrate",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint src"
  },
  "dependencies": {
    "drizzle-orm": "^0.36.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.28.0",
    "@libsql/client": "^0.14.0",
    "@lyra/config": "workspace:*",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

### 3.12 `packages/db/drizzle.config.ts`
```ts
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "sqlite",       // D1 (cloud) and libSQL (on-prem) share this dialect
  dbCredentials: { url: process.env.LIBSQL_URL ?? "file:./.data/lyra.db" }
} satisfies Config;
```

### 3.13 `packages/db/src/json.ts`
```ts
import { z } from "zod";

// Zod shapes for TEXT-as-JSON columns. Extend per docs/03 as modules land.
export const BrandJson = z.object({
  name: z.string(),
  logo: z.object({ light: z.string(), dark: z.string(), mark: z.string() }).partial(),
  palette: z.object({ accent: z.string(), accentHover: z.string() }).partial(),
  domain: z.string().optional()
});
export type BrandJson = z.infer<typeof BrandJson>;

export const PolicyJson = z.object({
  autoApprove: z.array(z.string()).default([]),
  aiBudgetDailyTokens: z.number().int().nonnegative().default(0),
  locales: z.array(z.string()).default(["en", "ar"]),
  dataResidency: z.enum(["cloud", "in-region", "on-prem"]).default("cloud")
});
export type PolicyJson = z.infer<typeof PolicyJson>;

export const NameJson = z.object({ en: z.string(), ar: z.string().optional() });
export const PurposesJson = z.object({
  marketing: z.boolean().default(false),
  profiling: z.boolean().default(false),
  dataSharing: z.boolean().default(false),
  crossBorder: z.boolean().default(false)
});
```

### 3.14 `packages/db/src/schema.ts` (M0 core subset)
```ts
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// Convention (docs/03): id = ULID text PK; tenant_id on every table;
// timestamps epoch ms; soft delete via deleted_at. JSON columns are TEXT.

export const tenants = sqliteTable("core_tenants", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("standard"),
  region: text("region").notNull().default("auto"),
  status: text("status").notNull().default("active"),
  brandJson: text("brand_json"),
  policyJson: text("policy_json"),
  entitlementsJson: text("entitlements_json"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const users = sqliteTable("core_users", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  name: text("name").notNull(),
  locale: text("locale").notNull().default("en"),
  status: text("status").notNull().default("invited"),
  authProvider: text("auth_provider").notNull().default("password"),
  mfaEnrolled: integer("mfa_enrolled", { mode: "boolean" }).notNull().default(false),
  lastSeenAt: integer("last_seen_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at")
}, (t) => ({ byTenant: index("core_users_tenant_idx").on(t.tenantId, t.email) }));

export const roles = sqliteTable("core_roles", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  permissionsJson: text("permissions_json").notNull(),
  createdAt: integer("created_at").notNull()
}, (t) => ({ byTenant: index("core_roles_tenant_idx").on(t.tenantId, t.key) }));

export const userRoles = sqliteTable("core_user_roles", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  userId: text("user_id").notNull(),
  roleId: text("role_id").notNull(),
  scopeJson: text("scope_json"),
  createdAt: integer("created_at").notNull()
}, (t) => ({ byTenant: index("core_user_roles_tenant_idx").on(t.tenantId, t.userId) }));

export const auditLog = sqliteTable("core_audit_log", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  actorRef: text("actor_ref").notNull(),
  action: text("action").notNull(),
  subjectRef: text("subject_ref"),
  beforeHash: text("before_hash"),
  afterHash: text("after_hash"),
  ip: text("ip"),
  ua: text("ua"),
  ts: integer("ts").notNull()
}, (t) => ({ byTenant: index("core_audit_tenant_idx").on(t.tenantId, t.ts) }));

export const schema = { tenants, users, roles, userRoles, auditLog };
```

### 3.15 `packages/db/src/index.ts`
```ts
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { schema } from "./schema";

// Cloud: pass a D1Database to drizzle(d1, { schema }) from the Worker.
// Local/on-prem: libSQL via file/remote URL. Same schema, same queries.
export function makeDb(url = process.env.LIBSQL_URL ?? "file:./.data/lyra.db") {
  const client = createClient({ url });
  return drizzle(client, { schema });
}
export type Db = ReturnType<typeof makeDb>;
export { schema };
export * from "./json";
```

### 3.16 `packages/core/package.json`
```json
{
  "name": "@lyra/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint src"
  },
  "dependencies": { "@lyra/db": "workspace:*", "zod": "^3.23.0" },
  "devDependencies": {
    "@lyra/config": "workspace:*",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

### 3.17 `packages/core/src/tenancy.ts`
```ts
// The single tenancy guard. CLAUDE.md rule 1: every query goes through this.
// Adds an eq(tenant_id) filter and forbids cross-tenant subject access.

import { and, eq, type SQL } from "drizzle-orm";

export type TenantId = string & { readonly brand: unique symbol };
export const asTenantId = (s: string) => s as TenantId;

export class CrossTenantError extends Error {
  constructor(msg = "cross-tenant access denied") { super(msg); this.name = "CrossTenantError"; }
}

/** Compose a tenant filter with any additional predicate. */
export function tenantWhere(column: any, tenantId: TenantId, extra?: SQL): SQL {
  const base = eq(column, tenantId as unknown as string);
  return extra ? (and(base, extra) as SQL) : base;
}

/** Assert a fetched row (or rows) belong to the tenant; throw otherwise. */
export function assertTenant<T extends { tenantId: string }>(tenantId: TenantId, row: T | T[] | undefined): void {
  if (!row) return;
  const rows = Array.isArray(row) ? row : [row];
  for (const r of rows) if (r.tenantId !== (tenantId as unknown as string)) throw new CrossTenantError();
}
```

### 3.18 `packages/core/src/tenancy.test.ts` (RED first)
```ts
import { describe, it, expect } from "vitest";
import { asTenantId, assertTenant, tenantWhere, CrossTenantError } from "./tenancy";

describe("tenancy guard", () => {
  it("passes rows that match the tenant", () => {
    const t = asTenantId("t_alpha");
    expect(() => assertTenant(t, [{ tenantId: "t_alpha" }, { tenantId: "t_alpha" }])).not.toThrow();
  });

  it("throws CrossTenantError on a foreign row", () => {
    const t = asTenantId("t_alpha");
    expect(() => assertTenant(t, { tenantId: "t_beta" })).toThrow(CrossTenantError);
  });

  it("builds a where clause (smoke)", () => {
    const t = asTenantId("t_alpha");
    // Using a stand-in column object; real column comes from schema in integration tests.
    const clause = tenantWhere({ name: "tenant_id" } as any, t);
    expect(clause).toBeDefined();
  });
});
```

### 3.19 `packages/core/src/rbac.ts` (M0 subset)
```ts
// Permission strings: "module:resource:action" (docs/04 §3).
// M0 ships platform + tenant admin bundles; modules extend later.

export type Permission = string;

export const BUNDLES: Record<string, Permission[]> = {
  "platform.admin": ["platform:*:*"],
  "tenant.admin": [
    "core:users:read", "core:users:create", "core:users:update",
    "core:roles:read", "core:roles:assign",
    "core:brand:update", "core:policy:update"
  ],
  "tenant.compliance": ["core:audit:read", "core:audit:export", "core:consent:read"]
};

export function permissionsFor(roleKeys: string[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const k of roleKeys) for (const p of BUNDLES[k] ?? []) out.add(p);
  return out;
}

/** Wildcards: "core:users:read" is granted by "core:users:*" or "core:*:*" or "platform:*:*". */
export function can(perms: Set<Permission>, needed: Permission): boolean {
  if (perms.has(needed)) return true;
  const [m, r] = needed.split(":");
  return perms.has(`${m}:${r}:*`) || perms.has(`${m}:*:*`) || perms.has(`platform:*:*`);
}
```

### 3.20 `packages/core/src/index.ts`
```ts
export * from "./tenancy";
export * from "./rbac";
```

### 3.21 `apps/api/package.json`
```json
{
  "name": "@lyra/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "build": "wrangler deploy --dry-run --outdir dist",
    "deploy:staging": "wrangler deploy --env staging",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint src"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "@lyra/core": "workspace:*",
    "@lyra/db": "workspace:*",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "wrangler": "^3.80.0",
    "@cloudflare/workers-types": "^4.20240909.0",
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@lyra/config": "workspace:*",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

### 3.22 `apps/api/wrangler.jsonc`
```jsonc
{
  "name": "lyra-api",
  "main": "src/index.ts",
  "compatibility_date": "2024-09-23",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  // M0: D1 local binding. KV/R2/Queues/DO added per docs/10 in later milestones.
  "d1_databases": [
    { "binding": "DB", "database_name": "lyra-core", "database_id": "local" }
  ],
  "env": {
    "staging": { "vars": { "ENVIRONMENT": "staging" } },
    "production": { "vars": { "ENVIRONMENT": "production" } }
  }
}
```

### 3.23 `apps/api/src/index.ts`
```ts
import { Hono } from "hono";
import { asTenantId } from "@lyra/core";

type Bindings = { DB: D1Database; ENVIRONMENT?: string };
type Vars = { tenantId: ReturnType<typeof asTenantId> };

const app = new Hono<{ Bindings: Bindings; Variables: Vars }>();

// Tenancy middleware (M0 stub): resolve tenant from header; real resolution
// (hostname → KV registry) lands in M1 per docs/02 §2.
app.use("*", async (c, next) => {
  const t = c.req.header("x-lyra-tenant") ?? "t_aldebaran";
  c.set("tenantId", asTenantId(t));
  await next();
});

app.get("/health", (c) =>
  c.json({ ok: true, service: "lyra-api", env: c.env.ENVIRONMENT ?? "local", ts: Date.now() })
);

app.get("/v1/whoami", (c) => c.json({ tenantId: c.get("tenantId") }));

export default app;
```

### 3.24 `apps/api/vitest.config.ts`
```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: { wrangler: { configPath: "./wrangler.jsonc" } }
    }
  }
});
```

### 3.25 `apps/api/src/index.test.ts` (RED first)
```ts
import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import app from "./index";

describe("api gateway (M0)", () => {
  it("health returns ok", async () => {
    const res = await app.request("/health", {}, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("defaults the tenant when header absent", async () => {
    const res = await app.request("/v1/whoami", {}, env);
    const body = await res.json();
    expect(body.tenantId).toBe("t_aldebaran");
  });

  it("honours the tenant header", async () => {
    const res = await app.request("/v1/whoami", { headers: { "x-lyra-tenant": "t_alpha" } }, env);
    const body = await res.json();
    expect(body.tenantId).toBe("t_alpha");
  });
});
```

### 3.26 `.github/workflows/ci.yml`
```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request: {}
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.12.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      # e2e added in M0 close (needs web app); keep as a separate gated job then.
```

### 3.27 `tests/e2e/m0.spec.ts` (RED first — journey J-A2)
```ts
import { test, expect } from "@playwright/test";

// J-A2 "New teammate": a tenant admin invites a user and the role takes effect.
// This is intentionally failing until apps/web login + admin land (prompt 6.5/6.6).
test.skip("J-A2 admin invites a teammate and role applies", async ({ page }) => {
  await page.goto("/");                              // web app not built yet
  await page.getByRole("button", { name: "Sign in" }).click();
  // ...fill seeded tenant.admin creds, invite user, assign role, assert access
  expect(true).toBe(true);
});
```
> Note the `test.skip`: e2e is defined now but unskipped when the web app
> exists (prompt 6.6). The unit + integration tests above are **not** skipped —
> they are your first real red→green loop.

---

## 4. Commands — from files to a running loop

```bash
# 1. install
corepack enable && corepack prepare pnpm@9.12.0 --activate
pnpm install

# 2. generate the first migration from the schema
pnpm db:generate            # writes packages/db/migrations/0000_*.sql

# 3. run unit + integration tests (EXPECT RED, then make green)
pnpm test                   # packages/core + apps/api

# 4. run the API locally
pnpm --filter @lyra/api dev     # wrangler dev → http://localhost:8787/health

# 5. full gate (what CI runs)
pnpm check                  # lint + typecheck + test
```

Expected M0 progression: after creating §3 files, `pnpm test` should pass the
tenancy and API tests (they're written to pass against the given code — that
proves the harness works). Your *next* red tests come from prompt 6.3 onward
(RBAC edge cases, DB integration, auth), which you make green in TDD loops.

---

## 5. The failing acceptance suite that defines "M0 done"

Per `docs/14-roadmap.md`, M0 closes when these are green. Encode each as a
test **before** building the feature (that is the TDD contract in `CLAUDE.md`):

- `@accept:M0-login` — a seeded `tenant.admin` can sign in (integration + e2e).
- `@accept:M0-rbac` — `can()` grants/denies correctly across wildcard bundles
  (unit; extend `rbac.test.ts`).
- `@accept:M0-tenancy` — a cross-tenant read throws `CrossTenantError` and the
  API returns 404/403 (integration against real schema + D1-local).
- `@accept:M0-createuser` — admin creates a user; role assignment is visible on
  next request (integration + e2e J-A2).
- `@accept:M0-rtl` — the web shell renders a pseudo-locale + RTL without layout
  break (Playwright screenshot).
- `@accept:M0-ci` — `pnpm check` is green in GitHub Actions.

When all six are green, tag `m0-complete` and move to M1 (prompt 6.7).

---

## 6. Claude Code prompt playbook

Feed these one at a time from the repo root. Each assumes Claude Code has read
`CLAUDE.md` and the referenced docs. **Review every diff against §3 and the
specs before accepting.** Keep the loop tight: prompt → red tests → green →
refactor → commit.

### 6.0 Orient
```
Read CLAUDE.md in full, then docs/14-roadmap.md (M0 only) and docs/13-testing-quality.md.
Summarise the M0 acceptance checklist as a list of failing tests you will create,
mapping each to a file path. Do not write code yet — just the test plan.
```

### 6.1 Scaffold (if you didn't paste §3 by hand)
```
Create the M0 repository skeleton exactly as specified in docs/IMPLEMENTATION.md §3.
Use pnpm workspaces + turbo, Node 22, TypeScript strict. Do not add dependencies
beyond those listed. After creating files, run `pnpm install` and `pnpm typecheck`
and fix only type errors you introduced. Show me the tree and the typecheck output.
```

### 6.2 Prove the harness
```
Run `pnpm test`. Confirm packages/core/src/tenancy.test.ts and
apps/api/src/index.test.ts pass. If anything is red, fix the implementation
(not the tests) until green. Report results.
```

### 6.3 RBAC — TDD
```
TDD. First write packages/core/src/rbac.test.ts covering: exact-match grant,
"module:resource:*" wildcard, "module:*:*" wildcard, "platform:*:*" superuser,
and explicit deny (permission absent). Run it — it must fail where behaviour is
missing. Then extend rbac.ts minimally to pass. Refactor. Keep BUNDLES aligned
with docs/06 §1 (M0 subset only). Do not add roles beyond platform.admin,
tenant.admin, tenant.compliance yet.
```

### 6.4 DB integration + tenancy for real — TDD
```
TDD. Add packages/db/src/schema.test.ts (vitest) that spins up an in-memory
libSQL, applies migrations, inserts two tenants and users in each, and asserts:
(a) a tenant-scoped select returns only that tenant's users, (b) assertTenant
throws on a foreign row. Write the test first (red), then implement a small
query helper in packages/core (e.g. listUsers(db, tenantId)) that uses
tenantWhere. Green, then refactor. This satisfies @accept:M0-tenancy.
```

### 6.5 Web shell (React Router v7 on Workers)
```
Create apps/web using React Router v7 (framework mode) targeting Cloudflare
Workers, per docs/02 and docs/07. Implement: the app shell (left rail with the
5 module glyphs from docs/01 §5, top bar with tenant mark + ⌘K stub), a login
route (email+password via better-auth), and i18n scaffolding (en + ar) using
logical CSS properties only. Wire Constellation tokens from docs/01 §3 as
CSS variables (tokens.css). Add a pseudo-locale build flag. Provide a Storybook
(or a /playground route) with the first 10 core components listed in docs/07 §2.
Do NOT hard-code the brand name — read brand.* from tenant config (CLAUDE.md
rule 5). Add vitest.config.ts and a smoke test. Show me the routes and tokens.
```

### 6.6 Auth + admin + seed — TDD, then unskip e2e
```
TDD. 1) Implement better-auth email+password against core_users with sessions.
2) Build Tenant Admin "People & roles": invite user, assign role bundle,
deactivate. 3) Write the Aldebaran seed (packages/core/fixtures) creating tenant
"Aldebaran Insurance", one tenant.admin, and the three M0 roles — deterministic
by seed. 4) Now unskip tests/e2e/m0.spec.ts and implement J-A2 end-to-end
(admin logs in, invites a teammate, assigns tenant.compliance, asserts the new
user sees audit read but not user-create). Add @accept:M0-login and
@accept:M0-createuser integration tests. Everything green before you stop.
```

### 6.7 Close M0, open M1
```
Run `pnpm check` and the e2e suite. Confirm all six @accept:M0-* items are green
and the cross-tenant test fails correctly. Write docs/decisions/ADR-0001 recording
the M0 stack choices. Then read docs/14-roadmap.md M1 and produce the M1 failing
acceptance suite (audit log + export, consent ledger + suppression event, event
bus + DLQ, model-gateway with eval harness, Tenant/Platform admin v1, Dev portal
v1) as a test plan mapped to files. Do not implement M1 yet.
```

### 6.8 Model gateway — eval-first (M1)
```
EDD (docs/13 §3). Before any prompt: create packages/model-gateway with the
ModelRequest/ModelResponse interface (docs/02 §5), adapters for workers-ai,
anthropic (via AI Gateway), and openai-compat (on-prem). Author evals/
extraction/{en,ar} golden sets with thresholds.json FIRST (field-F1 >= 0.95).
Wire the eval runner into `pnpm test`. Only then implement the adapters and a
budget-counter Durable Object. The eval is the failing test; make it pass on a
pinned model. Log every call to ai_audit_log.
```

> Continue this pattern for M2–M6 using each module spec's §8 acceptance
> criteria and the journey IDs in docs/06 as the failing tests. The rule never
> changes: **red test first, minimal green, refactor, commit.**

---

## 7. VS Code setup

### 7.1 `.vscode/extensions.json`
```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "bradlc.vscode-tailwindcss",
    "ms-playwright.playwright",
    "vitest.explorer",
    "cloudflare.vscode-cloudflare",
    "unifiedjs.vscode-mdx",
    "anthropic.claude-code"
  ]
}
```

### 7.2 `.vscode/settings.json`
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": { "source.fixAll.eslint": "explicit" },
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "vitest.enable": true,
  "files.eol": "\n",
  "search.exclude": { "**/.turbo": true, "**/dist": true, "**/.wrangler": true }
}
```

### 7.3 `.vscode/launch.json`
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "API (wrangler dev)",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "@lyra/api", "dev"],
      "console": "integratedTerminal"
    },
    {
      "name": "Vitest (current file)",
      "type": "node",
      "request": "launch",
      "autoAttachChildProcesses": true,
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["test:watch", "${relativeFile}"],
      "console": "integratedTerminal"
    }
  ]
}
```

### 7.4 Working style with Claude Code
- Keep `CLAUDE.md` open in a pinned tab; Claude Code re-reads it each session.
- One milestone, one branch. One prompt, one commit. Small diffs review faster
  and keep the TDD history clean (CLAUDE.md "definition of done").
- When Claude proposes adding a dependency or service not in `docs/02 §9`, make
  it write an ADR first (`docs/decisions/ADR-NNNN.md`).
- If a generated change weakens tenancy, audit, approvals, or an eval gate to
  go green — reject it. Those are the guardrails the whole product rests on.

---

## 8. Environment & secrets

- Local: copy `.env.example` → `.env.local`. Never commit `.env*` (gitignored).
- Cloudflare: set secrets with `wrangler secret put NAME` per environment
  (`ANTHROPIC_API_KEY`, `AUTH_SECRET`, later `RESEND_KEY`, `BSP_*`, `STRIPE_*`).
  In staging/prod, `ANTHROPIC_BASE_URL` points at the Cloudflare AI Gateway URL
  (docs/10 §3), not the provider directly.
- On-prem: same names via Docker env from the tenant's vault (docs/11).
- CI: store `CLOUDFLARE_API_TOKEN` and account IDs as GitHub Actions secrets;
  never echo secrets in logs (there's a prompt-scrubber test in M1, docs/13 §4).

---

## 9. Troubleshooting

- **`cloudflare:test` import fails** → ensure `@cloudflare/vitest-pool-workers`
  is installed and `apps/api/vitest.config.ts` points at `wrangler.jsonc`.
- **D1 local "database_id" errors** → for M0 the id `"local"` is fine with
  `wrangler dev`; real IDs are created with `wrangler d1 create` in M1/deploy.
- **Drizzle "dialect" mismatch** → keep `dialect: "sqlite"`. Never switch to a
  D1-only feature; it must also run on libSQL (CLAUDE.md rule 2).
- **pnpm can't find workspace package** → confirm `pnpm-workspace.yaml` globs
  and that each package `name` matches the `workspace:*` reference.
- **Type errors from `verbatimModuleSyntax`** → use `import type { X }` for
  type-only imports (already done in the given files).
- **Turbo caching stale failures** → `pnpm turbo run test --force` to bypass.

---

## 10. The done gate (every PR, from CLAUDE.md)

- Typecheck + lint + unit/integration green; new logic has tests written first.
- If UI: story added; mobile parity noted (docs/08).
- If API: OpenAPI updated in the SDK; breaking changes versioned.
- If model behaviour: eval case added and passing (docs/13 §3).
- Audit entries verified for consequential actions.
- Docs updated if behaviour diverges from `/docs` (spec-first; the spec wins).
- Mutation score ≥ 70% on packages/core & model-gateway (raise-only).

Build the observatory one instrument at a time — but every instrument arrives
with its test already pointed at the sky.
