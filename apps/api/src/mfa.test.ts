import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeAll, describe, expect, it } from "vitest";
import { seed, totpAt, TOTP_STEP_SEC } from "@lyra/core";
import type { Db } from "@lyra/db";
import { app } from "./index.js";
import type { Env } from "./env.js";

// PLAT-012/013. journeys.test.ts seeds every persona already enrolled on a shared
// demo secret so the journeys can log in; this file is the opposite — nobody is
// enrolled, so the enrolment walk itself is what gets tested.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

const PASSWORD = "Gonxt-Demo-2026!";
const exec = { waitUntil() {}, passThroughOnException() {} };

let env: Env;

interface Res<T = any> {
  status: number;
  body: T;
}

async function call<T = any>(
  token: string | null,
  method: string,
  path: string,
  payload?: unknown
): Promise<Res<T>> {
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

/** Current code for a secret. The step is 30s, so this is stable across a test. */
function codeFor(secret: string): Promise<string> {
  return totpAt(secret, Math.floor(Date.now() / 1000 / TOTP_STEP_SEC));
}

async function login(local: string): Promise<Res> {
  return call(null, "POST", "/v1/auth/login", {
    email: `${local}@gonxt.ae`,
    password: PASSWORD,
    tenantSlug: "gonxt"
  });
}

beforeAll(async () => {
  const client = createClient({ url: ":memory:" });
  for (const stmt of statements()) await client.execute(stmt);
  const database = drizzle(client) as unknown as Db;
  // No `mfaSecret`: this is what a real tenant looks like on day one.
  await seed(database as never);
  env = {
    DB_CLIENT: database,
    ENVIRONMENT: "development",
    APP_ORIGIN: "http://localhost:5173"
  } as unknown as Env;
}, 60_000);

describe("second factor", () => {
  it("walks a staff account from password to enrolled", async () => {
    const first = await login("amina.saleh");
    expect(first.status).toBe(200);
    expect(first.body.mfaRequired).toBe(true);
    expect(first.body.mfaStep).toBe("enrol");
    const token = first.body.token as string;

    // The session is real and does nothing until the factor is cleared. This is
    // the assertion that matters: the gate lives in `fromSession`, so it covers
    // every route rather than the ones someone remembered to decorate.
    const blocked = await call(token, "GET", "/v1/me");
    expect(blocked.status).toBe(403);
    expect(blocked.body.type).toContain("mfa_required");
    expect(blocked.body.step).toBe("enrol");

    const start = await call(token, "POST", "/v1/auth/mfa/enrol");
    expect(start.status).toBe(200);
    const secret = start.body.secret as string;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    // Issuer is the tenant name, never a hard-coded product string (CLAUDE.md §5).
    expect(start.body.otpauthUri).toContain("issuer=GONXT");

    const confirm = await call(token, "POST", "/v1/auth/mfa/enrol/confirm", {
      code: await codeFor(secret)
    });
    expect(confirm.status).toBe(200);
    expect(confirm.body.recoveryCodes).toHaveLength(10);

    // Confirming clears the gate on the session that did it, so the user is not
    // asked for a second code straight after enrolling.
    expect((await call(token, "GET", "/v1/me")).status).toBe(200);

    /* ------------------------------------------------ a later sign-in verifies */

    const second = await login("amina.saleh");
    expect(second.body.mfaStep).toBe("verify");
    const next = second.body.token as string;
    expect((await call(next, "GET", "/v1/me")).status).toBe(403);

    const wrong = await call(next, "POST", "/v1/auth/mfa/verify", { code: "000000" });
    expect(wrong.status).toBe(401);

    const verified = await call(next, "POST", "/v1/auth/mfa/verify", { code: await codeFor(secret) });
    expect(verified.status).toBe(200);
    expect(verified.body.usedRecovery).toBe(false);
    expect((await call(next, "GET", "/v1/me")).status).toBe(200);

    /* -------------------------------------------- a recovery code works exactly once */

    const recovery = confirm.body.recoveryCodes[0] as string;
    const third = (await login("amina.saleh")).body.token as string;
    const used = await call(third, "POST", "/v1/auth/mfa/verify", { code: recovery });
    expect(used.status).toBe(200);
    expect(used.body.usedRecovery).toBe(true);

    const fourth = (await login("amina.saleh")).body.token as string;
    const replay = await call(fourth, "POST", "/v1/auth/mfa/verify", { code: recovery });
    expect(replay.status).toBe(401);

    /* ------------------------------------------------------- staff cannot opt out */

    const refused = await call(next, "POST", "/v1/auth/mfa/disable", { code: await codeFor(secret) });
    expect(refused.status).toBe(403);
    expect(refused.body.detail).toContain("mandatory");
  }, 60_000);
});
