import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeAll, describe, expect, it } from "vitest";
import { schema, type Db } from "@lyra/db";
import { seed, totpAt, TOTP_STEP_SEC } from "@lyra/core";
import { app } from "./index.js";
import type { Env } from "./env.js";

// Guards on /v1/ai that the journey suite does not reach: who may write the
// suggestion telemetry, and which handler owns `GET /v1/ai/runs/:id`.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

// tenant.admin holds `ai:*:read`; axis.agent holds no `ai:` permission beyond
// the suggestion telemetry it is shown. The suggestion negative case is
// dev.admin, not a module operator: every persona that is shown an ambient
// suggestion now carries `ai:suggestions:read` so it can record the outcome
// (rbac.ts ROLES), and a developer-console seat sees no suggestion surface.
const PEOPLE: Record<string, string> = {
  "tenant.admin": "amina.saleh",
  "axis.agent": "layla.hassan",
  "dev.admin": "raed.samir"
};

let env: Env;
let database: Db;
let tokens: Record<string, string>;
let tenantId: string;

const exec = { waitUntil() {}, passThroughOnException() {} };

async function call<T = any>(
  who: string | null,
  method: string,
  path: string,
  payload?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: T }> {
  const token = who ? tokens[who] : undefined;
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers
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
  for (const [role, local] of Object.entries(PEOPLE)) {
    const login = await call(null, "POST", "/v1/auth/login", {
      email: `${local}@gonxt.ae`,
      password: PASSWORD,
      tenantSlug: "gonxt"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const verified = await call(
      null,
      "POST",
      "/v1/auth/mfa/verify",
      { code: await totpAt(DEMO_TOTP_SECRET, Math.floor(Date.now() / 1000 / TOTP_STEP_SEC)) },
      { authorization: `Bearer ${token}` }
    );
    expect(verified.status).toBe(200);
    tokens[role] = token;
  }

  const customer = (await database.select().from(schema.customers).limit(1))[0]!;
  tenantId = customer.tenantId;
}, 120_000);

/* -------------------------------------------------------------- suggestions */

describe("ai suggestion telemetry is gated", () => {
  const shown = { surface: "chip" as const, module: "axis" };

  it("refuses an actor without ai:suggestions:read", async () => {
    const created = await call("dev.admin", "POST", "/v1/ai/suggestions", shown);
    expect(created.status).toBe(403);

    // The outcome leg is gated on the same permission, not just on ownership —
    // otherwise the acceptance rate stays writable by anyone with a session.
    const outcome = await call("dev.admin", "POST", "/v1/ai/suggestions/sug_nope/outcome", {
      outcome: "accepted"
    });
    expect(outcome.status).toBe(403);
  });

  it("lets an actor with ai:suggestions:read record and resolve one", async () => {
    const created = await call("tenant.admin", "POST", "/v1/ai/suggestions", shown);
    expect(created.status).toBe(201);
    expect(created.body.tenantId).toBe(tenantId);
    expect(created.body.outcome).toBe("shown");

    const outcome = await call(
      "tenant.admin",
      "POST",
      `/v1/ai/suggestions/${created.body.id}/outcome`,
      { outcome: "accepted" }
    );
    expect(outcome.status).toBe(204);

    const row = await call("tenant.admin", "GET", `/v1/ai/suggestions/${created.body.id}`);
    expect(row.body.outcome).toBe("accepted");
  });
});

/* --------------------------------------------------------------- run views */

describe("GET /v1/ai/runs/:id reaches the CRUD record handler", () => {
  const runId = "air_shadow_test";

  beforeAll(async () => {
    await database.insert(schema.aiRuns).values({
      id: runId,
      tenantId,
      agentKey: "creative",
      module: "signal",
      purpose: "aeo.draft",
      actorRef: "user:seed",
      autonomyLevel: "suggest",
      trigger: "user",
      state: "succeeded",
      inputHash: "",
      startedAt: Date.now()
    });
  });

  it("answers with a flat row, not the enriched wrapper", async () => {
    const res = await call("tenant.admin", "GET", `/v1/ai/runs/${runId}`);
    expect(res.status).toBe(200);
    expect(res.body.run).toBeUndefined();
    expect(res.body.id).toBe(runId);
    expect(res.body.agentKey).toBe("creative");
    expect(res.body.state).toBe("succeeded");
  });

  it("serves the enriched view from /detail", async () => {
    const res = await call("tenant.admin", "GET", `/v1/ai/runs/${runId}/detail`);
    expect(res.status).toBe(200);
    expect(res.body.run.id).toBe(runId);
    expect(res.body.toolCalls).toEqual([]);
    expect(res.body.audit).toBeNull();
  });

  it("still gates the enriched view on ai:runs:read", async () => {
    const res = await call("axis.agent", "GET", `/v1/ai/runs/${runId}/detail`);
    expect(res.status).toBe(403);
  });
});
