import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { claimReserveViolations, schema, type Db } from "@lyra/db";
import { seed, totpAt, TOTP_STEP_SEC, type SeedResult } from "@lyra/core";
import { app } from "./index.js";
import type { Env } from "./env.js";

// docs/specs/gap-axis-design.md §B.2 + §D.3, reached from §H task 11. A reserve
// is a history, not a number: "what did we think this was worth in March" is
// what triangles and reserve adequacy are made of, so every movement appends a
// row and `axis_claims.reserveMinor` is only the denormalised head of it. The
// claim's own state machine lives in the same file because the desk moves both
// in one sitting — and neither may be done by PATCHing a column.

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
let policyId: string;

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

async function autoApprove(...keys: string[]): Promise<void> {
  const tenantRow = (await database.select().from(schema.tenants).where(eq(schema.tenants.id, seeded.tenantId)))[0]!;
  const policy = JSON.parse(tenantRow.policyJson as string) as { autoApprove: string[] };
  await database
    .update(schema.tenants)
    .set({ policyJson: JSON.stringify({ ...policy, autoApprove: keys }) })
    .where(eq(schema.tenants.id, seeded.tenantId));
}

async function openClaim(claimNo: string, amountMinor: number): Promise<string> {
  const out = ok(
    await call("POST", "/v1/axis/claims", {
      policyId,
      customerId,
      claimNo,
      incidentAt: Date.now() - DAY,
      reportedAt: Date.now(),
      amountMinor,
      currency: "AED"
    }),
    201
  );
  return ((out.claim ?? out) as { id: string }).id;
}

async function claimRow(claimId: string) {
  return (await database.select().from(schema.axisClaims).where(eq(schema.axisClaims.id, claimId)))[0]!;
}

async function reservesOf(claimId: string) {
  const rows = await database
    .select()
    .from(schema.axisClaimReserves)
    .where(eq(schema.axisClaimReserves.claimId, claimId));
  return rows.slice().sort((a, b) => a.seq - b.seq);
}

async function txnsFor(claimId: string, type: string) {
  const rows = await database
    .select()
    .from(schema.ledgerTxns)
    .where(and(eq(schema.ledgerTxns.tenantId, seeded.tenantId), eq(schema.ledgerTxns.type, type)));
  return rows.filter((t) => (t.subjectRefsJson ?? "").includes(claimId));
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

  productId = (await database.select().from(schema.products).where(eq(schema.products.line, "motor")))[0]!.id;
  const customer = (await database.select().from(schema.customers).limit(1))[0]!;
  customerId = customer.id;
  consentId = customer.consentId!;

  await autoApprove("axis.bind");
  const start = Date.now() - 30 * DAY;
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
  ok(await call("POST", `/v1/dist/quote-requests/${shopped.request.id}/select`, { responseId: best.id }));
  const bound = ok(
    await call("POST", `/v1/axis/quote-responses/${best.id}/bind`, {
      policyNo: "POL-RSV-1",
      startAt: start,
      endAt: start + 365 * DAY
    }),
    201
  );
  policyId = bound.policy.id as string;
}, 120_000);

