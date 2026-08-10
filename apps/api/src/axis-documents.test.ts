import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { seed, totpAt, TOTP_STEP_SEC } from "@lyra/core";
import { id as newId, schema, type Db } from "@lyra/db";
import { app } from "./index.js";
import type { Env } from "./env.js";

// PLAT: `axis:documents:verify` was a permission with nothing behind it — the
// only way to set `verifiedBy`/`verifiedAt` was a PATCH body, which makes the
// two columns a claim rather than evidence. These tests are about what the
// endpoint must never accept: a verifier name from the caller, a second
// verification over the first, or a document from another tenant.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const exec = { waitUntil() {}, passThroughOnException() {} };

/** axis.lead holds `axis:documents:verify`; axis.agent holds upload but not it. */
const PEOPLE: Record<string, string> = {
  lead: "omar.farouk",
  agent: "layla.hassan"
};

let env: Env;
let database: Db;
let tokens: Record<string, string>;
/** A document belonging to a second tenant, reachable only from there. */
let foreignDocId: string;

interface Res<T = any> {
  status: number;
  body: T;
}

async function call<T = any>(
  who: string | null,
  method: string,
  path: string,
  payload?: unknown,
  headers: Record<string, string> = {}
): Promise<Res<T>> {
  const token = who ? tokens[who] : undefined;
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers
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
    // ponytail: a Map is the whole of R2 a bundle needs — put then get.
    FILES: (() => {
      const store = new Map<string, Uint8Array>();
      return {
        put: async (key: string, bytes: Uint8Array) => {
          store.set(key, bytes);
        },
        get: async (key: string) => {
          const bytes = store.get(key);
          return bytes ? { body: new Response(bytes).body, size: bytes.byteLength } : null;
        }
      };
    })()
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

  const now = Date.now();
  const tenantId = newId("tn", now);
  await database.insert(schema.tenants).values({
    id: tenantId,
    slug: "otherco",
    name: "Other Co",
    status: "active",
    createdAt: now,
    updatedAt: now
  });
  foreignDocId = newId("doc", now);
  await database.insert(schema.axisDocuments).values({
    id: foreignDocId,
    tenantId,
    caseId: newId("cas", now),
    fileId: newId("fil", now),
    docType: "eid",
    status: "extracted",
    createdAt: now
  });
}, 120_000);

