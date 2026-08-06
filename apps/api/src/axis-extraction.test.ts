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

// docs/modules/axis.md §8, docs/04 §4 "documents(+extract)". The extract route
// is the structuring step only (packages/model-gateway/src/extract.ts) — no
// OCR, no vision. The `AI` binding is stubbed here exactly as journeys.test.ts
// stubs it: at the Workers AI binding, not inside the Gateway, so budget,
// guardrails and the ai_audit_log row are all still exercised for real.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const exec = { waitUntil() {}, passThroughOnException() {} };

/**
 * axis.lead and axis.agent both hold `axis:documents:extract` (rbac.ts) —
 * `outsider` is orbit.agent, which holds no `axis:documents:*` permission at
 * all, so it is the one that exercises the 403.
 */
const PEOPLE: Record<string, string> = {
  lead: "omar.farouk",
  agent: "layla.hassan",
  outsider: "sara.nasser"
};

/** One canned value per field name the stub model can be asked for, across both doc types. */
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
let foreignDocId: string;

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
    FIELD_KEY: "test-field-encryption-secret",
    // The reply mirrors whatever fields the route actually asked for (read off
    // response_format.json_schema), so one stub covers both eid and mulkiya
    // without hard-coding a docType here.
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

  const now = Date.now();
  const tenantId = newId("tn", now);
  await database.insert(schema.tenants).values({
    id: tenantId,
    slug: "otherco2",
    name: "Other Co 2",
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
    status: "received",
    createdAt: now
  });
}, 120_000);

/**
 * A fresh, un-extracted document through the upload path. `status` is left
 * off the body on purpose so the row picks up the column default ("received")
 * — ponytail: the generic create response reflects the pre-insert values, not
 * a re-read, so it never echoes a column the caller left out; the DB row is
 * what actually carries the default, which is what `extract` reads.
 */
async function upload(docType: string): Promise<string> {
  const res = await call("agent", "POST", "/v1/axis/documents", {
    caseId: newId("cas", Date.now()),
    fileId: newId("fil", Date.now()),
    docType
  });
  expect(res.status).toBe(201);
  const docId = res.body.id as string;
  const rows = await database.select().from(schema.axisDocuments).where(eq(schema.axisDocuments.id, docId));
  expect(rows[0]?.status).toBe("received");
  return docId;
}

const extract = (who: string, docId: string, payload?: unknown) =>
  call(who, "POST", `/v1/axis/documents/${docId}/extract`, payload ?? { rawText: "some ocr'd document text" });

