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

// docs/27 F13 / docs/specs/gap-axis-design.md §C.10. Two tables held one
// concept: the panel fan-out wrote `dist_quote_responses`, while `axis_quotes`
// was written in exactly one place — the seed — and read by the quote desk.
// `dist_quote_responses` is now the single source of quote truth, and a quote
// keyed by hand goes into the same table the fan-out fills.

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

describe("AXIS quote source (docs/27 F13)", () => {
  it("a manually keyed quote lands in dist_quote_responses, not axis_quotes", async () => {
    const before = await database.select().from(schema.axisQuotes);
    const offering = (await database.select().from(schema.distOfferings).limit(1))[0]!;
    const kase = ok(
      await call("POST", "/v1/axis/cases", {
        ref: "GNX-MANUAL-0001",
        kind: "bind",
        productLine: "motor",
        channelId: seeded.channels.web,
        status: "quoting"
      }),
      201
    );

    const quote = ok(
      await call("POST", `/v1/axis/cases/${kase.id}/quotes`, {
        providerId: offering.providerId,
        offeringId: offering.id,
        premiumMinor: 431_500,
        currency: "AED",
        validUntil: Date.now() + 7 * 86_400_000
      }),
      201
    );

    // The row is a quote response on the case's request, indistinguishable from
    // a panel answer to everything downstream — comparison, ranking and bind.
    expect(quote.state).toBe("quoted");
    expect(quote.premiumMinor).toBe(431_500);
    const stored = (
      await database
        .select()
        .from(schema.distQuoteResponses)
        .where(eq(schema.distQuoteResponses.id, quote.id as string))
    )[0]!;
    expect(stored.offeringId).toBe(offering.id);
    expect(stored.tenantId).toBe(seeded.tenantId);

    // A case opened without a shop gets a synthetic request, and the case now
    // points at it: one request per case is what keeps the desk's grouping and
    // `/select` working for a hand-keyed panel.
    const reopened = (
      await database.select().from(schema.axisCases).where(eq(schema.axisCases.id, kase.id as string))
    )[0]!;
    expect(reopened.quoteRequestId).toBe(stored.requestId);

    // Nothing was written to the retired table, and the CRUD door it used to
    // come through is gone.
    expect((await database.select().from(schema.axisQuotes)).length).toBe(before.length);
    const legacy = await call("POST", "/v1/axis/quotes", {
      caseId: kase.id,
      providerId: offering.providerId,
      premiumMinor: 431_500,
      currency: "AED"
    });
    expect(legacy.status).toBe(404);
  });

  it("seed produces a policy version pointing at a dist_quote_response", async () => {
    const policy = (
      await database
        .select()
        .from(schema.axisPolicies)
        .where(and(eq(schema.axisPolicies.tenantId, seeded.tenantId), eq(schema.axisPolicies.policyNo, "CDR-MOT-2601-778201")))
    )[0]!;
    expect(policy.currentVersionId).toBeTruthy();

    const version = (
      await database
        .select()
        .from(schema.axisPolicyVersions)
        .where(eq(schema.axisPolicyVersions.id, policy.currentVersionId!))
    )[0]!;
    expect(version.versionSeq).toBe(1);
    expect(version.reason).toBe("issue");
    expect(version.state).toBe("effective");
    expect(version.quoteResponseId).toBeTruthy();

    // The pointer resolves — the seeded sale traces back to the winning panel
    // answer, not to a parallel `axis_quotes` row nobody else reads.
    const response = (
      await database
        .select()
        .from(schema.distQuoteResponses)
        .where(eq(schema.distQuoteResponses.id, version.quoteResponseId!))
    )[0]!;
    expect(response.state).toBe("quoted");
    expect(response.premiumMinor).toBe(policy.premiumMinor);
  });
});
