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

async function call<T = any>(
  who: string | null,
  method: string,
  path: string,
  payload?: unknown,
  headers: Record<string, string> = {}
): Promise<Res<T>> {
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

  it("replays the same 200 for a repeated idempotency key instead of 409ing on its own result (regression: IMPORTANT 4/5)", async () => {
    const sopId = await draftSop("dispatch", 1);
    const key = `idem-publish-${sopId}`;
    const first = await call("lead", "POST", `/v1/axis/sops/${sopId}/publish`, undefined, { "idempotency-key": key });
    expect(first.status).toBe(200);

    const replay = await call("lead", "POST", `/v1/axis/sops/${sopId}/publish`, undefined, { "idempotency-key": key });
    expect(replay.status).toBe(200);
    expect(replay.body.status).toBe("active");

    // A genuine second publish without a key still 409s.
    const again = await publish("lead", sopId);
    expect(again.status).toBe(409);
  });
});
