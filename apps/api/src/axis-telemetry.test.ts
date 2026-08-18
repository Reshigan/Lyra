import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson, schema } from "@lyra/db";
import { notFound, type Ctx } from "@lyra/core";
import { Gateway, makeStub } from "@lyra/model-gateway";
import { axisRoutes } from "./routes/axis.js";
import { crudRouter } from "./crud.js";
import { BY_MODULE } from "./resources.js";
import { onError } from "./mw.js";
import { MAX_POINTS_PER_BATCH, TelematicsIngest, type PolicyRow } from "./engines/telematics.js";
import type { App } from "./env.js";

// docs/27 F5 (Group E, task 5). Route-level coverage for the two doorways onto
// telematics/UBI: `/telemetry` (a machine/device authority) and `/reprice` (a
// priced endorsement, so it stays behind `axis:policies:endorse`). Modeled on
// premium-financing.test.ts's testApp(ctx) + seedTenantAndPolicy() convention
// and engines/ubi-reprice.test.ts's gateway-stub helpers.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

const DAY = 86_400_000;
const SOURCE = "telematics:obd:km";
const NOW = Date.UTC(2026, 5, 15, 12);
const START = NOW - 30 * DAY;
const END = NOW + 335 * DAY;

/** A reply the model could plausibly return, in the shape `parseUbi` accepts. */
function reply(premiumDeltaPpm: number, code = "km_band"): string {
  return JSON.stringify({
    premiumDeltaPpm,
    factors: [{ code, weight: 1, evidenceRef: SOURCE }],
    confidence: 0.8
  });
}

function gatewayWith(...replies: string[]): Gateway {
  const stub = makeStub({ replies });
  return new Gateway({ env: {}, providers: { "workers-ai": stub, anthropic: stub, "openai-compat": stub } });
}

async function seedTenantAndPolicy(opts: { permissions?: string[] } = {}): Promise<{ ctx: Ctx; policy: PolicyRow }> {
  const client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  const tenantId = "t_1";
  const ctx: Ctx = {
    db: drizzle(client) as unknown as Ctx["db"],
    tenantId,
    actor: {
      kind: "user",
      id: "u_test",
      tenantId,
      grants: [{ roleKey: "test", permissions: opts.permissions ?? ["*:*:*"] }]
    },
    requestId: "req_1",
    now: NOW,
    locale: "en",
    // autoApprove keeps `axis.endorse` out of the way for the tests that are
    // not specifically exercising the approval gate — repriceFromTelemetry's
    // own approval behaviour is engines/ubi-reprice.test.ts's job, not this
    // file's.
    policy: PolicyJson.parse({ currency: "ZAR", autoApprove: ["axis.endorse"] }),
    entitlements: EntitlementsJson.parse({})
  };

  await ctx.db.insert(schema.products).values({
    id: "prod_ubi",
    tenantId,
    line: "motor",
    nameJson: JSON.stringify({ en: "Motor" }),
    pricingInputsJson: JSON.stringify({ km_band: {}, harsh_braking: {} }),
    createdAt: NOW,
    updatedAt: NOW
  } as never);

  await ctx.db.insert(schema.axisPolicies).values({
    id: "pol_1",
    tenantId,
    customerId: "cust_1",
    providerId: "prov_1",
    productId: "prod_ubi",
    policyNo: "POL-1",
    versionSeq: 1,
    startAt: START,
    endAt: END,
    premiumMinor: 100_000,
    currency: "ZAR",
    status: "active",
    createdAt: NOW,
    updatedAt: NOW
  } as never);

  await ctx.db.insert(schema.axisPolicyVersions).values({
    id: "pver_1",
    tenantId,
    policyId: "pol_1",
    versionSeq: 1,
    reason: "issue",
    effectiveFrom: START,
    effectiveTo: END,
    premiumMinor: 100_000,
    taxMinor: 15_000,
    feesMinor: 0,
    commissionMinor: 10_000,
    currency: "ZAR",
    premiumDeltaMinor: 0,
    proRataDays: 365,
    termsJson: JSON.stringify({ km_band: { weight: 0 } }),
    state: "effective",
    issuedBy: "user:u_test",
    issuedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW
  } as never);

  const [row] = await ctx.db.select().from(schema.axisPolicies).where(eq(schema.axisPolicies.id, "pol_1"));
  return { ctx, policy: row! };
}

