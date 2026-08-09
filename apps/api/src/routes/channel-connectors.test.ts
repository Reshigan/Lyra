import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { seed } from "@lyra/core";
import { id as newId, schema, type Db } from "@lyra/db";
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

  // No seeded persona holds orbit:channels:write on its own: tenant.admin only
  // gets `orbit:*:read` (packages/core/src/rbac.ts), and the three orbit
  // personas seed.ts actually assigns (orbit.agent/orbit.retention/orbit.partners)
  // don't include it either — only orbit.admin's `orbit:*:*` does, and no PEOPLE
  // entry uses that role. seed.ts still provisions an `orbit.admin` roles row for
  // the tenant (one per TENANT_ROLE_KEYS) even though nobody is assigned it, so
  // grant it to the existing tenant.admin user directly, the same way sibling
  // tests (channels.test.ts, axis-documents.test.ts) insert fixture rows
  // straight into the schema rather than going through the seed/API surface.
  const [orbitAdminRole] = await database.select().from(schema.roles).where(eq(schema.roles.key, "orbit.admin"));
  const [tenantAdminUser] = await database.select().from(schema.users).where(eq(schema.users.email, "amina.saleh@gonxt.ae"));
  await database.insert(schema.userRoles).values({
    id: newId("ur", Date.now()),
    tenantId: tenantAdminUser!.tenantId,
    userId: tenantAdminUser!.id,
    roleId: orbitAdminRole!.id,
    scopeJson: null,
    createdAt: Date.now()
  });

  // ENVIRONMENT is not "production", so the demo login door is open and this
  // resource-registration test doesn't need the full TOTP dance. Unlike
  // call(), this request carries no bearer token at all — /demo/login doesn't
  // take one.
  const loginRes = await app.fetch(
    new Request("http://api.test/v1/auth/demo/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "amina.saleh@gonxt.ae" })
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
