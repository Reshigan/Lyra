import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { schema, type Db } from "@lyra/db";
import { seed, totpAt, TOTP_STEP_SEC, type SeedResult } from "@lyra/core";
import { app } from "./index.js";
import type { Env } from "./env.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const exec = { waitUntil() {}, passThroughOnException() {} };

let env: Env;
let database: Db;
let seeded: SeedResult;
let token: string;

interface Res<T = any> {
  status: number;
  body: T;
}

async function call<T = any>(
  method: string,
  path: string,
  payload?: unknown,
  headers: Record<string, string> = {}
): Promise<Res<T>> {
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
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
  if (!allowed.includes(res.status)) {
    throw new Error(`expected ${allowed.join("|")}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
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
  seeded = await seed(database as never, { mfaSecret: DEMO_TOTP_SECRET });
  env = { DB_CLIENT: database, ENVIRONMENT: "development", APP_ORIGIN: "http://localhost:5173" } as unknown as Env;

  const login = await call("POST", "/v1/auth/login", {
    email: "faisal.omar@gonxt.ae",
    password: PASSWORD,
    tenantSlug: "gonxt"
  });
  token = ok(login).token as string;
  const verified = await call("POST", "/v1/auth/mfa/verify", {
    code: await totpAt(DEMO_TOTP_SECRET, Math.floor(Date.now() / 1000 / TOTP_STEP_SEC))
  });
  expect(verified.status).toBe(200);
}, 120_000);

describe("dist referral settlement (docs/superpowers/specs/2026-08-16-revenue-lines-full-build-design.md, Group A)", () => {
  it("refuses to settle a referral that was never qualified", async () => {
    const res = await call("POST", "/v1/dist/referrals/settle", {
      referralRef: "ref-never-qualified",
      currency: "AED",
      grossMinor: 10_000_00
    });
    expect(res.status).toBe(409);
  });

  it("qualifies then settles a referral, chaining REFERRAL-SETL off REFERRAL-QUAL", async () => {
    const referralRef = "ref-001";
    const qualified = ok(await call("POST", "/v1/dist/referrals/qualify", { referralRef, channelId: seeded.channels.web }), 201);
    expect(qualified.txn.state).toBe("settled");

    const settled = ok(
      await call("POST", "/v1/dist/referrals/settle", {
        referralRef,
        currency: "AED",
        grossMinor: 8_000_00,
        channelMinor: 1_000_00
      }),
      201
    );
    expect(settled.txn.state).toBe("settled");
    expect(settled.txn.parentTxnId).toBe(qualified.txn.id);

    const legs = await database
      .select()
      .from(schema.ledgerJournalLines)
      .where(eq(schema.ledgerJournalLines.batchId, settled.txn.ledgerBatchId as string));
    const debit = legs.filter((l) => l.side === "debit").reduce((n, l) => n + l.amountMinor, 0);
    const credit = legs.filter((l) => l.side === "credit").reduce((n, l) => n + l.amountMinor, 0);
    expect(debit).toBe(credit);
    expect(legs.some((l) => l.accountCode === "2100" && l.amountMinor === 1_000_00)).toBe(true);

    const audits = await database
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, seeded.tenantId), eq(schema.auditLog.action, "dist.referral.settle")));
    expect(audits.some((a) => a.subjectRef === referralRef)).toBe(true);
  });

  it("is idempotent on qualify replay", async () => {
    const referralRef = "ref-002";
    const first = ok(await call("POST", "/v1/dist/referrals/qualify", { referralRef }), 201);
    const second = ok(await call("POST", "/v1/dist/referrals/qualify", { referralRef }), 201);
    expect(second.txn.id).toBe(first.txn.id);
  });
});
