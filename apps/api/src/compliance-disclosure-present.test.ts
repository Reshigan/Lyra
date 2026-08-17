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

async function call<T = any>(method: string, path: string, payload?: unknown): Promise<Res<T>> {
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
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
    email: "omar.farouk@gonxt.ae",
    password: PASSWORD,
    tenantSlug: "gonxt"
  });
  token = ok(login).token as string;
  const verified = await call("POST", "/v1/auth/mfa/verify", {
    code: await totpAt(DEMO_TOTP_SECRET, Math.floor(Date.now() / 1000 / TOTP_STEP_SEC))
  });
  expect(verified.status).toBe(200);
}, 120_000);

describe("compliance disclosure present (docs/superpowers/specs/2026-08-16-revenue-lines-full-build-design.md, Group A)", () => {
  it("presents a disclosure and writes a disclosures row", async () => {
    const out = ok(
      await call("POST", "/v1/compliance/disclosures/present", {
        subjectRef: "campaign:xyz",
        key: "ad_placement",
        wording: "This is a sponsored placement.",
        channel: "web",
        idempotencyKey: "dsc:campaign-xyz:1"
      }),
      201
    );
    expect(out.subjectRef).toBe("campaign:xyz");
    expect(out.key).toBe("ad_placement");
    expect(out.wordingHash).toBeTruthy();

    const rows = await database
      .select()
      .from(schema.disclosures)
      .where(and(eq(schema.disclosures.tenantId, seeded.tenantId), eq(schema.disclosures.subjectRef, "campaign:xyz")));
    expect(rows.length).toBe(1);

    const audits = await database
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, seeded.tenantId), eq(schema.auditLog.action, "compliance.disclosure.present")));
    expect(audits.some((a) => a.subjectRef === "campaign:xyz")).toBe(true);
  });

  it("posts a DISCLOSURE-PRESENT ledger transaction linked by the request's idempotency key", async () => {
    const out = ok(
      await call("POST", "/v1/compliance/disclosures/present", {
        subjectRef: "campaign:ledger-check",
        key: "ad_placement",
        wording: "This is a sponsored placement.",
        channel: "web",
        idempotencyKey: "dsc:campaign-ledger-check:1"
      }),
      201
    );
    expect(out.subjectRef).toBe("campaign:ledger-check");

    const txns = await database
      .select()
      .from(schema.ledgerTxns)
      .where(
        and(
          eq(schema.ledgerTxns.tenantId, seeded.tenantId),
          eq(schema.ledgerTxns.type, "DISCLOSURE-PRESENT"),
          eq(schema.ledgerTxns.idempotencyKey, "dsc:campaign-ledger-check:1")
        )
      );
    expect(txns.length).toBe(1);
    expect(txns[0]?.state).toBe("settled");
  });

  it("replaying the same idempotencyKey does not double-write the disclosure, audit entry, or event", async () => {
    const payload = {
      subjectRef: "campaign:replay-check",
      key: "ad_placement",
      wording: "This is a sponsored placement.",
      channel: "web",
      idempotencyKey: "dsc:campaign-replay-check:1"
    };
    const first = ok(await call("POST", "/v1/compliance/disclosures/present", payload), 201);
    const second = ok(await call("POST", "/v1/compliance/disclosures/present", payload), 201);
    expect(second).toEqual(first);

    const rows = await database
      .select()
      .from(schema.disclosures)
      .where(and(eq(schema.disclosures.tenantId, seeded.tenantId), eq(schema.disclosures.subjectRef, "campaign:replay-check")));
    expect(rows.length).toBe(1);

    const audits = await database
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.tenantId, seeded.tenantId),
          eq(schema.auditLog.action, "compliance.disclosure.present"),
          eq(schema.auditLog.subjectRef, "campaign:replay-check")
        )
      );
    expect(audits.length).toBe(1);
  });
});
