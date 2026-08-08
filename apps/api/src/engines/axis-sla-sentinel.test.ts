import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { beforeAll, describe, expect, it } from "vitest";
import { id as newId, schema } from "@lyra/db";
import { EntitlementsJson, PolicyJson } from "@lyra/db";
import { permissionsForRole, seed, type Ctx } from "@lyra/core";
import { Gateway, makeStub } from "@lyra/model-gateway";
import { caseHistory, ownerLoad, predictSlaBreach, queueDepth } from "./axis-sla-sentinel.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "..", "packages", "db", "migrations");

function migrationStatements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

let client: Client;
let ctx: Ctx;
let tenantId: string;

beforeAll(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of migrationStatements()) await client.execute(sql);
  const db = drizzle(client) as unknown as Ctx["db"];
  const r = await seed(db, { password: "axis-sla-test-password-2026" });
  tenantId = r.tenantId;
  ctx = {
    db,
    tenantId,
    actor: {
      kind: "user",
      id: "u_1",
      tenantId,
      grants: [{ roleKey: "axis.admin", permissions: permissionsForRole("axis.admin") }]
    },
    requestId: "req_1",
    now: Date.UTC(2026, 0, 6, 8, 0, 0),
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  };
}, 120_000);

function stubbedGateway(opts?: { replies?: string[]; fail?: Error }): { gw: Gateway } {
  const stub = makeStub(opts?.fail ? { fail: opts.fail } : opts?.replies ? { replies: opts.replies } : {});
  return { gw: new Gateway({ env: {}, providers: { "workers-ai": stub, anthropic: stub, "openai-compat": stub } }) };
}

type CaseRow = typeof schema.axisCases.$inferSelect;

async function seedCase(opts: {
  status?: string;
  ownerRef?: string | null;
  slaDueAt?: number | null;
  createdAt?: number;
}): Promise<CaseRow> {
  const at = opts.createdAt ?? ctx.now;
  const id = newId("cas", at);
  const row: CaseRow = {
    id,
    tenantId,
    ref: `REF-${id}`,
    kind: "claim",
    customerId: null,
    productLine: null,
    channelId: null,
    quoteRequestId: null,
    status: opts.status ?? "awaiting_docs",
    slaDueAt: opts.slaDueAt === undefined ? ctx.now + 6 * 3_600_000 : opts.slaDueAt,
    ownerRef: opts.ownerRef ?? null,
    teamId: null,
    priority: "normal",
    source: "web",
    riskScore: null,
    valueMinor: null,
    currency: null,
    metaJson: null,
    closedAt: null,
    createdAt: at,
    updatedAt: at,
    deletedAt: null
  };
  await ctx.db.insert(schema.axisCases).values(row);
  return row;
}

async function seedEvent(caseId: string, opts?: { step?: string; outcome?: string | null; ts?: number }) {
  const at = opts?.ts ?? ctx.now;
  const id = newId("pev", at);
  await ctx.db.insert(schema.axisProcessEvents).values({
    id,
    tenantId,
    caseId,
    step: opts?.step ?? "docs_requested",
    actorRef: "user:u_1",
    durationMs: null,
    outcome: opts?.outcome ?? null,
    ts: at
  });
  return id;
}

describe("caseHistory / queueDepth / ownerLoad §G.4", () => {
  it("returns this case's process events, newest first", async () => {
    const kase = await seedCase({});
    const older = await seedEvent(kase.id, { step: "intake", ts: ctx.now - 1000 });
    const newer = await seedEvent(kase.id, { step: "docs_requested", ts: ctx.now });
    const other = await seedCase({});
    await seedEvent(other.id, { step: "intake" });

    const history = await caseHistory(ctx, kase);
    expect(history.map((h) => h.id)).toEqual([newer, older]);
  });

  it("counts open cases sharing this case's status, excluding closed ones", async () => {
    const kase = await seedCase({ status: "review" });
    await seedCase({ status: "review" });
    await seedCase({ status: "review", createdAt: ctx.now });
    const closed = await seedCase({ status: "review" });
    await ctx.db.update(schema.axisCases).set({ closedAt: ctx.now }).where(eq(schema.axisCases.id, closed.id));
    await seedCase({ status: "intake" });

    expect(await queueDepth(ctx, kase)).toBe(3);
  });

  it("returns zero owner load for an unassigned case", async () => {
    const kase = await seedCase({ ownerRef: null });
    expect(await ownerLoad(ctx, kase)).toBe(0);
  });

  it("counts open cases owned by the same owner", async () => {
    const kase = await seedCase({ ownerRef: "user:u_9" });
    await seedCase({ ownerRef: "user:u_9" });
    await seedCase({ ownerRef: "user:other" });

    expect(await ownerLoad(ctx, kase)).toBe(2);
  });
});

describe("predictSlaBreach §G.4", () => {
  it("predicts nothing when the gateway call fails", async () => {
    const kase = await seedCase({});
    const { gw } = stubbedGateway({ fail: new Error("boom") });
    expect(await predictSlaBreach(ctx, kase, gw)).toBeNull();
  });

  it("computes hoursToBreach deterministically from slaDueAt, not from the model", async () => {
    const kase = await seedCase({ slaDueAt: ctx.now + 12 * 3_600_000 });
    const { gw } = stubbedGateway({
      replies: ['{"breachProbability":40,"driver":{"feature":"queueDepth","detail":"3 open in status","evidenceRef":"queueDepth"}}']
    });

    const out = await predictSlaBreach(ctx, kase, gw);
    expect(out).not.toBeNull();
    expect(out!.hoursToBreach).toBeCloseTo(12, 5);
    expect(out!.breachProbability).toBe(40);
    expect(out!.driver).toEqual({ feature: "queueDepth", detail: "3 open in status", evidenceRef: "queueDepth" });
  });

  it("clamps hoursToBreach to zero once the case is already overdue", async () => {
    const kase = await seedCase({ slaDueAt: ctx.now - 3_600_000 });
    const { gw } = stubbedGateway({
      replies: ['{"breachProbability":90,"driver":{"feature":"age","detail":"already overdue","evidenceRef":"slaDueAt"}}']
    });

    const out = await predictSlaBreach(ctx, kase, gw);
    expect(out!.hoursToBreach).toBe(0);
  });

  it("returns a null hoursToBreach when the case has no SLA due date", async () => {
    const kase = await seedCase({ slaDueAt: null });
    const { gw } = stubbedGateway({
      replies: ['{"breachProbability":10,"driver":{"feature":"age","detail":"no due date set","evidenceRef":"slaDueAt"}}']
    });

    const out = await predictSlaBreach(ctx, kase, gw);
    expect(out!.hoursToBreach).toBeNull();
  });

  it("drops a driver with no evidenceRef and forces the probability to zero", async () => {
    const kase = await seedCase({});
    const { gw } = stubbedGateway({
      replies: ['{"breachProbability":85,"driver":{"feature":"vibes","detail":"feels risky"}}']
    });

    const out = await predictSlaBreach(ctx, kase, gw);
    expect(out!.breachProbability).toBe(0);
    expect(out!.driver).toBeNull();
  });
});
