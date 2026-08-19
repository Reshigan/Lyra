import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson, schema } from "@lyra/db";
import { notFound, permissionsForRole, seed, type AttributeCount, type Ctx } from "@lyra/core";
import { Gateway, makeStub } from "@lyra/model-gateway";
import { onError } from "../mw.js";
import { signalRoutes } from "../routes/signal.js";
import { attributeCounts, suggestTargeting } from "./signal-audience.js";
import type { App } from "../env.js";

// The engine behind docs/17 §SIG-025 ("audience estimate"), against a real
// libSQL book rather than a mocked count — the whole design is that the counts
// the model sees are the ones the database actually holds, so a test that
// hands the engine its own counts would test nothing.
//
// The fixture is one book with four cells, one of them thin and one of them
// protected:
//
//   30 × lsm:7 + region:gauteng
//   25 × lsm:8 + region:gauteng
//   10 × lsm:5                          <- under the k-floor of 20, suppressed
//   25 × religion:observant + region:westerncape   <- axis SIG-034 forbids
//
// so what survives is region=gauteng 55, lsm=7 30, lsm=8 25, region=westerncape
// 25, and `religion` and `lsm=5` may not appear in the prompt, the rule or the
// stored definition.

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

const NOW = Date.UTC(2026, 0, 6, 8, 0, 0);

/** A second tenant with its own tagged book, and a third with an untagged one. */
const OTHER_TENANT = "tn_other_book";
const BARE_TENANT = "tn_bare_book";

/** Exactly what survives `targetablePool` on the fixture above, in its order:
 *  count descending, then axis, then value. */
const SURVIVING: AttributeCount[] = [
  { axis: "region", value: "gauteng", count: 55 },
  { axis: "lsm", value: "7", count: 30 },
  { axis: "lsm", value: "8", count: 25 },
  { axis: "region", value: "westerncape", count: 25 }
];

function customers(
  tenant: string,
  prefix: string,
  spec: { n: number; tags: string[] | null; deleted?: boolean }[]
) {
  let i = 0;
  return spec.flatMap(({ n, tags, deleted }) =>
    Array.from({ length: n }, () => ({
      id: `cu_${prefix}_${i++}`,
      tenantId: tenant,
      type: "person",
      nameJson: JSON.stringify({ en: `Customer ${prefix}-${i}` }),
      kycStatus: "none",
      tagsJson: tags === null ? null : JSON.stringify(tags),
      locale: "en",
      deletedAt: deleted ? NOW : null,
      createdAt: NOW,
      updatedAt: NOW
    }))
  );
}

beforeAll(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of migrationStatements()) await client.execute(sql);
  const db = drizzle(client) as unknown as Ctx["db"];
  const r = await seed(db, { password: "signal-audience-test-password-2026" });
  tenantId = r.tenantId;
  ctx = {
    db,
    tenantId,
    actor: {
      kind: "user",
      id: "u_1",
      tenantId,
      grants: [{ roleKey: "signal.lead", permissions: permissionsForRole("signal.lead") }]
    },
    requestId: "req_1",
    now: NOW,
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  };

  await ctx.db.insert(schema.customers).values(
    [
      ...customers(tenantId, "a", [
        { n: 30, tags: ["lsm:7", "region:gauteng"] },
        { n: 25, tags: ["lsm:8", "region:gauteng"] },
        // Ten people. Naming the cell names them, so it never leaves the server.
        { n: 10, tags: ["lsm:5"] },
        // Well above the floor and still untargetable: SIG-034 is not a size rule.
        { n: 25, tags: ["religion:observant", "region:westerncape"] },
        // Erased people. Twenty of them — enough to clear the floor on their
        // own, so if they are ever counted the cell appears and every
        // expectation above moves with it.
        { n: 20, tags: ["region:limpopo"], deleted: true }
      ]),
      ...customers(OTHER_TENANT, "b", [{ n: 40, tags: ["lsm:9", "region:kzn"] }]),
      ...customers(BARE_TENANT, "c", [{ n: 30, tags: null }])
    ] as never
  );
}, 120_000);

/** A gateway whose only provider is a stub, so the request the engine built is
 *  inspectable on `stub.calls`. */
function gatewayWith(script: Parameters<typeof makeStub>[0]): {
  stub: ReturnType<typeof makeStub>;
  gw: Gateway;
} {
  const stub = makeStub(script);
  return {
    stub,
    gw: new Gateway({ env: {}, providers: { "workers-ai": stub, anthropic: stub, "openai-compat": stub } })
  };
}

