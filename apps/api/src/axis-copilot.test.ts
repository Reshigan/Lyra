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
  // ponytail: sara.nasser (orbit.agent) already holds axis:cases:read (docs/06
  // J-C2: ORBIT needs case visibility for customer replies), so she is not an
  // "outsider" for this route's permission — noor.jamal (signal.lead) holds no
  // axis:* grant at all and is the true negative case.
  outsider: "noor.jamal"
};

let env: Env;
let database: Db;
let tokens: Record<string, string>;

interface Res<T = any> { status: number; body: T; }

async function call<T = any>(
  who: string | null, method: string, path: string, payload?: unknown, headers: Record<string, string> = {}
): Promise<Res<T>> {
  const token = who ? tokens[who] : undefined;
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
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

  it("replays the cached answer for a repeated idempotency key instead of asking the model twice (regression: IMPORTANT 4/5)", async () => {
    const caseId = await openCase();
    let calls = 0;
    const counting: Env = {
      ...env,
      AI: { run: async () => { calls++; return { response: FIXED_ANSWER }; } }
    } as unknown as Env;
    const key = `idem-copilot-${caseId}`;
    const payload = { question: "What is this case worth?" };
    const req = (): Request =>
      new Request(`http://api.test/v1/axis/cases/${caseId}/copilot`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${tokens.lead}`, "idempotency-key": key },
        body: JSON.stringify(payload)
      });
    const first = await app.fetch(req(), counting as never, exec as never);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { answer: string; auditId: string };
    expect(calls).toBe(1);

    const replay = await app.fetch(req(), counting as never, exec as never);
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as { answer: string; auditId: string };
    expect(calls).toBe(1);
    expect(replayBody.answer).toBe(firstBody.answer);
    expect(replayBody.auditId).toBe(firstBody.auditId);
  });

  it("rejects a repeated idempotency key sent with a different question (regression: IMPORTANT 4/5)", async () => {
    const caseId = await openCase();
    const key = `idem-copilot-conflict-${caseId}`;
    const first = await call("lead", "POST", `/v1/axis/cases/${caseId}/copilot`, { question: "What is this case worth?" }, { "idempotency-key": key });
    expect(first.status).toBe(200);
    const conflict = await call("lead", "POST", `/v1/axis/cases/${caseId}/copilot`, { question: "A completely different question?" }, { "idempotency-key": key });
    expect(conflict.status).toBe(409);
  });
});
