import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { seed } from "@lyra/core";
import { schema, type Db } from "@lyra/db";
import { app } from "./index.js";
import type { Env } from "./env.js";

// New unauthenticated surface (docs/decisions/ADR-0030): a public comparison
// site has no session and no tenant-scoped caller, so it cannot reuse
// /v1/dist or /v1/core — it needs its own door, the same shape as
// /v1/onboarding/partners/signup (routes/onboarding.ts), scoped read-only to
// branding + active products plus a throttled lead-capture write.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const exec = { waitUntil() {}, passThroughOnException() {} };

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

class FakeKv {
  readonly store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

class FakeBucket {
  readonly store = new Map<string, Uint8Array>();
  async put(key: string, value: Uint8Array): Promise<void> {
    this.store.set(key, value);
  }
}

let env: Env;
let kv: FakeKv;
let files: FakeBucket;
let database: Db;

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
      headers: { "content-type": "application/json", ...headers },
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
  for (const stmt of statements()) await client.execute(stmt);
  database = drizzle(client) as unknown as Db;
  await seed(database as never, { mfaSecret: DEMO_TOTP_SECRET });
  kv = new FakeKv();
  files = new FakeBucket();
  env = {
    DB_CLIENT: database,
    ENVIRONMENT: "development",
    APP_ORIGIN: "http://localhost:5173",
    KV: kv as unknown as Env["KV"],
    FILES: files as unknown as Env["FILES"]
  } as unknown as Env;
}, 120_000);

