import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { schema, type Db } from "@lyra/db";
import { seed, totpAt, TOTP_STEP_SEC, type SeedResult } from "@lyra/core";
import { app } from "./index.js";
import type { Env } from "./env.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const DAY = 86_400_000;
const exec = { waitUntil() {}, passThroughOnException() {} };
const RISK = { age: 34, sumInsuredMinor: 28_000_000, priorClaims: false, vehicleUse: "private", market: "AE" };

let env: Env;
let database: Db;
let seeded: SeedResult;
let token: string;
let controllerToken: string;
let productId: string;
let customerId: string;
let consentId: string;

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

async function autoApprove(...keys: string[]): Promise<void> {
  const tenantRow = (await database.select().from(schema.tenants).where(eq(schema.tenants.id, seeded.tenantId)))[0]!;
  const policy = JSON.parse(tenantRow.policyJson as string) as { autoApprove: string[] };
  await database.update(schema.tenants).set({ policyJson: JSON.stringify({ ...policy, autoApprove: keys }) }).where(eq(schema.tenants.id, seeded.tenantId));
}

async function boundPolicy(policyNo: string, startAt: number) {
  const shopped = ok(await call("POST", "/v1/dist/quote-requests/shop", { productId, channelId: seeded.channels.web, customerId, consentId, inputs: RISK, currency: "AED" }), 201);
  const quoted = (shopped.responses as any[]).filter((r) => r.state === "quoted");
  const best = quoted.slice().sort((a, b) => a.premiumMinor - b.premiumMinor)[0];
  expect(best, "the motor panel returned no quote to bind").toBeTruthy();
  ok(await call("POST", `/v1/dist/quote-requests/${shopped.request.id}/select`, { responseId: best.id }));
  const bound = ok(await call("POST", `/v1/axis/quote-responses/${best.id}/bind`, { policyNo, startAt, endAt: startAt + 365 * DAY }), 201);
  return bound.policy.id as string;
}

async function policyRow(policyId: string) {
  return (await database.select().from(schema.axisPolicies).where(eq(schema.axisPolicies.id, policyId)))[0]!;
}

async function accrueCommission(policyId: string) {
  return ok(await call("POST", "/v1/dist/commission-entries/accrue", { policyId, kind: "new_business", earnedOn: "issue", taxMinor: 0 }, {}, () => controllerToken), 201);
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
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
  controllerToken = await login("faisal.omar");
  productId = (await database.select().from(schema.products).where(eq(schema.products.line, "motor")))[0]!.id;
  const customer = (await database.select().from(schema.customers).limit(1))[0]!;
  customerId = customer.id;
  consentId = customer.consentId!;
  await autoApprove("axis.bind", "dist.commission_accrue");
}, 120_000);

describe("AXIS bordereaux (docs/27 §E)", () => {
  it("an outbound premium bordereau totals to the period's commission entries", async () => {
    const policyId1 = await boundPolicy(`BDX-P-${Date.now()}-1`, Date.now());
    const policyId2 = await boundPolicy(`BDX-P-${Date.now()}-2`, Date.now());
    const entry1 = await accrueCommission(policyId1);
    const entry2 = await accrueCommission(policyId2);
    const providerId = (await policyRow(policyId1)).providerId;

    const generated = ok(
      await call("POST", "/v1/axis/bordereaux", {
        direction: "outbound",
        counterpartyKind: "provider",
        counterpartyId: providerId,
        kind: "premium",
        period: currentPeriod()
      }),
      201
    );

    expect(generated.bordereau.lineCount).toBeGreaterThanOrEqual(2);
    const expectedCommission = entry1.grossCommissionMinor + entry2.grossCommissionMinor;
    expect(generated.bordereau.commissionMinor).toBe(expectedCommission);
  });

  it("regenerating the same period is idempotent", async () => {
    const policyId = await boundPolicy(`BDX-I-${Date.now()}`, Date.now());
    await accrueCommission(policyId);
    const providerId = (await policyRow(policyId)).providerId;
    const period = currentPeriod();
    const params = { direction: "outbound", counterpartyKind: "provider", counterpartyId: providerId, kind: "premium", period };

    const first = ok(await call("POST", "/v1/axis/bordereaux", params), 201);
    const second = ok(await call("POST", "/v1/axis/bordereaux", params), 201);

    expect(second.bordereau.id).toBe(first.bordereau.id);
    expect(second.bordereau.lineCount).toBe(first.bordereau.lineCount);
    expect(second.bordereau.commissionMinor).toBe(first.bordereau.commissionMinor);
  });

  it("an inbound line with no local match lands as missing_ours", async () => {
    const generated = ok(
      await call("POST", "/v1/axis/bordereaux", {
        direction: "inbound",
        counterpartyKind: "provider",
        counterpartyId: "ext-provider-1",
        kind: "premium",
        period: currentPeriod(),
        currency: "AED",
        lines: [{ externalRef: "NO-SUCH-POLICY-999", grossPremiumMinor: 500_000 }]
      }),
      201
    );

    const reconciled = ok(await call("POST", `/v1/axis/bordereaux/${generated.bordereau.id}/reconcile`), 200);
    expect(reconciled.lines).toHaveLength(1);
    expect(reconciled.lines[0].matchState).toBe("missing_ours");
  });

  it("an outbound claims bordereau totals paid and reserve amounts for the period", async () => {
    const policyId = await boundPolicy(`BDX-C-${Date.now()}`, Date.now());
    const policy = await policyRow(policyId);
    const now = Date.now();
    await database.insert(schema.axisClaims).values({
      id: `axclm_bdx_${now}`,
      tenantId: seeded.tenantId,
      policyId,
      customerId,
      claimNo: `BDX-CLM-${now}`,
      incidentAt: now - DAY,
      reportedAt: now,
      amountMinor: 400_000,
      paidMinor: 150_000,
      reserveMinor: 100_000,
      currency: "AED",
      createdAt: now,
      updatedAt: now
    } as typeof schema.axisClaims.$inferInsert);

    const generated = ok(
      await call("POST", "/v1/axis/bordereaux", {
        direction: "outbound",
        counterpartyKind: "provider",
        counterpartyId: policy.providerId,
        kind: "claims",
        period: currentPeriod()
      }),
      201
    );

    expect(generated.bordereau.lineCount).toBeGreaterThanOrEqual(1);
    expect(generated.bordereau.claimsPaidMinor).toBeGreaterThanOrEqual(150_000);
    expect(generated.bordereau.reserveMinor).toBeGreaterThanOrEqual(100_000);
  });
});
