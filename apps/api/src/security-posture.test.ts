import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { seed, sha256Hex, totpAt, TOTP_STEP_SEC } from "@lyra/core";
import { schema, type Db } from "@lyra/db";
import { app } from "./index.js";
import type { Env } from "./env.js";

// The admin "Security & access" screen had nothing to read: MFA is a platform
// floor (packages/core rbac.ts `requiresMfa` — "no tenant policy switch turns
// it off") and session lifetime is one constant, so there is no tenant policy
// row to edit. What a tenant admin actually needs is the truth about what is
// enforced and who is outside it. These tests pin that it is honest about the
// floor, that it never leaks a factor secret, and that the per-person gap list
// is gated on the permission that would show those people anyway.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
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

let env: Env;
let database: Db;
let tokens: Record<string, string>;

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
  const verified = await call(token, "POST", "/v1/auth/mfa/verify", {
    code: await totpAt(DEMO_TOTP_SECRET, Math.floor(Date.now() / 1000 / TOTP_STEP_SEC))
  });
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
    APP_ORIGIN: "http://localhost:5173"
  } as unknown as Env;
  tokens = {
    admin: await login("amina.saleh"), // tenant.admin — holds core:*:*
    agent: await login("layla.hassan") // axis.agent — no core:settings:read
  };
}, 120_000);

const posture = (who: string) => call(tokens[who] ?? null, "GET", "/v1/core/security-posture");

/**
 * A caller holding exactly `core:settings:read` and nothing else. No demo user
 * has that shape, and an API key is the honest way to get one: scopes are the
 * key's whole authority.
 */
async function settingsOnlyKey(): Promise<string> {
  const tenant = (await database.select().from(schema.tenants).where(eq(schema.tenants.slug, "gonxt")))[0]!;
  const token = "qvk_test_SETTINGSONLYAAAABBBBCCCCDDDDEEEEFFFF";
  const now = Date.now();
  await database
    .insert(schema.apiKeys)
    .values({
      id: "key_settings_only",
      tenantId: tenant.id,
      name: "settings reader",
      prefix: token.slice(0, 17),
      keyHash: await sha256Hex(token),
      mode: "test",
      scopesJson: JSON.stringify(["core:settings:read"]),
      createdBy: "system:test",
      createdAt: now
    })
    .onConflictDoNothing();
  return token;
}

describe("GET /v1/core/security-posture", () => {
  it("reports the enforcement floor rather than editable policy", async () => {
    const res = await posture("admin");
    expect(res.status).toBe(200);
    // Session lifetime and login throttle are estate-wide constants, and the
    // screen must say so rather than render a knob that does nothing.
    expect(res.body.sessions.ttlHours).toBe(12);
    expect(res.body.sessions.tenantConfigurable).toBe(false);
    expect(res.body.mfa.tenantConfigurable).toBe(false);
    expect(res.body.limits.loginMax).toBeGreaterThan(0);
    expect(res.body.limits.loginWindowSec).toBeGreaterThan(0);
  });

  it("counts who is inside the MFA floor and who is outside it", async () => {
    const res = await posture("admin");
    expect(res.body.mfa.required).toBeGreaterThan(0);
    // The demo estate enrols its staff, so enrolled must account for everyone
    // required and the gap list must be consistent with the two counts.
    expect(res.body.mfa.enrolled + res.body.mfa.gaps.length).toBe(res.body.mfa.required);
  });

  it("names the people missing a second factor once one is unenrolled", async () => {
    await database
      .update(schema.users)
      .set({ mfaEnrolled: false, mfaSecret: null })
      .where(eq(schema.users.email, "layla.hassan@gonxt.ae"));

    const res = await posture("admin");
    const emails = (res.body.mfa.gaps as Array<{ email: string }>).map((g) => g.email);
    expect(emails).toContain("layla.hassan@gonxt.ae");

    await database
      .update(schema.users)
      .set({ mfaEnrolled: true, mfaSecret: DEMO_TOTP_SECRET })
      .where(eq(schema.users.email, "layla.hassan@gonxt.ae"));
  });

  it("never serialises a factor secret or a session token", async () => {
    const res = await posture("admin");
    const wire = JSON.stringify(res.body);
    expect(wire).not.toContain(DEMO_TOTP_SECRET);
    expect(wire).not.toContain("mfaSecret");
    expect(wire).not.toContain("tokenHash");
  });

  it("flags an enabled provider that cannot assert a second factor", async () => {
    const tenant = (await database.select().from(schema.tenants).where(eq(schema.tenants.slug, "gonxt")))[0]!;
    const now = Date.now();
    await database.insert(schema.identityProviders).values({
      id: "idp_posture_test",
      tenantId: tenant.id,
      kind: "oidc",
      name: "Weak IdP",
      emailDomain: "weak.example",
      issuer: "https://weak.example",
      enabled: true,
      mfaAsserted: false,
      createdAt: now,
      updatedAt: now
    });

    const res = await posture("admin");
    const gaps = (res.body.sso.gaps as Array<{ id: string }>).map((g) => g.id);
    expect(gaps).toContain("idp_posture_test");
    // A disabled provider cannot shadow the password form, so it is not a gap.
    await database
      .update(schema.identityProviders)
      .set({ enabled: false })
      .where(eq(schema.identityProviders.id, "idp_posture_test"));
    const after = await posture("admin");
    expect((after.body.sso.gaps as Array<{ id: string }>).map((g) => g.id)).not.toContain("idp_posture_test");
  });

  it("withholds the per-person gap list from a caller who may not read users", async () => {
    // Not a 403 on the whole screen: the counts are policy facts, but naming an
    // individual as unprotected is user data, so the list needs core:users:read
    // — otherwise the posture screen is a way to enumerate accounts sideways.
    const res = await call(await settingsOnlyKey(), "GET", "/v1/core/security-posture");
    expect(res.status).toBe(200);
    expect(res.body.mfa.required).toBeGreaterThan(0);
    expect(res.body.mfa.gaps).toEqual([]);
    expect(res.body.mfa.gapsWithheld).toBe(true);
  });

  it("refuses a caller without core:settings:read", async () => {
    const res = await posture("agent");
    expect(res.status).toBe(403);
  });
});