/** A fresh unverified document in the seeded tenant, through the upload path. */
async function upload(): Promise<string> {
  const res = await call("lead", "POST", "/v1/axis/documents", {
    caseId: newId("cas", Date.now()),
    fileId: newId("fil", Date.now()),
    docType: "eid",
    status: "extracted"
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

/** A fresh document whose fileId points at a real core_files row and R2 object. */
async function uploadWithFile(): Promise<{ docId: string; r2Key: string; bytes: Uint8Array }> {
  const docId = await upload();
  const rows = await database.select().from(schema.axisDocuments).where(eq(schema.axisDocuments.id, docId));
  const tenantId = rows[0]!.tenantId;
  const now = Date.now();
  const fileId = newId("fil", now);
  const r2Key = `axis/documents/${fileId}.bin`;
  const bytes = new TextEncoder().encode("stub file bytes");
  await env.FILES!.put(r2Key, bytes);
  await database.insert(schema.files).values({
    id: fileId,
    tenantId,
    r2Key,
    kind: "axis_document",
    subjectRef: docId,
    sha256: "0".repeat(64),
    sizeBytes: bytes.byteLength,
    contentType: "image/png",
    piiLevel: "high",
    createdAt: now
  });
  await database.update(schema.axisDocuments).set({ fileId }).where(eq(schema.axisDocuments.id, docId));
  return { docId, r2Key, bytes };
}

/** call()'s JSON-only decoding can't see a streamed file — this returns the raw Response. */
async function raw(who: string, path: string): Promise<Response> {
  return app.fetch(
    new Request(`http://api.test${path}`, { headers: { authorization: `Bearer ${tokens[who]}` } }),
    env as never,
    exec as never
  );
}

const verify = (who: string, docId: string, payload?: unknown) =>
  call(who, "POST", `/v1/axis/documents/${docId}/verify`, payload);

describe("POST /v1/axis/documents/:id/verify", () => {
  it("stamps the verifier and the time from the server, not the body", async () => {
    const docId = await upload();
    const before = Date.now();
    const res = await verify("lead", docId, { verifiedBy: "user:someone_else", verifiedAt: 1 });
    expect(res.status).toBe(200);

    const rows = await database
      .select()
      .from(schema.axisDocuments)
      .where(eq(schema.axisDocuments.id, docId));
    const row = rows[0]!;
    expect(row.status).toBe("verified");
    // The session's actor, never the one the body asked for.
    expect(row.verifiedBy).toMatch(/^user:/);
    expect(row.verifiedBy).not.toBe("user:someone_else");
    expect(row.verifiedAt).not.toBe(1);
    expect(row.verifiedAt).toBeGreaterThanOrEqual(before);
  });

  it("refuses a second verification with a 409 naming the state", async () => {
    const docId = await upload();
    expect((await verify("lead", docId)).status).toBe(200);

    const again = await verify("lead", docId);
    expect(again.status).toBe(409);
    expect(String(again.body.detail)).toContain("verified");
  });

  it("is 403 for a session without axis:documents:verify", async () => {
    const docId = await upload();
    const res = await verify("agent", docId);
    expect(res.status).toBe(403);

    const rows = await database
      .select()
      .from(schema.axisDocuments)
      .where(eq(schema.axisDocuments.id, docId));
    expect(rows[0]?.verifiedBy).toBeNull();
  });

  it("is 404 for a document in another tenant", async () => {
    const res = await verify("lead", foreignDocId);
    expect(res.status).toBe(404);

    const rows = await database
      .select()
      .from(schema.axisDocuments)
      .where(eq(schema.axisDocuments.id, foreignDocId));
    expect(rows[0]?.status).toBe("extracted");
  });

  it("is 404 for a document that does not exist", async () => {
    expect((await verify("lead", "doc_nope")).status).toBe(404);
  });

  it("writes an audit entry carrying the verification", async () => {
    const docId = await upload();
    expect((await verify("lead", docId)).status).toBe(200);
    const rows = await database.select().from(schema.auditLog);
    const entry = rows.find((a) => a.subjectRef === docId && a.action === "axis.documents.verify");
    expect(entry).toBeDefined();
    // The audit stores hashes, not images: a before and an after both present is
    // the evidence that the row changed under a named actor.
    expect(entry?.beforeHash).toBeTruthy();
    expect(entry?.afterHash).toBeTruthy();
    expect(entry?.actorRef).toMatch(/^user:/);
  });

  it("replays the same 200 for a repeated idempotency key instead of 409ing on its own result (regression: IMPORTANT 4/5)", async () => {
    const docId = await upload();
    const key = `idem-verify-${docId}`;
    const first = await call("lead", "POST", `/v1/axis/documents/${docId}/verify`, undefined, { "idempotency-key": key });
    expect(first.status).toBe(200);

    const replay = await call("lead", "POST", `/v1/axis/documents/${docId}/verify`, undefined, { "idempotency-key": key });
    expect(replay.status).toBe(200);
    expect(replay.body.verifiedAt).toBe(first.body.verifiedAt);

    // A genuine second attempt without a key, or with a fresh one, still 409s.
    expect((await verify("lead", docId)).status).toBe(409);
  });
});

describe("GET /v1/axis/documents/:id/file", () => {
  it("streams the stored file's bytes with its content type", async () => {
    const { docId, bytes } = await uploadWithFile();

    const res = await raw("lead", `/v1/axis/documents/${docId}/file`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toBe("inline");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("writes an audit entry naming the file that was read", async () => {
    const { docId } = await uploadWithFile();
    expect((await raw("lead", `/v1/axis/documents/${docId}/file`)).status).toBe(200);

    const rows = await database.select().from(schema.auditLog);
    const entry = rows.find((a) => a.subjectRef === `axis_document:${docId}` && a.action === "axis.documents.file.read");
    expect(entry).toBeDefined();
  });

  it("is 404 for a document in another tenant", async () => {
    const res = await raw("lead", `/v1/axis/documents/${foreignDocId}/file`);
    expect(res.status).toBe(404);
  });

  it("is 404 when the document's file object is missing from storage", async () => {
    const docId = await upload();
    const res = await raw("lead", `/v1/axis/documents/${docId}/file`);
    expect(res.status).toBe(404);
  });
});

// The capture path. Before this route the only way a document row got a file
// was the public portal (portal.ts) or a hand-written core_files insert — a
// field agent photographing a licence disc on the mobile app had nowhere to
// send the bytes. Multipart in, `core_files` + `axis_documents` out, one
// permission (`axis:documents:upload`) in front.
describe("POST /v1/axis/documents/upload", () => {
  async function post(
    who: string,
    parts: { caseId?: string; docType?: string; file?: { bytes: Uint8Array; type: string; name?: string } }
  ): Promise<Res> {
    const form = new FormData();
    if (parts.caseId !== undefined) form.append("caseId", parts.caseId);
    if (parts.docType !== undefined) form.append("docType", parts.docType);
    if (parts.file) {
      form.append("file", new Blob([parts.file.bytes], { type: parts.file.type }), parts.file.name ?? "capture.jpg");
    }
    const res = await app.fetch(
      new Request("http://api.test/v1/axis/documents/upload", {
        method: "POST",
        headers: { authorization: `Bearer ${tokens[who]}` },
        body: form
      }),
      env as never,
      exec as never
    );
    const text = res.headers.get("content-type")?.includes("json") ? await res.text() : "";
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  const jpeg = { bytes: new TextEncoder().encode("not really a jpeg"), type: "image/jpeg" };

  /** The seeded case every upload here is filed against. */
  async function seededCaseId(): Promise<string> {
    const [row] = await database.select().from(schema.axisCases);
    return row!.id;
  }

  it("stores the bytes and files the document against the case", async () => {
    const caseId = await seededCaseId();
    const res = await post("agent", { caseId, docType: "mulkiya", file: jpeg });

    expect(res.status).toBe(201);
    const [doc] = await database
      .select()
      .from(schema.axisDocuments)
      .where(eq(schema.axisDocuments.id, res.body.id as string));
    expect(doc!.caseId).toBe(caseId);
    expect(doc!.docType).toBe("mulkiya");
    expect(doc!.status).toBe("received");

    const [file] = await database.select().from(schema.files).where(eq(schema.files.id, doc!.fileId));
    expect(file!.contentType).toBe("image/jpeg");
    expect(file!.kind).toBe("axis_document");
    expect(file!.piiLevel).toBe("high");
    expect(file!.sizeBytes).toBe(jpeg.bytes.byteLength);
    // The bytes are readable back through the existing stream route.
    const streamed = await raw("agent", `/v1/axis/documents/${res.body.id}/file`);
    expect(new Uint8Array(await streamed.arrayBuffer())).toEqual(jpeg.bytes);
  });

  it("rejects a content type that is not a document or an image", async () => {
    const caseId = await seededCaseId();
    const res = await post("agent", {
      caseId,
      docType: "eid",
      file: { bytes: new TextEncoder().encode("MZ"), type: "application/x-msdownload" }
    });
    expect(res.status).toBe(400);
  });

  it("refuses a case that belongs to another tenant", async () => {
    const [foreign] = await database.select().from(schema.axisDocuments).where(eq(schema.axisDocuments.id, foreignDocId));
    const res = await post("agent", { caseId: foreign!.caseId, docType: "eid", file: jpeg });
    expect(res.status).toBe(404);
  });

  it("requires a file part", async () => {
    const caseId = await seededCaseId();
    expect((await post("agent", { caseId, docType: "eid" })).status).toBe(400);
  });

  it("writes an audit entry for the document it created", async () => {
    const caseId = await seededCaseId();
    const res = await post("agent", { caseId, docType: "eid", file: jpeg });
    const rows = await database.select().from(schema.auditLog);
    expect(
      rows.some((a) => a.action === "axis.documents.upload" && a.subjectRef === `axis_document:${res.body.id}`)
    ).toBe(true);
  });
});