/** A reply that names only cells it was shown and states only numbers the
 *  evidence gave it — anything else is dropped by parseAudienceProposal. */
const GROUNDED = JSON.stringify({
  name: "Gauteng upper-middle push",
  summary: "Upper-middle households in Gauteng who are already on the book.",
  selections: [
    { axis: "lsm", value: "7", reason: "30 customers sit in this band, the largest single LSM cell." },
    { axis: "region", value: "gauteng", reason: "55 customers are in this region." }
  ]
});

const userPrompt = (stub: ReturnType<typeof makeStub>): string =>
  stub.calls[0]!.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");

const rowsFor = async (tenant: string) => ({
  audiences: await ctx.db.select().from(schema.signalAudiences).where(eq(schema.signalAudiences.tenantId, tenant)),
  audits: await ctx.db.select().from(schema.auditLog).where(eq(schema.auditLog.tenantId, tenant)),
  events: await ctx.db.select().from(schema.eventOutbox).where(eq(schema.eventOutbox.tenantId, tenant)),
  ai: await ctx.db.select().from(schema.aiAuditLog).where(eq(schema.aiAuditLog.tenantId, tenant))
});

const audienceRow = async (audienceId: string) =>
  (await ctx.db.select().from(schema.signalAudiences).where(eq(schema.signalAudiences.id, audienceId)))[0]!;

interface StoredDefinition {
  all: { field: string; op: string; value: unknown }[];
  targeting: {
    subject: string;
    summary: string;
    lsm: number[];
    demographics: { axis: string; value: string }[];
    reasons: { axis: string; value: string; reason: string; count: number }[];
    estimatedReach: number;
    confidence: number;
    source: string;
    floor: number;
    shownCounts: AttributeCount[];
    evidence: string[];
  };
}

describe("attributeCounts", () => {
  it("suppresses the thin cell and the protected axis, and counts only this tenant", async () => {
    const { counts, bookSize } = await attributeCounts(ctx);
    expect(counts).toEqual(SURVIVING);
    // The seed's own untagged customer is on the book too — the book size is
    // every row, not just the tagged ones.
    expect(bookSize).toBe(91);
  });

  it("keeps one tenant's book out of another's counts", async () => {
    const mine = await attributeCounts(ctx);
    expect(mine.counts.some((c) => c.axis === "lsm" && c.value === "9")).toBe(false);
    expect(mine.counts.some((c) => c.value === "kzn")).toBe(false);

    const theirs = await attributeCounts({ ...ctx, tenantId: OTHER_TENANT });
    expect(theirs.bookSize).toBe(40);
    expect(theirs.counts).toEqual([
      { axis: "lsm", value: "9", count: 40 },
      { axis: "region", value: "kzn", count: 40 }
    ]);
  });

  it("leaves erased customers out of the book, the cells and the reach", async () => {
    const { counts, bookSize } = await attributeCounts(ctx);
    // Twenty soft-deleted rows carry this tag and nothing else does.
    expect(counts.some((c) => c.value === "limpopo")).toBe(false);
    expect(bookSize).toBe(91);
    // And not at a floor low enough to publish a cell of one, either: erasure
    // is not a size rule any more than SIG-034 is.
    const low = await attributeCounts(ctx, 1);
    expect(low.counts.some((c) => c.value === "limpopo")).toBe(false);
  });

  it("takes a caller's floor over the default", async () => {
    const { counts } = await attributeCounts(ctx, 10);
    expect(counts.find((c) => c.axis === "lsm" && c.value === "5")).toEqual({ axis: "lsm", value: "5", count: 10 });
    // Still no protected axis: the floor is a size rule, SIG-034 is not.
    expect(counts.some((c) => c.axis === "religion")).toBe(false);
  });
});