describe("GET /v1/portal/:tenantSlug/site", () => {
  it("returns brand and active products with no session at all", async () => {
    const res = await call("GET", "/v1/portal/gonxt/site");
    expect(res.status).toBe(200);
    expect(res.body.tenant.name).toBe("GONXT");
    expect(res.body.tenant.brand.palette.accent).toBe("#3762C4");
    expect(res.body.products.length).toBeGreaterThan(0);
    expect(res.body.products.every((p: any) => typeof p.id === "string" && typeof p.name === "string")).toBe(true);
    // Never a PII/internal field on the public surface.
    expect(JSON.stringify(res.body)).not.toMatch(/pricingInputsJson|takafulJson/);
  });

  it("404s an unknown or inactive tenant rather than guessing", async () => {
    const res = await call("GET", "/v1/portal/does-not-exist/site");
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/portal/:tenantSlug/leads", () => {
  async function firstActiveProductId(): Promise<string> {
    const rows = await database.select().from(schema.products).where(eq(schema.products.status, "active"));
    return rows[0]!.id;
  }

  it("creates a customer and an open quote request against an auto-provisioned direct-web channel", async () => {
    const productId = await firstActiveProductId();
    const res = await call("POST", "/v1/portal/gonxt/leads", {
      productId,
      name: "Jamie Visitor",
      email: "jamie.visitor@example.com",
      phone: "+971500000000",
      message: "Interested in a quote",
      consent: true
    });
    expect(res.status).toBe(201);
    expect(res.body.quoteRequestId).toBeTruthy();

    const [qr] = await database
      .select()
      .from(schema.distQuoteRequests)
      .where(eq(schema.distQuoteRequests.id, res.body.quoteRequestId));
    expect(qr!.state).toBe("open");
    expect(qr!.productId).toBe(productId);

    const [channel] = await database.select().from(schema.distChannels).where(eq(schema.distChannels.id, qr!.channelId));
    expect(channel!.kind).toBe("b2c");
    expect(channel!.key).toBe("direct-web");

    const [customer] = await database.select().from(schema.customers).where(eq(schema.customers.id, qr!.customerId!));
    expect(JSON.parse(customer!.emailsJson!)).toContain("jamie.visitor@example.com");

    // consent: true was validated but, until this fix, never landed anywhere
    // (regression: IMPORTANT 7).
    expect(qr!.consentId).toBeTruthy();
    const [consent] = await database.select().from(schema.consents).where(eq(schema.consents.id, qr!.consentId!));
    expect(consent!.customerId).toBe(qr!.customerId);
    expect(consent!.source).toBe("portal");
    expect(JSON.parse(consent!.purposesJson).dataSharing).toBe(true);

    const auditRows = await database.select().from(schema.auditLog);
    expect(auditRows.some((a) => a.action === "dist.quote_requests.create" && a.subjectRef === `quote-requests:${qr!.id}`)).toBe(
      true
    );
  });

  it("reuses the same customer and the same direct-web channel on a second lead", async () => {
    const productId = await firstActiveProductId();
    const first = await call("POST", "/v1/portal/gonxt/leads", {
      productId,
      name: "Repeat Visitor",
      email: "repeat.visitor@example.com",
      consent: true
    });
    expect(first.status).toBe(201);

    kv.store.clear(); // bypass this test's own throttle window, not the assertion under test
    const second = await call("POST", "/v1/portal/gonxt/leads", {
      productId,
      name: "Repeat Visitor",
      email: "repeat.visitor@example.com",
      consent: true
    });
    expect(second.status).toBe(201);

    const [qr1] = await database.select().from(schema.distQuoteRequests).where(eq(schema.distQuoteRequests.id, first.body.quoteRequestId));
    const [qr2] = await database.select().from(schema.distQuoteRequests).where(eq(schema.distQuoteRequests.id, second.body.quoteRequestId));
    expect(qr1!.customerId).toBe(qr2!.customerId);
    expect(qr1!.channelId).toBe(qr2!.channelId);
  });

  it("throttles repeated submissions from the same email", async () => {
    const productId = await firstActiveProductId();
    const payload = { productId, name: "Spammy", email: "spam@example.com", consent: true };
    for (let i = 0; i < 3; i++) await call("POST", "/v1/portal/gonxt/leads", payload);
    const res = await call("POST", "/v1/portal/gonxt/leads", payload);
    expect(res.status).toBe(429);
  });

  it("throttles repeated submissions from the same IP even across different emails (regression: IMPORTANT 6)", async () => {
    const productId = await firstActiveProductId();
    const ip = "203.0.113.9";
    for (let i = 0; i < 10; i++) {
      await call(
        "POST",
        "/v1/portal/gonxt/leads",
        { productId, name: "Rotating Email", email: `rotating-${i}@example.com`, consent: true },
        { "cf-connecting-ip": ip }
      );
    }
    const res = await call(
      "POST",
      "/v1/portal/gonxt/leads",
      { productId, name: "Rotating Email", email: "rotating-final@example.com", consent: true },
      { "cf-connecting-ip": ip }
    );
    expect(res.status).toBe(429);

    // A different IP is unaffected.
    const other = await call(
      "POST",
      "/v1/portal/gonxt/leads",
      { productId, name: "Elsewhere", email: "elsewhere@example.com", consent: true },
      { "cf-connecting-ip": "203.0.113.10" }
    );
    expect(other.status).toBe(201);
  });

  it("rejects a submission without consent or with malformed input", async () => {
    const productId = await firstActiveProductId();
    const noConsent = await call("POST", "/v1/portal/gonxt/leads", {
      productId,
      name: "No Consent",
      email: "noconsent@example.com",
      consent: false
    });
    expect(noConsent.status).toBe(400);

    const badEmail = await call("POST", "/v1/portal/gonxt/leads", {
      productId,
      name: "Bad Email",
      email: "not-an-email",
      consent: true
    });
    expect(badEmail.status).toBe(400);
  });

  it("404s a lead against an unknown tenant or a product from a different tenant", async () => {
    const productId = await firstActiveProductId();
    const wrongTenant = await call("POST", "/v1/portal/does-not-exist/leads", {
      productId,
      name: "Ghost",
      email: "ghost@example.com",
      consent: true
    });
    expect(wrongTenant.status).toBe(404);

    const wrongProduct = await call("POST", "/v1/portal/gonxt/leads", {
      productId: "prd_not_real",
      name: "Wrong Product",
      email: "wrongproduct@example.com",
      consent: true
    });
    expect(wrongProduct.status).toBe(404);
  });
});

// J-C1 "Get covered" self-serve (docs/06). The operator half already existed
// (/v1/dist/quote-requests/shop, journeys.test.ts); this is the same shop run by
// a stranger with no session, so the tests that matter are the ones about who
// may see the comparison and what the public shape leaves out.
describe("J-C1 self-serve quote", () => {
  const RISK = { age: 34, sumInsuredMinor: 28_000_000, priorClaims: false, vehicleUse: "private" };
  let motorId: string;
  let requestId: string;
  let token: string;
  let offers: any[];

  async function upload(path: string, fields: Record<string, string>, file?: Blob, name = "id.png"): Promise<Res> {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    if (file) form.append("file", file, name);
    const res = await app.fetch(
      new Request(`http://api.test${path}`, { method: "POST", body: form }),
      env as never,
      exec as never
    );
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  it("prices the whole panel from the public lead form and hands back a one-time link", async () => {
    const [motor] = await database.select().from(schema.products).where(eq(schema.products.line, "motor"));
    motorId = motor!.id;

    const res = await call("POST", "/v1/portal/gonxt/leads", {
      productId: motorId,
      name: "Self Serve",
      email: "self.serve@example.com",
      consent: true,
      inputs: RISK
    });
    expect(res.status).toBe(201);
    requestId = res.body.quoteRequestId;
    token = res.body.token;
    offers = res.body.offers;

    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(res.body.rankedBy).toBe("total_price");
    expect(offers.length).toBeGreaterThan(1);
    const totals = offers.map((o) => o.totalMinor);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    expect(offers.every((o) => o.premiumMinor > 0 && o.providerName)).toBe(true);

    // Margin, provider scoring and why an underwriter said no are staff-only
    // (docs/12): the public comparison must not carry them at all.
    expect(JSON.stringify(res.body)).not.toMatch(/commission|valueScore|declineReason/i);

    // The plaintext token is shown once and never stored.
    const [qr] = await database
      .select()
      .from(schema.distQuoteRequests)
      .where(eq(schema.distQuoteRequests.id, requestId));
    // A referral offering (ORX-MOT-TKF) answers out of band, so the request
    // stays open for it while the priced offers are already comparable.
    expect(qr!.state).toBe("fanned_out");
    expect(res.body.referredCount).toBeGreaterThan(0);
    expect(qr!.portalTokenHash).toBeTruthy();
    expect(qr!.portalTokenHash).not.toBe(token);
    expect(qr!.bestPremiumMinor).toBe(Math.min(...offers.map((o) => o.premiumMinor)));
  });

  it("re-opens the comparison with the token and 404s without it", async () => {
    const ok = await call("GET", `/v1/portal/gonxt/quote-requests/${requestId}?token=${token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.offers.length).toBe(offers.length);

    expect((await call("GET", `/v1/portal/gonxt/quote-requests/${requestId}`)).status).toBe(404);
    expect((await call("GET", `/v1/portal/gonxt/quote-requests/${requestId}?token=${"0".repeat(48)}`)).status).toBe(404);
  });

  it("accepts a chosen offer without binding cover, and refuses one that was never quoted", async () => {
    const unknown = await call("POST", `/v1/portal/gonxt/quote-requests/${requestId}/accept`, {
      token,
      offeringId: "off_not_on_this_request"
    });
    expect(unknown.status).toBe(404);

    const chosen = offers[0].offeringId;
    const res = await call("POST", `/v1/portal/gonxt/quote-requests/${requestId}/accept`, {
      token,
      offeringId: chosen
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ acceptedOfferingId: chosen, nextStep: "documents" });

    const [qr] = await database
      .select()
      .from(schema.distQuoteRequests)
      .where(eq(schema.distQuoteRequests.id, requestId));
    expect(qr!.state).toBe("converted");
    expect(qr!.bestOfferingId).toBe(chosen);

    // Acceptance is consequential-adjacent but not issuance (CLAUDE.md §4): no
    // case and no cover exist until a human picks it up.
    const cases = await database.select().from(schema.axisCases);
    expect(cases.some((x) => x.quoteRequestId === requestId)).toBe(false);

    const auditRows = await database.select().from(schema.auditLog);
    expect(auditRows.some((a) => a.action === "dist.quote_requests.accept")).toBe(true);
  });

  it("takes a supporting document and rejects anything that is not one", async () => {
    const bad = await upload(
      `/v1/portal/gonxt/quote-requests/${requestId}/documents`,
      { token },
      new Blob(["#!/bin/sh"], { type: "application/x-sh" }),
      "run.sh"
    );
    expect(bad.status).toBe(400);

    const res = await upload(`/v1/portal/gonxt/quote-requests/${requestId}/documents`, { token }, new Blob(
      [new Uint8Array([1, 2, 3, 4])],
      { type: "image/png" }
    ));
    expect(res.status).toBe(201);

    const [row] = await database.select().from(schema.files).where(eq(schema.files.id, res.body.fileId));
    expect(row!.kind).toBe("customer_document");
    expect(row!.subjectRef).toBe(`quote-requests:${requestId}`);
    expect(row!.piiLevel).toBe("high");
    expect(files.store.get(row!.r2Key)).toBeTruthy();

    // A stranger with the id but not the token cannot post documents onto
    // somebody else's quote.
    const noToken = await upload(
      `/v1/portal/gonxt/quote-requests/${requestId}/documents`,
      { token: "0".repeat(48) },
      new Blob([new Uint8Array([1])], { type: "image/png" })
    );
    expect(noToken.status).toBe(404);
  });

  it("still captures a plain lead when the panel cannot price in-session", async () => {
    const [life] = await database.select().from(schema.products).where(eq(schema.products.line, "life"));
    const res = await call("POST", "/v1/portal/gonxt/leads", {
      productId: life!.id,
      name: "Manual Panel",
      email: "manual.panel@example.com",
      consent: true,
      inputs: { age: 40 }
    });
    expect(res.status).toBe(201);
    // Manual/referral panels answer out of band, so there is nothing to show and
    // nothing to protect with a token.
    expect(res.body.offers?.length ?? 0).toBe(0);
  });
});

// J-C4 "Exercise privacy rights: portal request (access/erasure) -> automated
// package/erasure workflow -> confirmation" (docs/06). ADR-0041 shipped the
// intake staff-mediated; ADR-0042 supersedes it with this public door. The
// verification step stays where it was — staff, then `verificationRef` — because
// docs/12 states no verification method and IdentityVerifier has no
// implementation; what changes is that the subject can now start the clock
// themselves.
describe("POST /v1/portal/:tenantSlug/privacy-requests", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("records a received DSAR against the matching customer and starts the 30-day clock", async () => {
    kv.store.clear();
    const before = Date.now();
    const res = await call("POST", "/v1/portal/gonxt/privacy-requests", {
      type: "access",
      email: "jamie.visitor@example.com",
      name: "Jamie Visitor",
      details: "Please send everything you hold."
    });
    expect(res.status).toBe(202);
    expect(res.body.reference).toBeTruthy();

    const [row] = await database
      .select()
      .from(schema.dsarRequests)
      .where(eq(schema.dsarRequests.id, res.body.reference));
    expect(row!.type).toBe("access");
    expect(row!.state).toBe("received");
    expect(row!.channel).toBe("portal");
    // Nobody has proved who they are yet — that is the staff step, and leaving
    // this null is what keeps the queue honest.
    expect(row!.verificationRef).toBeNull();
    expect(row!.subjectIdentifier).toBe("jamie.visitor@example.com");
    expect(row!.dueAt).toBeGreaterThanOrEqual(before + 30 * DAY);
    // What the subject actually wrote survives — a rectification or objection is
    // unusable without it.
    expect(row!.subjectNote).toContain("Please send everything you hold.");
    expect(row!.subjectNote).toContain("Jamie Visitor");
    // The lead tests above created this customer, so the request links to them.
    expect(row!.customerId).toBeTruthy();

    const auditRows = await database.select().from(schema.auditLog);
    expect(auditRows.some((a) => a.subjectRef === `dsar-requests:${row!.id}`)).toBe(true);
  });

  it("answers an unknown subject exactly like a known one, so the portal cannot be used to enumerate customers", async () => {
    kv.store.clear();
    const known = await call("POST", "/v1/portal/gonxt/privacy-requests", {
      type: "erasure",
      email: "repeat.visitor@example.com"
    });
    kv.store.clear();
    const unknown = await call("POST", "/v1/portal/gonxt/privacy-requests", {
      type: "erasure",
      email: "nobody-here@example.com"
    });
    expect(unknown.status).toBe(known.status);
    expect(Object.keys(unknown.body).sort()).toEqual(Object.keys(known.body).sort());

    const [row] = await database
      .select()
      .from(schema.dsarRequests)
      .where(eq(schema.dsarRequests.id, unknown.body.reference));
    // Still recorded — an unmatched identifier is a staff problem, not a reason
    // to drop a rights request on the floor.
    expect(row!.customerId).toBeNull();
    expect(row!.state).toBe("received");
  });

  it("throttles by email and by IP", async () => {
    kv.store.clear();
    const payload = { type: "access" as const, email: "dsar-spam@example.com" };
    for (let i = 0; i < 3; i++) await call("POST", "/v1/portal/gonxt/privacy-requests", payload);
    expect((await call("POST", "/v1/portal/gonxt/privacy-requests", payload)).status).toBe(429);

    kv.store.clear();
    const ip = "203.0.113.44";
    for (let i = 0; i < 10; i++) {
      await call(
        "POST",
        "/v1/portal/gonxt/privacy-requests",
        { type: "access", email: `dsar-rotating-${i}@example.com` },
        { "cf-connecting-ip": ip }
      );
    }
    const rotated = await call(
      "POST",
      "/v1/portal/gonxt/privacy-requests",
      { type: "access", email: "dsar-rotating-final@example.com" },
      { "cf-connecting-ip": ip }
    );
    expect(rotated.status).toBe(429);
  });

  it("rejects an unknown right or a malformed email, and 404s an unknown tenant", async () => {
    kv.store.clear();
    const badType = await call("POST", "/v1/portal/gonxt/privacy-requests", {
      type: "delete-everything",
      email: "someone@example.com"
    });
    expect(badType.status).toBe(400);

    const badEmail = await call("POST", "/v1/portal/gonxt/privacy-requests", {
      type: "access",
      email: "not-an-email"
    });
    expect(badEmail.status).toBe(400);

    const noTenant = await call("POST", "/v1/portal/does-not-exist/privacy-requests", {
      type: "access",
      email: "someone@example.com"
    });
    expect(noTenant.status).toBe(404);
  });
});
