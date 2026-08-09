import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { seed, sealFields, totpAt, TOTP_STEP_SEC } from "@lyra/core";
import { schema, type Db } from "@lyra/db";
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
  await database.insert(schema.orbitConversations).values([
    {
      id: "cnv_1",
      tenantId,
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
