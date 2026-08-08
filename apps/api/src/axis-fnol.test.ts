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

// docs/27 F24 / docs/specs/gap-axis-design.md §H task 9. A notification is
// evidence before it is a claim. Two rules follow: the cover that answers is
// the cover that was in force on the day of the loss — not the cover in force
// today — and a notification is recorded whether or not any cover answers,
// because refusing to write one down is a conduct failure.

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

async function login(local: string): Promise<string> {
  const res = ok(await call("POST", "/v1/auth/login", { email: `${local}@gonxt.ae`, password: PASSWORD, tenantSlug: "gonxt" }));
  const issued = res.token as string;
  token = issued;
  const verified = await call("POST", "/v1/auth/mfa/verify", {
    code: await totpAt(DEMO_TOTP_SECRET, Math.floor(Date.now() / 1000 / TOTP_STEP_SEC))
  });
  expect(verified.status).toBe(200);
  return issued;
}

async function autoApprove(...keys: string[]): Promise<void> {
  const tenantRow = (await database.select().from(schema.tenants).where(eq(schema.tenants.id, seeded.tenantId)))[0]!;
  const policy = JSON.parse(tenantRow.policyJson as string) as { autoApprove: string[] };
  await database
    .update(schema.tenants)
    .set({ policyJson: JSON.stringify({ ...policy, autoApprove: keys }) })
    .where(eq(schema.tenants.id, seeded.tenantId));
}

async function boundPolicy(policyNo: string, startAt: number) {
  const shopped = ok(
    await call("POST", "/v1/dist/quote-requests/shop", {
      productId,
      channelId: seeded.channels.web,
      customerId,
      consentId,
      inputs: RISK,
      currency: "AED"
    }),
    201
  );
  const quoted = (shopped.responses as any[]).filter((r) => r.state === "quoted");
  const best = quoted.slice().sort((a, b) => a.premiumMinor - b.premiumMinor)[0];
  expect(best, "the motor panel returned no quote to bind").toBeTruthy();
  ok(await call("POST", `/v1/dist/quote-requests/${shopped.request.id}/select`, { responseId: best.id }));
  const bound = ok(
    await call("POST", `/v1/axis/quote-responses/${best.id}/bind`, { policyNo, startAt, endAt: startAt + 365 * DAY }),
    201
  );
  return bound.policy.id as string;
}

async function versionsOf(policyId: string) {
  return database.select().from(schema.axisPolicyVersions).where(eq(schema.axisPolicyVersions.policyId, policyId));
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

  await login("omar.farouk");
  await autoApprove("axis.bind", "axis.underwriting_referral", "axis.endorse");

  productId = (await database.select().from(schema.products).where(eq(schema.products.line, "motor")))[0]!.id;
  const customer = (await database.select().from(schema.customers).limit(1))[0]!;
  customerId = customer.id;
  consentId = customer.consentId!;
}, 120_000);

describe("AXIS FNOL and coverage check (docs/27 F24)", () => {
  it("a claim records the policy version in force at the incident date", async () => {
    const startAt = Date.now() - 200 * DAY;
    const policyId = await boundPolicy("POL-FNOL-1", startAt);

    // Endorse mid-term. The head now points at version 2, but a loss that
    // happened before the endorsement is answered by version 1 — the terms the
    // customer actually had on the day.
    const endorseAt = startAt + 100 * DAY;
    ok(
      await call("POST", `/v1/axis/policies/${policyId}/endorse`, {
        effectiveFrom: endorseAt,
        reason: "mta.vehicle_change",
        changes: { excessMinor: 2_000_00 }
      })
    );
    const versions = (await versionsOf(policyId)).sort((a, b) => a.versionSeq - b.versionSeq);
    expect(versions, "endorsement should have produced a second version").toHaveLength(2);
    const [v1, v2] = versions;

    const incidentAt = startAt + 50 * DAY;
    const cover = ok(await call("POST", "/v1/axis/claims/coverage-check", { policyId, incidentAt }));
    expect(cover.coverageState).toBe("in_force");
    expect(cover.policyVersionId).toBe(v1!.id);
    expect(cover.policyVersionId).not.toBe(v2!.id);

    const claim = ok(
      await call("POST", "/v1/axis/claims", {
        policyId,
        customerId,
        incidentAt,
        perilCode: "collision",
        description: "Rear-ended at a junction.",
        amountMinor: 12_000_00,
        currency: "AED"
      }),
      201
    );
    const row = (claim.claim ?? claim) as Record<string, unknown>;
    expect(row.policyVersionId).toBe(v1!.id);
    expect(row.coverageState).toBe("in_force");
    expect(row.status).toBe("reported");
    expect(row.coverageCheckedAt).toBeTruthy();

    // The snapshot is taken at notification, not read back later: the version
    // could be voided by a correction and the claim must still show what was
    // relied on.
    expect(JSON.parse(String(row.coverageJson))).toMatchObject({ versionSeq: 1 });

    // A notification is a transaction, so it is auditable and reversible.
    const txns = await database
      .select()
      .from(schema.ledgerTxns)
      .where(eq(schema.ledgerTxns.type, "FNOL-REGISTER"));
    expect(txns.some((t) => (t.subjectRefsJson ?? "").includes(String(row.id)))).toBe(true);
  });

  it("an incident before inception registers with coverageState not_yet_incepted", async () => {
    const startAt = Date.now() - 10 * DAY;
    const policyId = await boundPolicy("POL-FNOL-2", startAt);
    const incidentAt = startAt - 5 * DAY;

    const cover = ok(await call("POST", "/v1/axis/claims/coverage-check", { policyId, incidentAt }));
    expect(cover.coverageState).toBe("not_yet_incepted");
    expect(cover.policyVersionId).toBeNull();
    expect(cover.warnings.join(" ")).toMatch(/incept/i);

    const claim = ok(
      await call("POST", "/v1/axis/claims", {
        policyId,
        customerId,
        incidentAt,
        perilCode: "theft",
        description: "Reported late, incident predates cover.",
        currency: "AED"
      }),
      201
    );
    const row = (claim.claim ?? claim) as Record<string, unknown>;
    expect(row.coverageState).toBe("not_yet_incepted");
    expect(row.policyVersionId).toBeNull();
    expect(row.status).toBe("reported");
  });

  it("an out-of-cover notification is still recorded", async () => {
    // Cover ended before the loss. Declining to write the notification down
    // would be the conduct failure; the claim is registered and flagged so a
    // human decides, and no cover is implied by the record existing.
    const startAt = Date.now() - 500 * DAY;
    const policyId = await boundPolicy("POL-FNOL-3", startAt);
    const incidentAt = startAt + 400 * DAY;

    const cover = ok(await call("POST", "/v1/axis/claims/coverage-check", { policyId, incidentAt }));
    expect(cover.coverageState).toBe("out_of_cover");

    const claim = ok(
      await call("POST", "/v1/axis/claims", {
        policyId,
        customerId,
        incidentAt,
        perilCode: "fire",
        description: "Loss after expiry.",
        amountMinor: 5_000_00,
        currency: "AED"
      }),
      201
    );
    const row = (claim.claim ?? claim) as Record<string, unknown>;
    expect(row.coverageState).toBe("out_of_cover");
    expect(row.status).toBe("reported");
    expect(row.claimNo, "a notification without a reference is not a record").toBeTruthy();

    // It is on the books: readable, and countable in the claims list.
    const listed = ok(await call("GET", "/v1/axis/claims?limit=100"));
    expect((listed.data as any[]).some((c) => c.id === row.id)).toBe(true);
  });
});
