import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { seed } from "@lyra/core";
import { schema, type Db } from "@lyra/db";
import { app } from "../index.js";
import type { Env } from "../env.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "..", "packages", "db", "migrations");
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

async function call<T = any>(token: string, method: string, path: string, payload?: unknown) {
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
    }),
    env as never,
    exec as never
  );
  const body = (await res.json().catch(() => undefined)) as T;
  return { status: res.status, body };
}

let env: Env;
let database: Db;
let adminToken: string;

beforeAll(async () => {
  const client = createClient({ url: ":memory:" });
  for (const stmt of statements()) await client.execute(stmt);
  database = drizzle(client) as unknown as Db;
  await seed(database as never, {});
  env = { DB_CLIENT: database, FIELD_KEY, ENVIRONMENT: "development", APP_ORIGIN: "http://localhost:5173" } as unknown as Env;

  // hind.saqr is seed.ts's orbit.admin persona — the only orbit role bundle
  // carrying `orbit:*:*` (packages/core/src/rbac.ts), hence orbit:channels:write.
  // ENVIRONMENT is not "production", so the demo login door is open and this
  // resource-registration test doesn't need the full TOTP dance. Unlike
  // call(), this request carries no bearer token at all — /demo/login doesn't
  // take one.
  const loginRes = await app.fetch(
    new Request("http://api.test/v1/auth/demo/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "hind.saqr@gonxt.ae" })
    }),
    env as never,
    exec as never
  );
  expect(loginRes.status).toBe(200);
  adminToken = ((await loginRes.json()) as { token: string }).token;
}, 60_000);

describe("orbit.channel-connectors", () => {
  it("seals secretsJson on write and strips it from reads", async () => {
    const created = await call(adminToken, "POST", "/v1/orbit/channel-connectors", {
      provider: "whatsapp-cloud-api",
      transport: "whatsapp",
      label: "Main WhatsApp",
      secretsJson: JSON.stringify({ appSecret: "s3cret", verifyToken: "verify-me", accessToken: "token" }),
      configJson: JSON.stringify({ phoneNumberId: "pn_1" }),
      status: "active"
    });
    expect(created.status).toBe(201);
    expect(created.body.secretsJson).toBeUndefined();

    const [row] = await database
      .select()
      .from(schema.orbitChannelConnectors)
      .where(eq(schema.orbitChannelConnectors.id, created.body.id));
    expect(row!.secretsJson).not.toContain("s3cret");
    expect(row!.secretsJson).toContain("enc.v1.");

    const read = await call(adminToken, "GET", `/v1/orbit/channel-connectors/${created.body.id}`);
    expect(read.body.secretsJson).toBeUndefined();
  });

  // crud.ts accepts every `*Json` column as an object as well as a string, so
  // the object form is the idiomatic one — and the one that used to skip
  // sealing entirely and store provider credentials in cleartext.
  it("seals secretsJson posted as an object", async () => {
    const created = await call(adminToken, "POST", "/v1/orbit/channel-connectors", {
      provider: "whatsapp-cloud-api",
      transport: "whatsapp",
      label: "Object form",
      secretsJson: { appSecret: "OBJECT_PLAINTEXT", accessToken: "OBJECT_TOKEN" },
      configJson: { phoneNumberId: "pn_2" },
      status: "active"
    });
    expect(created.status).toBe(201);

    const [row] = await database
      .select()
      .from(schema.orbitChannelConnectors)
      .where(eq(schema.orbitChannelConnectors.id, created.body.id));
    expect(row!.secretsJson).not.toContain("OBJECT_PLAINTEXT");
    expect(row!.secretsJson).not.toContain("OBJECT_TOKEN");
    expect(row!.secretsJson).toContain("enc.v1.");
  });

  it("seals secretsJson patched as an object", async () => {
    const created = await call(adminToken, "POST", "/v1/orbit/channel-connectors", {
      provider: "whatsapp-cloud-api",
      transport: "whatsapp",
      label: "Patch target",
      secretsJson: JSON.stringify({ appSecret: "initial" }),
      configJson: "{}",
      status: "active"
    });
    expect(created.status).toBe(201);

    const patched = await call(adminToken, "PATCH", `/v1/orbit/channel-connectors/${created.body.id}`, {
      secretsJson: { appSecret: "PATCH_OBJECT_PLAINTEXT" }
    });
    expect(patched.status).toBe(200);

    const [row] = await database
      .select()
      .from(schema.orbitChannelConnectors)
      .where(eq(schema.orbitChannelConnectors.id, created.body.id));
    expect(row!.secretsJson).not.toContain("PATCH_OBJECT_PLAINTEXT");
    expect(row!.secretsJson).toContain("enc.v1.");
  });

  it("rejects an array secretsJson", async () => {
    const res = await call(adminToken, "POST", "/v1/orbit/channel-connectors", {
      provider: "whatsapp-cloud-api",
      transport: "whatsapp",
      label: "Array",
      secretsJson: ["ARRAY_PLAINTEXT"],
      configJson: "{}",
      status: "active"
    });
    expect(res.status).toBe(400);
  });

  // ConnectorSecrets is Record<string, string>; sealFields only seals strings,
  // so a nested value would otherwise land in SQLite in the clear.
  it("rejects a non-string secret value", async () => {
    const res = await call(adminToken, "POST", "/v1/orbit/channel-connectors", {
      provider: "whatsapp-cloud-api",
      transport: "whatsapp",
      label: "Nested",
      secretsJson: { appSecret: "x", meta: { deep: "DEEP_PLAINTEXT" } },
      configJson: "{}",
      status: "active"
    });
    expect(res.status).toBe(400);
  });

  it("rejects malformed secretsJson", async () => {
    const res = await call(adminToken, "POST", "/v1/orbit/channel-connectors", {
      provider: "whatsapp-cloud-api",
      transport: "whatsapp",
      label: "Broken",
      secretsJson: "not json",
      configJson: "{}",
      status: "active"
    });
    expect(res.status).toBe(400);
  });
});
