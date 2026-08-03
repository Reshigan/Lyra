import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { beforeAll, describe, expect, it } from "vitest";
import { schema, type Db } from "@lyra/db";
import { seed, totpAt, TOTP_STEP_SEC } from "@lyra/core";
import { app } from "./index.js";
import type { Env } from "./env.js";

// Which handler owns `GET /v1/ledger/periods/:id`. The enriched period view used
// to sit on that path and swallow the generated CRUD record handler, so the
// record screen got a `{period, checks}` wrapper where it expects a flat row.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

const PEOPLE: Record<string, string> = {
  "finance.controller": "faisal.omar",
  "orbit.agent": "sara.nasser"
};

let env: Env;
let tokens: Record<string, string>;
let database: Db;

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
}, 120_000);

describe("GET /v1/ledger/periods/:id reaches the CRUD record handler", () => {
  const code = "2026-03";
  let periodId: string;

  beforeAll(async () => {
    // The enriched view is what creates the row, so ask for it first.
    const seeded = await call("finance.controller", "GET", `/v1/ledger/period/${code}`);
    expect(seeded.status).toBe(200);
    periodId = seeded.body.period.id as string;
  });

  it("answers with a flat row, not the enriched wrapper", async () => {
    const res = await call("finance.controller", "GET", `/v1/ledger/periods/${periodId}`);
    expect(res.status).toBe(200);
    expect(res.body.period).toBeUndefined();
    expect(res.body.checks).toBeUndefined();
    expect(res.body.id).toBe(periodId);
    expect(res.body.code).toBe(code);
    expect(res.body.state).toBe("open");
  });

  it("serves the enriched view from the singular path", async () => {
    const res = await call("finance.controller", "GET", `/v1/ledger/period/${code}`);
    expect(res.status).toBe(200);
    expect(res.body.period.code).toBe(code);
    expect(Array.isArray(res.body.checks)).toBe(true);
    expect(res.body.checks.every((c: { name: string }) => c.name.endsWith(`@${code}`))).toBe(true);
  });

  it("still gates the enriched view on ledger:periods:read", async () => {
    const res = await call("orbit.agent", "GET", `/v1/ledger/period/${code}`);
    expect(res.status).toBe(403);
  });
});

describe("the retired generic CRUD door onto periods is gone", () => {
  const code = "2026-04";
  let periodId: string;

  beforeAll(async () => {
    const seeded = await call("finance.controller", "GET", `/v1/ledger/period/${code}`);
    expect(seeded.status).toBe(200);
    periodId = seeded.body.period.id as string;
  });

  it("cannot jump a period straight to hard_closed by PATCHing state directly", async () => {
    // Only POST /periods/:code/close runs closeChecks() and enforces
    // soft-before-hard sequencing. A generic PATCH here would skip both.
    const res = await call("finance.controller", "PATCH", `/v1/ledger/periods/${periodId}`, {
      state: "hard_closed"
    });
    expect(res.status).toBe(404);

    const [row] = await database
      .select()
      .from(schema.ledgerPeriods)
      .where(eq(schema.ledgerPeriods.id, periodId));
    expect(row?.state).toBe("open");
  });

  it("still reads through the generic resource", async () => {
    const res = await call("finance.controller", "GET", `/v1/ledger/periods/${periodId}`);
    expect(res.status).toBe(200);
  });
});
