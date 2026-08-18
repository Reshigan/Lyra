import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { seed, sealFields, totpAt, TOTP_STEP_SEC } from "@lyra/core";
import { schema, ChannelOptinsJson, PurposesJson, type Db } from "@lyra/db";
import { app } from "../index.js";
import type { Env } from "../env.js";

// The human-agent reply path (ADR-0037/ADR-0038). What matters here and not in
// the engine test: the permission gate, tenant scoping of both the conversation
// and its connector, and the 400 a conversation with no channel binding must
// give instead of a 500 from deep inside the adapter registry.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const FIELD_KEY = "test-field-key";
const exec = { waitUntil() {}, passThroughOnException() {} };

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

let env: Env;
let database: Db;
let agentToken: string;
/** A user with no `orbit:messages:send`. */
let outsiderToken: string;
/** hind.saqr — orbit.admin. `orbit.lead` also carries `orbit:conversations:assign`
 *  explicitly (rbac.ts), but no `orbit.lead` persona is seeded (seed.ts), so
 *  orbit.admin is the only seeded persona holding it — `orbit.agent`
 *  (agentToken above) does not hold it. */
let leadToken: string;
let partnerToken: string;

interface Res<T = any> {
  status: number;
  body: T;
}

async function call<T = any>(token: string | null, method: string, path: string, payload?: unknown): Promise<Res<T>> {
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
    }),
    env as never,
    exec as never
  );
  const text = res.headers.get("content-type")?.includes("json") ? await res.text() : "";
  return { status: res.status, body: text ? (JSON.parse(text) as T) : (null as T) };
}

async function login(local: string): Promise<string> {
  const first = await call(null, "POST", "/v1/auth/login", {
    email: `${local}@gonxt.ae`,
    password: PASSWORD,
    tenantSlug: "gonxt"
  });
  expect(first.status).toBe(200);
  const token = first.body.token as string;
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
  return token;
}

beforeAll(async () => {
  const client = createClient({ url: ":memory:" });
  for (const stmt of statements()) await client.execute(stmt);
  database = drizzle(client) as unknown as Db;
  await seed(database as never, { mfaSecret: DEMO_TOTP_SECRET });
  env = {
    DB_CLIENT: database,
    ENVIRONMENT: "development",
    APP_ORIGIN: "http://localhost:5173",
    FIELD_KEY
  } as unknown as Env;
  agentToken = await login("sara.nasser"); // orbit.agent — holds orbit:messages:send
  outsiderToken = await login("layla.hassan"); // axis.agent — does not
  leadToken = await login("hind.saqr"); // orbit.admin — holds orbit:conversations:assign

  const [tenant] = await database.select().from(schema.tenants).where(eq(schema.tenants.slug, "gonxt"));
  const tenantId = tenant!.id;
  const now = Date.now();

  const sealed = await sealFields(FIELD_KEY, { accessToken: "token-123" }, ["accessToken"]);
  await database.insert(schema.orbitChannelConnectors).values({
    id: "ccn_1",
    tenantId,
    provider: "whatsapp-cloud-api",
    transport: "whatsapp",
    label: "Main",
    secretsJson: JSON.stringify(sealed),
    configJson: JSON.stringify({ phoneNumberId: "pn_1" }),
    status: "active",
    createdAt: now,
    updatedAt: now
  });
  // cnv_1 needs a consented customer — dispatchOutbound checks consent even
  // when the conversation has no customerId (it resolves one via channel
  // identity), so an unlinked externalRef refuses the send outright.
  await database.insert(schema.customers).values({
    id: "cus_1",
    tenantId,
    type: "person",
    nameJson: JSON.stringify({ en: "Reply Customer" }),
    createdAt: now,
    updatedAt: now
  });
  await database.insert(schema.consents).values({
    id: "cns_1",
    tenantId,
    customerId: "cus_1",
    purposesJson: JSON.stringify(PurposesJson.parse({})),
    channelOptinsJson: JSON.stringify(ChannelOptinsJson.parse({ whatsapp: true })),
    source: "web",
    evidenceRef: null,
    ts: now,
    expiry: null,
    version: 1
  });
  await database.insert(schema.orbitConversations).values([
    {
      id: "cnv_1",
      tenantId,
      customerId: "cus_1",
      channel: "whatsapp",
      externalRef: "97150",
      connectorId: "ccn_1",
      state: "human",
      lang: "en",
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "cnv_no_connector",
      tenantId,
      channel: "web",
      externalRef: "web-1",
      connectorId: null,
      state: "human",
      lang: "en",
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now
    }
  ]);
  await database.insert(schema.orbitPartners).values({
    id: "ptn_1",
    tenantId,
    name: "Acme Telco",
    kind: "telco",
    revshareJson: JSON.stringify({ pct: 10 }),
    sandboxFlag: true,
    status: "active",
    stage: "sandbox",
    createdAt: now,
    updatedAt: now
  });
  await database.insert(schema.orbitPartners).values({
    id: "ptn_suspended",
    tenantId,
    name: "Suspended Co",
    kind: "telco",
    revshareJson: null,
    sandboxFlag: true,
    status: "suspended",
    stage: "sandbox",
    suspendedAt: now,
    suspendedReason: "billing dispute",
    createdAt: now,
    updatedAt: now
  });

  partnerToken = await login("dana.aziz"); // orbit.partners
}, 120_000);