describe("AXIS claim reserves (docs/specs/gap-axis-design.md §C.4, §D.3)", () => {
  it("a reserve movement appends rather than overwrites", async () => {
    const claimId = await openClaim("CLM-RSV-1", 30_000_00);

    ok(
      await call("POST", `/v1/axis/claims/${claimId}/reserves`, {
        amountMinor: 20_000_00,
        basis: "desk_estimate",
        rationale: "first look at the photographs"
      }),
      201
    );
    ok(
      await call("POST", `/v1/axis/claims/${claimId}/reserves`, {
        amountMinor: 35_000_00,
        basis: "assessor",
        rationale: "assessor's report raises the estimate"
      }),
      201
    );

    const rows = await reservesOf(claimId);
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
    // The earlier opinion survives the later one — that is the whole point.
    expect(rows[0]!.amountMinor).toBe(20_000_00);
    expect(rows[0]!.previousMinor).toBe(0);
    expect(rows[0]!.deltaMinor).toBe(20_000_00);
    expect(rows[1]!.previousMinor).toBe(20_000_00);
    expect(rows[1]!.deltaMinor).toBe(15_000_00);
    expect(rows[1]!.basis).toBe("assessor");

    const claim = await claimRow(claimId);
    expect(claim.reserveMinor).toBe(35_000_00);
    // packages/db/src/claim-reserves.ts is the invariant, not this assertion.
    expect(claimReserveViolations(claim, rows)).toEqual([]);

    // A reserve is an opinion about future money, not money: CLAIM-RESERVE is a
    // transaction so it is reversible and auditable, and posts no journal.
    const txns = await txnsFor(claimId, "CLAIM-RESERVE");
    expect(txns.length).toBe(2);
    expect(txns.every((t) => t.ledgerBatchId === null)).toBe(true);
  });

  it("heads are reserved independently and sum to the claim's reserve", async () => {
    const claimId = await openClaim("CLM-RSV-2", 30_000_00);
    ok(await call("POST", `/v1/axis/claims/${claimId}/reserves`, { amountMinor: 10_000_00, basis: "desk_estimate" }), 201);
    ok(
      await call("POST", `/v1/axis/claims/${claimId}/reserves`, {
        head: "expense",
        amountMinor: 2_000_00,
        basis: "desk_estimate"
      }),
      201
    );

    const rows = await reservesOf(claimId);
    // Each head numbers itself from 1 — the sequence is per head, not per claim.
    expect(rows.filter((r) => r.head === "expense").map((r) => r.seq)).toEqual([1]);
    const claim = await claimRow(claimId);
    expect(claim.reserveMinor).toBe(12_000_00);
    expect(claimReserveViolations(claim, rows)).toEqual([]);
  });

  it("a reserve above the tenant threshold waits for a decision and writes nothing", async () => {
    const claimId = await openClaim("CLM-RSV-3", 90_000_00);
    // packages/core/src/approvals.ts: axis.claim_reserve gates above 50,000.00.
    const res = await call("POST", `/v1/axis/claims/${claimId}/reserves`, {
      amountMinor: 60_000_00,
      basis: "desk_estimate"
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("approval_required");

    expect(await reservesOf(claimId)).toEqual([]);
    expect((await claimRow(claimId)).reserveMinor).toBe(0);
    expect(await txnsFor(claimId, "CLAIM-RESERVE")).toEqual([]);
  });
});

describe("AXIS claim transitions (docs/specs/gap-axis-design.md §B.2)", () => {
  it("only legal hops are allowed and each posts its own transaction", async () => {
    const claimId = await openClaim("CLM-TRN-1", 12_000_00);
    expect((await claimRow(claimId)).status).toBe("reported");

    // reported -> settled is not a hop anyone may take, however senior.
    const illegal = await call("POST", `/v1/axis/claims/${claimId}/transition`, { to: "settled" });
    expect(illegal.status).toBe(409);
    expect((await claimRow(claimId)).status).toBe("reported");

    const out = ok(await call("POST", `/v1/axis/claims/${claimId}/transition`, { to: "triage" }));
    expect(out.claim.status).toBe("triage");
    const syncs = await txnsFor(claimId, "CLAIM-SYNC");
    expect(syncs.length).toBe(1);
    expect(syncs[0]!.ledgerBatchId).toBeNull();

    const outbox = await database.select().from(schema.eventOutbox).where(eq(schema.eventOutbox.type, "axis.claim.triaged"));
    expect(outbox.filter((e) => e.envelopeJson.includes(claimId)).length).toBe(1);
  });

  it("declining a claim always needs dual control", async () => {
    // `axis.claim_settlement` is neverAutoApprove (docs/19 §4.1): telling a
    // customer no is never a thing one person does alone, allowlist or not.
    await autoApprove("axis.bind", "axis.claim_settlement");
    const claimId = await openClaim("CLM-TRN-2", 12_000_00);
    ok(await call("POST", `/v1/axis/claims/${claimId}/transition`, { to: "triage" }));

    const res = await call("POST", `/v1/axis/claims/${claimId}/transition`, { to: "rejected", reason: "no cover" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("approval_required");
    expect((await claimRow(claimId)).status).toBe("triage");
    expect(await txnsFor(claimId, "CLAIM-DECLINE")).toEqual([]);

    const raised = (await database.select().from(schema.approvals).where(eq(schema.approvals.tenantId, seeded.tenantId)))
      .filter((a) => a.subjectRef.includes(claimId) && a.policyKey === "axis.claim_settlement");
    expect(raised.length).toBe(1);
    expect(JSON.parse(raised[0]!.contextJson as string).dualControl).toBe(true);
  });
});
