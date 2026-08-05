# AXIS Screens Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the seven remaining gaps in the AXIS module — Case Room audit-export and copilot rail, the Verify Queue's viewer restructure, an AXIS Admin console, an AXIS Dev console, a Process Map screen, a recon evidence-bundle export, and a benchmark verification — so AXIS reaches parity with the rest of the platform for go-live.

**Architecture:** Each task is additive and independent: new routes appended to existing Hono routers (`apps/api/src/routes/axis.ts`, `apps/api/src/routes/ledger.ts`), new tab/action/link entries appended to `apps/web/app/modules/axis.ts`, one new Drizzle table for ops policies, one new model-gateway eval task. No existing route, table, or exported function signature changes shape — only additions. Tasks 1-6 touch disjoint files except where noted in each task's Files block, so they can run in parallel; Task 7 is a read-only verification and has no file conflicts with anything.

**Tech Stack:** Hono (Workers), React Router v7 (framework mode, Cloudflare Workers), Drizzle ORM (SQLite dialect, D1 + libSQL), Zod, Vitest, `@lyra/ui` (Constellation design system), `@lyra/core`, `@lyra/model-gateway`.

## Global Constraints

- Every table has `tenant_id`; every query goes through `withTenant`/`scoped()` (packages/core). No raw cross-tenant queries.
- Drizzle SQLite dialect only; anything added must work on both D1 and libSQL.
- Model access only via `packages/model-gateway`'s `gateway.complete()` — never call a provider SDK directly. Every call is auto-audited to `ai_audit_log` by the gateway itself.
- Consequential actions (`consequential: true`) require an approval step. None of the seven tasks below add a money-moving or regulated-advice action, so none add a new approval policy.
- No hard-coded "LYRA" or brand strings in user-facing surfaces.
- Cross-module integration is event-bus only; direct cross-module imports are forbidden except from `packages/core`.
- All UI strings via i18n keys (`en`, `ar`); logical CSS properties only (`margin-inline-start`, not `margin-left`).
- WCAG 2.2 AA: keyboard-reachable interactive elements, visible focus, ≥4.5:1 contrast.
- Migrations are forward-only and reviewed; never edit an applied migration.
- Ambient AI grammar (docs/15): AI renders as ghost text, quiet chips, background drafts — never modals. Every AI artifact carries the single ✦ marker (`AGENT_MARK` in `packages/ui/src/ai.tsx`) and an inspectable "why".
- TDD is non-negotiable: every unit of behaviour starts with a failing test. AI features are eval-first — the eval/golden-set is written and made to fail before the prompt/route exists.
- Prefer boring technology; reuse existing helpers/patterns over inventing new ones (this repo's own convention, reinforced throughout).

---

## Task 1a: Case Room — audit-export button and download

Frontend-only wiring plus one small proxy route. Zero new backend business logic — `POST /v1/compliance/evidence-bundles/export` and `GET /v1/compliance/evidence-bundles/:id/download` already exist and already handle any `subjectRef` (proven end-to-end today by `apps/api/src/axis-audit-bundle.test.ts`, which exports a case's own audit trail via `subjectRef: caseId`, no prefix).

**Files:**
- Modify: `apps/web/app/routes/case-detail.tsx`
- Modify: `apps/web/app/routes/case-detail.test.ts`
- Create: `apps/web/app/routes/case-evidence-download.tsx`
- Create: `apps/web/app/routes/case-evidence-download.test.ts`
- Modify: `apps/web/app/routes.ts`

**Interfaces:**
- Consumes: `api<T>(path, ApiOptions)` and `apiFetch(path, ApiOptions)` from `apps/web/app/api.server.ts` (existing, unchanged). `POST /v1/compliance/evidence-bundles/export` body `{ purpose: "internal" | "audit" | "regulator" | "litigation", subjectRef?: string, from?: number, to?: number, deliveredTo?: string }` → `201` with `{ id, state, bundleHash, manifest, ... }`. `GET /v1/compliance/evidence-bundles/:id/download` → `200` with the zip bytes, `content-type: application/zip`.
- Produces: nothing consumed by other tasks in this plan.

### Step 1: Write the failing test for the export action

`apps/web/app/routes/case-detail.test.ts` currently ends with the `describe("action: anything else", ...)` block (line 130-139). Add a new `describe` block after it, following the file's existing `stubFetch`/`args`/`form` conventions exactly:

```ts
describe("action: export", () => {
  it("requests an internal evidence bundle scoped to this case", async () => {
    const calls = stubFetch(
      new Response(JSON.stringify({ id: "evb_1", state: "ready" }), {
        status: 201,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await action(args(form({ intent: "export" })));

    expect(calls[0]?.url).toBe("https://api.test/v1/compliance/evidence-bundles/export");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ purpose: "internal", subjectRef: "cas_1" });
    expect(result.done).toBe("exported");
    expect(result.bundleId).toBe("evb_1");
  });

  it("surfaces a refusal rather than claiming the bundle exists", async () => {
    stubFetch(
      new Response(JSON.stringify({ title: "forbidden", status: 403, code: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await action(args(form({ intent: "export" })));

    expect(result.problem?.status).toBe(403);
    expect(result.done).toBeNull();
  });
});
```

### Step 2: Run test to verify it fails

Run: `pnpm --filter @lyra/web vitest run app/routes/case-detail.test.ts`
Expected: FAIL — `result.bundleId` is `undefined` (the `action()` function doesn't have an `export` intent branch yet, so it falls through to `{ ...nothing, problem: { title: "unknown intent", status: 400 } }`), and the first assertion (`calls[0]?.url`) fails since no fetch call is made.

### Step 3: Add the `export` intent to `PERM`, the action's `nothing` shape, and the action branch

In `apps/web/app/routes/case-detail.tsx`, modify the `PERM` object (currently lines 83-91):

```ts
export const PERM = {
  read: "axis:cases:read",
  update: "axis:cases:update",
  documents: "axis:documents:read",
  verify: "axis:documents:verify",
  approvals: "axis:cases:approve",
  events: "axis:metrics:read",
  tasks: "axis:tasks:read",
  export: "compliance:evidence:export",
  download: "compliance:evidence:read"
} as const;
```

In the `loader()` function, add `export: held.has(PERM.export)` to the `may` object (currently lines 242-246):

```ts
  const may = {
    read: held.has(PERM.read),
    update: held.has(PERM.update),
    verify: held.has(PERM.verify),
    export: held.has(PERM.export)
  };
```

In the `action()` function, extend the `nothing` shape (currently line 291) and add the branch (after the `verify` branch, currently lines 301-306, before the fallthrough at line 307):

```ts
  const nothing = {
    done: null as string | null,
    problem: null as Problem | null,
    error: null as string | null,
    bundleId: null as string | null
  };
```

```ts
    if (intent === "export") {
      const bundle = await api<{ id: string }>("/v1/compliance/evidence-bundles/export", {
        env,
        request,
        method: "POST",
        ...headers,
        body: { purpose: "internal", subjectRef: id }
      });
      return { ...nothing, done: "exported", bundleId: bundle.id };
    }
```

### Step 4: Run test to verify it passes

Run: `pnpm --filter @lyra/web vitest run app/routes/case-detail.test.ts`
Expected: PASS

### Step 5: Add the export button and download link to the component, plus labels

Add label keys to both locales in `LABELS` (currently lines 107-230), inside the `en` block after `metaTitle` (line 125) and the matching `ar` block after `metaTitle` (line 186):

```ts
    // en, after metaTitle:
    exportTitle: "Audit export",
    exportIntro: "Build a regulator-ready evidence bundle of everything recorded on this work item.",
    exportSubmit: "Build the bundle",
    exported: "The bundle is ready.",
    download: "Download"
```

```ts
    // ar, after metaTitle:
    exportTitle: "تصدير للتدقيق",
    exportIntro: "إنشاء حزمة أدلة جاهزة للجهة الرقابية بكل ما هو مسجّل على بند العمل هذا.",
    exportSubmit: "إنشاء الحزمة",
    exported: "الحزمة جاهزة.",
    download: "تنزيل"
```

In the component, add a Card after the `metaTitle` Card (currently lines 560-562, the last element before the closing `</div>`), only when `loaded.may.export` is true, and render the download link once `result?.done === "exported"` and `result.bundleId` is set:

```tsx
      {loaded.may.export ? (
        <Card title={l("exportTitle")} description={l("exportIntro")}>
          <Form method="post" className="flex flex-wrap items-center gap-4">
            <input type="hidden" name="intent" value="export" />
            <input type="hidden" name="idempotencyKey" value={loaded.idempotencyKey} />
            <Button type="submit" variant="secondary" loading={busy}>
              {l("exportSubmit")}
            </Button>
            {result?.done === "exported" && result.bundleId ? (
              <a
                href={`/axis/cases/${workItem.id}/evidence-bundles/${result.bundleId}/download`}
                className="font-ui text-13 text-accent underline-offset-2 hover:underline"
              >
                {l("download")}
              </a>
            ) : null}
          </Form>
        </Card>
      ) : null}
```

### Step 6: Run the full test file and the typecheck

Run: `pnpm --filter @lyra/web vitest run app/routes/case-detail.test.ts && pnpm --filter @lyra/web typecheck`
Expected: PASS, no type errors.

### Step 7: Commit

```bash
git add apps/web/app/routes/case-detail.tsx apps/web/app/routes/case-detail.test.ts
git commit -m "feat(axis): add audit-export action to the case room"
```

### Step 8: Write the failing test for the download proxy route

Create `apps/web/app/routes/case-evidence-download.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import type { Env } from "../env";
import { loader } from "./case-evidence-download";

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function loaderArgs(): LoaderFunctionArgs {
  return {
    request: new Request("https://web.test/axis/cases/cas_1/evidence-bundles/evb_1/download"),
    context: { get: () => ({ env, ctx: null }) },
    params: { id: "cas_1", bundleId: "evb_1" }
  } as unknown as LoaderFunctionArgs;
}

describe("case evidence download loader", () => {
  it("proxies the bundle bytes with the API's content-type", async () => {
    const bytes = new Uint8Array([80, 75, 3, 4]);
    let requestedUrl = "";
    vi.stubGlobal("fetch", (input: URL | string) => {
      requestedUrl = String(input);
      return Promise.resolve(
        new Response(bytes, {
          status: 200,
          headers: { "content-type": "application/zip", "content-disposition": "attachment; filename=bundle.zip" }
        })
      );
    });

    const response = await loader(loaderArgs());

    expect(requestedUrl).toBe("https://api.test/v1/compliance/evidence-bundles/evb_1/download");
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });
});
```

### Step 9: Run test to verify it fails

Run: `pnpm --filter @lyra/web vitest run app/routes/case-evidence-download.test.ts`
Expected: FAIL — `Cannot find module './case-evidence-download'`.

### Step 10: Write the proxy route

Create `apps/web/app/routes/case-evidence-download.tsx`:

```tsx
import type { LoaderFunctionArgs } from "react-router";
import { apiFetch } from "../api.server";
import { cloudflare } from "../context";

// A pure byte proxy: the browser can't read the session cookie (httpOnly), so
// a plain <a href> to apps/api would 401. This loader forwards the cookie
// server-side (api.server.ts's apiFetch) and streams the response straight
// through — same "server-side by design" shape as every other loader here.

export async function loader({ request, params, context }: LoaderFunctionArgs): Promise<Response> {
  const env = context.get(cloudflare).env;
  const bundleId = params.bundleId as string;
  const upstream = await apiFetch(`/v1/compliance/evidence-bundles/${bundleId}/download`, { env, request });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/zip",
      "content-disposition": upstream.headers.get("content-disposition") ?? "attachment"
    }
  });
}
```

### Step 11: Run test to verify it passes

Run: `pnpm --filter @lyra/web vitest run app/routes/case-evidence-download.test.ts`
Expected: PASS

### Step 12: Register the route

In `apps/web/app/routes.ts`, add a new route inside the `layout("routes/workspace.tsx", [...])` array, in the "Record screens" block (currently lines 59-66), right before the generic `axis/cases/:id/detail` line 65 so its more specific path still wins on rank (React Router ranks static segments over dynamic ones regardless of order, but keeping it near the case routes matches the file's own grouping convention):

```ts
    route("axis/cases/:id/evidence-bundles/:bundleId/download", "routes/case-evidence-download.tsx"),
```

### Step 13: Run the web app's full test suite and typecheck

Run: `pnpm --filter @lyra/web vitest run && pnpm --filter @lyra/web typecheck`
Expected: PASS

### Step 14: Commit

```bash
git add apps/web/app/routes/case-evidence-download.tsx apps/web/app/routes/case-evidence-download.test.ts apps/web/app/routes.ts
git commit -m "feat(axis): stream evidence-bundle downloads through a server-side proxy route"
```

## Task 1b: Case Room — copilot side-rail

**Files:**
- Modify: `packages/core/src/narrator-verify.ts`
- Test: `packages/core/src/narrator-verify.test.ts` (new file)
- Modify: `packages/model-gateway/evals/run.ts`
- Create: `packages/model-gateway/evals/axis-copilot/cases.jsonl`
- Create: `packages/model-gateway/evals/axis-copilot/thresholds.json`
- Modify: `apps/api/src/routes/axis.ts`
- Test: `apps/api/src/axis-copilot.test.ts` (new file)
- Modify: `apps/web/app/routes/case-detail.tsx`
- Modify: `apps/web/app/routes/case-detail.test.ts`

**Interfaces:**
- Consumes: Task 1a's planned `PERM`/`may`/`nothing`/`action()`/`LABELS`/component-JSX state in `case-detail.tsx` (this task's diffs land after Task 1a's, not after the pre-Task-1a file). Consumes `Drawer`, `AgentBadge`, `GhostText`, `ConfidenceMeter` from `@lyra/ui` (already exported from the package's top barrel — no new import path). Consumes `extractNumbers` (already exported from `packages/core/src/narrator-verify.ts`).
- Produces: `verifyGroundedness(text: string, contextLines: string[]): GroundednessResult` (`{ ok: boolean; mismatches: number[] }`) exported from `@lyra/core`, consumed by both the new API route and the new eval scorer. `POST /v1/axis/cases/:id/copilot` → `{ answer: string; confidence: number; mismatches: number[]; auditId: string }`, consumed by `case-detail.tsx`'s `action()`.

### Step 1: Write the failing test for `verifyGroundedness`

Create `packages/core/src/narrator-verify.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { verifyGroundedness } from "./narrator-verify.js";

describe("verifyGroundedness", () => {
  it("passes text whose numbers all trace back to the context", () => {
    const result = verifyGroundedness(
      "The claim is valued at 5000 AED and was opened on 2026-01-05.",
      ["Case CAS-1: kind claim, status review, priority high, opened 2026-01-05, value 5000 AED."]
    );
    expect(result).toEqual({ ok: true, mismatches: [] });
  });

  it("flags a number the context never gave it", () => {
    const result = verifyGroundedness(
      "The claim is valued at 99999 AED.",
      ["Case CAS-1: kind claim, status review, priority high, opened 2026-01-05, value 5000 AED."]
    );
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([99999]);
  });

  it("passes text with no numeric claims at all", () => {
    const result = verifyGroundedness("This case looks routine.", ["Case CAS-1: kind claim, status review."]);
    expect(result).toEqual({ ok: true, mismatches: [] });
  });
});
```

### Step 2: Run test to verify it fails

Run: `pnpm --filter @lyra/core vitest run src/narrator-verify.test.ts`
Expected: FAIL with "verifyGroundedness is not a function" (the export does not exist yet)

### Step 3: Implement `verifyGroundedness`

Append to the end of `packages/core/src/narrator-verify.ts`:

```ts
export interface GroundednessResult {
  ok: boolean;
  mismatches: number[];
}

/**
 * Same inspectability gate as verifyNumericClaims, generalized to plain
 * context lines instead of a BriefingSnapshot: the AXIS case copilot has
 * no snapshot, only the case/document/task facts assembled into prose.
 */
export function verifyGroundedness(text: string, contextLines: string[]): GroundednessResult {
  const pool = extractNumbers(contextLines.join("\n"));
  const mismatches = extractNumbers(text).filter((n) => !nearAny(n, pool));
  return { ok: mismatches.length === 0, mismatches };
}
```

### Step 4: Run test to verify it passes

Run: `pnpm --filter @lyra/core vitest run src/narrator-verify.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add packages/core/src/narrator-verify.ts packages/core/src/narrator-verify.test.ts
git commit -m "feat(core): add verifyGroundedness, a context-grounding check for free-text AI answers"
```

### Step 6: Write the eval golden set (the failing eval, per docs/13's eval-first rule)

Create `packages/model-gateway/evals/axis-copilot/thresholds.json`:

```json
{
  "recallMin": 1.0,
  "falsePositiveMax": 0
}
```

Create `packages/model-gateway/evals/axis-copilot/cases.jsonl`:

```jsonl
{"id":"value-clean","contextLines":["Case CAS-1: kind claim, status review, priority high, opened 2026-01-05, value 5000 AED."],"text":"This case is valued at 5000 AED.","expectOk":true}
{"id":"value-fabricated","contextLines":["Case CAS-1: kind claim, status review, priority high, opened 2026-01-05, value 5000 AED."],"text":"This case is valued at 8200 AED.","expectOk":false}
{"id":"count-clean","contextLines":["Case CAS-2: kind quote, status intake, priority normal, opened 2026-02-01.","Document emirates_id: status extracted.","Document mulkiya: status extracted.","Document trade_license: status received."],"text":"There are 3 documents on this case.","expectOk":true}
{"id":"count-fabricated","contextLines":["Case CAS-2: kind quote, status intake, priority normal, opened 2026-02-01.","Document emirates_id: status extracted.","Document mulkiya: status extracted.","Document trade_license: status received."],"text":"There are 7 documents on this case.","expectOk":false}
{"id":"multi-clean","contextLines":["Case CAS-3: kind claim, status review, priority high, opened 2026-01-10, SLA due 2026-01-17, value 12000 AED."],"text":"This 12000 AED case is due 2026-01-17.","expectOk":true}
{"id":"multi-fabricated","contextLines":["Case CAS-3: kind claim, status review, priority high, opened 2026-01-10, SLA due 2026-01-17, value 12000 AED."],"text":"This 45000 AED case is due 2026-01-17.","expectOk":false}
```

### Step 7: Run the eval runner to confirm the new task is unscored

Run: `pnpm --filter @lyra/model-gateway eval`
Expected: the runner discovers the `axis-copilot` directory but throws (or skips with a warning) for lack of a registered scorer — confirming the golden set alone is not yet wired up.

### Step 8: Add the `axis-copilot` scorer to the eval runner

In `packages/model-gateway/evals/run.ts`, extend the top import line:

```ts
import { verifyNumericClaims, verifyGroundedness, checkCompliance as checkSignalCompliance, type BriefingSnapshot } from "@lyra/core";
```

Add the scorer function, following the existing `scoreNorth` template, and register it in `SCORERS`:

```ts
interface AxisCopilotCase {
  id: string;
  contextLines: string[];
  text: string;
  expectOk: boolean;
}
interface AxisCopilotThresholds {
  recallMin: number;
  falsePositiveMax: number;
}

async function scoreAxisCopilot(dir: string): Promise<Metric[]> {
  const cases = await loadCases<AxisCopilotCase>(dir);
  const thresholds = await loadThresholds<AxisCopilotThresholds>(dir);
  const violations = cases.filter((c) => !c.expectOk);
  const clean = cases.filter((c) => c.expectOk);
  const caught = violations.filter((c) => !verifyGroundedness(c.text, c.contextLines).ok).length;
  const falseFlags = clean.filter((c) => !verifyGroundedness(c.text, c.contextLines).ok).length;
  return [
    metric("recall", violations.length ? caught / violations.length : 1, { min: thresholds.recallMin }),
    metric("falsePositiveRate", clean.length ? falseFlags / clean.length : 0, { max: thresholds.falsePositiveMax })
  ];
}

const SCORERS: Record<string, (dir: string) => Promise<Metric[]>> = {
  injection: scoreInjection,
  compliance: scoreCompliance,
  axis: scoreAxis,
  "axis-copilot": scoreAxisCopilot,
  north: scoreNorth,
  signal: scoreSignal
};
```

### Step 9: Run the eval runner to confirm it passes

Run: `pnpm --filter @lyra/model-gateway eval`
Expected: PASS, with `axis-copilot` reporting `recall=1` and `falsePositiveRate=0`

### Step 10: Commit

```bash
git add packages/model-gateway/evals/run.ts packages/model-gateway/evals/axis-copilot/cases.jsonl packages/model-gateway/evals/axis-copilot/thresholds.json
git commit -m "feat(model-gateway): add the axis-copilot groundedness eval"
```

### Step 11: Write the failing API test

Create `apps/api/src/axis-copilot.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { seed, totpAt, TOTP_STEP_SEC } from "@lyra/core";
import { id as newId, schema, type Db } from "@lyra/db";
import { app } from "./index.js";
import type { Env } from "./env.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const exec = { waitUntil() {}, passThroughOnException() {} };

const PEOPLE: Record<string, string> = {
  lead: "omar.farouk",
  outsider: "sara.nasser"
};

let env: Env;
let database: Db;
let tokens: Record<string, string>;

interface Res<T = any> { status: number; body: T; }

async function call<T = any>(who: string | null, method: string, path: string, payload?: unknown): Promise<Res<T>> {
  const token = who ? tokens[who] : undefined;
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
    }),
    env as never, exec as never
  );
  const text = res.headers.get("content-type")?.includes("json") ? await res.text() : "";
  return { status: res.status, body: text ? (JSON.parse(text) as T) : (null as T) };
}

const FIXED_ANSWER = "This case is worth 5000 AED.";

beforeAll(async () => {
  const client = createClient({ url: ":memory:" });
  const statements = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) await client.execute(stmt);
  database = drizzle(client) as unknown as Db;
  await seed(database as never, { mfaSecret: DEMO_TOTP_SECRET });
  env = {
    DB_CLIENT: database, ENVIRONMENT: "development", APP_ORIGIN: "http://localhost:5173",
    AI: { run: async () => ({ response: FIXED_ANSWER }) }
  } as unknown as Env;

  tokens = {};
  for (const [who, local] of Object.entries(PEOPLE)) {
    const login = await call(null, "POST", "/v1/auth/login", { email: `${local}@gonxt.ae`, password: PASSWORD, tenantSlug: "gonxt" });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const verified = await app.fetch(
      new Request("http://api.test/v1/auth/mfa/verify", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: await totpAt(DEMO_TOTP_SECRET, Math.floor(Date.now() / 1000 / TOTP_STEP_SEC)) })
      }),
      env as never, exec as never
    );
    expect(verified.status).toBe(200);
    tokens[who] = token;
  }
}, 120_000);

async function openCase(): Promise<string> {
  const res = await call("lead", "POST", "/v1/axis/cases", {
    ref: `CAS-${Date.now()}`,
    kind: "claim",
    status: "review",
    priority: "high",
    valueMinor: 500000,
    currency: "AED"
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("POST /axis/cases/:id/copilot", () => {
  it("answers grounded in the case's own facts and records the model call", async () => {
    const caseId = await openCase();
    const res = await call("lead", "POST", `/v1/axis/cases/${caseId}/copilot`, { question: "What is this case worth?" });
    expect(res.status).toBe(200);
    expect(res.body.answer).toBe(FIXED_ANSWER);
    expect(res.body.confidence).toBeGreaterThanOrEqual(0.9);
    expect(res.body.mismatches).toEqual([]);
    expect(typeof res.body.auditId).toBe("string");
    const rows = await database.select().from(schema.aiAuditLog).where(eq(schema.aiAuditLog.id, res.body.auditId));
    expect(rows[0]?.purpose).toBe("axis.case.copilot");
    expect(rows[0]?.subjectRef).toBe(caseId);
  });

  it("flags an answer that states a number the case context never gave it", async () => {
    const caseId = await openCase();
    const bad: Env = { ...env, AI: { run: async () => ({ response: "This case is worth 999999 AED." }) } } as unknown as Env;
    const res = await app.fetch(
      new Request(`http://api.test/v1/axis/cases/${caseId}/copilot`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${tokens.lead}` },
        body: JSON.stringify({ question: "What is this case worth?" })
      }),
      bad as never, exec as never
    );
    const body = (await res.json()) as { confidence: number; mismatches: number[] };
    expect(res.status).toBe(200);
    expect(body.mismatches).toContain(999999);
    expect(body.confidence).toBeLessThan(0.9);
  });

  it("refuses a locale it does not support", async () => {
    const caseId = await openCase();
    const res = await call("lead", "POST", `/v1/axis/cases/${caseId}/copilot`, { question: "hi", locale: "fr" });
    expect(res.status).toBe(400);
  });

  it("refuses another tenant's staff", async () => {
    const caseId = await openCase();
    const res = await call("outsider", "POST", `/v1/axis/cases/${caseId}/copilot`, { question: "What is this case worth?" });
    expect(res.status).toBe(403);
  });
});
```

### Step 12: Run the test to verify it fails

Run: `pnpm --filter @lyra/api vitest run src/axis-copilot.test.ts`
Expected: FAIL with a 404 (the route does not exist yet)

### Step 13: Implement the route

In `apps/api/src/routes/axis.ts`, extend the two import lines at the top of the file:

```ts
import { eq, desc } from "drizzle-orm";
```

```ts
import { actorRef, audit, badRequest, conflict, emit, require_, scoped, verifyGroundedness, type Ctx } from "@lyra/core";
```

Append the new route at the end of the file, immediately after the existing `/documents/:id/extract` route's closing `});`:

```ts
const CopilotBody = z.object({
  question: z.string().min(1).max(2000),
  locale: z.enum(["en", "ar"]).default("en")
});

