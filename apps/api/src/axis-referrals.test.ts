import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
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
const RISK = { age: 34, sumInsuredMinor: 28_000_000, priorClaims: false, vehicleUse: "private", market: "AE" };

let env: Env;
let database: Db;
let seeded: SeedResult;
let token: string;
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

async function setAuthority(valueJson: Record<string, unknown>): Promise<void> {
  const now = Date.now();
  await database.delete(schema.axisOpsPolicies).where(eq(schema.axisOpsPolicies.key, "axis.authority"));
  await database.insert(schema.axisOpsPolicies).values({
    id: newId("opl", now),
    tenantId: seeded.tenantId,
    key: "axis.authority",
    kind: "authority",
    valueJson: JSON.stringify(valueJson),
    status: "active",
    updatedBy: "system",
    createdAt: now,
    updatedAt: now
  } as typeof schema.axisOpsPolicies.$inferInsert);
}

async function shopAndSelect(policyNo: string) {
  const shopped = ok(await call("POST", "/v1/dist/quote-requests/shop", { productId, channelId: seeded.channels.web, customerId, consentId, inputs: RISK, currency: "AED" }), 201);
  const quoted = (shopped.responses as any[]).filter((r) => r.state === "quoted");
  const best = quoted.slice().sort((a, b) => a.premiumMinor - b.premiumMinor)[0];
  expect(best, "the motor panel returned no quote to bind").toBeTruthy();
  ok(await call("POST", `/v1/dist/quote-requests/${shopped.request.id}/select`, { responseId: best.id }));
  return best;
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
  productId = (await database.select().from(schema.products).where(eq(schema.products.line, "motor")))[0]!.id;
  const customer = (await database.select().from(schema.customers).limit(1))[0]!;
  customerId = customer.id;
  consentId = customer.consentId!;
  await autoApprove("axis.bind", "dist.commission_accrue");
}, 120_000);

describe("AXIS underwriting referrals (docs/27 §A.4, §D.6)", () => {
  it("a bind above delegated authority creates a referral instead of a policy", async () => {
    await setAuthority({ underwriting: [{ role: "axis.lead", productLine: "*", maxPremiumMinor: 100_000 }] });
    const best = await shopAndSelect(`AXIS-REF-${Date.now()}`);
    expect(best.premiumMinor, "the panel's premium is too small to clear the authority limit").toBeGreaterThan(100_000);

    const res = await call("POST", `/v1/axis/quote-responses/${best.id}/bind`, {
      policyNo: `AXIS-REF-${Date.now()}`,
      startAt: Date.now(),
      endAt: Date.now() + 365 * DAY
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("approval_required");

    const referrals = await database
      .select()
      .from(schema.axisReferrals)
      .where(eq(schema.axisReferrals.tenantId, seeded.tenantId));
    expect(referrals.length).toBe(1);
    expect(referrals[0]!.kind).toBe("authority_limit");
    expect(referrals[0]!.state).toBe("open");
  });

  it("a bind within delegated authority proceeds without a referral", async () => {
    await setAuthority({ underwriting: [{ role: "axis.lead", productLine: "*", maxPremiumMinor: 25_000_000 }] });
    const best = await shopAndSelect(`AXIS-OK-${Date.now()}`);
    expect(best.premiumMinor).toBeLessThan(25_000_000);

    const res = await call("POST", `/v1/axis/quote-responses/${best.id}/bind`, {
      policyNo: `AXIS-OK-${Date.now()}`,
      startAt: Date.now(),
      endAt: Date.now() + 365 * DAY
    });
    expect(res.status).toBe(201);
  });

  it("accepting the referral unblocks a retry of the same bind", async () => {
    await setAuthority({ underwriting: [{ role: "axis.lead", productLine: "*", maxPremiumMinor: 100_000 }] });
    const best = await shopAndSelect(`AXIS-RETRY-${Date.now()}`);
    const bindBody = { policyNo: `AXIS-RETRY-${Date.now()}`, startAt: Date.now(), endAt: Date.now() + 365 * DAY };

    const blocked = await call("POST", `/v1/axis/quote-responses/${best.id}/bind`, bindBody);
    expect(blocked.status).toBe(403);

    const opened = (
      await database
        .select()
        .from(schema.axisReferrals)
        .where(and(eq(schema.axisReferrals.tenantId, seeded.tenantId), eq(schema.axisReferrals.state, "open")))
    ).sort((a, b) => b.createdAt - a.createdAt)[0]!;
    expect(opened).toBeTruthy();

    ok(await call("POST", `/v1/axis/referrals/${opened.id}/decide`, { intent: "accept" }));

    const retried = await call("POST", `/v1/axis/quote-responses/${best.id}/bind`, bindBody);
    expect(retried.status).toBe(201);
  });
});
