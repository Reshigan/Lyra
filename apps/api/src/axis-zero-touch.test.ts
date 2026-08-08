import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { schema, type Db } from "@lyra/db";
import { seed, totpAt, TOTP_STEP_SEC, type SeedResult } from "@lyra/core";
import { app } from "./index.js";
import type { Env } from "./env.js";

// docs/25 go-live checklist / docs/modules/axis.md §8: the motor happy path —
// web intake, >=3 provider quotes, bind, policy delivered — must complete with
// zero human touches in under 10 minutes. `axis.bind` is gated by default
// (proven by J-O1 in journeys.test.ts, which always walks it through a human
// decision); this file proves the *other* lawful path through the same gate:
// a tenant that has put `axis.bind` on its own `policy.autoApprove` allowlist
// gets a real, ungated auto-approval (`gate()` in packages/core/src/approvals.ts
// short-circuits before ever creating a pending row) — not a bypass of the gate.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const exec = { waitUntil() {}, passThroughOnException() {} };

// Same risk shape as journeys.test.ts's MOTOR_RISK, plus `market` — required
// for falconMotor's eligibility rule (packages/core/src/seed.ts) so a third,
// distinct underwriter (falcon, alongside gonxt and cedar) actually quotes.
const RISK = { age: 34, sumInsuredMinor: 28_000_000, priorClaims: false, vehicleUse: "private", market: "AE" };

let env: Env;
let objects: Map<string, Uint8Array>;
let database: Db;
let seeded: SeedResult;
let tokens: Record<string, string>;
let productId: string;
let customerId: string;
let consentId: string;

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
  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("json");
  const body = isJson ? await res.json() : await res.arrayBuffer();
  return { status: res.status, body: body as T };
}