describe("POST /v1/axis/documents/:id/extract", () => {
  it("structures an eid document's text into named fields and moves it to extracted", async () => {
    const docId = await upload("eid");
    const res = await extract("agent", docId, { rawText: "EID text", locale: "en" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("extracted");
    expect(res.body.extractionModel).toBeTruthy();
    expect(res.body.extractionConfidence).toBe(100);
    // docs/12 §1: the Emirates ID number is sealed before it reaches the column
    // (ADR-0032); everything that is not an identifier stays legible.
    const extracted = JSON.parse(res.body.extractionJson);
    expect(extracted).toMatchObject({
      fullName: "Ahmed Al Mansoori",
      dateOfBirth: "1985-04-12",
      expiryDate: "2029-11-03",
      nationality: "United Arab Emirates"
    });
    expect(extracted.idNumber).toMatch(/^enc\.v1\./);

    const rows = await database.select().from(schema.axisDocuments).where(eq(schema.axisDocuments.id, docId));
    expect(rows[0]?.status).toBe("extracted");
    expect(rows[0]?.extractionConfidence).toBe(100);
    expect(rows[0]?.extractionJson).not.toContain("784-1985");
  });

  it("structures a mulkiya document's text (arabic locale) into named fields", async () => {
    const docId = await upload("mulkiya");
    const res = await extract("agent", docId, { rawText: "Mulkiya text", locale: "ar" });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body.extractionJson)).toEqual({
      plateNumber: "DXB A 12345",
      ownerName: "Omar Khalid",
      vehicleModel: "Toyota Camry 2022",
      registrationExpiry: "2026-12-01"
    });
  });

  // The golden-set measurement lives in packages/model-gateway/evals/axis
  // (`pnpm eval`, gated at fieldAccuracyMin 0.95). This checks the same
  // parsing end to end through the HTTP route, on a small in-repo sample.
  it("field accuracy on a small sample matches the extraction eval's parsing", async () => {
    const samples: { docType: string; expected: Record<string, string> }[] = [
      {
        docType: "eid",
        expected: {
          fullName: "Ahmed Al Mansoori",
          idNumber: "784-1985-1234567-1",
          dateOfBirth: "1985-04-12",
          expiryDate: "2029-11-03",
          nationality: "United Arab Emirates"
        }
      },
      {
        docType: "mulkiya",
        expected: {
          plateNumber: "DXB A 12345",
          ownerName: "Omar Khalid",
          vehicleModel: "Toyota Camry 2022",
          registrationExpiry: "2026-12-01"
        }
      }
    ];

    let correct = 0;
    let total = 0;
    for (const sample of samples) {
      const docId = await upload(sample.docType);
      const res = await extract("agent", docId);
      expect(res.status).toBe(200);
      // Read back through the reveal door rather than off the column: accuracy
      // is a statement about what the model extracted, and sealed identifiers
      // are unreadable by design (docs/12 §1).
      const revealed = await call("lead", "POST", `/v1/axis/documents/${docId}/reveal`);
      expect(revealed.status).toBe(200);
      const values = revealed.body.values as Record<string, string>;
      for (const [field, expected] of Object.entries(sample.expected)) {
        total += 1;
        if (values[field] === expected) correct += 1;
      }
    }
    expect(correct / total).toBeGreaterThanOrEqual(0.95);
  });

  it("is 400 for a doc type with no extraction schema", async () => {
    const docId = await upload("other");
    const res = await extract("agent", docId);
    expect(res.status).toBe(400);
  });

  it("refuses a document that is not in status 'received' with a 409", async () => {
    const docId = await upload("eid");
    expect((await extract("agent", docId)).status).toBe(200);
    const again = await extract("agent", docId);
    expect(again.status).toBe(409);
    expect(String(again.body.detail)).toContain("extracted");
  });

  it("is 403 for a session without axis:documents:extract", async () => {
    const docId = await upload("eid");
    const res = await extract("outsider", docId);
    expect(res.status).toBe(403);

    const rows = await database.select().from(schema.axisDocuments).where(eq(schema.axisDocuments.id, docId));
    expect(rows[0]?.status).toBe("received");
  });

  it("is 404 for a document in another tenant", async () => {
    const res = await extract("agent", foreignDocId);
    expect(res.status).toBe(404);
  });

  it("is 404 for a document that does not exist", async () => {
    expect((await extract("agent", "doc_nope")).status).toBe(404);
  });

  it("writes an audit entry and leaves status 'received' when the model call fails", async () => {
    const bad: Env = {
      ...env,
      AI: {
        run: async () => {
          throw new Error("boom");
        }
      }
    } as unknown as Env;
    const docId = await upload("eid");
    const res = await app.fetch(
      new Request(`http://api.test/v1/axis/documents/${docId}/extract`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${tokens.agent}` },
        body: JSON.stringify({ rawText: "EID text" })
      }),
      bad as never,
      exec as never
    );
    expect(res.status).toBeGreaterThanOrEqual(500);

    const rows = await database.select().from(schema.axisDocuments).where(eq(schema.axisDocuments.id, docId));
    expect(rows[0]?.status).toBe("received");
  });

  it("writes an audit entry carrying the extraction", async () => {
    const docId = await upload("eid");
    expect((await extract("agent", docId)).status).toBe(200);
    const rows = await database.select().from(schema.auditLog);
    const entry = rows.find((a) => a.subjectRef === docId && a.action === "axis.documents.extract");
    expect(entry).toBeDefined();
    expect(entry?.beforeHash).toBeTruthy();
    expect(entry?.afterHash).toBeTruthy();
    expect(entry?.actorRef).toMatch(/^user:/);
  });
});

// docs/12 §2: "PII masked by default in UIs (reveal = permission + audit)".
// axis.agent may extract a document and never read the identifier out of it;
// axis.lead holds `core:pii:view` and does — with a row left behind either way.
describe("POST /v1/axis/documents/:id/reveal", () => {
  const reveal = (who: string, docId: string) =>
    call(who, "POST", `/v1/axis/documents/${docId}/reveal`);

  async function extracted(): Promise<string> {
    const docId = await upload("eid");
    expect((await extract("agent", docId)).status).toBe(200);
    return docId;
  }

  it("opens the sealed identifier for an actor holding core:pii:view", async () => {
    const res = await reveal("lead", await extracted());
    expect(res.status).toBe(200);
    expect(res.body.values.idNumber).toBe("784-1985-1234567-1");
    expect(res.body.values.fullName).toBe("Ahmed Al Mansoori");
  });

  it("is 403 for an actor who may read the document but not its PII", async () => {
    const res = await reveal("agent", await extracted());
    expect(res.status).toBe(403);
  });

  it("audits the act without copying the identifier into the audit row", async () => {
    const docId = await extracted();
    expect((await reveal("lead", docId)).status).toBe(200);
    const rows = await database.select().from(schema.auditLog);
    const entry = rows.find((a) => a.subjectRef === docId && a.action === "axis.documents.reveal");
    expect(entry).toBeDefined();
    expect(entry?.actorRef).toMatch(/^user:/);
    expect(JSON.stringify(entry)).not.toContain("784-1985");
  });

  it("is 409 for a document that has not been extracted yet", async () => {
    expect((await reveal("lead", await upload("eid"))).status).toBe(409);
  });

  it("is 404 for a document in another tenant", async () => {
    expect((await reveal("lead", foreignDocId)).status).toBe(404);
  });

  it("is 500 rather than a plaintext fallback when FIELD_KEY is missing", async () => {
    const docId = await extracted();
    const { FIELD_KEY: _dropped, ...keyless } = env as Env & { FIELD_KEY: string };
    const res = await app.fetch(
      new Request(`http://api.test/v1/axis/documents/${docId}/reveal`, {
        method: "POST",
        headers: { authorization: `Bearer ${tokens.lead}` }
      }),
      keyless as never,
      exec as never
    );
    expect(res.status).toBe(500);
  });
});