/**
 * Direct-engine fixture setup (not through the route under test), mirroring
 * engines/ubi-reprice.test.ts's own `ingestKm` — this file's reprice tests
 * need telemetry already on file, and re-deriving the ingest engine's own
 * validation here would be the duplication the brief says not to ship.
 */
async function ingestKm(ctx: Ctx, policy: PolicyRow, ...values: number[]): Promise<void> {
  const ingest = new TelematicsIngest(ctx, SOURCE, policy);
  await ingest.ingest(
    `policy:${policy.id}`,
    values.map((value, i) => ({ at: NOW - (i + 1) * DAY, value }))
  );
}

async function points(ctx: Ctx) {
  return ctx.db.select().from(schema.axisTelemetryPoints).where(eq(schema.axisTelemetryPoints.tenantId, ctx.tenantId));
}

async function versions(ctx: Ctx) {
  return ctx.db.select().from(schema.axisPolicyVersions).where(eq(schema.axisPolicyVersions.tenantId, ctx.tenantId));
}

/** One row per gateway completion, so its length is the model-call count. */
async function modelCalls(ctx: Ctx) {
  return ctx.db.select().from(schema.aiAuditLog).where(eq(schema.aiAuditLog.tenantId, ctx.tenantId));
}

async function keys(ctx: Ctx) {
  return ctx.db.select().from(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.tenantId, ctx.tenantId));
}

const batch = (points: unknown[]): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ source: SOURCE, points })
});

/**
 * Mirrors premium-financing.test.ts's testApp(ctx): a fixed ctx and a fixed
 * gateway injected directly, mounting the real axisRoutes and the real
 * axis/telemetry-points resource under their real paths — exercising the
 * actual route/permission/CRUD-lockdown wiring without the login detour.
 */
function testApp(ctx: Ctx, gateway: Gateway): Hono<App> {
  const app = new Hono<App>();
  app.onError(onError);
  app.notFound((c) => onError(notFound(c.req.path), c));
  app.use("*", async (c, next) => {
    c.set("ctx", ctx);
    c.set("gateway", gateway);
    await next();
  });
  app.route("/v1/axis", axisRoutes);
  const telemetryPoints = BY_MODULE.axis?.find((r) => r.path === "telemetry-points");
  if (!telemetryPoints) throw new Error("no axis/telemetry-points resource");
  app.route("/v1/axis/telemetry-points", crudRouter(telemetryPoints));
  return app;
}

describe("POST /policies/:id/telemetry", () => {
  it("stores points when the actor holds axis:policies:telemetry", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ permissions: ["axis:policies:telemetry"] });
    const app = testApp(ctx, gatewayWith(reply(0)));

    const res = await app.request(`/v1/axis/policies/${policy.id}/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: SOURCE,
        points: [
          { at: NOW - DAY, value: 120 },
          { at: NOW - 2 * DAY, value: 95 }
        ]
      })
    });

    expect(res.status).toBe(201);
    expect(await points(ctx)).toHaveLength(2);
  });

  it("rejects without axis:policies:telemetry, before any write", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ permissions: ["axis:policies:read"] });
    const app = testApp(ctx, gatewayWith(reply(0)));

    const res = await app.request(`/v1/axis/policies/${policy.id}/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: SOURCE, points: [{ at: NOW - DAY, value: 120 }] })
    });

    expect(res.status).toBe(403);
    expect(await points(ctx)).toHaveLength(0);
  });

  it("does not let axis:policies:endorse alone authorise /telemetry (separation of duties)", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ permissions: ["axis:policies:endorse"] });
    const app = testApp(ctx, gatewayWith(reply(0)));

    const res = await app.request(`/v1/axis/policies/${policy.id}/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: SOURCE, points: [{ at: NOW - DAY, value: 120 }] })
    });

    expect(res.status).toBe(403);
    expect(await points(ctx)).toHaveLength(0);
  });

  it("surfaces a batch the engine refuses as a client error, not a 500, leaving no rows", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ permissions: ["axis:policies:telemetry"] });
    const app = testApp(ctx, gatewayWith(reply(0)));

    // `at` before the cover term's startAt — TelematicsIngest's own bounds
    // check, not anything the route duplicates.
    const res = await app.request(`/v1/axis/policies/${policy.id}/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: SOURCE, points: [{ at: START - DAY, value: 120 }] })
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await points(ctx)).toHaveLength(0);
  });

  it("refuses an oversized batch at the route, not after parsing every point", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ permissions: ["axis:policies:telemetry"] });
    const app = testApp(ctx, gatewayWith(reply(0)));

    const over = Array.from({ length: MAX_POINTS_PER_BATCH + 1 }, (_, i) => ({ at: NOW - DAY - i, value: 1 }));
    const res = await app.request(`/v1/axis/policies/${policy.id}/telemetry`, batch(over));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await points(ctx)).toHaveLength(0);
  });

  it("refuses a fractional instant, so `at` cannot drift off the dedup key", async () => {
    // The unique index is on the exact `at`; 1.5ms and 1.6ms are two rows for
    // one moment, and no window boundary lands between them.
    const { ctx, policy } = await seedTenantAndPolicy({ permissions: ["axis:policies:telemetry"] });
    const app = testApp(ctx, gatewayWith(reply(0)));

    const res = await app.request(`/v1/axis/policies/${policy.id}/telemetry`, batch([{ at: NOW - DAY + 0.5, value: 1 }]));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await points(ctx)).toHaveLength(0);
  });
});