describe("suggestTargeting", () => {
  it("shows the model the surviving cells and nothing else", async () => {
    const { stub, gw } = gatewayWith({ replies: [GROUNDED] });
    await suggestTargeting(ctx, gw, { subject: "household cover", momentum: null, signalCount: null });

    const prompt = userPrompt(stub);
    // Positive first: an empty prompt would pass every absence check below.
    expect(prompt).toContain("Attribute region=gauteng: 55 customers");
    expect(prompt).toContain("Attribute lsm=7: 30 customers");
    expect(prompt).toContain("Attribute lsm=8: 25 customers");
    expect(prompt).toContain("Attribute region=westerncape: 25 customers");
    expect(prompt).toContain("k-anonymity floor of 20");

    // docs/17 §SIG-034: the axis is not a targeting dimension, so the model is
    // never shown that the tenant even holds it.
    expect(prompt).not.toContain("religion");
    expect(prompt).not.toContain("observant");
    // The ten-person cell: below the floor, so it is not on the page either.
    expect(prompt).not.toContain("lsm=5");
    expect(prompt).not.toContain("LSM 5");

    // CLAUDE.md rule 3 — the call is attributed, not anonymous.
    expect(stub.calls[0]!.module).toBe("signal");
    expect(stub.calls[0]!.purpose).toBe("audience.suggest");
    expect(stub.calls[0]!.tier).toBe("reasoning");
  });

  it("accepts a grounded proposal, and stores the rule, the reasons and the counts behind it", async () => {
    const { gw } = gatewayWith({ replies: [GROUNDED] });
    const before = await rowsFor(tenantId);
    const out = await suggestTargeting(ctx, gw, {
      subject: "gauteng household cover",
      momentum: null,
      signalCount: null
    });

    expect(out.source).toBe("ai");
    expect(out.proposal.confidence).toBe(100);
    // Axes intersect and marginals cannot say by how much, so the smallest axis
    // caps it: lsm=7 is 30, region=gauteng is 55.
    expect(out.proposal.estimatedReach).toBe(30);
    expect(out.proposal.lsm).toEqual([7]);
    expect(out.shownCounts).toEqual(SURVIVING);
    expect(out.auditId).not.toBeNull();

    const row = await audienceRow(out.audienceId);
    expect(row.name).toBe("Gauteng upper-middle push");
    expect(row.sizeCached).toBe(30);
    expect(row.consentPurposes).toBe("marketing");
    expect(row.refreshPolicy).toBe("manual");
    expect(row.lastRefreshedAt).toBe(NOW);

    const def = JSON.parse(row.definitionJson) as StoredDefinition;
    expect(def.all).toEqual([
      { field: "customer.attr.lsm", op: "in", value: ["7"] },
      { field: "customer.attr.region", op: "in", value: ["gauteng"] },
      { field: "consent.marketing", op: "eq", value: true }
    ]);
    // The lawful-basis leaf is the last one and is not the model's to omit.
    expect(def.all.at(-1)).toEqual({ field: "consent.marketing", op: "eq", value: true });

    expect(def.targeting.source).toBe("ai");
    expect(def.targeting.floor).toBe(20);
    expect(def.targeting.estimatedReach).toBe(30);
    expect(def.targeting.confidence).toBe(100);
    expect(def.targeting.subject).toBe("gauteng household cover");
    expect(def.targeting.shownCounts).toEqual(SURVIVING);
    // Every selected cell carries the sentence that justifies the spend on it.
    expect(def.targeting.reasons.map((r) => `${r.axis}=${r.value}`)).toEqual(
      def.targeting.demographics.map((d) => `${d.axis}=${d.value}`)
    );
    expect(def.targeting.reasons).toHaveLength(2);
    for (const reason of def.targeting.reasons) expect(reason.reason.length).toBeGreaterThan(0);
    expect(def.targeting.reasons.find((r) => r.axis === "lsm")!.count).toBe(30);
    expect(def.targeting.evidence).toContain("Attribute region=gauteng: 55 customers");
    // Nothing protected and nothing thin survived into what a human will read.
    expect(row.definitionJson).not.toContain("religion");
    expect(row.definitionJson).not.toContain("lsm=5");

    const after = await rowsFor(tenantId);
    const audits = after.audits.filter((a) => a.subjectRef === `signal_audience:${out.audienceId}`);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("signal.audience.suggested");

    // docs/04 §7 — the rest of the platform learns of this on the bus.
    const events = after.events.filter(
      (e) => (JSON.parse(e.envelopeJson) as { subject?: string }).subject === out.audienceId
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("signal.audience.suggested");
    expect((JSON.parse(events[0]!.envelopeJson) as { data: Record<string, unknown> }).data).toMatchObject({
      estimatedReach: 30,
      confidence: 100,
      source: "ai"
    });

    // Exactly one gateway call, and it is the one the engine's auditId names.
    const ai = after.ai.filter((a) => !before.ai.some((b) => b.id === a.id));
    expect(ai).toHaveLength(1);
    expect(ai[0]!.id).toBe(out.auditId);
    expect(ai[0]!.purpose).toBe("audience.suggest");
    expect(ai[0]!.module).toBe("signal");
  });

  it("falls back to the deterministic pool on an unparseable reply, and still writes the audience", async () => {
    const { gw } = gatewayWith({ replies: ["I'm sorry, I can't help with targeting."] });
    const out = await suggestTargeting(ctx, gw, { subject: "unparseable", momentum: null, signalCount: null });

    // docs/15 §4 — the model drafts, it does not gate. A bad reply costs the
    // marketer a good pool, never the feature.
    expect(out.source).toBe("fallback");
    expect(out.proposal.confidence).toBe(0);
    // The call itself happened and was audited, so the failure is inspectable.
    expect(out.auditId).not.toBeNull();

    const row = await audienceRow(out.audienceId);
    expect(row.name).toBe("unparseable — largest reachable segments");
    // Largest cell on each of the two largest axes: region=gauteng 55, lsm=7 30.
    expect(row.sizeCached).toBe(30);
    const def = JSON.parse(row.definitionJson) as StoredDefinition;
    expect(def.targeting.source).toBe("fallback");
    expect(def.targeting.demographics).toEqual([
      { axis: "region", value: "gauteng" },
      { axis: "lsm", value: "7" }
    ]);
    expect(def.all.at(-1)).toEqual({ field: "consent.marketing", op: "eq", value: true });
  });

  it("falls back with no audit id at all when the gateway call throws", async () => {
    const { gw } = gatewayWith({ fail: new Error("workers-ai: AI binding missing") });
    const out = await suggestTargeting(ctx, gw, { subject: "no model", momentum: null, signalCount: null });

    expect(out.source).toBe("fallback");
    expect(out.proposal.confidence).toBe(0);
    expect(out.auditId).toBeNull();

    const row = await audienceRow(out.audienceId);
    expect(row.name).toBe("no model — largest reachable segments");
    expect(row.sizeCached).toBe(30);
    expect(JSON.parse(row.definitionJson).targeting.source).toBe("fallback");
  });

  it("refuses a book with nothing above the floor, and writes nothing at all", async () => {
    const bare = { ...ctx, tenantId: BARE_TENANT };
    const { stub, gw } = gatewayWith({ replies: [GROUNDED] });

    await expect(
      suggestTargeting(bare, gw, { subject: "untagged book", momentum: null, signalCount: null })
    ).rejects.toMatchObject({ status: 409, code: "conflict" });

    // Nothing was proposed, so nothing was asked of a model either.
    expect(stub.calls).toHaveLength(0);
    const after = await rowsFor(BARE_TENANT);
    expect(after.audiences).toHaveLength(0);
    expect(after.audits).toHaveLength(0);
    expect(after.events).toHaveLength(0);
    expect(after.ai).toHaveLength(0);
  });
});

describe("POST /audiences/suggest", () => {
  const app = (actor: Ctx["actor"], gw: Gateway): Hono<App> => {
    const a = new Hono<App>();
    a.onError(onError);
    a.notFound((c) => onError(notFound(c.req.path), c));
    a.use("*", async (c, next) => {
      c.set("ctx", { ...ctx, actor });
      c.set("gateway", gw);
      await next();
    });
    a.route("/", signalRoutes);
    return a;
  };

  const post = async (a: Hono<App>, subject: string) => {
    const res = await a.fetch(
      new Request("http://api.test/audiences/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject })
      })
    );
    return { status: res.status, body: (await res.json()) as Record<string, never> };
  };

  /** Same tenant, narrower grants — `can` refuses another tenant's actor outright,
   *  so the permission itself is what these two vary. */
  const actorWith = (id: string, permissions: string[]): Ctx["actor"] => ({
    kind: "user",
    id,
    tenantId,
    grants: [{ roleKey: "test", permissions: permissions as Ctx["actor"]["grants"][number]["permissions"] }]
  });

  it("refuses an actor without signal:audiences:estimate, and writes nothing", async () => {
    const { stub, gw } = gatewayWith({ replies: [GROUNDED] });
    const before = await rowsFor(tenantId);

    const res = await post(app(actorWith("u_reader", ["signal:audiences:read"]), gw), "forbidden subject");
    expect(res.status).toBe(403);

    expect(stub.calls).toHaveLength(0);
    const after = await rowsFor(tenantId);
    expect(after.audiences).toHaveLength(before.audiences.length);
    expect(after.ai).toHaveLength(before.ai.length);
    expect(after.events).toHaveLength(before.events.length);
  });

  it("suggests for an actor that holds it", async () => {
    const { gw } = gatewayWith({ replies: [GROUNDED] });
    const res = await post(app(actorWith("u_marketer", ["signal:audiences:estimate"]), gw), "routed subject");

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ source: "ai" });
    const row = await audienceRow(res.body.audienceId as unknown as string);
    expect(row.tenantId).toBe(tenantId);
    expect((JSON.parse(row.definitionJson) as StoredDefinition).targeting.subject).toBe("routed subject");
  });
});
