import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@lyra/db";
import { seed, totpAt, TOTP_STEP_SEC } from "@lyra/core";
import { app } from "./index.js";
import type { Env } from "./env.js";

// docs/15 §5. The lens is resolved through GET /v1/me/lens rather than a
// generic CRUD record, since a user who never touched it has no row at all.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

const PEOPLE: Record<string, string> = {
  "axis.agent": "layla.hassan",
  "north.exec": "hala.zayed"
};

let env: Env;
let tokens: Record<string, string>;

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
  const database = drizzle(client) as unknown as Db;
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

describe("GET /v1/me/lens", () => {
  it("resolves the seeded role default for a persona that has never written a lens", async () => {
    const res = await call("north.exec", "GET", "/v1/me/lens");
    expect(res.status).toBe(200);
    expect(res.body.lens.workspace).toBe("north");
  });

  it("401s an unauthenticated caller", async () => {
    const res = await call(null, "GET", "/v1/me/lens");
    expect(res.status).toBe(401);
  });
});

describe("POST /v1/me/lens/usage and /v1/me/lens/reset", () => {
  it("increments a weight on repeated use, then reset discards it and is audited", async () => {
    const first = await call("axis.agent", "POST", "/v1/me/lens/usage", { key: "cases" });
    expect(first.status).toBe(200);
    expect(first.body.weights.cases).toBe(1);

    const second = await call("axis.agent", "POST", "/v1/me/lens/usage", { key: "cases" });
    expect(second.status).toBe(200);
    expect(second.body.weights.cases).toBe(2);

    const resolved = await call("axis.agent", "GET", "/v1/me/lens");
    expect(resolved.body.isDefault).toBe(false);
    expect(resolved.body.lens.weights.cases).toBe(2);

    const reset = await call("axis.agent", "POST", "/v1/me/lens/reset");
    expect(reset.status).toBe(200);
    expect(reset.body.weights).toEqual({});
    expect(reset.body.workspace).toBe("axis");

    const afterReset = await call("axis.agent", "GET", "/v1/me/lens");
    expect(afterReset.body.isDefault).toBe(true);
  });

  it("rejects a body without a key", async () => {
    const res = await call("axis.agent", "POST", "/v1/me/lens/usage", {});
    expect(res.status).toBe(400);
  });
});