describe("retry storms", () => {
  it("stores one set of rows when a device re-flushes the same batch with no key", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ permissions: ["axis:policies:telemetry"] });
    const app = testApp(ctx, gatewayWith(reply(0)));
    const body = batch([
      { at: NOW - DAY, value: 120 },
      { at: NOW - 2 * DAY, value: 95 }
    ]);

    const first = await app.request(`/v1/axis/policies/${policy.id}/telemetry`, body);
    const second = await app.request(`/v1/axis/policies/${policy.id}/telemetry`, body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(await first.json());
    expect(await points(ctx)).toHaveLength(2);
    const txns = await ctx.db.select().from(schema.ledgerTxns).where(eq(schema.ledgerTxns.type, "TELEM-INGEST"));
    expect(txns).toHaveLength(1);
    expect(await keys(ctx)).toHaveLength(1);
  });

  it("refuses a caller key replayed with a different batch instead of storing both", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ permissions: ["axis:policies:telemetry"] });
    const app = testApp(ctx, gatewayWith(reply(0)));
    const withKey = (points: unknown[]): RequestInit => {
      const init = batch(points);
      return { ...init, headers: { ...(init.headers as Record<string, string>), "idempotency-key": "k_dev_1" } };
    };

    const first = await app.request(`/v1/axis/policies/${policy.id}/telemetry`, withKey([{ at: NOW - DAY, value: 120 }]));
    const second = await app.request(`/v1/axis/policies/${policy.id}/telemetry`, withKey([{ at: NOW - DAY, value: 999 }]));

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(await points(ctx)).toHaveLength(1);
  });

  it("keys a header-less reprice to the version it is repricing, so a retry replays", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ permissions: ["axis:policies:endorse"] });
    await ingestKm(ctx, policy, 120, 95, 140);
    const app = testApp(ctx, gatewayWith(reply(100_000), reply(100_000)));

    const first = await app.request(`/v1/axis/policies/${policy.id}/reprice`, { method: "POST" });
    expect(first.status).toBe(200);
    // Nothing else in the request identifies the attempt: the body is empty, so
    // without the version in the key a retry is a second real price move.
    expect((await keys(ctx)).map((k) => k.key)).toEqual([`axis_ubi_reprice:${policy.id}:1`]);

    // The retry the transport would send after a lost response.
    const retry = await app.request(`/v1/axis/policies/${policy.id}/reprice`, {
      method: "POST",
      headers: { "idempotency-key": `axis_ubi_reprice:${policy.id}:1` }
    });

    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(await first.json());
    expect(await versions(ctx)).toHaveLength(2);
    expect(await modelCalls(ctx)).toHaveLength(1);
  });

  it("cannot bump the price twice from one window, key or no key", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ permissions: ["axis:policies:endorse"] });
    await ingestKm(ctx, policy, 120, 95, 140);
    const app = testApp(ctx, gatewayWith(reply(100_000), reply(100_000)));

    const first = await app.request(`/v1/axis/policies/${policy.id}/reprice`, { method: "POST" });
    // A second header-less call derives a *different* key (the new version), so
    // the key is not what stops it — the window is: the reprice advanced
    // `effectiveFrom` to now, and the kilometres it priced are behind it.
    const second = await app.request(`/v1/axis/policies/${policy.id}/reprice`, { method: "POST" });

    expect(first.status).toBe(200);
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(second.status).toBeLessThan(500);
    expect(await versions(ctx)).toHaveLength(2);
    expect(await modelCalls(ctx)).toHaveLength(1);
  });
});

