import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { schema, id as newId, type Db } from "@lyra/db";
import { seed, totpAt, TOTP_STEP_SEC, type SeedResult } from "@lyra/core";
import { app } from "./index.js";
import type { Env } from "./env.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const DAY = 86_400_000;
const exec = { waitUntil() {}, passThroughOnException() {} };

let env: Env;
let database: Db;
let seeded: SeedResult;
let token: string;

interface Res<T = any> { status: number; body: T; }

async function call<T = any>(method: string, path: string, payload?: unknown, headers: Record<string, string> = {}, as: () => string = () => token): Promise<Res<T>> {
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${as()}`, ...headers },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
    }),
    env as never,
    exec as never
  );
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  return { status: res.status, body: (isJson ? await res.json() : await res.arrayBuffer()) as T };
}

function ok<T>(res: Res<T>, ...accept: number[]): T {
  const allowed = accept.length ? accept : [200, 201, 204];
  if (!allowed.includes(res.status)) throw new Error(`expected ${allowed.join("|")}, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function login(local: string): Promise<string> {
  const res = ok(await call("POST", "/v1/auth/login", { email: `${local}@gonxt.ae`, password: PASSWORD, tenantSlug: "gonxt" }));
  const issued = res.token as string;
  const verified = await call("POST", "/v1/auth/mfa/verify", { code: await totpAt(DEMO_TOTP_SECRET, Math.floor(Date.now() / 1000 / TOTP_STEP_SEC)) }, {}, () => issued);
  expect(verified.status).toBe(200);
  return issued;
}

async function insertComplaint(ref: string, dueAt: number, state: string) {
  const now = Date.now();
  await database.insert(schema.axisComplaints).values({
    id: newId("cmp", now),
    tenantId: seeded.tenantId,
    ref,
    channel: "email",
    categoryCode: "service",
    receivedAt: now - 2 * DAY,
    dueAt,
    state,
    redressMinor: 0,
    createdAt: now,
    updatedAt: now
  } as typeof schema.axisComplaints.$inferInsert);
}

beforeAll(async () => {
  const client = createClient({ url: ":memory:" });
  const statements = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) await client.execute(stmt);
  database = drizzle(client) as unknown as Db;
  seeded = await seed(database as never, { mfaSecret: DEMO_TOTP_SECRET });
  env = { DB_CLIENT: database, ENVIRONMENT: "development", APP_ORIGIN: "http://localhost:5173" } as unknown as Env;
  token = await login("omar.farouk");
}, 120_000);

describe("AXIS conduct — complaints register (docs/27 §D.8)", () => {
  it("a complaint past its regulatory due date surfaces on the exceptions screen", async () => {
    const now = Date.now();
    await insertComplaint(`CMP-OVERDUE-${now}`, now - DAY, "investigating");
    await insertComplaint(`CMP-FUTURE-${now}`, now + DAY, "investigating");
    await insertComplaint(`CMP-CLOSED-${now}`, now - DAY, "closed");

    const res = ok(
      await call(
        "GET",
        `/v1/axis/complaints?state=received,investigating,awaiting_customer,escalated&to=${now}&sort=dueAt&order=asc&limit=25`
      )
    );

    const refs = (res.data as any[]).map((c) => c.ref);
    expect(refs).toContain(`CMP-OVERDUE-${now}`);
    expect(refs).not.toContain(`CMP-FUTURE-${now}`);
    expect(refs).not.toContain(`CMP-CLOSED-${now}`);
  });
});