describe("POST /v1/orbit/conversations/:id/reply", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the reply through the conversation's connector", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.reply.1" }] }), { status: 200 }))
    );
    const res = await call(agentToken, "POST", "/v1/orbit/conversations/cnv_1/reply", { text: "On our way!" });
    expect(res.status).toBe(201);
    expect(res.body.externalRef).toBe("wamid.reply.1");

    const [message] = await database
      .select()
      .from(schema.orbitMessages)
      .where(eq(schema.orbitMessages.id, res.body.messageId));
    expect(message!.conversationId).toBe("cnv_1");
    expect(message!.content).toBe("On our way!");
  });

  it("is 400 when the conversation has no connector", async () => {
    const res = await call(agentToken, "POST", "/v1/orbit/conversations/cnv_no_connector/reply", { text: "hi" });
    expect(res.status).toBe(400);
  });

  it("is 404 for a conversation that does not exist", async () => {
    const res = await call(agentToken, "POST", "/v1/orbit/conversations/cnv_nope/reply", { text: "hi" });
    expect(res.status).toBe(404);
  });

  it("is 403 without orbit:messages:send, and sends nothing", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await call(outsiderToken, "POST", "/v1/orbit/conversations/cnv_1/reply", { text: "hi" });
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /v1/orbit/routing/sweep", () => {
  it("runs the routing sweep and reports counts", async () => {
    const res = await call(leadToken, "POST", "/v1/orbit/routing/sweep");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      frtBreaches: expect.any(Number),
      resolutionBreaches: expect.any(Number),
      reassigned: expect.any(Number),
      unassigned: expect.any(Number)
    });
  });

  it("is 403 without orbit:conversations:assign", async () => {
    const res = await call(outsiderToken, "POST", "/v1/orbit/routing/sweep");
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/orbit/partners/:id/quotes", () => {
  it("returns a synthetic sandbox quote for an active partner", async () => {
    const res = await call(partnerToken, "POST", "/v1/orbit/partners/ptn_1/quotes", {
      productLine: "motor",
      amountMinor: 100_000,
      currency: "AED"
    });
    expect(res.status).toBe(201);
    expect(res.body.partnerId).toBe("ptn_1");
    expect(res.body.mode).toBe("sandbox");
    expect(res.body.synthetic).toBe(true);
    expect(res.body.quotedPremiumMinor).toBeGreaterThan(0);
  });

  it("rejects without orbit:partners:read", async () => {
    const res = await call(outsiderToken, "POST", "/v1/orbit/partners/ptn_1/quotes", {
      productLine: "motor",
      amountMinor: 100_000,
      currency: "AED"
    });
    expect(res.status).toBe(403);
  });

  it("404s for an unknown partner", async () => {
    const res = await call(partnerToken, "POST", "/v1/orbit/partners/ptn_missing/quotes", {
      productLine: "motor",
      amountMinor: 100_000,
      currency: "AED"
    });
    expect(res.status).toBe(404);
  });

  it("409s for a suspended partner", async () => {
    const res = await call(partnerToken, "POST", "/v1/orbit/partners/ptn_suspended/quotes", {
      productLine: "motor",
      amountMinor: 100_000,
      currency: "AED"
    });
    expect(res.status).toBe(409);
  });

  it("rejects a malformed body", async () => {
    const res = await call(partnerToken, "POST", "/v1/orbit/partners/ptn_1/quotes", {
      productLine: "motor",
      amountMinor: -5,
      currency: "AED"
    });
    expect(res.status).toBe(400);
  });
});