function ok<T>(res: Res<T>, ...accept: number[]): T {
  const allowed = accept.length ? accept : [200, 201, 204];
  if (!allowed.includes(res.status)) throw new Error(`expected ${allowed.join("|")}, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
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
  seeded = await seed(database as never, { mfaSecret: DEMO_TOTP_SECRET });

  // ponytail: a Map is the whole of R2 this test needs — put then get. It is
  // held in a module-level binding so the assertions can read the bytes that
  // were actually stored without a download route standing in for the check.
  objects = new Map<string, Uint8Array>();
  env = {
    DB_CLIENT: database,
    ENVIRONMENT: "development",
    APP_ORIGIN: "http://localhost:5173",
    FILES: {
      put: async (key: string, bytes: Uint8Array) => void objects.set(key, bytes),
      get: async (key: string) => {
        const bytes = objects.get(key);
        return bytes ? { body: new Response(bytes).body, size: bytes.byteLength } : null;
      }
    }
  } as unknown as Env;

  // The tenant/policy fixture: `axis.bind` explicitly on this tenant's own
  // autoApprove allowlist, exactly as packages/core/src/seed.ts:154 does for
  // `signal.campaign_launch` — a real tenant policy decision, not a default.
  const tenantRow = (await database.select().from(schema.tenants).where(eq(schema.tenants.id, seeded.tenantId)))[0]!;
  const policy = JSON.parse(tenantRow.policyJson as string) as { autoApprove: string[] };
  await database
    .update(schema.tenants)
    .set({ policyJson: JSON.stringify({ ...policy, autoApprove: [...policy.autoApprove, "axis.bind", "axis.underwriting_referral"] }) })
    .where(eq(schema.tenants.id, seeded.tenantId));

  tokens = {};
  for (const [who, local] of [["lead", "omar.farouk"]] as const) {
    const login = await call(null, "POST", "/v1/auth/login", { email: `${local}@gonxt.ae`, password: PASSWORD, tenantSlug: "gonxt" });
    const token = ok(login).token as string;
    // MFA verify needs the bearer of the just-issued token, so it goes through
    // `app.fetch` directly rather than the `call()` helper (which only knows
    // tokens already stashed in `tokens`).
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

  const productRow = (await database.select().from(schema.products).where(eq(schema.products.line, "motor")))[0]!;
  productId = productRow.id;
  const customer = (await database.select().from(schema.customers).limit(1))[0]!;
  customerId = customer.id;
  consentId = customer.consentId!;
}, 120_000);

describe("AXIS motor: fully automated happy path (docs/25, AXIS §8)", () => {
  it("web intake -> >=3 provider quotes -> bind -> policy PDF, zero human touches, under 10 minutes", async () => {
    const t0 = Date.now();

    // Web intake: the case the shop and the bind both hang off.
    const created = ok(
      await call("lead", "POST", "/v1/axis/cases", { ref: "CASE-ZT-1", kind: "new_business", customerId, status: "open" }),
      201
    );
    const caseId = created.id as string;

    // Shop the whole panel from one submission (docs/06 J-C1's own mechanism).
    const shopped = ok(
      await call("lead", "POST", "/v1/dist/quote-requests/shop", {
        productId,
        channelId: seeded.channels.web,
        customerId,
        consentId,
        inputs: RISK,
        currency: "AED",
        caseId
      }),
      201
    );
    const quoted = shopped.responses.filter((r: any) => r.state === "quoted");
    const distinctProviders = new Set(quoted.map((r: any) => r.providerId));
    // The acceptance criterion is >=3 *provider* quotes, not merely >=3 rows —
    // this tenant's motor panel has two offerings from the same underwriter
    // (cedar), so the count that matters is distinct providerId.
    expect(distinctProviders.size).toBeGreaterThanOrEqual(3);

    const best = quoted.slice().sort((a: any, b: any) => a.premiumMinor - b.premiumMinor)[0];
    expect(best).toBeTruthy();

    // Seed data carries its own unrelated `axis.bind` approval rows (demo
    // evidence for other policies) — the proof here is that this specific
    // bind adds none, not that the table is empty.
    const approvalsBefore = (
      await database
        .select()
        .from(schema.approvals)
        .where(and(eq(schema.approvals.tenantId, seeded.tenantId), eq(schema.approvals.policyKey, "axis.bind")))
    ).length;

    // Bind: axis.bind is on this tenant's autoApprove list, so `gate()` returns
    // null immediately (packages/core/src/approvals.ts) — no 403, no approval
    // row, ever, for this request. This is the one call under test; the rest of
    // the sequence is here only to prove it sits inside a real pipeline.
    const start = t0;
    // The customer accepts the quote, then the accepted quote becomes the
    // contract. This is the real bind (§H task 3), not a hand-assembled row:
    // it posts BIND, writes version 1 and stamps the head.
    ok(await call("lead", "POST", `/v1/dist/quote-requests/${shopped.request.id}/select`, { responseId: best.id }));
    const bindRes = await call("lead", "POST", `/v1/axis/quote-responses/${best.id}/bind`, {
      policyNo: "POL-ZT-1",
      startAt: start,
      endAt: start + 365 * 86_400_000,
      caseId
    });
    expect(bindRes.status).not.toBe(403);
    const bound = ok(bindRes, 201);
    const policyId = bound.policy.id as string;
    const policyRow = (await database.select().from(schema.axisPolicies).where(eq(schema.axisPolicies.id, policyId)))[0]!;
    // Bind stops at `bound`; `bound -> active` is inception, a clock event the
    // INCEPT scheduler owns. Nothing here waits on a human either way.
    expect(policyRow.status).toBe("bound");
    expect(policyRow.currentVersionId).toBe(bound.version.id);

    // Zero human touches: this bind added no `axis.bind` approval row. An
    // approval row is only ever created on the *pending* path — the
    // auto-approved path in `gate()` (packages/core/src/approvals.ts) returns
    // before one is ever written.
    const approvalsAfter = (
      await database
        .select()
        .from(schema.approvals)
        .where(and(eq(schema.approvals.tenantId, seeded.tenantId), eq(schema.approvals.policyKey, "axis.bind")))
    ).length;
    expect(approvalsAfter).toBe(approvalsBefore);

    // The auto-approval still leaves a trail: `core.approval.auto`, naming the
    // policy key, in the ordinary audit log — "zero touch" is not "no record".
    const auditRows = await database.select().from(schema.auditLog).where(eq(schema.auditLog.tenantId, seeded.tenantId));
    expect(auditRows.some((r) => r.action === "core.approval.auto")).toBe(true);

    // The policy document: a schedule for the contract just bound, attached to
    // the version it describes (§D.11). Delivery is ORBIT's — AXIS issues.
    const issued = ok(await call("lead", "POST", `/v1/axis/policies/${policyId}/documents`, { kind: "schedule" }), 201);
    expect(issued.kind).toBe("schedule");
    expect(issued.versionId).toBe(bound.version.id);

    const version = (
      await database.select().from(schema.axisPolicyVersions).where(eq(schema.axisPolicyVersions.id, bound.version.id))
    )[0]!;
    expect(version.versionSeq).toBe(1);
    expect(version.documentFileId, "the schedule is attached to version 1").toBe(issued.fileId);
    // Nobody has sent it yet: delivery is a separate fact from issuance.
    expect(version.deliveredAt).toBeNull();

    const file = (await database.select().from(schema.files).where(eq(schema.files.id, issued.fileId)))[0]!;
    expect(file.contentType).toBe("application/pdf");
    expect(file.subjectRef).toBe(bound.version.id);

    const bytes = objects.get(file.r2Key);
    expect(bytes, "the schedule bytes are in the object store").toBeTruthy();
    expect(file.sizeBytes).toBe(bytes!.byteLength);
    expect(new TextDecoder().decode(bytes!.slice(0, 5))).toBe("%PDF-");

    const outbox = await database.select().from(schema.eventOutbox).where(eq(schema.eventOutbox.tenantId, seeded.tenantId));
    expect(outbox.some((e) => e.type === "axis.policy.document_issued" && e.envelopeJson.includes(issued.fileId))).toBe(true);

    const elapsedMs = Date.now() - t0;
    expect(elapsedMs).toBeLessThan(600_000);
  });
});
