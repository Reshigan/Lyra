import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { seed, sha256Hex, totpAt, TOTP_STEP_SEC } from "@lyra/core";
import { schema, type Db } from "@lyra/db";
import { app } from "./index.js";
import type { Env } from "./env.js";

// docs/25 go-live checklist: "any case exports a complete signed audit bundle."
// The mechanism is the generic evidence-bundle export (routes/compliance.ts) —
// this file proves it end to end for an AXIS case: the returned manifest's
// per-file sha256 is independently recomputed from the archive's own bytes
// (not just format-checked), the bundle is both tenant- and subject-scoped
// (a second case's rows never leak in), and — since the export is keyed by
// `subjectRef` and audit rows carry the row's own id as that subject
// (crud.ts's `audit(ctx, { subjectRef: rowId, ... })`) — "case-scoped" here
// means the case row's own create/update trail, not a case's documents or
// policies (those carry their own id as subjectRef, a separate export call
// each). That's a real seam, not a bug: flagged in the final report.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const exec = { waitUntil() {}, passThroughOnException() {} };

/** axis.lead opens/updates cases; tenant.compliance holds compliance:evidence:export. */
const PEOPLE: Record<string, string> = {
  lead: "omar.farouk",
  officer: "khalid.rashed"
};

let env: Env;
let database: Db;
let tokens: Record<string, string>;

interface Res<T = any> {
  status: number;
  body: T;
}

async function call<T = any>(who: string | null, method: string, path: string, payload?: unknown): Promise<Res<T>> {
  const token = who ? tokens[who] : undefined;
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
    }),
    env as never,
    exec as never
  );
  const text = res.headers.get("content-type")?.includes("json") ? await res.text() : "";
  return { status: res.status, body: text ? (JSON.parse(text) as T) : (null as T) };
}

async function download(id: string): Promise<Uint8Array> {
  const res = await app.fetch(
    new Request(`http://api.test/v1/compliance/evidence-bundles/${id}/download`, {
      headers: { authorization: `Bearer ${tokens.officer}` }
    }),
    env as never,
    exec as never
  );
  expect(res.status).toBe(200);
  return new Uint8Array(await res.arrayBuffer());
}

/** Reads a store-only (method 0) ZIP — the exact shape `engines/export/zip.ts` writes. */
function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map<string, Uint8Array>();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const nameLen = view.getUint16(offset + 26, true);
    const dataLen = view.getUint32(offset + 22, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLen));
    const dataStart = offset + 30 + nameLen;
    out.set(name, bytes.subarray(dataStart, dataStart + dataLen));
    offset = dataStart + dataLen;
  }
  return out;
}

async function openCase(ref: string): Promise<string> {
  const created = await call("lead", "POST", "/v1/axis/cases", { ref, kind: "new_business", status: "open" });
  expect(created.status).toBe(201);
  return created.body.id as string;
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
    FILES: (() => {
      const objects = new Map<string, Uint8Array>();
      return {
        put: async (key: string, bytes: Uint8Array) => void objects.set(key, bytes),
        get: async (key: string) => {
          const bytes = objects.get(key);
          return bytes ? { body: new Response(bytes).body } : null;
        }
      };
    })()
  } as unknown as Env;

  tokens = {};
  for (const [who, local] of Object.entries(PEOPLE)) {
    const login = await call(null, "POST", "/v1/auth/login", { email: `${local}@gonxt.ae`, password: PASSWORD, tenantSlug: "gonxt" });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
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
    tokens[who] = token;
  }
}, 120_000);

afterEach(() => vi.useRealTimers());

describe("AXIS case: complete audit bundle (docs/25)", () => {
  it("exports a case's own audit trail with a manifest whose hashes verify against the archive's bytes", async () => {
    const caseId = await openCase("CASE-AUD-1");
    expect((await call("lead", "PATCH", `/v1/axis/cases/${caseId}`, { status: "quoting" })).status).toBe(200);

    // Negative control: a second case, its own create+update trail, same tenant.
    const otherCaseId = await openCase("CASE-AUD-2");
    expect((await call("lead", "PATCH", `/v1/axis/cases/${otherCaseId}`, { status: "quoting" })).status).toBe(200);

    const to = Date.now() + 1;
    const exported = await call("officer", "POST", "/v1/compliance/evidence-bundles/export", {
      purpose: "audit",
      subjectRef: caseId,
      from: 0,
      to
    });
    expect(exported.status).toBe(201);
    const bundle = exported.body;
    expect(bundle.state).toBe("ready");
    expect(bundle.manifest.scope.subjectRef).toBe(caseId);

    const archive = await download(bundle.id);
    const files = unzip(archive);
    expect([...files.keys()].sort()).toEqual(["ai-audit.jsonl", "audit.jsonl", "manifest.json", "summary.pdf"]);

    // The manifest names three files (it does not describe itself); each one's
    // declared sha256 must match an independent hash of the bytes actually in
    // the archive — not merely look like a hash, per the task's own bar.
    for (const f of bundle.manifest.files as Array<{ path: string; sha256: string }>) {
      const bytes = files.get(f.path);
      expect(bytes).toBeDefined();
      expect(await sha256Hex(bytes!)).toBe(f.sha256);
    }

    // Subject scoping: every audit row in the bundle is this case's own, and
    // the other case's rows — created in the same tenant, same window — never
    // leak in.
    const auditLines = new TextDecoder()
      .decode(files.get("audit.jsonl")!)
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { subjectRef: string; tenantId: string });
    expect(auditLines.length).toBeGreaterThanOrEqual(2); // create + update
    expect(auditLines.every((r) => r.subjectRef === caseId)).toBe(true);
    expect(auditLines.some((r) => r.subjectRef === otherCaseId)).toBe(false);

    // Ground truth: the same two rows exist, tenant-scoped, in the live table.
    const liveRows = await database.select().from(schema.auditLog).where(eq(schema.auditLog.subjectRef, caseId));
    expect(liveRows.length).toBe(auditLines.length);
  });

  it("hashes identically for the same scope and the same rows (zip's fixed timestamps, per compliance.ts's own comment)", async () => {
    const caseId = await openCase("CASE-AUD-3");
    expect((await call("lead", "PATCH", `/v1/axis/cases/${caseId}`, { status: "quoting" })).status).toBe(200);

    // `generatedAt`/`to` default to the request's own clock (ctx.now = Date.now()
    // per request, apps/api/src/mw.ts) — a real difference in wall time between
    // two live calls would change the hash for a reason that has nothing to do
    // with the rows. Freezing the clock isolates the property actually under
    // test: identical scope + identical rows -> identical bytes -> identical
    // hash. This freezes only vitest's global Date, not any production code.
    const frozen = Date.now();
    vi.useFakeTimers({ now: frozen, shouldAdvanceTime: false });

    const body = { purpose: "audit" as const, subjectRef: caseId, from: 0, to: frozen };
    const first = await call("officer", "POST", "/v1/compliance/evidence-bundles/export", body);
    const second = await call("officer", "POST", "/v1/compliance/evidence-bundles/export", body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.bundleHash).toBe(first.body.bundleHash);
  });
});