axisRoutes.post("/cases/:id/copilot", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "axis:cases:read", { tenantId: ctx.tenantId, module: "axis" });
  const rowId = c.req.param("id");
  const kase = await must(ctx, schema.axisCases, rowId, "cases");
  const input = await body(c, CopilotBody);

  const [documents, events, tasks] = await Promise.all([
    ctx.db.select().from(schema.axisDocuments).where(scoped(ctx, schema.axisDocuments, eq(schema.axisDocuments.caseId, rowId))),
    ctx.db.select().from(schema.axisProcessEvents).where(scoped(ctx, schema.axisProcessEvents, eq(schema.axisProcessEvents.caseId, rowId))).orderBy(desc(schema.axisProcessEvents.ts)).limit(10),
    ctx.db.select().from(schema.axisTasks).where(scoped(ctx, schema.axisTasks, eq(schema.axisTasks.caseId, rowId)))
  ]);

  const contextLines: string[] = [
    `Case ${kase.ref}: kind ${kase.kind}, status ${kase.status}, priority ${kase.priority}, opened ${new Date(kase.createdAt).toISOString()}` +
      (kase.slaDueAt ? `, SLA due ${new Date(kase.slaDueAt).toISOString()}` : "") +
      (kase.valueMinor !== null ? `, value ${kase.valueMinor / 100} ${kase.currency ?? ""}`.trimEnd() : "") +
      ".",
    ...documents.map((d) => `Document ${d.docType}: status ${d.status}.`),
    ...events.map((e) => `Event ${e.step}: ${e.outcome ?? "in progress"} at ${new Date(e.ts).toISOString()}.`),
    ...tasks.map((t) => `Task ${t.titleKey}: state ${t.state}.`)
  ];

  const result = await c.get("gateway").complete(ctx, {
    module: "axis",
    purpose: "axis.case.copilot",
    tier: "standard",
    subjectRef: rowId,
    locale: input.locale,
    messages: [
      {
        role: "system",
        content:
          "Answer the question about this case using only the context lines below. " +
          "Do not state a number that is not in the context. Locale: " + input.locale + ".\n\n" +
          contextLines.join("\n")
      },
      { role: "user", content: input.question }
    ]
  });

  const groundedness = verifyGroundedness(result.text, contextLines);
  const confidence = groundedness.ok ? 0.95 : Math.max(0.2, 0.95 - groundedness.mismatches.length * 0.15);

  return c.json({
    answer: result.text,
    confidence,
    mismatches: groundedness.mismatches,
    auditId: result.auditId
  });
});
```

This route persists no new row (an ephemeral Q&A turn, not case state) and needs no new RBAC entry (it reuses `axis:cases:read`, already granted to both `axis.agent` and `axis.lead`). It sets no `responseSchema`, so the gateway returns free text in `result.text`.

### Step 14: Run the test to verify it passes

Run: `pnpm --filter @lyra/api vitest run src/axis-copilot.test.ts`
Expected: PASS

### Step 15: Commit

```bash
git add apps/api/src/routes/axis.ts apps/api/src/axis-copilot.test.ts
git commit -m "feat(axis): add a context-grounded case copilot endpoint"
```

### Step 16: Write the failing web test

In `apps/web/app/routes/case-detail.test.ts`, add a new `describe` block after the existing `describe("action: verify", ...)` block (before `describe("action: anything else", ...)`):

```ts
describe("action: copilot", () => {
  it("asks the case copilot and returns its answer", async () => {
    const calls = stubFetch(
      new Response(JSON.stringify({ answer: "It is worth 5000 AED.", confidence: 0.95, mismatches: [], auditId: "aud_1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await action(args(form({ intent: "copilot", question: "What is this case worth?", locale: "en" })));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/cases/cas_1/copilot");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ question: "What is this case worth?", locale: "en" });
    expect(result.done).toBe("answered");
    expect(result.answer).toBe("It is worth 5000 AED.");
  });

  it("refuses an empty question without calling anything", async () => {
    const calls = stubFetch(ok());

    const result = await action(args(form({ intent: "copilot", question: "  ", locale: "en" })));

    expect(result.error).toBe("questionRequired");
    expect(calls).toHaveLength(0);
  });
});
```

### Step 17: Run test to verify it fails

Run: `pnpm --filter @lyra/web vitest run app/routes/case-detail.test.ts`
Expected: FAIL, `result.done` is `undefined` (the `copilot` intent is not implemented)

### Step 18: Extend `case-detail.tsx`

All edits below land after Task 1a's planned changes to the same blocks (Task 1a adds the `export`/`download` permission and the evidence-bundle export Card; this task's additions follow immediately after each of those).

Extend the `PERM` object (after Task 1a's `download: "compliance:evidence:read"` line):

```ts
  copilot: "axis:cases:read"
```

Extend the `may` object (after Task 1a's `export: held.has(PERM.export)` line):

```ts
    copilot: held.has(PERM.copilot)
```

Extend the `nothing` shape used by `action()` (after Task 1a's `bundleId: null as string | null` addition):

```ts
    answer: null as string | null,
    confidence: null as number | null
```

Extend `action()`: add a `copilot` branch after Task 1a's `export` branch, before the fallthrough `{ ...nothing, problem: { title: "unknown intent", status: 400 } }`:

```ts
    if (intent === "copilot") {
      const question = String(form.get("question") ?? "").trim();
      if (!question) return { ...nothing, error: "questionRequired" };
      const locale = String(form.get("locale") ?? "en");
      const result = await api<{ answer: string; confidence: number; mismatches: number[]; auditId: string }>(
        `/v1/axis/cases/${id}/copilot`,
        { env, request, method: "POST", body: { question, locale } }
      );
      return { ...nothing, done: "answered", answer: result.answer, confidence: result.confidence };
    }
```

Extend `LABELS` (both `en` and `ar` blocks), after Task 1a's `download` key:

```ts
    copilotTitle: "Ask the case copilot",
    copilotPlaceholder: "Ask a question about this case…",
    copilotSubmit: "Ask",
    copilotEmpty: "Ask a question and the answer will appear here, grounded in this case's own facts."
```

```ts
    copilotTitle: "اسأل مساعد الحالة",
    copilotPlaceholder: "اطرح سؤالاً حول هذه الحالة…",
    copilotSubmit: "اسأل",
    copilotEmpty: "اطرح سؤالاً وستظهر الإجابة هنا، مستندة إلى وقائع هذه الحالة."
```

Extend the component: add a `useState` for the drawer's open state near the top of the component body (after the existing `const busy = navigation.state !== "idle";` line):

```ts
  const [copilotOpen, setCopilotOpen] = useState(false);
```

Add `useState` to the existing `react` import line at the top of the file (extend whatever is already imported from `"react"`; if nothing is currently imported from `react`, add a new line `import { useState } from "react";` near the other framework imports).

Add the `Drawer` trigger button and the `Drawer` itself, after Task 1a's planned export Card (the last element before the closing `</div>` of the page):

```tsx
        {loaded.may.copilot ? (
          <Button variant="secondary" onClick={() => setCopilotOpen(true)}>
            <AgentBadge label={l("copilotTitle")} />
          </Button>
        ) : null}
      </div>
      {loaded.may.copilot ? (
        <Drawer open={copilotOpen} onClose={() => setCopilotOpen(false)} title={l("copilotTitle")}>
          <Form method="post" replace>
            <input type="hidden" name="intent" value="copilot" />
            <input type="hidden" name="idempotencyKey" value={loaded.idempotencyKey} />
            <input type="hidden" name="locale" value={locale} />
            <textarea name="question" placeholder={l("copilotPlaceholder")} rows={3} required />
            <Button type="submit" disabled={busy}>
              {l("copilotSubmit")}
            </Button>
          </Form>
          {result?.done === "answered" && result.answer ? (
            <>
              <GhostText text={result.answer} onAccept={() => {}} onDiscard={() => {}} />
              <ConfidenceMeter value={result.confidence ?? 0} />
            </>
          ) : (
            <p>{l("copilotEmpty")}</p>
          )}
        </Drawer>
      ) : null}
```

This closes the page's outer `<div>` where Task 1a's export Card previously closed it, then renders the `Drawer` as a sibling outside that `<div>` (drawers are typically overlay-positioned, not page-flow content). Extend the top `@lyra/ui` import line to add the four new components:

```ts
import { AgentBadge, Badge, Button, Card, ConfidenceMeter, DateTime, Drawer, EmptyState, GhostText, Money, Select, Stat, Table, type Column } from "@lyra/ui";
```

### Step 19: Run test to verify it passes

Run: `pnpm --filter @lyra/web vitest run app/routes/case-detail.test.ts`
Expected: PASS

### Step 20: Run the web app's full test suite and typecheck

Run: `pnpm --filter @lyra/web vitest run && pnpm --filter @lyra/web typecheck`
Expected: PASS

### Step 21: Commit

```bash
git add apps/web/app/routes/case-detail.tsx apps/web/app/routes/case-detail.test.ts
git commit -m "feat(axis): add a copilot side-rail to the Case Room, grounded in the case's own facts"
```

---

## Task 2: Verify Queue restructure

The Verify Queue (`axis/doc-intelligence`) lists every open document as its own
full-width `Card` — model fields, correction form, verify button, extract
form, all stacked. Verifying against the source file means opening the file
in another tab and flipping back and forth. This task turns it into a desk: a
document viewer on one side of the same fields, a compact rail to move
between documents with `j`/`k`, and — when the model recorded where on the
page a field came from — a box drawn over it.

No schema change. `axisDocuments.extractionJson` is already a free-form JSON
column; a reserved `_bbox` key inside it (sibling to the real fields, read the
same way `fieldsOf` already reads the rest) carries `[x, y, w, h]` per field
name, as a percentage of the page. A document with no `_bbox` just shows no
boxes — nothing to migrate, nothing that can be absent-and-wrong.

Viewing the file itself needs a new route. `axisDocuments.fileId` points at a
`core_files` row (`r2Key`, `contentType`), same as every other file in the
platform; there is no existing route that streams one back for axis
documents, so this task adds one, mirroring `compliance.ts`'s evidence-bundle
download route (`apps/api/src/routes/compliance.ts:333-367`) — `must()` twice,
`c.env.FILES?.get()`, `audit()`, `meterEgress()`, then the R2 object's body as
the response — and a matching web-side proxy route, mirroring Task 1a's
`case-evidence-download.tsx`.

**Files:**
- Modify: `apps/web/app/routes/axis-doc-intel.tsx`
- Modify: `apps/web/app/routes/axis-doc-intel.test.ts`
- Modify: `apps/api/src/routes/axis.ts`
- Modify: `apps/api/src/axis-documents.test.ts`
- Create: `apps/web/app/routes/axis-document-file.tsx`
- Create: `apps/web/app/routes/axis-document-file.test.ts`
- Modify: `apps/web/app/routes.ts`

**Interfaces:**
- Consumes: `fieldsOf`, `confidenceOf`, `needsReview`, `statusTone`,
  `mergeCorrections`, `typedFrom`, `FIELD_PREFIX`, `DocRow`, `labelsIn`,
  `Label`, `PERM`, `REVIEW_FLOOR` — all already exported from
  `axis-doc-intel.tsx` (Task 1a/1b did not touch this file). `must()` from
  `apps/api/src/rows.ts`. `notFound` from `@lyra/core`. `meterEgress` from
  `apps/api/src/engines/egress.ts`. `apiFetch`/`api`/`ApiError` from
  `apps/web/app/api.server.ts`.
- Produces: `bboxOf(doc: Pick<DocRow, "extractionJson">): Record<string, [number, number, number, number]>`,
  exported from `axis-doc-intel.tsx`. `GET /v1/axis/documents/:id/file`,
  gated by `axis:documents:read` (same permission the document list already
  requires). `GET /axis/documents/:id/file` on the web side, proxying it.

### Step 1: Write the failing frontend tests

`fieldsOf` must not hand a reserved `_bbox` key back as a correctable field,
and a new `bboxOf` must read it. Edit `apps/web/app/routes/axis-doc-intel.test.ts`:

```ts
import {
  FIELD_PREFIX,
  OPEN_DOC_STATUSES,
  REVIEW_FLOOR,
  action,
  bboxOf,
  confidenceOf,
  fieldsOf,
  labelsIn,
  mergeCorrections,
  needsReview,
  phrase,
  statusTone,
  typedFrom
} from "./axis-doc-intel";
```

```ts
describe("fieldsOf", () => {
  it("reads the model's answers and keeps an omitted field as null", () => {
    expect(fieldsOf({ extractionJson: '{"fullName":"Aisha","idNumber":"  ","expiryDate":null}' })).toEqual({
      fullName: "Aisha",
      idNumber: null,
      expiryDate: null
    });
  });

  it("treats an unread document, bad JSON and a JSON array as nothing extracted", () => {
    expect(fieldsOf({ extractionJson: null })).toEqual({});
    expect(fieldsOf({ extractionJson: "not json" })).toEqual({});
    expect(fieldsOf({ extractionJson: '["a","b"]' })).toEqual({});
  });

  it("keeps the reserved _bbox key out of the correctable fields", () => {
    expect(fieldsOf({ extractionJson: '{"fullName":"Aisha","_bbox":{"fullName":[1,2,3,4]}}' })).toEqual({
      fullName: "Aisha"
    });
  });
});

describe("bboxOf", () => {
  it("reads the model's box per field, as a percentage of the page", () => {
    expect(
      bboxOf({ extractionJson: '{"fullName":"Aisha","_bbox":{"fullName":[12.5,30,40,6]}}' })
    ).toEqual({ fullName: [12.5, 30, 40, 6] });
  });

  it("treats a missing, malformed or absent box as nothing to draw", () => {
    expect(bboxOf({ extractionJson: null })).toEqual({});
    expect(bboxOf({ extractionJson: '{"fullName":"Aisha"}' })).toEqual({});
    expect(bboxOf({ extractionJson: '{"_bbox":{"fullName":[1,2,3]}}' })).toEqual({});
    expect(bboxOf({ extractionJson: '{"_bbox":"not an object"}' })).toEqual({});
  });
});
```

### Step 2: Run tests to verify they fail

Run: `pnpm --filter @lyra/web vitest run app/routes/axis-doc-intel.test.ts`
Expected: FAIL — `bboxOf` is not exported, and the `_bbox`-exclusion case fails
because `fieldsOf` currently returns every key.

### Step 3: Implement `bboxOf` and the `fieldsOf` exclusion

Edit `apps/web/app/routes/axis-doc-intel.tsx`. In `fieldsOf`, skip reserved keys:

```ts
export function fieldsOf(doc: Pick<DocRow, "extractionJson">): Record<string, string | null> {
  if (!doc.extractionJson) return {};
  try {
    const parsed: unknown = JSON.parse(doc.extractionJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (key.startsWith("_")) continue;
      out[key] = typeof value === "string" && value.trim() ? value : null;
    }
    return out;
  } catch {
    // ponytail: a row whose JSON does not parse reads as "nothing extracted"
    // rather than throwing — one bad document must not blank the whole desk.
    return {};
  }
}

/**
 * `_bbox`: an optional reserved key living beside the real fields in the same
 * JSON — the model's own coordinates for a field, `[x, y, w, h]` as a percent
 * of the page, when it has them. No schema change, no migration: a document
 * with none just draws no boxes.
 */
export function bboxOf(doc: Pick<DocRow, "extractionJson">): Record<string, [number, number, number, number]> {
  if (!doc.extractionJson) return {};
  try {
    const parsed: unknown = JSON.parse(doc.extractionJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const raw = (parsed as Record<string, unknown>)["_bbox"];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, [number, number, number, number]> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === "number")) {
        out[key] = value as [number, number, number, number];
      }
    }
    return out;
  } catch {
    return {};
  }
}
```

### Step 4: Run tests to verify they pass

Run: `pnpm --filter @lyra/web vitest run app/routes/axis-doc-intel.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add apps/web/app/routes/axis-doc-intel.tsx apps/web/app/routes/axis-doc-intel.test.ts
git commit -m "feat(axis): read a reserved _bbox key out of a document's extraction"
```

### Step 6: Write the failing backend test

Edit `apps/api/src/axis-documents.test.ts`. Add a `FILES` bucket stub to `env`
(mirroring `apps/api/src/routes/compliance.test.ts`'s R2 fake) and a helper
that seeds a real `core_files` row behind a document, since `upload()`'s
`fileId` today is a bare id with nothing behind it:

```ts
const env = {
  DB_CLIENT: database,
  ENVIRONMENT: "development",
  APP_ORIGIN: "http://localhost:5173",
  // ponytail: a Map is the whole of R2 a bundle needs — put then get.
  FILES: (() => {
    const store = new Map<string, Uint8Array>();
    return {
      put: async (key: string, bytes: Uint8Array) => {
        store.set(key, bytes);
      },
      get: async (key: string) => {
        const bytes = store.get(key);
        return bytes ? { body: new Response(bytes).body, size: bytes.byteLength } : null;
      }
    };
  })()
} as unknown as Env;
```

This replaces the existing plain `env = {...}` object literal in `beforeAll`
(same three original keys, plus `FILES`) — keep it assigned to the module-level
`let env: Env;` exactly as today.

Add the file-seeding helper and a raw-response test helper right after `upload()`:

```ts
/** A fresh document whose fileId points at a real core_files row and R2 object. */
async function uploadWithFile(): Promise<{ docId: string; r2Key: string; bytes: Uint8Array }> {
  const docId = await upload();
  const rows = await database.select().from(schema.axisDocuments).where(eq(schema.axisDocuments.id, docId));
  const tenantId = rows[0]!.tenantId;
  const now = Date.now();
  const fileId = newId("fil", now);
  const r2Key = `axis/documents/${fileId}.bin`;
  const bytes = new TextEncoder().encode("stub file bytes");
  await env.FILES!.put(r2Key, bytes);
  await database.insert(schema.files).values({
    id: fileId,
    tenantId,
    r2Key,
    kind: "axis_document",
    subjectRef: docId,
    sha256: "0".repeat(64),
    sizeBytes: bytes.byteLength,
    contentType: "image/png",
    piiLevel: "high",
    createdAt: now
  });
  await database.update(schema.axisDocuments).set({ fileId }).where(eq(schema.axisDocuments.id, docId));
  return { docId, r2Key, bytes };
}