describe("POST /policies/:id/reprice", () => {
  it("reprices when the actor holds axis:policies:endorse", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ permissions: ["axis:policies:endorse"] });
    await ingestKm(ctx, policy, 120, 95, 140);
    const app = testApp(ctx, gatewayWith(reply(100_000)));

    const res = await app.request(`/v1/axis/policies/${policy.id}/reprice`, { method: "POST" });

    expect(res.status).toBe(200);
    const out = (await res.json()) as { repriced: boolean; premiumMinor?: number };
    expect(out.repriced).toBe(true);
    expect(out.premiumMinor).toBe(110_000);
  });

  it("returns repriced:false as a 200, not an error, on a genuine no-op", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ permissions: ["axis:policies:endorse"] });
    await ingestKm(ctx, policy, 120, 95);
    const app = testApp(ctx, gatewayWith(reply(0)));

    const res = await app.request(`/v1/axis/policies/${policy.id}/reprice`, { method: "POST" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ repriced: false });
  });

  it("rejects without axis:policies:endorse, before any write", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ permissions: ["axis:policies:telemetry"] });
    await ingestKm(ctx, policy, 120, 95);
    const app = testApp(ctx, gatewayWith(reply(100_000)));

    const res = await app.request(`/v1/axis/policies/${policy.id}/reprice`, { method: "POST" });

    expect(res.status).toBe(403);
    const [version] = await ctx.db
      .select()
      .from(schema.axisPolicyVersions)
      .where(eq(schema.axisPolicyVersions.policyId, policy.id));
    expect(version!.versionSeq).toBe(1);
  });
});

describe("telemetry-points resource route (regression)", () => {
  it("rejects a direct create against the generic CRUD route", async () => {
    const { ctx } = await seedTenantAndPolicy();
    const app = testApp(ctx, gatewayWith(reply(0)));

    const res = await app.request("/v1/axis/telemetry-points", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subjectRef: "policy:pol_1", source: SOURCE, at: NOW, value: 10 })
    });

    // ro() declares no `create` permission, so crud.ts never registers the
    // POST route at all — it falls through to app.notFound (404), matching
    // the payment-plans regression test's established, tested convention.
    expect(res.status).toBe(404);
  });

  it("rejects a direct update against the generic CRUD route", async () => {
    const { ctx, policy } = await seedTenantAndPolicy();
    await ingestKm(ctx, policy, 120);
    const [row] = await points(ctx);
    const app = testApp(ctx, gatewayWith(reply(0)));

    const res = await app.request(`/v1/axis/telemetry-points/${row!.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: 999 })
    });

    expect(res.status).toBe(404);
  });

  it("rejects a direct delete against the generic CRUD route, leaving the row", async () => {
    const { ctx, policy } = await seedTenantAndPolicy();
    await ingestKm(ctx, policy, 120);
    const [row] = await points(ctx);
    const app = testApp(ctx, gatewayWith(reply(0)));

    const res = await app.request(`/v1/axis/telemetry-points/${row!.id}`, { method: "DELETE" });

    // 404 because `ro()` declares read only — the row is still there, so the
    // status is the missing *verb*, not a missing record.
    expect(res.status).toBe(404);
    expect(await points(ctx)).toHaveLength(1);
  });

  it("still allows a read, of this tenant's actual points", async () => {
    const { ctx, policy } = await seedTenantAndPolicy();
    await ingestKm(ctx, policy, 120);
    const app = testApp(ctx, gatewayWith(reply(0)));

    const res = await app.request("/v1/axis/telemetry-points", { method: "GET" });

    // A 200 alone would pass against an empty page: the point of `ro()` is that
    // read still works, so assert the row comes back.
    expect(res.status).toBe(200);
    const out = (await res.json()) as { data: { subjectRef: string; source: string; value: number }[] };
    expect(out.data).toHaveLength(1);
    expect(out.data[0]).toMatchObject({ subjectRef: `policy:${policy.id}`, source: SOURCE, value: 120 });
  });
});
