import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { seed, sha256Hex } from "@lyra/core";
import { schema, type Db } from "@lyra/db";
import { app } from "./index.js";
import type { Env } from "./env.js";

// docs/06 §J-X3: "portal signup -> sandbox key -> mock quote in <30 min ->
// certification checklist -> live key." Before this route existed, an external
// developer had no door in at all — `orbit_partners` and `core_api_keys` were
// staff-only. This is the door: no session, no api key, one POST, and out comes
// a prospect-stage partner plus a key scoped to sandbox use only.

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

/** Enough of KVNamespace to exercise the signup throttle. */
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

let env: Env;
let kv: FakeKv;
let database: Db;

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

const signup = (payload: unknown) => call(null, "POST", "/v1/onboarding/partners/signup", payload);

beforeAll(async () => {
  const client = createClient({ url: ":memory:" });
  for (const stmt of statements()) await client.execute(stmt);
  database = drizzle(client) as unknown as Db;
  await seed(database as never, { mfaSecret: DEMO_TOTP_SECRET });
  kv = new FakeKv();
  env = {
    DB_CLIENT: database,
    ENVIRONMENT: "development",
    APP_ORIGIN: "http://localhost:5173",
    KV: kv as unknown as Env["KV"]
  } as unknown as Env;
}, 120_000);

describe("POST /v1/onboarding/partners/signup", () => {
  it("creates a prospect partner and mints a sandbox key, with no session at all", async () => {
    const res = await signup({
      tenantSlug: "gonxt",
      companyName: "Acme Aggregator",
      contactEmail: "dev@acme.example",
      contactName: "Dev Person",
      kind: "aggregator"
    });
    expect(res.status).toBe(201);
    expect(res.body.stage).toBe("prospect");
    expect(res.body.sandboxFlag).toBe(true);
    const plaintext = res.body.sandboxKey as string;
    expect(plaintext).toMatch(/^qvk_test_[A-Z2-7]{40,}$/);

    const partnerRows = await database
      .select()
      .from(schema.orbitPartners)
      .where(eq(schema.orbitPartners.id, res.body.id));
    const partner = partnerRows[0]!;
    expect(partner.stage).toBe("prospect");
    expect(partner.sandboxFlag).toBe(true);
    expect(partner.apiKeyRef).toBe(res.body.sandboxKeyId);
    // The contact email lives in the record; it must not also be the plaintext key.
    expect(JSON.stringify(partner)).not.toContain(plaintext.slice(17));

    const keyRows = await database.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, res.body.sandboxKeyId));
    const key = keyRows[0]!;
    expect(key.mode).toBe("test");
    expect(key.keyHash).toBe(await sha256Hex(plaintext));
    expect(JSON.parse(key.scopesJson)).toEqual(
      expect.arrayContaining(["dist:quote_requests:create", "dist:quote_requests:read", "orbit:partners:read"])
    );
    // Never handed a key that can mint further keys or act outside sandbox scope.
    expect(JSON.parse(key.scopesJson)).not.toContain("dev:keys_test:issue");
    expect(JSON.parse(key.scopesJson)).not.toContain("dev:keys_live:issue");

    // Certification checklist (J-X3) generated the same way staff onboarding does.
    const stepRows = await database.select().from(schema.onboardingSteps).where(eq(schema.onboardingSteps.subjectRef, partner.id));
    expect(stepRows.length).toBeGreaterThan(0);

    const auditRows = await database.select().from(schema.auditLog);
    expect(auditRows.some((a) => a.action === "orbit.partners.create" && a.subjectRef === `partners:${partner.id}`)).toBe(
      true
    );
    expect(auditRows.some((a) => a.action === "core.api-keys.create" && a.subjectRef === `api-keys:${res.body.sandboxKeyId}`)).toBe(
      true
    );
  });

  it("mints a key that authenticates and is scoped to sandbox use, not staff-only reads", async () => {
    const res = await signup({
      tenantSlug: "gonxt",
      companyName: "Round Trip Co",
      contactEmail: "roundtrip@acme.example",
      kind: "telco"
    });
    expect(res.status).toBe(201);
    const key = res.body.sandboxKey as string;

    // The J-X3 "mock quote" surface: reading the quote-request list is in scope.
    const allowed = await call(key, "GET", "/v1/dist/quote-requests");
    expect(allowed.status).toBe(200);

    // Staff-only surfaces stay staff-only: this key was never granted them.
    const denied = await call(key, "GET", "/v1/core/users");
    expect(denied.status).toBe(403);
  });

  it("rejects a second signup from the same email inside the window", async () => {
    const payload = {
      tenantSlug: "gonxt",
      companyName: "Repeat Co",
      contactEmail: "repeat@acme.example",
      kind: "bank"
    };
    const first = await signup(payload);
    expect(first.status).toBe(201);
    const second = await signup(payload);
    expect(second.status).toBe(429);
  });

  it("rejects malformed input", async () => {
    const missingEmail = await signup({ tenantSlug: "gonxt", companyName: "No Email", kind: "bank" });
    expect(missingEmail.status).toBe(400);

    const badEmail = await signup({
      tenantSlug: "gonxt",
      companyName: "Bad Email",
      contactEmail: "not-an-email",
      kind: "bank"
    });
    expect(badEmail.status).toBe(400);

    const noTenant = await signup({
      companyName: "No Tenant",
      contactEmail: "no-tenant@acme.example",
      kind: "bank"
    });
    expect(noTenant.status).toBe(400);
  });

  it("refuses an unknown tenant slug rather than guessing", async () => {
    const res = await signup({
      tenantSlug: "does-not-exist",
      companyName: "Ghost Co",
      contactEmail: "ghost@acme.example",
      kind: "bank"
    });
    expect(res.status).toBe(404);
  });

  it("never trusts a spoofed stage, mode, or tenantId from the body", async () => {
    const res = await signup({
      tenantSlug: "gonxt",
      companyName: "Spoofed Co",
      contactEmail: "spoofed@acme.example",
      kind: "bank",
      stage: "live",
      mode: "live",
      tenantId: "t_somewhere_else"
    });
    expect(res.status).toBe(400);
  });
});