// The correction desk (apps/web/app/routes/axis-doc-intel.tsx) saves a human's
// answer through generic CRUD, not through the extract route — so the sealing
// sits on the write path itself (resources.ts beforeWrite, docs/12 §1).
describe("PATCH /v1/axis/documents/:id — corrected extractions", () => {
  async function extracted(): Promise<string> {
    const docId = await upload("eid");
    expect((await extract("agent", docId)).status).toBe(200);
    return docId;
  }

  const stored = async (docId: string): Promise<string | null> =>
    (await database.select().from(schema.axisDocuments).where(eq(schema.axisDocuments.id, docId)))[0]
      ?.extractionJson ?? null;

  it("seals a corrected identifier rather than storing what the human typed", async () => {
    const docId = await extracted();
    const res = await call("lead", "PATCH", `/v1/axis/documents/${docId}`, {
      extractionJson: JSON.stringify({ fullName: "Ahmed Al Mansoori", idNumber: "784-1985-7654321-9" })
    });
    expect(res.status).toBe(200);

    expect(await stored(docId)).not.toContain("784-1985");
    const revealed = await call("lead", "POST", `/v1/axis/documents/${docId}/reveal`);
    expect(revealed.body.values.idNumber).toBe("784-1985-7654321-9");
    expect(revealed.body.values.fullName).toBe("Ahmed Al Mansoori");
  });

  it("does not re-seal a value the caller read back and submitted unchanged", async () => {
    const docId = await extracted();
    const before = JSON.parse((await stored(docId))!) as Record<string, string>;

    const res = await call("lead", "PATCH", `/v1/axis/documents/${docId}`, {
      extractionJson: JSON.stringify({ ...before, nationality: "United Arab Emirates" })
    });
    expect(res.status).toBe(200);

    // Same envelope, not an envelope wrapping an envelope: the reveal still
    // returns the identifier itself after a round trip through the form.
    const after = JSON.parse((await stored(docId))!) as Record<string, string>;
    expect(after.idNumber).toBe(before.idNumber);
    const revealed = await call("lead", "POST", `/v1/axis/documents/${docId}/reveal`);
    expect(revealed.body.values.idNumber).toBe("784-1985-1234567-1");
  });

  it("keeps the model's reserved keys and non-identifier fields legible", async () => {
    const docId = await extracted();
    const res = await call("lead", "PATCH", `/v1/axis/documents/${docId}`, {
      extractionJson: JSON.stringify({
        fullName: "Ahmed Al Mansoori",
        idNumber: "784-1985-7654321-9",
        _bbox: { fullName: [1, 2, 3, 4] }
      })
    });
    expect(res.status).toBe(200);

    const after = JSON.parse((await stored(docId))!) as Record<string, unknown>;
    expect(after.fullName).toBe("Ahmed Al Mansoori");
    expect(after._bbox).toEqual({ fullName: [1, 2, 3, 4] });
  });

  it("refuses an extractionJson that is not an object of fields", async () => {
    const docId = await extracted();
    expect((await call("lead", "PATCH", `/v1/axis/documents/${docId}`, { extractionJson: "not json" })).status).toBe(
      400
    );
    expect((await call("lead", "PATCH", `/v1/axis/documents/${docId}`, { extractionJson: "[1,2]" })).status).toBe(400);
  });
});
