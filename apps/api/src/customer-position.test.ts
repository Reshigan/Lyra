import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { seed, totpAt, TOTP_STEP_SEC } from "@lyra/core";
import { schema, type Db } from "@lyra/db";
import { app } from "./index.js";
import type { Env } from "./env.js";

// The 360 screen's Position card summed the first CRUD page client-side —
// wrong money past 50 rows, wrong currency for multi-currency customers.
// This endpoint aggregates in SQL, grouped by currency, and degrades per
// permission the same way the screen's panels do: a sum the actor may not
// see is null, never 0.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const exec = { waitUntil() {}, passThroughOnException() {} };

/** axis.lead holds policies+claims reads; orbit.agent holds policies but not claims. */
const PEOPLE: Record<string, string> = {
  lead: "omar.farouk",
  agent: "sara.nasser"
};

let env: Env;
let database: Db;
let tokens: Record<string, string>;

interface Res<T = any> {
  status: number;
  body: T;
}

async function call<T = any>(who: string | null, method: string, path: string, payload?: unknown): Promise<Res<T>> {
  const token = who ? tokens[who] : undefined;
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
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
  const seeded = await seed(database as never, { mfaSecret: DEMO_TOTP_SECRET });

  env = {
    DB_CLIENT: database,
    ENVIRONMENT: "development",
    APP_ORIGIN: "http://localhost:5173"
  } as unknown as Env;

  // Policy creation is gated by the `axis.bind` approval policy
  // (apps/api/src/resources.ts) and the demo tenant's own autoApprove list
  // only carries `signal.campaign_launch` (packages/core/src/seed.ts) — an
  // ungated create here would 403 with `approval_required` before ever
  // reaching this route. Same fixture axis-zero-touch.test.ts uses: put
  // `axis.bind` on this tenant's own autoApprove allowlist so `gate()`
  // returns null immediately, no pending approval in the way.
  const tenantRow = (await database.select().from(schema.tenants).where(eq(schema.tenants.id, seeded.tenantId)))[0]!;
  const tenantPolicy = JSON.parse(tenantRow.policyJson as string) as { autoApprove: string[] };
  await database
    .update(schema.tenants)
    .set({ policyJson: JSON.stringify({ ...tenantPolicy, autoApprove: [...tenantPolicy.autoApprove, "axis.bind"] }) })
    .where(eq(schema.tenants.id, seeded.tenantId));

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
      env as never,
      exec as never
    );
    expect(verified.status).toBe(200);
    tokens[who] = token;
  }
}, 120_000);

interface Position {
  positions: Array<{ currency: string; premiumMinor: number | null; commissionMinor: number | null; settledMinor: number | null }>;
  ltvMinor: number;
  currency: string;
}

async function newCustomer(suffix: string): Promise<string> {
  const created = await call("lead", "POST", "/v1/core/customers", { nameJson: { en: `Position ${suffix}` } });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

async function newPolicy(customerId: string, policyNo: string, currency: string, premiumMinor: number, commissionMinor: number): Promise<string> {
  const created = await call("lead", "POST", "/v1/axis/policies", {
    customerId,
    providerId: "prv_test",
    policyNo,
    startAt: 1,
    endAt: 2,
    premiumMinor,
    commissionMinor,
    currency
  });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

describe("GET /v1/core/customers/:id/position", () => {
  it("sums per currency in SQL and names the largest-premium currency dominant", async () => {
    const customerId = await newCustomer("multi");
    const policyId = await newPolicy(customerId, "POS-AED-1", "AED", 120_000, 9_600);
    await newPolicy(customerId, "POS-AED-2", "AED", 80_000, 4_000);
    await newPolicy(customerId, "POS-USD-1", "USD", 50_000, 2_500);
    const claim = await call("lead", "POST", "/v1/axis/claims", {
      policyId,
      customerId,
      claimNo: "POS-CLM-1",
      reportedAt: 3,
      currency: "AED",
      settledMinor: 40_000
    });
    expect(claim.status).toBe(201);

    const res = await call<Position>("lead", "GET", `/v1/core/customers/${customerId}/position`);
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe("AED");
    expect(res.body.ltvMinor).toBe(0);
    expect(res.body.positions).toEqual([
      { currency: "AED", premiumMinor: 200_000, commissionMinor: 13_600, settledMinor: 40_000 },
      { currency: "USD", premiumMinor: 50_000, commissionMinor: 2_500, settledMinor: 0 }
    ]);
  });

  it("nulls the sums an actor may not read, never zeroing them", async () => {
    const customerId = await newCustomer("degraded");
    const policyId = await newPolicy(customerId, "POS-DEG-1", "AED", 70_000, 3_500);
    const claim = await call("lead", "POST", "/v1/axis/claims", {
      policyId,
      customerId,
      claimNo: "POS-CLM-2",
      reportedAt: 3,
      currency: "AED",
      settledMinor: 10_000
    });
    expect(claim.status).toBe(201);

    // orbit.agent: axis:policies:read yes, axis:claims:read no (packages/core/src/rbac.ts).
    const res = await call<Position>("agent", "GET", `/v1/core/customers/${customerId}/position`);
    expect(res.status).toBe(200);
    expect(res.body.positions).toEqual([
      { currency: "AED", premiumMinor: 70_000, commissionMinor: 3_500, settledMinor: null }
    ]);
  });

  it("404s an id that does not exist in the tenant", async () => {
    const res = await call("lead", "GET", "/v1/core/customers/cus_nope/position");
    expect(res.status).toBe(404);
  });

  it("404s a soft-deleted customer", async () => {
    const customerId = await newCustomer("gone");
    await database
      .update(schema.customers)
      .set({ deletedAt: Date.now() })
      .where(and(eq(schema.customers.id, customerId)));
    const res = await call("lead", "GET", `/v1/core/customers/${customerId}/position`);
    expect(res.status).toBe(404);
  });
});
