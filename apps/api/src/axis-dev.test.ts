import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeAll, describe, expect, it } from "vitest";
import { seed, totpAt, TOTP_STEP_SEC } from "@lyra/core";
import { type Db } from "@lyra/db";
import { app } from "./index.js";
import type { Env } from "./env.js";

// docs/20 developer console. Same stub convention as axis-extraction.test.ts:
// the `AI` binding is faked at the Workers AI boundary so the real gateway
// call, budget and ai_audit_log row are all still exercised.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const exec = { waitUntil() {}, passThroughOnException() {} };

/** raed.samir (dev.admin) holds dev:sandbox:use; layla.hassan (axis.agent) holds no dev:* permission. */
const PEOPLE: Record<string, string> = {
  dev: "raed.samir",
  outsider: "layla.hassan"
};

const FIELD_VALUES: Record<string, string> = {
  fullName: "Ahmed Al Mansoori",
  idNumber: "784-1985-1234567-1",
  dateOfBirth: "1985-04-12",
  expiryDate: "2029-11-03",
  nationality: "United Arab Emirates",
  plateNumber: "DXB A 12345",
  ownerName: "Omar Khalid",
  vehicleModel: "Toyota Camry 2022",
  registrationExpiry: "2026-12-01"
};

let env: Env;
let database: Db;
let tokens: Record<string, string>;

interface Res<T = any> {
  status: number;
  body: T;
}

async function call<T = any>(
  who: string | null,
  method: string,
  path: string,
  payload?: unknown
): Promise<Res<T>> {
  const token = who ? tokens[who] : undefined;
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
  await seed(database as never, { mfaSecret: DEMO_TOTP_SECRET });
  env = {
    DB_CLIENT: database,
    ENVIRONMENT: "development",
    APP_ORIGIN: "http://localhost:5173",
    AI: {
      run: async (_model: string, input: any) => {
        const fields: string[] = Object.keys(input?.response_format?.json_schema?.schema?.properties ?? {});
        const out: Record<string, string> = {};
        for (const f of fields) out[f] = FIELD_VALUES[f] ?? "";
        return { response: JSON.stringify(out) };
      }
    }
  } as unknown as Env;

  tokens = {};
  for (const [who, local] of Object.entries(PEOPLE)) {
    const login = await call(null, "POST", "/v1/auth/login", {
      email: `${local}@gonxt.ae`,
      password: PASSWORD,
      tenantSlug: "gonxt"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const verified = await app.fetch(
      new Request("http://api.test/v1/auth/mfa/verify", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          code: await totpAt(DEMO_TOTP_SECRET, Math.floor(Date.now() / 1000 / TOTP_STEP_SEC))
        })
      }),
      env as never,
      exec as never
    );
    expect(verified.status).toBe(200);
    tokens[who] = token;
  }
}, 120_000);

const sample = (who: string, payload: unknown) => call(who, "POST", "/v1/axis/dev/extract-sample", payload);

describe("POST /v1/axis/dev/extract-sample", () => {
  it("structures eid sample text into named fields", async () => {
    const res = await sample("dev", { docType: "eid", rawText: "EID text", locale: "en" });
    expect(res.status).toBe(200);
    expect(res.body.confidence).toBe(100);
    expect(res.body.model).toBeTruthy();
    expect(res.body.values).toEqual({
      fullName: "Ahmed Al Mansoori",
      idNumber: "784-1985-1234567-1",
      dateOfBirth: "1985-04-12",
      expiryDate: "2029-11-03",
      nationality: "United Arab Emirates"
    });
  });

  it("structures mulkiya sample text (arabic locale) into named fields", async () => {
    const res = await sample("dev", { docType: "mulkiya", rawText: "Mulkiya text", locale: "ar" });
    expect(res.status).toBe(200);
    expect(res.body.values).toEqual({
      plateNumber: "DXB A 12345",
      ownerName: "Omar Khalid",
      vehicleModel: "Toyota Camry 2022",
      registrationExpiry: "2026-12-01"
    });
  });

  it("is 403 for a session without dev:sandbox:use", async () => {
    const res = await sample("outsider", { docType: "eid", rawText: "EID text" });
    expect(res.status).toBe(403);
  });
});