/** call()'s JSON-only decoding can't see a streamed file — this returns the raw Response. */
async function raw(who: string, path: string): Promise<Response> {
  return app.fetch(
    new Request(`http://api.test${path}`, { headers: { authorization: `Bearer ${tokens[who]}` } }),
    env as never,
    exec as never
  );
}
```

Add the test block after the existing `describe("POST /v1/axis/documents/:id/verify", ...)` block:

```ts
describe("GET /v1/axis/documents/:id/file", () => {
  it("streams the stored file's bytes with its content type", async () => {
    const { docId, bytes } = await uploadWithFile();

    const res = await raw("lead", `/v1/axis/documents/${docId}/file`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toBe("inline");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("writes an audit entry naming the file that was read", async () => {
    const { docId } = await uploadWithFile();
    expect((await raw("lead", `/v1/axis/documents/${docId}/file`)).status).toBe(200);

    const rows = await database.select().from(schema.auditLog);
    const entry = rows.find((a) => a.subjectRef === `axis_document:${docId}` && a.action === "axis.documents.file.read");
    expect(entry).toBeDefined();
  });

  it("is 404 for a document in another tenant", async () => {
    const res = await raw("lead", `/v1/axis/documents/${foreignDocId}/file`);
    expect(res.status).toBe(404);
  });

  it("is 404 when the document's file object is missing from storage", async () => {
    const docId = await upload();
    const res = await raw("lead", `/v1/axis/documents/${docId}/file`);
    expect(res.status).toBe(404);
  });
});
```

### Step 7: Run the test to verify it fails

Run: `pnpm --filter @lyra/api vitest run src/axis-documents.test.ts`
Expected: FAIL — `GET /v1/axis/documents/:id/file` does not exist (404 from
the router itself, not the route's own `notFound`, and the byte/audit
assertions fail).

### Step 8: Implement the backend route

Edit `apps/api/src/routes/axis.ts`. Extend the `@lyra/core` import to add
`notFound`, and add a new import for `meterEgress`:

```ts
import { actorRef, audit, badRequest, conflict, emit, notFound, require_, scoped, verifyGroundedness, type Ctx } from "@lyra/core";
```

```ts
import { meterEgress } from "../engines/egress.js";
```

Add the route after the `/documents/:id/extract` route (at the end of the file,
after its closing `});`):

```ts
axisRoutes.get("/documents/:id/file", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "axis:documents:read", { tenantId: ctx.tenantId, module: "axis" });
  const doc = await must(ctx, schema.axisDocuments, c.req.param("id"), "document");
  const file = await must(ctx, schema.files, doc.fileId, "document file");
  const object = await c.env.FILES?.get(file.r2Key);
  if (!object) throw notFound("document file");

  await audit(ctx, {
    action: "axis.documents.file.read",
    subjectRef: `axis_document:${doc.id}`,
    after: { fileId: file.id }
  });
  await meterEgress(ctx, file.sizeBytes ?? object.size);
  return new Response(object.body, {
    headers: {
      "content-type": file.contentType ?? "application/octet-stream",
      "content-disposition": "inline",
      "cache-control": "no-store"
    }
  });
});
```

### Step 9: Run the test to verify it passes

Run: `pnpm --filter @lyra/api vitest run src/axis-documents.test.ts`
Expected: PASS

### Step 10: Commit

```bash
git add apps/api/src/routes/axis.ts apps/api/src/axis-documents.test.ts
git commit -m "feat(axis): stream a document's source file, audited and egress-metered"
```

### Step 11: Write the failing web proxy test

Create `apps/web/app/routes/axis-document-file.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import type { Env } from "../env";
import { loader } from "./axis-document-file";

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function args(): LoaderFunctionArgs {
  return {
    request: new Request("https://web.test/axis/documents/doc_1/file"),
    context: { get: () => ({ env, ctx: null }) },
    params: { id: "doc_1" }
  } as unknown as LoaderFunctionArgs;
}

describe("loader", () => {
  it("streams the API's bytes and content type through untouched", async () => {
    const bytes = new TextEncoder().encode("stub image bytes");
    vi.stubGlobal(
      "fetch",
      async () => new Response(bytes, { status: 200, headers: { "content-type": "image/png" } })
    );

    const res = await loader(args());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });
});
```

### Step 12: Run the test to verify it fails

Run: `pnpm --filter @lyra/web vitest run app/routes/axis-document-file.test.ts`
Expected: FAIL — `./axis-document-file` does not exist.

### Step 13: Implement the web proxy route

Create `apps/web/app/routes/axis-document-file.tsx`:

```tsx
import type { LoaderFunctionArgs } from "react-router";
import { apiFetch } from "../api.server";
import { cloudflare } from "../context";

export async function loader({ request, params, context }: LoaderFunctionArgs): Promise<Response> {
  const env = context.get(cloudflare).env;
  const upstream = await apiFetch(`/v1/axis/documents/${params.id}/file`, { env, request });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": upstream.headers.get("content-disposition") ?? "inline",
      "cache-control": "no-store"
    }
  });
}
```

Register it in `apps/web/app/routes.ts`, alongside the other `axis/*` static
routes:

```ts
    route("axis/doc-intelligence", "routes/axis-doc-intel.tsx"),
    route("axis/documents/:id/file", "routes/axis-document-file.tsx"),
    route("axis/analytics", "routes/axis-analytics.tsx"),
```

### Step 14: Run the test to verify it passes

Run: `pnpm --filter @lyra/web vitest run app/routes/axis-document-file.test.ts`
Expected: PASS

### Step 15: Commit

```bash
git add apps/web/app/routes/axis-document-file.tsx apps/web/app/routes/axis-document-file.test.ts apps/web/app/routes.ts
git commit -m "feat(axis): proxy a document's source file through to the API"
```

### Step 16: Restructure the Verify Queue screen

The list-of-cards layout becomes a rail (pick a document) + viewer (see the
file, with any boxes the model recorded) + the existing per-document card body
(now rendered once, for whichever document is selected), with `j`/`k` moving
the selection. Nothing about what the card body does changes — same
correction form, same verify button, same extract form, same permission
checks — only that it now renders for one document instead of being repeated
per document.

Edit `apps/web/app/routes/axis-doc-intel.tsx`. Add a `react` import at the top,
before the `react-router` import:

```tsx
import { useEffect, useState } from "react";
```

Add a `nav.label` key to both halves of `LABELS`. In the `en` object, right
after `"empty.body": "Every document has been read and confirmed.",`:

```ts
    "nav.label": "Documents",
```

In the `ar` object, right after `"empty.body": "كل المستندات قُرئت وأُكّدت.",`:

```ts
    "nav.label": "المستندات",
```

Replace the component body from `{loaded.docs.map((doc) => {` through the
closing `})}` (the entire per-document `Card` block) with a rail + viewer +
single card, keyed to a selected index:

```tsx
export default function AxisDocIntel() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const shell = useShellData();
  const navigation = useNavigation();

  const locale = shell?.locale ?? "en";
  const l = labelsIn(locale);
  const held = new Set(shell?.permissions ?? []);
  const busy = navigation.state !== "idle";

  const counted = (status: string) => loaded.docs.filter((doc) => doc.status === status).length;

  const [index, setIndex] = useState(0);
  const selected = loaded.docs[Math.min(index, Math.max(loaded.docs.length - 1, 0))];
  const model = selected ? fieldsOf(selected) : {};
  const names = Object.keys(model);
  const confidence = selected ? confidenceOf(selected) : null;
  const boxes = selected ? bboxOf(selected) : {};

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key === "j") setIndex((i) => Math.min(i + 1, loaded.docs.length - 1));
      else if (event.key === "k") setIndex((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loaded.docs.length]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-22 text-text">{l("title")}</h1>
        <p className="max-w-prose font-ui text-13 text-subtle">{l("intro")}</p>
      </header>

      {result?.problem ? <Gate problem={phrase(result.problem, l)} l={l} /> : null}
      {result?.done ? (
        <p role="status" className="font-ui text-13 text-success">
          {l(`done.${result.done}`)}
        </p>
      ) : null}

      <KPIWall>
        <Stat label={l("stat.open")} value={loaded.docs.length} />
        <Stat label={l("stat.extracted")} value={counted("extracted")} />
        <Stat label={l("stat.received")} value={counted("received")} />
        <Stat label={l("stat.rejected")} value={counted("rejected")} />
      </KPIWall>

      <Form method="get" className="flex flex-wrap items-end gap-3">
        <Field label={l("filter.label")} className="w-56">
          <Select
            name="show"
            defaultValue={loaded.all ? "all" : "open"}
            options={[
              { value: "open", label: l("filter.open") },
              { value: "all", label: l("filter.all") }
            ]}
          />
        </Field>
        <Button type="submit" variant="secondary" loading={busy}>
          {l("filter.submit")}
        </Button>
      </Form>

      {loaded.docs.length === 0 ? <EmptyState title={l("empty.title")} body={l("empty.body")} /> : null}

      {selected ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr_1fr]">
          <ul className="flex flex-col gap-1 lg:max-h-[70vh] lg:overflow-y-auto" aria-label={l("nav.label")}>
            {loaded.docs.map((doc, i) => (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-current={i === index ? "true" : undefined}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-start font-ui text-12 ${
                    i === index ? "bg-surface-2 text-accent" : "text-muted"
                  }`}
                >
                  <span className="truncate">{doc.docType}</span>
                  <Badge tone={statusTone(doc.status)} size="sm">
                    {l(`status.${doc.status}`)}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>

          <div className="relative overflow-hidden rounded border border-border bg-surface-2 lg:max-h-[70vh]">
            <img
              src={`/axis/documents/${selected.id}/file`}
              alt={selected.docType}
              className="block w-full object-contain"
            />
            {Object.entries(boxes).map(([name, [x, y, w, h]]) => (
              <span
                key={name}
                title={name}
                className="pointer-events-none absolute border-2 border-accent"
                style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }}
              />
            ))}
          </div>

          <Card
            key={selected.id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/axis/documents/${selected.id}`}
                  className="font-mono text-13 text-accent underline underline-offset-2"
                >
                  {selected.docType}
                </Link>
                <Badge tone={statusTone(selected.status)} size="sm">
                  {l(`status.${selected.status}`)}
                </Badge>
                {selected.extractionModel ? (
                  <AgentBadge
                    agent={selected.extractionModel}
                    why={
                      <span className="font-ui text-12 text-muted">
                        {l("why", { model: selected.extractionModel })}
                      </span>
                    }
                  />
                ) : null}
              </span>
            }
            description={
              <EvidenceLink
                sourceLabel={l("evidence.label")}
                source={
                  <span className="flex flex-col gap-1 font-ui text-12 text-muted">
                    <span>
                      {l("evidence.file")}: <span className="font-mono">{selected.fileId}</span>
                    </span>
                    <span>
                      {l("evidence.type")}: {selected.docType}
                    </span>
                    <span>
                      {l("evidence.read")}: <DateTime value={selected.createdAt} locale={locale} />
                    </span>
                    {selected.verifiedBy ? (
                      <span>
                        {l("evidence.verified")}: {selected.verifiedBy}
                        {selected.verifiedAt ? (
                          <>
                            {" · "}
                            <DateTime value={selected.verifiedAt} locale={locale} />
                          </>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                }
              >
                {selected.fileId}
              </EvidenceLink>
            }
          >
            <div className="flex flex-col gap-4">
              {confidence !== null ? (
                <ConfidenceMeter value={confidence} label={l("confidence.label")} floor={REVIEW_FLOOR} />
              ) : null}

              {needsReview(selected) ? (
                <GuardrailNotice tone="warning" title={l("review.title")} reason={l("review.reason")} />
              ) : null}

              {names.length === 0 ? (
                <p className="font-ui text-13 text-subtle">{l("correct.none")}</p>
              ) : held.has(PERM.correct) ? (
                <Form method="post" className="flex flex-col gap-3">
                  <input type="hidden" name="intent" value="correct" />
                  <input type="hidden" name="docId" value={selected.id} />
                  <input type="hidden" name="extractionJson" value={selected.extractionJson ?? ""} />
                  <p className="font-ui text-12 text-subtle">{l("correct.intro")}</p>
                  <ul className="flex flex-col gap-3">
                    {names.map((name) => (
                      <li key={name} className="flex flex-wrap items-end gap-3">
                        <Field label={name} className="w-64">
                          <Input name={`${FIELD_PREFIX}${name}`} placeholder={l("correct.placeholder")} />
                        </Field>
                        <span className="pb-2 font-ui text-13">
                          {model[name] ? <GhostText text={model[name]!} /> : <span className="text-subtle">—</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <span className="flex flex-wrap items-center gap-3">
                    <Button type="submit" variant="secondary" loading={busy}>
                      {l("correct.submit")}
                    </Button>
                  </span>
                </Form>
              ) : (
                <ul className="flex flex-col gap-2">
                  {names.map((name) => (
                    <li key={name} className="flex flex-wrap gap-2 font-ui text-13">
                      <span className="text-muted">{name}</span>
                      <span className="text-text">{model[name] ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              )}

              {held.has(PERM.correct) && selected.status !== "verified" ? (
                <Form method="post" className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="intent" value="verify" />
                  <input type="hidden" name="docId" value={selected.id} />
                  <Button type="submit" variant="primary" loading={busy}>
                    {l("verify.submit")}
                  </Button>
                  <span className="font-ui text-12 text-subtle">{l("verify.hint")}</span>
                </Form>
              ) : null}

              {held.has(PERM.extract) && selected.status === "received" ? (
                <Form method="post" className="flex flex-col gap-3 border-t border-border pt-4">
                  <input type="hidden" name="intent" value="extract" />
                  <input type="hidden" name="docId" value={selected.id} />
                  <p className="font-ui text-13 font-medium text-text">{l("extract.title")}</p>
                  <p className="font-ui text-12 text-subtle">{l("extract.intro")}</p>
                  <Field label={l("extract.rawText")}>
                    <Textarea name="rawText" required maxLength={20_000} rows={4} />
                  </Field>
                  <span className="flex flex-wrap items-end gap-3">
                    <Field label={l("extract.locale")} className="w-40">
                      <Select
                        name="locale"
                        defaultValue={locale === "ar" ? "ar" : "en"}
                        options={[
                          { value: "en", label: l("locale.en") },
                          { value: "ar", label: l("locale.ar") }
                        ]}
                      />
                    </Field>
                    <Button type="submit" variant="secondary" loading={busy}>
                      {l("extract.submit")}
                    </Button>
                  </span>
                </Form>
              ) : null}
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
```

This is a pure JSX restructure of already-tested logic (`fieldsOf`,
`confidenceOf`, `needsReview`, `mergeCorrections`, `statusTone`, `bboxOf`
each have their own unit tests; the action's three intents are unchanged).
There is no new pure logic here to unit-test — the check is that the existing
suite, which drives the same action/loader contract, still passes.

### Step 17: Run the full frontend suite and typecheck

Run: `pnpm --filter @lyra/web vitest run && pnpm --filter @lyra/web typecheck`
Expected: PASS

### Step 18: Commit

```bash
git add apps/web/app/routes/axis-doc-intel.tsx
git commit -m "feat(axis): restructure the Verify Queue into a viewer + rail with j/k navigation"
```

## Task 3: AXIS Admin console

**Goal:** one screen where an `axis.admin` publishes SOP versions, edits SLA/routing/queue policy, and reads connector health — plus the one backend verb generated CRUD cannot express (SOP publish, which must retire the version it replaces atomically).

**Files:**
- Modify: `packages/db/src/schema/axis.ts` — new `axis_ops_policies` table
- Modify: `packages/db/src/schema.ts` — re-export
- Modify: `packages/core/src/rbac.ts` — new permissions, `axis.admin` bundle gains `core:webhooks:read`
- Modify: `apps/api/src/resources.ts` — register `ops-policies`
- Modify: `apps/api/src/routes/axis.ts` — new `POST /v1/axis/sops/:id/publish`
- Create: `apps/api/src/axis-sops.test.ts`
- Modify: `apps/web/app/modules/axis.ts` — labels + `ops-policies` tab
- Create: `apps/web/app/routes/axis-admin.tsx`
- Create: `apps/web/app/routes/axis-admin.test.ts`
- Modify: `apps/web/app/routes.ts` — register `axis/admin`

**Interfaces:**
- Consumes: `must()`/rows.ts (`apps/api/src/rows.ts`), `scoped()`/`require_()`/`audit()`/`conflict()` from `@lyra/core`, the `r()`/`rw()` resource helpers (`apps/api/src/resources.ts:24-57`), `safe()` 403-fallback loader pattern (`apps/web/app/routes/admin-security.tsx:228-235`).
- Produces: `POST /v1/axis/sops/:id/publish` → `{ ...sop, status: "active" }`; `GET/POST/PATCH /v1/axis/ops-policies[/:id]` (generic CRUD); route `/axis/admin`.

SOPs already have full generic CRUD at `axis:sops:read`/`axis:sops:write` (`apps/api/src/resources.ts:272`). The one gap is publish: setting a row's `status` to `active` through the generic PATCH does nothing about the version it replaces, so two versions of the same procedure can end up `active` at once. Connector health reads tables that are already generically exposed (`core_webhooks`, `core_webhook_deliveries`) — no new backend route, just a bespoke aggregation view. SLA/routing/queue policy is a new generic resource; its screen is the module tab that registering it produces automatically, so this task only needs to add the table, not a bespoke editor.

- [ ] **Step 1: Add the `axis_ops_policies` table**

In `packages/db/src/schema/axis.ts`, insert immediately after the `processEvents` table (after the line `);` that closes it, before the `/** Claims: ... */` comment):

```ts
/** Tenant-configurable SLA, routing and queue policy (docs/03 §AXIS admin). */
export const opsPolicies = sqliteTable(
  "axis_ops_policies",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    key: text("key").notNull(),
    kind: text("kind").notNull(), // sla|routing|queue
    valueJson: text("value_json").notNull(),
    status: text("status").notNull().default("active"), // active|disabled
    updatedBy: text("updated_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [uniqueIndex("axis_ops_policies_key_uq").on(t.tenantId, t.key)]
);
```

- [ ] **Step 2: Re-export it**

In `packages/db/src/schema.ts`, add a line immediately after `processEvents as axisProcessEvents,` (line 64):

```ts
  opsPolicies as axisOpsPolicies,
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: drizzle-kit writes a new `packages/db/migrations/NNNN_<tag>.sql` (auto-named — the file must exist and contain `CREATE TABLE \`axis_ops_policies\`` and a unique index on `(tenant_id, key)`) and appends an entry to `packages/db/migrations/meta/_journal.json`.

- [ ] **Step 4: Register the resource**

In `apps/api/src/resources.ts`, insert immediately after the `sops` registration (line 272, before `process-events`):

```ts
  r("ops-policies", schema.axisOpsPolicies, "opl", "axis", rw("axis:ops_policies"), {
    actorColumns: ["updatedBy"]
  }),
```

- [ ] **Step 5: Add the permissions**

In `packages/core/src/rbac.ts`, in the `PERMISSIONS` array, add a line immediately after `"axis:metrics:read",` (line 103):

```ts
  "axis:ops_policies:read", "axis:ops_policies:write",
```

In the `axis.admin` role bundle (lines 315-322), the connector-health panel needs to read `core_webhooks`/`core_webhook_deliveries`, which sit outside the `axis:*:*` wildcard. Change:

```ts
  "axis.admin": [
    "axis:*:*", "ai:suggestions:read", "core:customers:*", "core:products:*", "core:providers:*",
    "core:pii:view", "core:approvals:read", "core:approvals:decide", "core:files:*",
```

to:

```ts
  "axis.admin": [
    "axis:*:*", "ai:suggestions:read", "core:customers:*", "core:products:*", "core:providers:*",
    "core:pii:view", "core:approvals:read", "core:approvals:decide", "core:files:*", "core:webhooks:read",
```

(`axis:ops_policies:*` needs no bundle edit — `axis.admin` already holds `axis:*:*`, which covers it via wildcard matching.)

- [ ] **Step 6: Run the generic registry tests**

Run: `pnpm --filter @lyra/api vitest run resources.test.ts`
Expected: PASS — the new `ops-policies` resource is checked structurally (real columns for `actorColumns`, no `amountField`/`pii`/`secretColumns` declared) by the existing parametric tests in `apps/api/src/resources.test.ts`, with no new test code needed.

- [ ] **Step 7: Write the failing test for SOP publish**

Create `apps/api/src/axis-sops.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { seed, totpAt, TOTP_STEP_SEC } from "@lyra/core";
import { id as newId, schema, type Db } from "@lyra/db";
import { app } from "./index.js";
import type { Env } from "./env.js";

// PLAT: publishing a SOP used to mean hand-editing `status` through the
// generic PATCH, which let two versions of the same procedure sit "active" at
// once — whichever version a caller last touched. This endpoint makes publish
// atomic: the new version goes live and the version it replaces retires in
// the same call.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const exec = { waitUntil() {}, passThroughOnException() {} };

/** axis.lead holds `axis:sops:write`; axis.agent does not. */
const PEOPLE: Record<string, string> = {
  lead: "omar.farouk",
  agent: "layla.hassan"
};

let env: Env;
let database: Db;
let tokens: Record<string, string>;
let foreignSopId: string;

interface Res<T = any> {
  status: number;
  body: T;
}

async function call<T = any>(who: string | null, method: string, path: string, payload?: unknown): Promise<Res<T>> {
  const token = who ? tokens[who] : undefined;
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
    }),
    env as never,
    exec as never
  );
  const text = res.headers.get("content-type")?.includes("json") ? await res.text() : "";
  return { status: res.status, body: text ? (JSON.parse(text) as T) : (null as T) };
}

beforeAll(async () => {
  const client = createClient({ url: ":memory:" });
  const statements = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) await client.execute(stmt);
  database = drizzle(client) as unknown as Db;
  await seed(database as never, { mfaSecret: DEMO_TOTP_SECRET });
  env = {
    DB_CLIENT: database,
    ENVIRONMENT: "development",
    APP_ORIGIN: "http://localhost:5173"
  } as unknown as Env;

  tokens = {};
  for (const [who, local] of Object.entries(PEOPLE)) {
    const login = await call(null, "POST", "/v1/auth/login", {
      email: `${local}@gonxt.ae`,
      password: PASSWORD,
      tenantSlug: "gonxt"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const verified = await app.fetch(
      new Request("http://api.test/v1/auth/mfa/verify", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          code: await totpAt(DEMO_TOTP_SECRET, Math.floor(Date.now() / 1000 / TOTP_STEP_SEC))
        })
      }),
      env as never,
      exec as never
    );
    expect(verified.status).toBe(200);
    tokens[who] = token;
  }

  const now = Date.now();
  const tenantId = newId("tn", now);
  await database.insert(schema.tenants).values({
    id: tenantId,
    slug: "otherco2",
    name: "Other Co 2",
    status: "active",
    createdAt: now,
    updatedAt: now
  });
  foreignSopId = newId("sop", now);
  await database.insert(schema.axisSops).values({
    id: foreignSopId,
    tenantId,
    key: "onboarding",
    version: 1,
    nameJson: JSON.stringify({ en: "Onboarding" }),
    stepsJson: JSON.stringify([]),
    status: "draft",
    createdBy: "user:seed",
    createdAt: now
  });
}, 120_000);

async function draftSop(key: string, version: number): Promise<string> {
  const res = await call("lead", "POST", "/v1/axis/sops", {
    key,
    version,
    nameJson: { en: `Procedure ${version}` },
    stepsJson: [{ step: "review" }]
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

const publish = (who: string, sopId: string) => call(who, "POST", `/v1/axis/sops/${sopId}/publish`);

describe("POST /v1/axis/sops/:id/publish", () => {
  it("activates a draft version", async () => {
    const sopId = await draftSop("intake", 1);
    const res = await publish("lead", sopId);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
  });

  it("retires the version it replaces, atomically", async () => {
    const key = "kyc";
    const v1 = await draftSop(key, 1);
    expect((await publish("lead", v1)).status).toBe(200);
    const v2 = await draftSop(key, 2);
    expect((await publish("lead", v2)).status).toBe(200);

    const rows = await database.select().from(schema.axisSops).where(eq(schema.axisSops.key, key));
    const byId = new Map(rows.map((r) => [r.id, r.status]));
    expect(byId.get(v1)).toBe("retired");
    expect(byId.get(v2)).toBe("active");
  });

  it("refuses a second publish with a 409 naming the state", async () => {
    const sopId = await draftSop("escalation", 1);
    expect((await publish("lead", sopId)).status).toBe(200);
    const again = await publish("lead", sopId);
    expect(again.status).toBe(409);
    expect(String(again.body.detail)).toContain("active");
  });

  it("is 403 for a session without axis:sops:write", async () => {
    const sopId = await draftSop("assign", 1);
    expect((await publish("agent", sopId)).status).toBe(403);
  });

  it("is 404 for a sop in another tenant", async () => {
    expect((await publish("lead", foreignSopId)).status).toBe(404);
  });

  it("writes an audit entry naming the publish", async () => {
    const sopId = await draftSop("verify", 1);
    expect((await publish("lead", sopId)).status).toBe(200);
    const rows = await database.select().from(schema.auditLog);
    const entry = rows.find((a) => a.subjectRef === sopId && a.action === "axis.sops.publish");
    expect(entry).toBeDefined();
    expect(entry?.actorRef).toMatch(/^user:/);
  });
});
```

- [ ] **Step 8: Run it and watch it fail**

Run: `pnpm --filter @lyra/api vitest run axis-sops.test.ts`
Expected: FAIL — every `publish()` call gets a 404, because `/sops/:id/publish` does not exist yet.

- [ ] **Step 9: Implement the route**

In `apps/api/src/routes/axis.ts`, change the import line:

```ts
import { eq } from "drizzle-orm";
```

to:

```ts
import { and, eq, not } from "drizzle-orm";
```

Then append, at the end of the file (after the closing `});` of `/documents/:id/extract`):

```ts

// docs/03 §AXIS admin. The one axis verb generated CRUD cannot express for
// SOPs: publish. Setting `status` to "active" through the generic PATCH does
// nothing about the version it replaces, so two versions of the same
// procedure could sit "active" at once — whichever the caller last touched.
// This makes the swap atomic, and "rollback" is just publishing an older
// version again — no separate endpoint.
axisRoutes.post("/sops/:id/publish", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "axis:sops:write", { tenantId: ctx.tenantId, module: "axis" });
  const rowId = c.req.param("id");
  const before = await must(ctx, schema.axisSops, rowId, "sops");
  if (before.status === "active") throw conflict(`sop is already ${before.status}`);
  await ctx.db
    .update(schema.axisSops)
    .set({ status: "retired" })
    .where(
      scoped(
        ctx,
        schema.axisSops,
        and(eq(schema.axisSops.key, before.key), eq(schema.axisSops.status, "active"), not(eq(schema.axisSops.id, rowId)))
      )
    );
  const stamp = { status: "active" as const };
  await ctx.db
    .update(schema.axisSops)
    .set(stamp)
    .where(scoped(ctx, schema.axisSops, eq(schema.axisSops.id, rowId)));
  const after = { ...before, ...stamp };
  await audit(ctx, { action: "axis.sops.publish", subjectRef: rowId, before, after });
  return c.json(after);
});
```

- [ ] **Step 10: Run the test again**

Run: `pnpm --filter @lyra/api vitest run axis-sops.test.ts`
Expected: PASS

- [ ] **Step 11: Add the `ops-policies` tab**

In `apps/web/app/modules/axis.ts`, in the `en` labels block, add a line immediately after `"case-approvals": "Case approvals",`:

```ts
      "ops-policies": "Operating policies",
```

In the `ar` labels block, add a line immediately after `"case-approvals": "موافقات الحالة",`:

```ts
      "ops-policies": "سياسات التشغيل",
```

Then, in the tabs array, insert a new tab immediately after the `process-events` tab closes (after its `}`, before the array's closing `]`):

```ts
    },
    {
      key: "ops-policies",
      api: "/v1/axis/ops-policies",
      read: "axis:ops_policies:read",
      create: "axis:ops_policies:write",
      update: "axis:ops_policies:write",
      remove: "axis:ops_policies:write",
      filters: [{ name: "status", options: ["active", "disabled"] }],
      columns: [
        { name: "key", type: "text", sortable: true },
        { name: "kind", type: "text", badge: true },
        { name: "status", type: "text", badge: true },
        { name: "updatedAt", type: "datetime", sortable: true }
      ],
      fields: [
        { name: "key", type: "text", required: true },
        { name: "kind", type: "select", options: ["sla", "routing", "queue"], required: true },
        { name: "valueJson", type: "json", required: true }
      ],
      editable: [
        { name: "status", type: "select", options: ["active", "disabled"] },
        { name: "valueJson", type: "json" }
      ]
    }
```

(Note: the `process-events` tab's own closing `}` currently has no trailing comma because it is last in the array — this step's edit must add that comma when it becomes second-to-last.)

- [ ] **Step 12: Write the failing test for the Admin console screen**

Create `apps/web/app/routes/axis-admin.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import type { Env } from "../env";
import { LABELS, action, connectorHealth, connectorTone, labelsIn } from "./axis-admin";

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(reply: Response) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    calls.push({ url: String(input), method: init.method ?? "GET" });
    return Promise.resolve(reply.clone());
  });
  return calls;
}

function args(form: FormData): ActionFunctionArgs {
  return {
    request: new Request("https://web.test/axis/admin", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as ActionFunctionArgs;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("labelsIn", () => {
  it("keeps ar on exactly the keys en has", () => {
    expect(Object.keys(LABELS.ar ?? {}).sort()).toEqual(Object.keys(LABELS.en ?? {}).sort());
  });

  it("translates every key rather than echoing english", () => {
    for (const [key, value] of Object.entries(LABELS.ar ?? {})) {
      expect(value.trim(), key).not.toBe("");
      expect(value, key).not.toBe(LABELS.en?.[key]);
    }
  });

  it("falls back to the key rather than rendering nothing", () => {
    expect(labelsIn("de")("title")).toBe(LABELS.en?.title);
    expect(labelsIn("en")("nope")).toBe("nope");
  });
});

describe("connectorHealth", () => {
  it("counts deliveries per webhook by status, and finds the latest", () => {
    const hooks = [{ id: "whk_1", url: "https://hooks.test/a", status: "active" }];
    const deliveries = [
      { webhookId: "whk_1", status: "delivered", createdAt: 100 },
      { webhookId: "whk_1", status: "delivered", createdAt: 200 },
      { webhookId: "whk_1", status: "failed", createdAt: 150 },
      { webhookId: "whk_1", status: "dead", createdAt: 50 }
    ];
    expect(connectorHealth(hooks, deliveries)).toEqual([
      { webhookId: "whk_1", url: "https://hooks.test/a", status: "active", delivered: 2, failed: 1, dead: 1, pending: 0, lastDeliveryAt: 200 }
    ]);
  });

  it("reports a webhook with no deliveries yet rather than throwing", () => {
    const hooks = [{ id: "whk_2", url: "https://hooks.test/b", status: "active" }];
    expect(connectorHealth(hooks, [])).toEqual([
      { webhookId: "whk_2", url: "https://hooks.test/b", status: "active", delivered: 0, failed: 0, dead: 0, pending: 0, lastDeliveryAt: null }
    ]);
  });
});

describe("connectorTone", () => {
  it("is danger with any dead delivery, warning with any failure, success otherwise", () => {
    expect(connectorTone({ dead: 1, failed: 0 })).toBe("danger");
    expect(connectorTone({ dead: 0, failed: 1 })).toBe("warning");
    expect(connectorTone({ dead: 0, failed: 0 })).toBe("success");
  });
});

describe("publish", () => {
  it("returns the published sop id", async () => {
    const calls = stubFetch(
      new Response(JSON.stringify({ id: "sop_1", status: "active" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await action(args(form({ intent: "publish", sopId: "sop_1" })));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/sops/sop_1/publish");
    expect(calls[0]?.method).toBe("POST");
    expect(result.published).toBe("sop_1");
  });

  it("needs a sop id", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const result = await action(args(form({ intent: "publish" })));
    expect(result.problem?.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("surfaces a refusal as a Problem rather than throwing", async () => {
    stubFetch(
      new Response(JSON.stringify({ title: "conflict", status: 409, detail: "sop is already active" }), {
        status: 409,
        headers: { "content-type": "application/json" }
      })
    );
    const result = await action(args(form({ intent: "publish", sopId: "sop_1" })));
    expect(result.problem?.status).toBe(409);
    expect(result.published).toBeNull();
  });
});

describe("unknown intent", () => {
  it("answers 400 without calling the API", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const result = await action(args(form({ intent: "nope" })));
    expect(result.problem?.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
```

- [ ] **Step 13: Run it and watch it fail**

Run: `pnpm --filter @lyra/web vitest run axis-admin.test.ts`
Expected: FAIL with a module-resolution error — `./axis-admin` does not exist yet.

- [ ] **Step 14: Implement the screen**

Create `apps/web/app/routes/axis-admin.tsx`:

```tsx
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs
} from "react-router";
import { Badge, Button, Card, EmptyState, Stat, Table, type BadgeTone, type Column } from "@lyra/ui";
import { ApiError, api, fetchMe, type Problem } from "../api.server";
import { cloudflare } from "../context";
import { translator } from "../i18n";
import { Gate } from "./staff";
import { useShellData } from "./workspace";

// docs/03 §AXIS admin. Three things an AXIS admin needs that no generated
// list gives them: publishing a SOP version (the swap has to be atomic — see
// apps/api/src/routes/axis.ts), a read on whether the tenant's outbound
// webhooks are actually delivering, and the door into SLA/routing/queue
// policy, which is otherwise a plain generated resource (the `ops-policies`
// module tab) and does not need a bespoke editor here.

/* --------------------------------------------------------------- contract */

export const PERM = {
  sopsRead: "axis:sops:read",
  sopsWrite: "axis:sops:write",
  hooksRead: "core:webhooks:read"
} as const;

export interface SopRow {
  id: string;
  key: string;
  version: number;
  status: string;
  appliesTo: string | null;
  createdAt: number;
}

export interface HookRow {
  id: string;
  url: string;
  status: string;
}

export interface DeliveryRow {
  webhookId: string;
  status: string;
  createdAt: number;
}

export interface HealthRow {
  webhookId: string;
  url: string;
  status: string;
  delivered: number;
  failed: number;
  dead: number;
  pending: number;
  lastDeliveryAt: number | null;
}

/** Per-webhook delivery counts, from the tables core.ts already exposes generically. */
export function connectorHealth(hooks: HookRow[], deliveries: DeliveryRow[]): HealthRow[] {
  return hooks.map((hook) => {
    const rows = deliveries.filter((d) => d.webhookId === hook.id);
    return {
      webhookId: hook.id,
      url: hook.url,
      status: hook.status,
      delivered: rows.filter((r) => r.status === "delivered").length,
      failed: rows.filter((r) => r.status === "failed").length,
      dead: rows.filter((r) => r.status === "dead").length,
      pending: rows.filter((r) => r.status === "pending").length,
      lastDeliveryAt: rows.reduce<number | null>((max, r) => (max === null || r.createdAt > max ? r.createdAt : max), null)
    };
  });
}

export function connectorTone(row: Pick<HealthRow, "dead" | "failed">): BadgeTone {
  if (row.dead > 0) return "danger";
  if (row.failed > 0) return "warning";
  return "success";
}

/* ----------------------------------------------------------------- labels */

export const LABELS: Record<string, Record<string, string>> = {
  en: {
    title: "AXIS admin",
    intro: "Publish procedures, read connector health, and reach operating policy.",
    deniedTitle: "You cannot read AXIS admin settings",
    sopsTitle: "Procedures",
    sopsIntro: "The version marked active is the one cases follow. Publishing one retires whichever version it replaces.",
    sopsCaption: "Procedure versions",
    sopsEmpty: "No procedures yet.",
    colKey: "Procedure",
    colVersion: "Version",
    colStatus: "Status",
    colApplies: "Applies to",
    publish: "Publish",
    opsTitle: "Operating policy",
    opsIntro: "SLA, routing and queue policy for this tenant.",
    opsManage: "Open operating policy",
    connectorsTitle: "Connector health",
    connectorsIntro: "Outbound webhook delivery over the deliveries recorded so far.",
    connectorsCaption: "Webhooks",
    connectorsEmpty: "No webhook is configured.",
    colUrl: "Endpoint",
    colDelivered: "Delivered",
    colFailed: "Failed",
    colDead: "Dead",
    colPending: "Pending",
    hooksManage: "Manage webhooks in the developer console"
  },
  ar: {
    title: "إدارة AXIS",
    intro: "انشر الإجراءات، اطّلع على سلامة الموصلات، وادخل إلى سياسات التشغيل.",
    deniedTitle: "لا يمكنك قراءة إعدادات إدارة AXIS",
    sopsTitle: "الإجراءات",
    sopsIntro: "النسخة المفعّلة هي التي تتبعها الحالات. نشر نسخة يقاعد النسخة التي تحل محلها.",
    sopsCaption: "نسخ الإجراءات",
    sopsEmpty: "لا توجد إجراءات بعد.",
    colKey: "الإجراء",
    colVersion: "النسخة",
    colStatus: "الحالة",
    colApplies: "ينطبق على",
    publish: "نشر",
    opsTitle: "سياسة التشغيل",
    opsIntro: "سياسات الخدمة والتوجيه والطابور لهذا المستأجر.",
    opsManage: "افتح سياسة التشغيل",
    connectorsTitle: "سلامة الموصلات",
    connectorsIntro: "تسليم الويب هوك الصادر بحسب عمليات التسليم المسجّلة حتى الآن.",
    connectorsCaption: "الويب هوك",
    connectorsEmpty: "لا يوجد ويب هوك مهيّأ.",
    colUrl: "نقطة النهاية",
    colDelivered: "تم التسليم",
    colFailed: "فشل",
    colDead: "متوقف",
    colPending: "قيد الانتظار",
    hooksManage: "إدارة الويب هوك في وحدة تحكم المطورين"
  }
};

export function labelsIn(locale: string): (key: string, vars?: Record<string, string>) => string {
  const t = translator(locale);
  const table = LABELS[locale] ?? LABELS.en!;
  const fallback = LABELS.en!;
  return (key, vars) => {
    const local = table[key] ?? fallback[key];
    const shared = local ?? t(`common.${key}`);
    const raw = shared === `common.${key}` ? key : shared;
    return vars ? raw.replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match) : raw;
  };
}

/* ------------------------------------------------------------------ loader */

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return fallback;
    throw error;
  }
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const me = await fetchMe(env, request);
  const held = new Set(me.permissions);
  const may = {
    sopsRead: held.has(PERM.sopsRead),
    sopsWrite: held.has(PERM.sopsWrite),
    hooksRead: held.has(PERM.hooksRead)
  };

  const [sops, hooks, deliveries] = await Promise.all([
    may.sopsRead
      ? safe(() => api<{ data: SopRow[] }>("/v1/axis/sops?limit=100", { env, request }), { data: [] })
      : { data: [] },
    may.hooksRead
      ? safe(() => api<{ data: HookRow[] }>("/v1/core/webhooks?limit=100", { env, request }), { data: [] })
      : { data: [] },
    may.hooksRead
      ? safe(
          () => api<{ data: DeliveryRow[] }>("/v1/core/webhook-deliveries?limit=500&sort=createdAt&order=desc", { env, request }),
          { data: [] }
        )
      : { data: [] }
  ]);

  return {
    may,
    sops: sops.data,
    health: connectorHealth(hooks.data, deliveries.data),
    problem: null as Problem | null
  };
}

/* ------------------------------------------------------------------ action */

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  const nothing = { problem: null as Problem | null, published: null as string | null };
  const intent = String(form.get("intent") ?? "");
  if (intent !== "publish") return { ...nothing, problem: { title: "unknown intent", status: 400 } };
  const sopId = String(form.get("sopId") ?? "").trim();
  if (!sopId) return { ...nothing, problem: { title: "sop required", status: 400 } };

  try {
    const published = await api<{ id: string; status: string }>(`/v1/axis/sops/${encodeURIComponent(sopId)}/publish`, {
      env,
      request,
      method: "POST"
    });
    return { ...nothing, published: published.id };
  } catch (error) {
    if (error instanceof ApiError) return { ...nothing, problem: error.problem };
    throw error;
  }
}

/* --------------------------------------------------------------- component */

export default function AxisAdmin() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const shell = useShellData();
  const locale = shell?.locale ?? "en";
  const t = translator(locale);
  const l = labelsIn(locale);
  const busy = useNavigation().state !== "idle";

  if (!loaded.may.sopsRead && !loaded.may.hooksRead) {
    return (
      <div className="flex flex-col gap-6">
        <Header l={l} />
        <EmptyState title={l("deniedTitle")} body={t("error.forbidden")} />
      </div>
    );
  }

  const sopColumns: Array<Column<SopRow>> = [
    { key: "key", header: l("colKey"), render: (row) => <span className="font-mono text-12">{row.key}</span> },
    { key: "version", header: l("colVersion"), numeric: true, render: (row) => row.version },
    {
      key: "status",
      header: l("colStatus"),
      render: (row) => (
        <Badge tone={row.status === "active" ? "success" : row.status === "retired" ? "neutral" : "info"} size="sm" dot>
          {row.status}
        </Badge>
      )
    },
    { key: "appliesTo", header: l("colApplies"), render: (row) => row.appliesTo ?? "" },
    {
      key: "publish",
      header: t("common.actions"),
      render: (row) =>
        loaded.may.sopsWrite && row.status !== "active" ? (
          <Form method="post">
            <input type="hidden" name="intent" value="publish" />
            <input type="hidden" name="sopId" value={row.id} />
            <Button type="submit" variant="ghost" size="sm" loading={busy}>
              {l("publish")}
            </Button>
          </Form>
        ) : null
    }
  ];

  const healthColumns: Array<Column<HealthRow>> = [
    { key: "url", header: l("colUrl"), render: (row) => <span className="font-mono text-12 break-all">{row.url}</span> },
    { key: "delivered", header: l("colDelivered"), numeric: true, render: (row) => row.delivered },
    {
      key: "failed",
      header: l("colFailed"),
      numeric: true,
      render: (row) => (
        <Badge tone={connectorTone(row)} size="sm">
          {row.failed}
        </Badge>
      )
    },
    { key: "dead", header: l("colDead"), numeric: true, render: (row) => row.dead },
    { key: "pending", header: l("colPending"), numeric: true, render: (row) => row.pending }
  ];

  return (
    <div className="flex flex-col gap-6">
      <Header l={l} />

      {result?.problem ? <Gate problem={result.problem} l={l} /> : null}

      {loaded.may.sopsRead ? (
        <Card title={l("sopsTitle")} description={l("sopsIntro")}>
          <Table
            caption={l("sopsCaption")}
            columns={sopColumns}
            rows={loaded.sops}
            rowKey={(row) => row.id}
            rowState={(row) => (row.status === "retired" ? "sealed" : undefined)}
            empty={<EmptyState title={l("sopsEmpty")} />}
          />
        </Card>
      ) : null}

      <Card title={l("opsTitle")} description={l("opsIntro")}>
        <Link to="/axis/ops-policies" className="font-ui text-13 text-accent underline underline-offset-2">
          {l("opsManage")}
        </Link>
      </Card>

      {loaded.may.hooksRead ? (
        <Card title={l("connectorsTitle")} description={l("connectorsIntro")}>
          <div className="flex flex-col gap-3">
            <div className="grid gap-4 sm:grid-cols-4">
              <Stat label={l("colDelivered")} value={String(loaded.health.reduce((sum, r) => sum + r.delivered, 0))} />
              <Stat label={l("colFailed")} value={String(loaded.health.reduce((sum, r) => sum + r.failed, 0))} />
              <Stat label={l("colDead")} value={String(loaded.health.reduce((sum, r) => sum + r.dead, 0))} />
              <Stat label={l("colPending")} value={String(loaded.health.reduce((sum, r) => sum + r.pending, 0))} />
            </div>
            <Table
              caption={l("connectorsCaption")}
              columns={healthColumns}
              rows={loaded.health}
              rowKey={(row) => row.webhookId}
              empty={<EmptyState title={l("connectorsEmpty")} />}
            />
            <Link to="/admin/developer" className="font-ui text-13 text-accent underline underline-offset-2">
              {l("hooksManage")}
            </Link>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Header({ l }: { l: (key: string) => string }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="font-display text-24 text-text">{l("title")}</h1>
      <p className="max-w-prose font-ui text-13 text-muted">{l("intro")}</p>
    </header>
  );
}
```

- [ ] **Step 15: Register the route**

In `apps/web/app/routes.ts`, insert a line immediately after `route("axis/analytics", "routes/axis-analytics.tsx"),` (line 50):

```ts
    route("axis/admin", "routes/axis-admin.tsx"),
```

- [ ] **Step 16: Run the test again**

Run: `pnpm --filter @lyra/web vitest run axis-admin.test.ts`
Expected: PASS

- [ ] **Step 17: Run the full backend suite and typecheck**

Run: `pnpm --filter @lyra/api vitest run && pnpm --filter @lyra/api typecheck && pnpm --filter @lyra/db typecheck`
Expected: PASS

- [ ] **Step 18: Run the full frontend suite and typecheck**

Run: `pnpm --filter @lyra/web vitest run && pnpm --filter @lyra/web typecheck`
Expected: PASS

- [ ] **Step 19: Commit**

```bash
git add packages/db/src/schema/axis.ts packages/db/src/schema.ts packages/db/migrations \
  packages/core/src/rbac.ts apps/api/src/resources.ts apps/api/src/routes/axis.ts apps/api/src/axis-sops.test.ts \
  apps/web/app/modules/axis.ts apps/web/app/routes/axis-admin.tsx apps/web/app/routes/axis-admin.test.ts apps/web/app/routes.ts
git commit -m "feat(axis): add the AXIS admin console — SOP publish, operating policy, connector health"
```

---

## Task 4: AXIS Dev console

Three integrator-facing pieces: a webhook test-ping button on the existing developer portal (reuses the real delivery path, no fake queued event), and a new extraction-playground screen that runs the real `axis.document.extract` prompt against pasted sample text with no document row attached. The `dev:sandbox:use` permission and its grant to `dev.developer`/`partner.developer` already exist in `packages/core/src/rbac.ts` (added for the existing API-key sandbox) — nothing new to add there.

**Files:**
- Modify: `apps/api/src/routes/core.ts` — `POST /v1/core/webhooks/:id/test`
- Modify: `apps/api/src/api-keys.test.ts`
- Modify: `apps/api/src/routes/axis.ts` — `POST /v1/axis/dev/extract-sample`
- Create: `apps/api/src/axis-dev.test.ts`
- Modify: `apps/web/app/routes/admin-developer.tsx`
- Modify: `apps/web/app/routes/admin-developer.test.ts`
- Create: `apps/web/app/routes/axis-dev.tsx`
- Create: `apps/web/app/routes/axis-dev.test.ts`
- Modify: `apps/web/app/routes.ts`

**Interfaces:**
- Consumes: `deliver(ctx, hook, envelope, attempt)` from `apps/api/src/dispatch.ts` (existing, unchanged) — returns `{ok: boolean; status?: number; error?: string}`. `EXTRACTION_FIELDS`, `extractionSchema`, `parseExtraction` from `@lyra/model-gateway` (existing, unchanged). `bodyFrom`, `FieldSpec`, `optionLabel` from `apps/web/app/modules/spec.ts` (existing, unchanged). `api<T>`, `ApiError`, `fetchMe` from `apps/web/app/api.server.ts` (existing, unchanged).
- Produces: `TestPing` (`{ok, status?, error?}`) and `Rotated` types in `admin-developer.tsx`, reused nowhere else. `axis-dev.tsx`'s `FIELDS` array (`docType`, `locale`, `rawText`) matches `SampleExtractBody`'s zod shape exactly — no later task depends on it.

- [ ] **Step 1: Write the failing backend test for the webhook test-ping route**

Append to `apps/api/src/api-keys.test.ts`, after the existing `describe("POST /v1/core/webhooks/:id/rotate", ...)` block:

```ts
describe("POST /v1/core/webhooks/:id/test", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("delivers a signed test event and reports the response status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const created = await register("admin", { url: "https://hooks.example.com/test-ok", eventTypesJson: [] });
    const res = await call(tokens.admin!, "POST", `/v1/core/webhooks/${created.body.id}/test`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe(200);
  });

  it("reports a failed delivery without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    const created = await register("admin", { url: "https://hooks.example.com/test-fail", eventTypesJson: [] });
    const res = await call(tokens.admin!, "POST", `/v1/core/webhooks/${created.body.id}/test`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.status).toBe(500);
  });

  it("writes an audit entry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const created = await register("admin", { url: "https://hooks.example.com/test-audit", eventTypesJson: [] });
    await call(tokens.admin!, "POST", `/v1/core/webhooks/${created.body.id}/test`);
    const rows = await database.select().from(schema.auditLog);
    const entry = rows.find((a) => a.action === "core.webhooks.test" && a.subjectRef === `webhooks:${created.body.id}`);
    expect(entry).toBeDefined();
  });

  it("is 403 for a session without core:webhooks:read", async () => {
    const created = await register("admin", { url: "https://hooks.example.com/test-403", eventTypesJson: [] });
    const res = await call(tokens.agent!, "POST", `/v1/core/webhooks/${created.body.id}/test`);
    expect(res.status).toBe(403);
  });

  it("404s testing another tenant's webhook", async () => {
    const created = await register("admin", { url: "https://hooks.example.com/test-foreign", eventTypesJson: [] });
    const res = await call(otherKey, "POST", `/v1/core/webhooks/${created.body.id}/test`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lyra/api vitest run api-keys.test.ts -t "webhooks/:id/test"`
Expected: FAIL — `404 Not Found` (no such route yet).

- [ ] **Step 3: Implement the route**

In `apps/api/src/routes/core.ts`, after the existing `coreRoutes.post("/webhooks/:id/rotate", ...)` block, add:

```ts
// docs/20 developer console "webhook tester". Reuses the real delivery path
// (dispatch.ts `deliver`) with a hand-built envelope rather than a queued
// event, so the receiver gets the exact signature scheme production events
// use, without waiting on the outbox or leaving a fake row behind for it.
coreRoutes.post("/webhooks/:id/test", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "core:webhooks:read", { tenantId: ctx.tenantId, module: "core" });
  const rowId = c.req.param("id");
  const hook = await must(ctx, schema.webhooks, rowId, "webhooks");

  const envelope: Envelope = {
    id: newId("ev", ctx.now),
    ts: ctx.now,
    tenant_id: ctx.tenantId,
    module: "core",
    type: "core.webhooks.test",
    actor: actorRef(ctx),
    data: { message: "This is a test event from the LYRA developer console." },
    v: 1
  };
  const result = await deliver(ctx, hook, envelope, 1);
  await audit(ctx, { action: "core.webhooks.test", subjectRef: `webhooks:${rowId}`, after: result });
  return c.json(result);
});
```

`Envelope`, `deliver`, `newId`, `actorRef` are already imported at the top of `core.ts` for the rest of the file's routes — no new imports needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lyra/api vitest run api-keys.test.ts -t "webhooks/:id/test"`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the failing backend test for the extraction sandbox**

Create `apps/api/src/axis-dev.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeAll, describe, expect, it } from "vitest";
import { seed, totpAt, TOTP_STEP_SEC } from "@lyra/core";
import { type Db } from "@lyra/db";
import { app } from "./index.js";
import type { Env } from "./env.js";

// docs/20 developer console. Same stub convention as axis-extraction.test.ts:
// the `AI` binding is faked at the Workers AI boundary so the real gateway
// call, budget and ai_audit_log row are all still exercised.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const exec = { waitUntil() {}, passThroughOnException() {} };

/** raed.samir (dev.admin) holds dev:sandbox:use; layla.hassan (axis.agent) holds no dev:* permission. */
const PEOPLE: Record<string, string> = {
  dev: "raed.samir",
  outsider: "layla.hassan"
};

const FIELD_VALUES: Record<string, string> = {
  fullName: "Ahmed Al Mansoori",
  idNumber: "784-1985-1234567-1",
  dateOfBirth: "1985-04-12",
  expiryDate: "2029-11-03",
  nationality: "United Arab Emirates",
  plateNumber: "DXB A 12345",
  ownerName: "Omar Khalid",
  vehicleModel: "Toyota Camry 2022",
  registrationExpiry: "2026-12-01"
};

let env: Env;
let database: Db;
let tokens: Record<string, string>;

interface Res<T = any> {
  status: number;
  body: T;
}

async function call<T = any>(
  who: string | null,
  method: string,
  path: string,
  payload?: unknown
): Promise<Res<T>> {
  const token = who ? tokens[who] : undefined;
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
    }),
    env as never,
    exec as never
  );
  const text = res.headers.get("content-type")?.includes("json") ? await res.text() : "";
  return { status: res.status, body: text ? (JSON.parse(text) as T) : (null as T) };
}

beforeAll(async () => {
  const client = createClient({ url: ":memory:" });
  const statements = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) await client.execute(stmt);
  database = drizzle(client) as unknown as Db;
  await seed(database as never, { mfaSecret: DEMO_TOTP_SECRET });
  env = {
    DB_CLIENT: database,
    ENVIRONMENT: "development",
    APP_ORIGIN: "http://localhost:5173",
    AI: {
      run: async (_model: string, input: any) => {
        const fields: string[] = Object.keys(input?.response_format?.json_schema?.schema?.properties ?? {});
        const out: Record<string, string> = {};
        for (const f of fields) out[f] = FIELD_VALUES[f] ?? "";
        return { response: JSON.stringify(out) };
      }
    }
  } as unknown as Env;

  tokens = {};
  for (const [who, local] of Object.entries(PEOPLE)) {
    const login = await call(null, "POST", "/v1/auth/login", {
      email: `${local}@gonxt.ae`,
      password: PASSWORD,
      tenantSlug: "gonxt"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const verified = await app.fetch(
      new Request("http://api.test/v1/auth/mfa/verify", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          code: await totpAt(DEMO_TOTP_SECRET, Math.floor(Date.now() / 1000 / TOTP_STEP_SEC))
        })
      }),
      env as never,
      exec as never
    );
    expect(verified.status).toBe(200);
    tokens[who] = token;
  }
}, 120_000);

const sample = (who: string, payload: unknown) => call(who, "POST", "/v1/axis/dev/extract-sample", payload);

describe("POST /v1/axis/dev/extract-sample", () => {
  it("structures eid sample text into named fields", async () => {
    const res = await sample("dev", { docType: "eid", rawText: "EID text", locale: "en" });
    expect(res.status).toBe(200);
    expect(res.body.confidence).toBe(100);
    expect(res.body.model).toBeTruthy();
    expect(res.body.values).toEqual({
      fullName: "Ahmed Al Mansoori",
      idNumber: "784-1985-1234567-1",
      dateOfBirth: "1985-04-12",
      expiryDate: "2029-11-03",
      nationality: "United Arab Emirates"
    });
  });

  it("structures mulkiya sample text (arabic locale) into named fields", async () => {
    const res = await sample("dev", { docType: "mulkiya", rawText: "Mulkiya text", locale: "ar" });
    expect(res.status).toBe(200);
    expect(res.body.values).toEqual({
      plateNumber: "DXB A 12345",
      ownerName: "Omar Khalid",
      vehicleModel: "Toyota Camry 2022",
      registrationExpiry: "2026-12-01"
    });
  });

  it("is 403 for a session without dev:sandbox:use", async () => {
    const res = await sample("outsider", { docType: "eid", rawText: "EID text" });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @lyra/api vitest run axis-dev.test.ts`
Expected: FAIL — `404 Not Found`.

- [ ] **Step 7: Implement the route**

In `apps/api/src/routes/axis.ts`, after the existing `/documents/:id/extract` route, add:

```ts
const SampleExtractBody = z.object({
  docType: z.enum(["eid", "mulkiya"]),
  rawText: z.string().min(1).max(20_000),
  locale: z.enum(["en", "ar"]).default("en")
});

/**
 * docs/20 developer console. Same field-extraction call as
 * `/documents/:id/extract`, minus the document row, audit trail and
 * embedding — a scratch space to check a prompt/schema before wiring a real
 * upload. `docType`'s zod enum already limits input to the two keys
 * `EXTRACTION_FIELDS` defines, so there's no missing-schema case to guard.
 */
axisRoutes.post("/dev/extract-sample", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "dev:sandbox:use", { tenantId: ctx.tenantId, module: "dev" });
  const input = await body(c, SampleExtractBody);
  // `docType`'s zod enum limits input to the two keys EXTRACTION_FIELDS defines.
  const fields = EXTRACTION_FIELDS[input.docType]!;

  const result = await c.get("gateway").complete(ctx, {
    module: "axis",
    purpose: "axis.dev.extract_sample",
    tier: "standard",
    locale: input.locale,
    responseSchema: extractionSchema(fields),
    messages: [
      {
        role: "system",
        content:
          `Extract these fields from the ${input.docType} document text below and reply with ` +
          `JSON only, matching the schema: ${fields.join(", ")}. Locale: ${input.locale}.`
      },
      { role: "user", content: input.rawText }
    ]
  });

  const { values, confidence } = parseExtraction(result.text, fields);
  return c.json({ values, confidence, model: result.model });
});
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter @lyra/api vitest run axis-dev.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 9: Write the failing frontend test for the test-ping button**

In `apps/web/app/routes/admin-developer.test.ts`, insert a new `describe("test", ...)` block immediately before `describe("unknown intent", ...)`:

```ts
describe("test", () => {
  it("pings the endpoint and returns the delivery result", async () => {
    const calls = stubFetch(
      new Response(JSON.stringify({ ok: true, status: 200 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await action(args(form({ intent: "test", hookId: "whk_1" })));

    expect(calls[0]?.url).toBe("https://api.test/v1/core/webhooks/whk_1/test");
    expect(calls[0]?.method).toBe("POST");
    expect(result.tested).toEqual({ ok: true, status: 200 });
  });

  it("needs an endpoint", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));

    const result = await action(args(form({ intent: "test" })));

    expect(result.error).toBe("hookRequired");
    expect(calls).toHaveLength(0);
  });

  it("surfaces a refusal as a Problem rather than throwing", async () => {
    stubFetch(
      new Response(JSON.stringify({ title: "forbidden", status: 403 }), {
        status: 403,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await action(args(form({ intent: "test", hookId: "whk_1" })));

    expect(result.problem?.status).toBe(403);
    expect(result.tested).toBeNull();
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `pnpm --filter @lyra/web vitest run admin-developer.test.ts -t "test"`
Expected: FAIL — `action` has no `"test"` intent branch, `result.tested` is `undefined`.

- [ ] **Step 11: Implement the test-ping button in `admin-developer.tsx`**

Add the `TestPing` interface after `Rotated`:

```ts
/** apps/api/src/dispatch.ts `deliver`'s return shape, echoed back by the test-ping route. */
export interface TestPing {
  ok: boolean;
  status?: number;
  error?: string;
}
```

Add English `LABELS` keys after `hookRequired`, and revise `sandboxIntro`:

```ts
testPing: "Send test event",
testPingTitle: "Test delivery",
testPingOk: "Delivered",
testPingFailed: "Failed",
sandboxTitle: "Sandbox credentials",
sandboxIntro:
  "Test-mode API keys are the sandbox for API calls. For AI extraction, the developer console has a scratch space that runs the real prompt without a document row.",
sandboxLink: "Open the extraction playground",
```

Add the matching Arabic keys in the same positions:

```ts
testPing: "أرسل حدث اختبار",
testPingTitle: "نتيجة الاختبار",
testPingOk: "تم التسليم",
testPingFailed: "فشل",
sandboxTitle: "اعتمادات بيئة التجربة",
sandboxIntro:
  "مفاتيح وضع الاختبار هي بيئة التجربة لاستدعاءات الواجهة البرمجية. لاستخراج الذكاء الاصطناعي، توجد في وحدة المطوّرين بيئة تجربة تُشغّل الطلب الحقيقي دون سجل مستند.",
sandboxLink: "افتح بيئة تجربة الاستخراج",
```

Rewrite the `action` function to branch on `intent` before falling through to the existing rotate logic:

```ts
export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  const nothing = {
    problem: null as Problem | null,
    error: null as string | null,
    rotated: null as Rotated | null,
    tested: null as TestPing | null
  };
  const intent = String(form.get("intent") ?? "");

  if (intent === "test") {
    const hookId = String(form.get("hookId") ?? "").trim();
    if (!hookId) return { ...nothing, error: "hookRequired" };
    try {
      const tested = await api<TestPing>(`/v1/core/webhooks/${encodeURIComponent(hookId)}/test`, {
        env,
        request,
        method: "POST"
      });
      return { ...nothing, tested };
    } catch (error) {
      if (error instanceof ApiError) return { ...nothing, problem: error.problem };
      throw error;
    }
  }

  if (intent !== "rotate") return { ...nothing, problem: { title: "unknown intent", status: 400 } };

  // Rotation is destructive for the receiver — the previous secret stops
  // verifying the moment this returns — so it asks first.
  if (String(form.get("confirm") ?? "") !== "on") return { ...nothing, error: "confirmRequired" };
  const hookId = String(form.get("hookId") ?? "").trim();
  if (!hookId) return { ...nothing, error: "hookRequired" };
  const key = String(form.get("idempotencyKey") ?? "");
  const headers = key ? { "idempotency-key": key } : {};

  try {
    const rotated = await api<Rotated>(`/v1/core/webhooks/${encodeURIComponent(hookId)}/rotate`, {
      env,
      request,
      method: "POST",
      headers
    });
    // Returned, never redirected to: a redirect would drop the one copy of the
    // plaintext secret, and the API cannot mint it again.
    return { ...nothing, rotated: { id: rotated.id, url: rotated.url, secret: rotated.secret } };
  } catch (error) {
    if (error instanceof ApiError) return { ...nothing, problem: error.problem };
    throw error;
  }
}
```

Rename `hookColumns`' `"rotate"` column key to `"actions"`, combining the test-ping and rotate forms:

```tsx
{
  key: "actions",
  header: t("common.actions"),
  render: (row) => (
    <div className="flex flex-wrap items-center gap-2">
      <Form method="post">
        <input type="hidden" name="intent" value="test" />
        <input type="hidden" name="hookId" value={row.id} />
        <Button type="submit" variant="ghost" size="sm" loading={busy}>
          {l("testPing")}
        </Button>
      </Form>
      {loaded.may.hooksWrite ? (
        <Form method="post" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="intent" value="rotate" />
          <input type="hidden" name="hookId" value={row.id} />
          <input type="hidden" name="idempotencyKey" value={loaded.idempotencyKey} />
          <Checkbox name="confirm" value="on" label={l("rotateConfirm")} />
          <Button type="submit" variant="ghost" size="sm" loading={busy}>
            {l("rotate")}
          </Button>
        </Form>
      ) : null}
    </div>
  )
}
```

Render the result next to `RevealedSecret`, inside the hooks `Card`:

```tsx
{result?.rotated ? <RevealedSecret rotated={result.rotated} l={l} /> : null}
{result?.tested ? <TestPingResult tested={result.tested} l={l} /> : null}
```

Replace the sandbox `Card` at the bottom of the component:

```tsx
<Card title={l("sandboxTitle")}>
  <div className="flex flex-col gap-2">
    <p className="max-w-prose font-ui text-13 text-muted">{l("sandboxIntro")}</p>
    <Link to="/axis/dev" className="font-ui text-13 text-accent underline underline-offset-2">
      {l("sandboxLink")}
    </Link>
  </div>
</Card>
```

Add the `TestPingResult` component at the end of the file:

```tsx
function TestPingResult({ tested, l }: { tested: TestPing; l: (key: string) => string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-2 p-3">
      <h3 className="font-display text-14 text-text">{l("testPingTitle")}</h3>
      <Badge tone={tested.ok ? "success" : "danger"} size="sm" dot>
        {tested.ok ? l("testPingOk") : l("testPingFailed")}
      </Badge>
      {tested.status !== undefined ? <code className="font-mono text-12 text-muted">{tested.status}</code> : null}
      {tested.error ? (
        <p role="alert" className="font-ui text-12 text-danger">
          {tested.error}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `pnpm --filter @lyra/web vitest run admin-developer.test.ts`
Expected: PASS (17 tests)

- [ ] **Step 13: Write the failing frontend test for the extraction playground**

Create `apps/web/app/routes/axis-dev.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import type { Env } from "../env";
import { action } from "./axis-dev";

// docs/20 developer console sandbox. The action is a thin pass-through to
// /v1/axis/dev/extract-sample — these tests hold the request/response shape,
// not the extraction logic itself (that's apps/api/src/axis-dev.test.ts).

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(reply: Response) {
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    calls.push({
      url: String(input),
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? init.body : null
    });
    return Promise.resolve(reply.clone());
  });
  return calls;
}

function args(form: FormData): ActionFunctionArgs {
  return {
    request: new Request("https://web.test/axis/dev", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as ActionFunctionArgs;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("action", () => {
  it("sends the sample to the extraction endpoint and returns the parsed fields", async () => {
    const calls = stubFetch(
      new Response(JSON.stringify({ values: { idNumber: "784-1" }, confidence: 92, model: "gpt" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await action(
      args(form({ docType: "eid", locale: "en", rawText: "ID Number: 784-1" }))
    );

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/dev/extract-sample");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ docType: "eid", locale: "en", rawText: "ID Number: 784-1" });
    expect(result.result).toEqual({ values: { idNumber: "784-1" }, confidence: 92, model: "gpt" });
    expect(result.problem).toBeNull();
  });

  it("surfaces a refusal as a Problem rather than throwing", async () => {
    stubFetch(
      new Response(JSON.stringify({ title: "forbidden", status: 403 }), {
        status: 403,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await action(args(form({ docType: "eid", locale: "en", rawText: "text" })));

    expect(result.problem?.status).toBe(403);
    expect(result.result).toBeNull();
  });
});
```

- [ ] **Step 14: Run test to verify it fails**

Run: `pnpm --filter @lyra/web vitest run axis-dev.test.ts`
Expected: FAIL — `Cannot find module './axis-dev'`.

- [ ] **Step 15: Implement `axis-dev.tsx`**

Create `apps/web/app/routes/axis-dev.tsx`:

```tsx
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs
} from "react-router";
import { Button, EmptyState } from "@lyra/ui";
import { ApiError, api, fetchMe } from "../api.server";
import { FieldInput } from "../components/fields";
import { cloudflare } from "../context";
import { translator } from "../i18n";
import { bodyFrom, type FieldSpec } from "../modules/spec";
import { Problem } from "./module";
import { useShellData } from "./workspace";

// docs/20 developer console "extraction playground". Runs the exact prompt
// apps/api/src/routes/axis.ts's /documents/:id/extract uses, minus a document
// row, so an integrator can check a field schema against sample text before
// wiring a real upload.

const PERM = { sandbox: "dev:sandbox:use" } as const;

/** SampleExtractBody, apps/api/src/routes/axis.ts. */
const FIELDS: readonly FieldSpec[] = [
  { name: "docType", type: "select", options: ["eid", "mulkiya"], required: true },
  { name: "locale", type: "select", options: ["en", "ar"], required: true },
  { name: "rawText", type: "textarea", required: true, hintKey: "rawTextHint" }
];

interface Result {
  values: Record<string, string>;
  confidence: number;
  model: string;
}

/* ----------------------------------------------------------------- labels */

const LABELS: Record<string, Record<string, string>> = {
  en: {
    title: "Extraction playground",
    intro: "Runs the real document-extraction prompt on sample text, without a document to attach it to.",
    deniedTitle: "You cannot use the sandbox",
    docType: "Document type",
    "docType.eid": "Emirates ID",
    "docType.mulkiya": "Mulkiya",
    locale: "Locale",
    "locale.en": "English",
    "locale.ar": "Arabic",
    rawText: "Sample text",
    rawTextHint: "Paste OCR'd text as if it came off a real document.",
    extract: "Extract fields",
    resultsTitle: "Extracted fields",
    confidence: "Confidence",
    model: "Model",
    devLinkTitle: "Webhooks and API keys",
    devLink: "Open the developer portal"
  },
  ar: {
    title: "بيئة تجربة الاستخراج",
    intro: "تُشغّل طلب استخراج المستندات الحقيقي على نص تجريبي، دون مستند تُرفق به.",
    deniedTitle: "لا يمكنك استخدام بيئة التجربة",
    docType: "نوع المستند",
    "docType.eid": "هوية إماراتية",
    "docType.mulkiya": "ملكية",
    locale: "اللغة",
    "locale.en": "الإنجليزية",
    "locale.ar": "العربية",
    rawText: "نص تجريبي",
    rawTextHint: "الصق نصاً كما لو أنه استُخرج من مستند حقيقي.",
    extract: "استخرج الحقول",
    resultsTitle: "الحقول المستخرجة",
    confidence: "درجة الثقة",
    model: "النموذج",
    devLinkTitle: "الويب هوك ومفاتيح الواجهة البرمجية",
    devLink: "افتح بوابة المطوّرين"
  }
};

function labelsIn(locale: string): (key: string, vars?: Record<string, string>) => string {
  const table = LABELS[locale] ?? LABELS.en ?? {};
  const fallback = LABELS.en ?? {};
  const t = translator(locale);
  return (key, vars) => {
    const local = table[key] ?? fallback[key];
    const shared = local ?? t(`common.${key}`);
    const raw = shared === `common.${key}` ? key : shared;
    return vars ? raw.replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match) : raw;
  };
}

/* ------------------------------------------------------------------ loader */

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const me = await fetchMe(env, request);
  const may = { sandbox: me.permissions.includes(PERM.sandbox) };
  return { may };
}

/* ------------------------------------------------------------------ action */

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  const body = bodyFrom(FIELDS, form);

  try {
    const result = await api<Result>("/v1/axis/dev/extract-sample", { env, request, method: "POST", body });
    return { problem: null, result };
  } catch (error) {
    if (error instanceof ApiError) return { problem: error.problem, result: null };
    throw error;
  }
}

/* --------------------------------------------------------------- component */

export default function AxisDev() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const shell = useShellData();
  const navigation = useNavigation();

  const locale = shell?.locale ?? "en";
  const t = translator(locale);
  const l = labelsIn(locale);
  const busy = navigation.state !== "idle";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-24 text-text">{l("title")}</h1>
        <p className="max-w-prose font-ui text-13 text-muted">{l("intro")}</p>
      </header>

      {!loaded.may.sandbox ? (
        <EmptyState title={l("deniedTitle")} body={t("error.forbidden")} />
      ) : (
        <>
          {result?.problem ? <Problem problem={result.problem} /> : null}

          <Form method="post" className="flex flex-col gap-4 rounded-lg border border-border p-4">
            {FIELDS.map((field) => (
              <FieldInput key={field.name} field={field} label={l} />
            ))}
            <div>
              <Button type="submit" loading={busy}>
                {l("extract")}
              </Button>
            </div>
          </Form>

          {result?.result ? (
            <section aria-labelledby="results-heading" className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <h2 id="results-heading" className="font-display text-16 text-text">
                {l("resultsTitle")}
              </h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 font-ui text-13">
                {Object.entries(result.result.values).map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-subtle">{key}</dt>
                    <dd className="text-text">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="font-ui text-12 text-subtle">
                {l("confidence")}: {result.result.confidence}% &middot; {l("model")}: {result.result.model}
              </p>
            </section>
          ) : null}

          <div className="flex flex-col gap-1 rounded-lg border border-border p-4">
            <h2 className="font-display text-16 text-text">{l("devLinkTitle")}</h2>
            <Link to="/admin/developer" className="font-ui text-13 text-accent underline underline-offset-2">
              {l("devLink")}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 16: Register the route**

In `apps/web/app/routes.ts`, insert a line immediately after `route("axis/analytics", "routes/axis-analytics.tsx"),`:

```ts
    route("axis/dev", "routes/axis-dev.tsx"),
```

- [ ] **Step 17: Run test to verify it passes**

Run: `pnpm --filter @lyra/web vitest run axis-dev.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 18: Run the full backend and frontend suites and typecheck**

Run: `pnpm --filter @lyra/api vitest run && pnpm --filter @lyra/api typecheck && pnpm --filter @lyra/web vitest run && pnpm --filter @lyra/web typecheck`
Expected: PASS

- [ ] **Step 19: Commit**

```bash
git add apps/api/src/routes/core.ts apps/api/src/api-keys.test.ts apps/api/src/routes/axis.ts apps/api/src/axis-dev.test.ts \
  apps/web/app/routes/admin-developer.tsx apps/web/app/routes/admin-developer.test.ts \
  apps/web/app/routes/axis-dev.tsx apps/web/app/routes/axis-dev.test.ts apps/web/app/routes.ts
git commit -m "feat(axis): add the AXIS dev console — webhook test-ping and extraction playground"
```

---

## Task 5: Process Map

Frontend-only, no backend change. `axis_process_events` is already a generic CRUD resource (`apps/api/src/resources.ts:273`, `r("process-events", schema.axisProcessEvents, "pev", "axis", ro("axis:metrics:read"), { immutable: true })`), so `GET /v1/axis/process-events?sort=ts&order=asc&limit=2000` already works against the live API with zero new backend code. `apps/web/app/routes/case-detail.tsx` already tables a *single* case's steps — this screen is deliberately the other view: a tenant-wide window of recent steps, reduced into step-to-step transition counts and durations, drawn as a flow diagram. The transition tally and the diagram layout are two plain functions with no DOM and no fetch, so they're unit-tested directly the same way `apps/web/app/routes/axis-analytics.tsx`'s `statusRows`/`cycleStats` are — this route has no `action`, so there's nothing to test through a stubbed `fetch`.

**Files:**
- Create: `apps/web/app/routes/axis-process-map.tsx`
- Create: `apps/web/app/routes/axis-process-map.test.ts`
- Modify: `apps/web/app/routes.ts`

**Interfaces:**
- Consumes: `Header`, `labelsFrom`, `rowsOf`, `safe`, `tag`, `type Page` from `apps/web/app/routes/detail-kit.tsx` (existing, unchanged). `api`, `fetchMe` from `apps/web/app/api.server.ts` (existing, unchanged). `translator` from `apps/web/app/i18n.ts` (existing, unchanged). `useShellData` from `apps/web/app/routes/workspace.tsx` (existing, unchanged).
- Produces: `flowFrom(events: readonly FlowEvent[]): Flow` and `layoutFlow(flow: Flow, width: number, height: number): Layout`, exported from `axis-process-map.tsx`. `Flow = {nodes: FlowNode[], links: FlowLink[]}`, `FlowNode = {step, rank, total}`, `FlowLink = {from, to, count, avgMs}`, `Layout = {nodes: LaidOutNode[], links: LaidOutLink[]}` where `LaidOutNode` adds `{x, y, height}` and `LaidOutLink` adds `{path, width}`. No later task depends on these; nothing else in the plan touches process-events.

- [ ] **Step 1: Write the failing test for the transition tally and the layout**

Create `apps/web/app/routes/axis-process-map.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { flowFrom, layoutFlow, type FlowEvent } from "./axis-process-map";

// The map is process mining across every case, not one case's timeline
// (case-detail.tsx already tables that) — these tests pin the two arithmetic
// steps that turn raw axis_process_events rows into a flow diagram: tallying
// step-to-step transitions across cases, then laying the tally out.

describe("flowFrom", () => {
  it("ranks steps by first appearance and tallies transitions across cases", () => {
    const events: FlowEvent[] = [
      { caseId: "c1", step: "intake", ts: 1, durationMs: 100 },
      { caseId: "c1", step: "review", ts: 2, durationMs: 200 },
      { caseId: "c2", step: "intake", ts: 1, durationMs: 50 },
      { caseId: "c2", step: "review", ts: 2, durationMs: 300 },
      { caseId: "c2", step: "issued", ts: 3, durationMs: 10 }
    ];

    const flow = flowFrom(events);

    expect(flow.nodes).toEqual([
      { step: "intake", rank: 0, total: 2 },
      { step: "review", rank: 1, total: 2 },
      { step: "issued", rank: 2, total: 1 }
    ]);
    expect(flow.links).toEqual([
      { from: "intake", to: "review", count: 2, avgMs: 250 },
      { from: "review", to: "issued", count: 1, avgMs: 10 }
    ]);
  });

  it("orders a case's events by time, not by arrival order", () => {
    const events: FlowEvent[] = [
      { caseId: "c1", step: "review", ts: 2 },
      { caseId: "c1", step: "intake", ts: 1 }
    ];

    expect(flowFrom(events).links).toEqual([{ from: "intake", to: "review", count: 1, avgMs: 0 }]);
  });

  it("gives a lone-step case no links", () => {
    const flow = flowFrom([{ caseId: "c1", step: "intake", ts: 1 }]);
    expect(flow.links).toEqual([]);
    expect(flow.nodes).toEqual([{ step: "intake", rank: 0, total: 1 }]);
  });
});

describe("layoutFlow", () => {
  it("places later ranks further along and stacks a column's nodes without overlap", () => {
    const flow = flowFrom([
      { caseId: "c1", step: "intake", ts: 1 },
      { caseId: "c1", step: "review", ts: 2 },
      { caseId: "c2", step: "intake", ts: 1 },
      { caseId: "c2", step: "escalated", ts: 2 }
    ]);

    const laid = layoutFlow(flow, 800, 400);
    const intake = laid.nodes.find((n) => n.step === "intake")!;
    const review = laid.nodes.find((n) => n.step === "review")!;
    const escalated = laid.nodes.find((n) => n.step === "escalated")!;

    expect(review.x).toBeGreaterThan(intake.x);
    expect(escalated.x).toBe(review.x);
    expect(escalated.y).toBeGreaterThanOrEqual(review.y + review.height);
  });

  it("drops a link whose node is missing rather than drawing a dangling path", () => {
    const laid = layoutFlow(
      { nodes: [{ step: "a", rank: 0, total: 1 }], links: [{ from: "a", to: "ghost", count: 1, avgMs: 0 }] },
      400,
      200
    );

    expect(laid.links[0]!.path).toBe("");
    expect(laid.links[0]!.width).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lyra/web vitest run axis-process-map.test.ts`
Expected: FAIL with `Cannot find module './axis-process-map'`

- [ ] **Step 3: Implement `axis-process-map.tsx`**

Create `apps/web/app/routes/axis-process-map.tsx`:

```tsx
import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { EmptyState } from "@lyra/ui";
import { api, fetchMe } from "../api.server";
import { cloudflare } from "../context";
import { translator } from "../i18n";
import { Header, labelsFrom, rowsOf, safe, tag, type Page } from "./detail-kit";
import { useShellData } from "./workspace";

// Tenant-wide process mining, not one case's timeline — case-detail.tsx
// already tables a single case's steps. This reads axis_process_events across
// every case in a capped recent window and turns the step-to-step transitions
// into a flow diagram: where work actually goes, and where it pools
// (packages/db/src/schema/axis.ts's comment on the table: "Normalized step
// events for process mining").

const PERM = { read: "axis:metrics:read" } as const;
const WINDOW = 2000;

export interface EventRow {
  id: string;
  caseId: string;
  step: string;
  ts: number;
  durationMs?: number | null;
}

/* ------------------------------------------------------------------- flow */

export interface FlowEvent {
  caseId: string;
  step: string;
  ts: number;
  durationMs?: number | null;
}

export interface FlowNode {
  step: string;
  rank: number;
  total: number;
}

export interface FlowLink {
  from: string;
  to: string;
  count: number;
  avgMs: number;
}

export interface Flow {
  nodes: FlowNode[];
  links: FlowLink[];
}

/** One row per case, chronological, tallied into step-to-step transitions. */
export function flowFrom(events: readonly FlowEvent[]): Flow {
  const byCase = new Map<string, FlowEvent[]>();
  for (const event of events) {
    const bucket = byCase.get(event.caseId);
    if (bucket) bucket.push(event);
    else byCase.set(event.caseId, [event]);
  }

  const rank = new Map<string, number>();
  const total = new Map<string, number>();
  const linkKey = (from: string, to: string) => `${from}\0${to}`;
  const linkCount = new Map<string, number>();
  const linkDuration = new Map<string, number>();

  for (const caseEvents of byCase.values()) {
    const sequence = [...caseEvents].sort((a, b) => a.ts - b.ts);
    let previous: FlowEvent | null = null;
    for (const event of sequence) {
      if (!rank.has(event.step)) rank.set(event.step, rank.size);
      total.set(event.step, (total.get(event.step) ?? 0) + 1);
      if (previous) {
        const key = linkKey(previous.step, event.step);
        linkCount.set(key, (linkCount.get(key) ?? 0) + 1);
        linkDuration.set(key, (linkDuration.get(key) ?? 0) + (event.durationMs ?? 0));
      }
      previous = event;
    }
  }

  const nodes = [...rank.entries()]
    .map(([step, r]) => ({ step, rank: r, total: total.get(step) ?? 0 }))
    .sort((a, b) => a.rank - b.rank);

  const links = [...linkCount.entries()].map(([key, count]) => {
    const [from, to] = key.split("\0") as [string, string];
    return { from, to, count, avgMs: (linkDuration.get(key) ?? 0) / count };
  });

  return { nodes, links };
}

export interface LaidOutNode extends FlowNode {
  x: number;
  y: number;
  height: number;
}

export interface LaidOutLink extends FlowLink {
  path: string;
  width: number;
}

export interface Layout {
  nodes: LaidOutNode[];
  links: LaidOutLink[];
}

const NODE_WIDTH = 16;
const NODE_GAP = 12;

/** ponytail: hand-rolled bezier ribbons — the same call Sparkline makes for a line chart, no chart library. */
export function layoutFlow(flow: Flow, width: number, height: number): Layout {
  const maxRank = flow.nodes.reduce((max, node) => Math.max(max, node.rank), 0);
  const columnWidth = maxRank > 0 ? (width - NODE_WIDTH) / maxRank : 0;
  const grandTotal = flow.nodes.reduce((sum, node) => sum + node.total, 0) || 1;

  const byColumn = new Map<number, FlowNode[]>();
  for (const node of flow.nodes) {
    const bucket = byColumn.get(node.rank);
    if (bucket) bucket.push(node);
    else byColumn.set(node.rank, [node]);
  }

  const positioned = new Map<string, LaidOutNode>();
  for (const column of byColumn.values()) {
    let y = 0;
    for (const node of column) {
      const nodeHeight = Math.max(4, (node.total / grandTotal) * height - NODE_GAP);
      positioned.set(node.step, { ...node, x: node.rank * columnWidth, y, height: nodeHeight });
      y += nodeHeight + NODE_GAP;
    }
  }

  const outOffset = new Map<string, number>();
  const inOffset = new Map<string, number>();
  const maxCount = flow.links.reduce((max, link) => Math.max(max, link.count), 0) || 1;

  const links = flow.links.map((link) => {
    const source = positioned.get(link.from);
    const target = positioned.get(link.to);
    if (!source || !target) return { ...link, path: "", width: 0 };

    const linkWidth = Math.max(1, (link.count / maxCount) * 24);
    const sourceY = source.y + (outOffset.get(link.from) ?? 0) + linkWidth / 2;
    const targetY = target.y + (inOffset.get(link.to) ?? 0) + linkWidth / 2;
    outOffset.set(link.from, (outOffset.get(link.from) ?? 0) + linkWidth);
    inOffset.set(link.to, (inOffset.get(link.to) ?? 0) + linkWidth);

    const x1 = source.x + NODE_WIDTH;
    const x2 = target.x;
    const midX = (x1 + x2) / 2;
    return {
      ...link,
      path: `M ${x1} ${sourceY} C ${midX} ${sourceY}, ${midX} ${targetY}, ${x2} ${targetY}`,
      width: linkWidth
    };
  });

  return { nodes: [...positioned.values()], links };
}

/* ----------------------------------------------------------------- labels */

const LABELS: Record<string, Record<string, string>> = {
  en: {
    title: "Process map",
    intro: `Where work actually flows across the last ${WINDOW} recorded steps, and where it pools.`
  },
  ar: {
    title: "خريطة العملية",
    intro: `مسار سير العمل الفعلي عبر آخر ${WINDOW} خطوة مسجّلة، ومواضع تراكمه.`
  }
};

const labelsIn = labelsFrom(LABELS);

/* ----------------------------------------------------------------- loader */

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const me = await fetchMe(env, request);
  const may = me.permissions.includes(PERM.read);
  const page = may
    ? await safe(
        () => api<Page<EventRow>>(`/v1/axis/process-events?sort=ts&order=asc&limit=${WINDOW}`, { env, request }),
        null
      )
    : null;
  return { may, flow: flowFrom(rowsOf(page)) };
}

/* --------------------------------------------------------------- component */

const WIDTH = 880;
const HEIGHT = 420;

export default function AxisProcessMap() {
  const loaded = useLoaderData<typeof loader>();
  const shell = useShellData();
  const locale = shell?.locale ?? "en";
  const t = translator(locale);
  const l = labelsIn(locale, shell?.domainPack);
  const laid = layoutFlow(loaded.flow, WIDTH, HEIGHT);

  return (
    <div className="flex flex-col gap-6">
      <Header title={l("title")} intro={l("intro")} />

      {!loaded.may ? (
        <EmptyState title={l("deniedTitle")} body={t("error.forbidden")} />
      ) : laid.nodes.length === 0 ? (
        <EmptyState title={l("none")} />
      ) : (
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={l("title")} className="h-[420px] w-full">
          {laid.links.map((link, i) => (
            <path key={i} d={link.path} fill="none" stroke="var(--accent)" strokeOpacity={0.35} strokeWidth={link.width}>
              <title>
                {`${tag(l, "step", link.from)} → ${tag(l, "step", link.to)}: ${link.count} (avg ${Math.round(link.avgMs)}ms)`}
              </title>
            </path>
          ))}
          {laid.nodes.map((node) => (
            <g key={node.step}>
              <rect x={node.x} y={node.y} width={NODE_WIDTH} height={node.height} fill="var(--accent)" />
              <text
                x={node.x + NODE_WIDTH + 6}
                y={node.y + node.height / 2}
                dominantBaseline="middle"
                className="fill-text font-ui text-11"
              >
                {`${tag(l, "step", node.step)} (${node.total})`}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lyra/web vitest run axis-process-map.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Register the route**

In `apps/web/app/routes.ts`, insert after the `route("axis/dev", "routes/axis-dev.tsx"),` line:

```typescript
    route("axis/process-map", "routes/axis-process-map.tsx"),
```

- [ ] **Step 6: Run the frontend suite and typecheck**

Run: `pnpm --filter @lyra/web vitest run && pnpm --filter @lyra/web typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/routes/axis-process-map.tsx apps/web/app/routes/axis-process-map.test.ts apps/web/app/routes.ts
git commit -m "feat(axis): add the tenant-wide process map"
```

## Task 6: Recon evidence-bundle export

API-only — no web route or component. A regulator/auditor asking for a
reconciliation run's evidence today gets nothing but a screen; this gives
finance a signed, hash-manifested zip of one run's data, reusing the exact
mechanism `apps/api/src/routes/compliance.ts`'s `/evidence-bundles/export`
already built (same `evidenceBundles` table, same zip/hash/store pattern),
scoped to one recon run instead of an audit-log time window. `reconRuns`
already carries an unused `evidenceBundleFileId` column
(`packages/db/src/schema/ledger.ts:216`) — docs/16 "build to the seams": that
column is the seam this task fills, not a new table.

**Files:**
- Modify: `packages/core/src/rbac.ts:152` (permission catalog), `packages/core/src/rbac.ts:458` (`finance.analyst` role bundle)
- Modify: `apps/api/src/routes/ledger.ts` (imports, two new routes)
- Test: `apps/api/src/ledger.test.ts` (new describe block)

**Interfaces:**
- Consumes: `schema.ledgerReconRuns`, `schema.ledgerReconMatches`, `schema.evidenceBundles`, `schema.files` (`@lyra/db`); `scoped`, `sha256Hex`, `actorRef`, `audit`, `require_`, `notFound`, `id` (`@lyra/core`/`@lyra/db`); `must` (`apps/api/src/rows.ts`); `zip`, `utf8` (`apps/api/src/engines/export/zip.ts`); `render` (`apps/api/src/engines/export/render.ts`); `meterEgress` (`apps/api/src/engines/egress.ts`); `ReportTable` type (`@lyra/ledger`) — all already used identically in `compliance.ts`.
- Produces: `POST /v1/ledger/recon/runs/:id/evidence-bundle` (201, the bundle row + manifest), `GET /v1/ledger/recon/runs/:id/evidence-bundle/download` (streams the zip). Both gated on the new `ledger:recon:export` permission.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/ledger.test.ts`, after the last `describe` block (end of file):

```typescript
describe("POST /v1/ledger/recon/runs/:id/evidence-bundle", () => {
  let runId: string;

  beforeAll(async () => {
    const created = await call("finance.controller", "POST", "/v1/ledger/recon/runs", {
      process: "psp",
      period: "2026-03",
      currency: "AED",
      lines: [{ ref: "stmt-1", amountMinor: 10000, currency: "AED" }]
    });
    expect(created.status).toBe(201);
    runId = created.body.id as string;
  });

  it("bundles the run, hashes each file and the archive, and records the file on the run", async () => {
    const res = await call("finance.controller", "POST", `/v1/ledger/recon/runs/${runId}/evidence-bundle`);
    expect(res.status).toBe(201);
    expect(res.body.state).toBe("ready");
    expect(res.body.purpose).toBe("audit");
    expect(res.body.bundleHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.manifest.files).toHaveLength(3);

    const [run] = await database
      .select()
      .from(schema.ledgerReconRuns)
      .where(eq(schema.ledgerReconRuns.id, runId));
    expect(run?.evidenceBundleFileId).toBe(res.body.fileId);
  });

  it("downloads an archive whose bytes hash to the stored bundle hash", async () => {
    const built = await call("finance.controller", "POST", `/v1/ledger/recon/runs/${runId}/evidence-bundle`);
    const res = await call<ArrayBuffer>("finance.controller", "GET", `/v1/ledger/recon/runs/${runId}/evidence-bundle/download`);
    expect(res.status).toBe(200);

    const raw = await app.fetch(
      new Request(`http://api.test/v1/ledger/recon/runs/${runId}/evidence-bundle/download`, {
        headers: { authorization: `Bearer ${tokens["finance.controller"]}` }
      }),
      env as never,
      exec as never
    );
    const bytes = new Uint8Array(await raw.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(hex).toBe(built.body.bundleHash);
  });

  it("is 403 without ledger:recon:export, 404 for a run with no bundle yet", async () => {
    expect((await call("orbit.agent", "POST", `/v1/ledger/recon/runs/${runId}/evidence-bundle`)).status).toBe(403);
    expect((await call("orbit.agent", "GET", `/v1/ledger/recon/runs/${runId}/evidence-bundle/download`)).status).toBe(403);

    const bare = await call("finance.controller", "POST", "/v1/ledger/recon/runs", {
      process: "psp",
      period: "2026-04",
      currency: "AED",
      lines: [{ ref: "stmt-2", amountMinor: 500, currency: "AED" }]
    });
    expect((await call("finance.controller", "GET", `/v1/ledger/recon/runs/${bare.body.id}/evidence-bundle/download`)).status).toBe(404);
  });
});
```

`orbit.agent` (already seeded in this file's `PEOPLE` map) holds no `ledger:*`
permissions, so it is the 403 case; `finance.controller` holds `ledger:*:*`,
which covers the new permission without a role-bundle edit — the bundle test
only needs `finance.analyst`'s bundle updated because that is the role real
recon operators hold day to day, not because these tests require it.

Also add a `FILES` stub to this file's `env` (`apps/api/src/ledger.test.ts`,
inside `beforeAll`, next to the existing `env = {...}` assignment) — today it
has none, so `c.env.FILES` is `undefined` and every bundle would come back
`state: "failed"`:

```typescript
  env = {
    DB_CLIENT: database,
    ENVIRONMENT: "development",
    APP_ORIGIN: "http://localhost:5173",
    // ponytail: a Map is the whole of R2 a bundle needs — put then get.
    FILES: (() => {
      const objects = new Map<string, Uint8Array>();
      return {
        put: async (key: string, bytes: Uint8Array) => void objects.set(key, bytes),
        get: async (key: string) => {
          const bytes = objects.get(key);
          return bytes ? { body: new Response(bytes).body } : null;
        }
      };
    })()
  } as unknown as Env;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @lyra/api vitest run ledger.test.ts -t "evidence-bundle"`
Expected: FAIL — 403 instead of 201/200 (route does not exist yet, `require_` never runs, Hono 404s the unmatched path so the assertions on `res.body.state` etc. throw first).

- [ ] **Step 3: Add the permission**

In `packages/core/src/rbac.ts:152`, change:

```typescript
  "ledger:recon:read", "ledger:recon:run", "ledger:recon:confirm",
```

to:

```typescript
  "ledger:recon:read", "ledger:recon:run", "ledger:recon:confirm", "ledger:recon:export",
```

In `packages/core/src/rbac.ts:458` (`finance.analyst` role bundle), change:

```typescript
    ...readsOf("ledger"), "ledger:ai:invoke", "ledger:recon:run", "ledger:invoices:create",
```

to:

```typescript
    ...readsOf("ledger"), "ledger:ai:invoke", "ledger:recon:run", "ledger:recon:export", "ledger:invoices:create",
```

`finance.controller`'s existing `"ledger:*:*"` wildcard already covers the
new permission — no edit needed there.

- [ ] **Step 4: Add imports to `ledger.ts`**

In `apps/api/src/routes/ledger.ts`, change the top of the import block from:

```typescript
import { Hono } from "hono";
import { z } from "zod";
import { actorRef, audit, badRequest, notFound, require_, withIdempotency, type Ctx } from "@lyra/core";
```

to:

```typescript
import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { actorRef, audit, badRequest, notFound, require_, scoped, sha256Hex, withIdempotency, type Ctx } from "@lyra/core";
import { id, schema } from "@lyra/db";
```

And after the existing `import { EXPORT_FORMATS, isExportFormat, render } from "../engines/export/render.js";` line, add:

```typescript
import { meterEgress } from "../engines/egress.js";
import { utf8, zip } from "../engines/export/zip.js";
import { must } from "../rows.js";
```

- [ ] **Step 5: Implement the two routes**

In `apps/api/src/routes/ledger.ts`, at the end of the
`/* ------------------------------------------------------------ reconciliation */`
section (immediately after the existing `POST /recon/matches/:id/decide` handler), add:

```typescript
ledgerRoutes.post("/recon/runs/:id/evidence-bundle", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:recon:export", { tenantId: ctx.tenantId, module: "ledger" });
  const run = await must(ctx, schema.ledgerReconRuns, c.req.param("id"), "recon run");

  const matches = await ctx.db
    .select()
    .from(schema.ledgerReconMatches)
    .where(scoped(ctx, schema.ledgerReconMatches, eq(schema.ledgerReconMatches.runId, run.id)))
    .orderBy(schema.ledgerReconMatches.createdAt);

  const scope = { runId: run.id, process: run.process, period: run.period, purpose: "audit" as const };
  const jsonl = (rows: readonly unknown[]): string => rows.map((r) => JSON.stringify(r)).join("\n");

  const summary: ReportTable = {
    title: "Reconciliation evidence bundle",
    columns: [
      { key: "item", label: "Item", kind: "text" },
      { key: "value", label: "Value", kind: "text" }
    ],
    rows: [
      { item: "Run", value: run.id },
      { item: "Process", value: run.process },
      { item: "Period", value: run.period },
      { item: "Counterparty", value: run.counterpartyRef ?? "—" },
      { item: "Matched", value: String(run.matchedCount) },
      { item: "Variance count", value: String(run.varianceCount) },
      { item: "Variance", value: `${run.varianceMinor} ${run.currency}` },
      { item: "State", value: run.state },
      { item: "Requested by", value: actorRef(ctx) }
    ],
    generatedAt: ctx.now
  };

  const contents = [
    { path: "run.json", data: utf8(JSON.stringify(run, null, 2)) },
    { path: "matches.jsonl", data: utf8(jsonl(matches)) },
    { path: "summary.pdf", data: (await render("pdf", summary, {}, c.env.BROWSER)).bytes }
  ];
  const manifest = {
    version: 1,
    tenantId: ctx.tenantId,
    generatedAt: ctx.now,
    requestedBy: actorRef(ctx),
    scope,
    files: await Promise.all(
      contents.map(async (f) => ({ path: f.path, sizeBytes: f.data.length, sha256: await sha256Hex(f.data) }))
    )
  };
  // manifest travels inside the archive, so the bundle hash covers it too —
  // one hash to quote, entries verify against the manifest. Same idiom as
  // compliance.ts's evidence-bundles/export.
  const archive = zip([...contents, { path: "manifest.json", data: utf8(JSON.stringify(manifest, null, 2)) }]);
  const bundleHash = await sha256Hex(archive);

  const bundleId = id("evb", ctx.now);
  const bucket = c.env.FILES;
  const fileId = bucket ? id("file", ctx.now) : null;
  if (bucket && fileId) {
    const r2Key = `evidence/${ctx.tenantId}/${bundleId}.zip`;
    await bucket.put(r2Key, archive, { httpMetadata: { contentType: "application/zip" } });
    await ctx.db.insert(schema.files).values({
      id: fileId,
      tenantId: ctx.tenantId,
      r2Key,
      kind: "evidence_bundle",
      subjectRef: bundleId,
      sha256: bundleHash,
      sizeBytes: archive.length,
      contentType: "application/zip",
      piiLevel: "high",
      createdAt: ctx.now,
      deletedAt: null
    });
    await ctx.db
      .update(schema.ledgerReconRuns)
      .set({ evidenceBundleFileId: fileId, updatedAt: ctx.now })
      .where(scoped(ctx, schema.ledgerReconRuns, eq(schema.ledgerReconRuns.id, run.id)));
  }

  const row = {
    id: bundleId,
    tenantId: ctx.tenantId,
    purpose: "audit" as const,
    scopeJson: JSON.stringify(scope),
    manifestJson: JSON.stringify(manifest),
    bundleHash,
    fileId,
    requestedBy: actorRef(ctx),
    approvedBy: null,
    state: bucket ? "ready" : "failed",
    deliveredTo: null,
    createdAt: ctx.now,
    updatedAt: ctx.now
  };
  await ctx.db.insert(schema.evidenceBundles).values(row);
  await audit(ctx, {
    action: "ledger.recon.evidence.export",
    subjectRef: `evidence_bundle:${bundleId}`,
    after: { ...row, manifestJson: undefined, manifest, runId: run.id }
  });
  return c.json({ ...row, manifest }, 201);
});

ledgerRoutes.get("/recon/runs/:id/evidence-bundle/download", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:recon:export", { tenantId: ctx.tenantId, module: "ledger" });
  const run = await must(ctx, schema.ledgerReconRuns, c.req.param("id"), "recon run");
  if (!run.evidenceBundleFileId) throw notFound("evidence bundle");

  const file = await must(ctx, schema.files, run.evidenceBundleFileId, "evidence bundle file");
  const object = await c.env.FILES?.get(file.r2Key);
  if (!object) throw notFound("evidence bundle file");

  await audit(ctx, {
    action: "ledger.recon.evidence.download",
    subjectRef: `evidence_bundle:${file.subjectRef ?? run.id}`,
    after: { runId: run.id, fileId: file.id }
  });
  await meterEgress(ctx, file.sizeBytes ?? object.size);
  return new Response(object.body, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="evidence-${run.id}.zip"`,
      "cache-control": "no-store"
    }
  });
});
```

- [ ] **Step 6: Run the tests and verify they pass**

Run: `pnpm --filter @lyra/api vitest run ledger.test.ts -t "evidence-bundle"`
Expected: PASS (3 tests)

- [ ] **Step 7: Run the full suite and typecheck**

Run: `pnpm --filter @lyra/api vitest run && pnpm --filter @lyra/core vitest run rbac.test.ts && pnpm --filter @lyra/api typecheck && pnpm --filter @lyra/core typecheck`
Expected: PASS — including `rbac.test.ts`'s "grants only permissions that exist" and "puts every non-platform permission in reach of at least one tenant role", which the Step 3 catalog + role-bundle edit must satisfy together.

- [ ] **Step 8: Update the OpenAPI doc**

`apps/api/src/openapi.ts` generates from the route table already, so no
manual schema edit — regenerate the SDK and diff it:

```bash
pnpm --filter @lyra/sdk generate
git diff --stat packages/sdk/src/generated.ts
```

Expected: the diff adds the two new operations
(`postLedgerReconRunsByIdEvidenceBundle`,
`getLedgerReconRunsByIdEvidenceBundleDownload` or whatever the generator's
naming convention produces) and nothing else.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/rbac.ts apps/api/src/routes/ledger.ts apps/api/src/ledger.test.ts packages/sdk/src/generated.ts
git commit -m "feat(ledger): export a recon run's evidence as a signed, hash-manifested bundle"
```

---

## Task 7: EID/mulkiya accuracy benchmark — verify only

No code change. docs/modules/axis.md §8 sets the bar: "EID + mulkiya
extraction >= 95% field accuracy on test set (both languages)". That eval
already exists — `packages/model-gateway/evals/axis/` — and already runs on
every `pnpm eval` invocation. This task is closing the loop: run it, read the
result, confirm the bar is met, and record that confirmation. It is not a gap
in the AXIS module; it's the one gap-analysis item that turns out to already
be done, and "verify it's done" is itself a deliverable for a go-live
checklist.

**What's already there (read, not written this task):**
- `packages/model-gateway/evals/axis/cases.jsonl` — 10 canned cases: EID
  en/ar (`eid-en-01..03`, `eid-ar-01..02`) and mulkiya en/ar
  (`mulkiya-en-01..03`, `mulkiya-ar-01..02`). Each case bakes in a canned
  model reply (`text`, sometimes code-fenced, sometimes with
  missing/whitespace/case noise) plus the field values a correct extraction
  should produce (`expected`).
- `packages/model-gateway/evals/axis/thresholds.json` — `{"fieldAccuracyMin":
  0.95}`.
- `packages/model-gateway/evals/run.ts:122-138` (`scoreAxis`) — for every
  case, calls the real `parseExtraction` (`packages/model-gateway/src/extract.ts`,
  the same function `apps/api/src/routes/axis.ts`'s
  `/documents/:id/extract` route runs in production — no scorer
  duplicate, docs/13 §3) and compares each extracted field against
  `expected` via `normalizeField`. Reports one metric, `fieldAccuracy`, and
  fails the whole eval run if it's below `fieldAccuracyMin`.
- `packages/model-gateway/evals/run.ts:203-209` (`SCORERS`) registers
  `axis: scoreAxis` — it runs automatically, not opt-in.
- No live model call in this eval (docs/13 §4: evals stay
  deterministic/CI-safe) — it is pure function scoring against fixed replies,
  so "run it" means "run the existing harness," not "spend eval budget."

**Files:**
- None modified. This task produces a plan-file record only.

**Interfaces:**
- Consumes: `pnpm eval` (repo root `package.json:16`, delegates to
  `packages/model-gateway`'s `"eval": "tsx evals/run.ts"`).
- Produces: nothing new. The existing `axis` metric line in the eval's
  stdout is the artifact this task checks.

- [ ] **Step 1: Run the full eval suite**

Run: `pnpm eval`

Expected output includes a block:

```
axis
  PASS fieldAccuracy = 1.000 (need >= 0.95)
```

(Value may be below 1.000 and still pass, as long as it's `>= 0.95` — the
gate is the threshold, not perfection.) The run ends with `eval gate: passed`
and exit code 0. If instead it prints `FAIL fieldAccuracy = ...` and
`eval gate: FAILED` (exit 1), this task is not verify-only anymore — stop and
open an ADR-scoped follow-up task to fix `parseExtraction` or the AXIS
extraction prompt (out of scope for this plan; the gap-analysis item that
generated Task 7 was "confirm the existing bar is met," not "raise it").

- [ ] **Step 2: Record the result**

No file changes to commit for this task — it's a verification gate, not a
code change, so there's nothing to `git add`. Note the passing `fieldAccuracy`
value in the milestone/go-live checklist (docs/14-roadmap.md's current
milestone acceptance list) as evidence AXIS's extraction accuracy
requirement is met, alongside the other six tasks' commits.
