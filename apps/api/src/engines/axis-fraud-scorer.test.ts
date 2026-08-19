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
import { claimDocuments, holderClaimHistory, scoreAndReferClaim, scoreFraud } from "./axis-fraud-scorer.js";

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
  const r = await seed(db, { password: "axis-fraud-test-password-2026" });
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

function stubbedGateway(opts?: { replies?: string[]; fail?: Error }): { gw: Gateway; stub: ReturnType<typeof makeStub> } {
  const stub = makeStub(opts?.fail ? { fail: opts.fail } : opts?.replies ? { replies: opts.replies } : {});
  return { gw: new Gateway({ env: {}, providers: { "workers-ai": stub, anthropic: stub, "openai-compat": stub } }), stub };
}

/** `stub.calls` records what the provider was handed — i.e. after the gateway scrubbed it. */
function lastPromptSentToProvider(stub: ReturnType<typeof makeStub>, n = 0): string {
  return stub.calls[n]!.messages.at(-1)!.content;
}

// 2026-06-16T01:00:00.000Z. Chosen because its epoch-ms form passes Luhn, which is
// what makes it a live round-trip test: sent raw it is a 13-digit run the CARD rule
// redacts to `[[CARD_1]]`, and the model then scores a claim with no incident date.
const LUHN_MS = 1_781_571_600_000;

type ClaimRow = typeof schema.axisClaims.$inferSelect;

/** A minimal, currently-open claim ready for fraud scoring. */
async function seedClaim(opts: {
  customerId?: string;
  caseId?: string | null;
  amountMinor?: number | null;
  incidentAt?: number;
  reportedAt?: number;
}): Promise<ClaimRow> {
  const at = ctx.now;
  const id = newId("clm", at);
  const row: ClaimRow = {
    id,
    tenantId,
    policyId: `pol_${id}`,
    customerId: opts.customerId ?? `cust_${id}`,
    caseId: opts.caseId ?? null,
    claimNo: `CLM-${id}`,
    incidentAt: opts.incidentAt ?? at,
    reportedAt: opts.reportedAt ?? at,
    amountMinor: opts.amountMinor ?? 100_000,
    settledMinor: null,
    currency: "AED",
    status: "assessing",
    fnolJson: null,
    assessorRef: null,
    policyVersionId: null,
    coverageState: "in_force",
    coverageCheckedAt: at,
    coverageJson: JSON.stringify({ limits: { thirdParty: 1_000_000 } }),
    perilCode: "collision",
    causeCode: "third_party",
    catCode: null,
    reserveMinor: 0,
    paidMinor: 0,
    recoveredMinor: 0,
    excessMinor: 50_000,
    handlerRef: null,
    slaDueAt: null,
    fraudScore: null,
    siuState: null,
    complexity: "standard",
    reopenedAt: null,
    closedAt: null,
    lastTxnId: null,
    createdAt: at,
    updatedAt: at
  };
  await ctx.db.insert(schema.axisClaims).values(row);
  return row;
}

async function seedDocument(caseId: string, opts?: { docType?: string; extractionConfidence?: number | null }) {
  const at = ctx.now;
  const id = newId("doc", at);
  await ctx.db.insert(schema.axisDocuments).values({
    id,
    tenantId,
    caseId,
    fileId: `file_${id}`,
    docType: opts?.docType ?? "other",
    extractionJson: null,
    extractionConfidence: opts?.extractionConfidence ?? null,
    extractionModel: null,
    verifiedBy: null,
    verifiedAt: null,
    status: "received",
    createdAt: at
  });
  return id;
}

describe("holderClaimHistory / claimDocuments §G.2", () => {
  it("returns other claims by the same holder, excluding this one, most recent first", async () => {
    const customerId = `cust_${newId("clm", ctx.now)}`;
    const claim = await seedClaim({ customerId });
    const older = await seedClaim({ customerId });
    const other = await seedClaim({}); // different holder

    const history = await holderClaimHistory(ctx, claim);
    expect(history.map((h) => h.id)).toEqual([older.id]);
    expect(history.map((h) => h.id)).not.toContain(other.id);
  });

  it("returns no documents when the claim has no case", async () => {
    const claim = await seedClaim({ caseId: null });
    expect(await claimDocuments(ctx, claim)).toEqual([]);
  });

  it("returns documents for the claim's case", async () => {
    const caseId = `case_${newId("cas", ctx.now)}`;
    const claim = await seedClaim({ caseId });
    const docId = await seedDocument(caseId);

    const docs = await claimDocuments(ctx, claim);
    expect(docs.map((d) => d.id)).toEqual([docId]);
  });
});

describe("scoreFraud / scoreAndReferClaim §G.2", () => {
  it("recommends nothing and writes nothing when the gateway call fails", async () => {
    const claim = await seedClaim({});
    const { gw } = stubbedGateway({ fail: new Error("boom") });

    expect(await scoreFraud(ctx, claim, gw)).toBeNull();
    expect(await scoreAndReferClaim(ctx, claim, gw)).toBeNull();

    const [after] = await ctx.db.select().from(schema.axisClaims).where(eq(schema.axisClaims.id, claim.id));
    expect(after!.fraudScore).toBeNull();
  });

  it("stamps a below-threshold score onto the claim without opening a referral", async () => {
    const claim = await seedClaim({});
    const { gw } = stubbedGateway({
      replies: ['{"score":20,"indicators":[{"code":"late_report","weight":20,"evidenceRef":"reportedAt"}]}']
    });

    const outcome = await scoreAndReferClaim(ctx, claim, gw);
    expect(outcome).toEqual({ score: 20, referral: null });

    const [after] = await ctx.db.select().from(schema.axisClaims).where(eq(schema.axisClaims.id, claim.id));
    expect(after!.fraudScore).toBe(20);
    expect(after!.siuState).toBeNull();
  });

  it("opens a referral and flags the claim when the score crosses the threshold", async () => {
    const claim = await seedClaim({});
    const { gw } = stubbedGateway({
      replies: [
        '{"score":80,"indicators":[' +
          '{"code":"repeat_holder_claims","weight":40,"evidenceRef":"history"},' +
          '{"code":"amount_near_limit","weight":40,"evidenceRef":"amountMinor"}' +
          "]}"
      ]
    });

    const outcome = await scoreAndReferClaim(ctx, claim, gw);
    expect(outcome!.score).toBe(80);
    expect(outcome!.referral).not.toBeNull();
    expect(outcome!.referral!.state).toBe("open");
    expect(outcome!.referral!.source).toBe("model");
    expect(JSON.parse(outcome!.referral!.reasonsJson)).toEqual([
      { indicator: "repeat_holder_claims", weight: 40, evidenceRef: "history" },
      { indicator: "amount_near_limit", weight: 40, evidenceRef: "amountMinor" }
    ]);

    const [after] = await ctx.db.select().from(schema.axisClaims).where(eq(schema.axisClaims.id, claim.id));
    expect(after!.fraudScore).toBe(80);
    expect(after!.siuState).toBe("referred");
  });

  it("never opens a second referral for a claim that already has one (axis_siu_claim_uq)", async () => {
    const claim = await seedClaim({});
    const { gw } = stubbedGateway({
      replies: [
        '{"score":90,"indicators":[{"code":"repeat_holder_claims","weight":90,"evidenceRef":"history"}]}',
        '{"score":95,"indicators":[{"code":"repeat_holder_claims","weight":95,"evidenceRef":"history"}]}'
      ]
    });

    const first = await scoreAndReferClaim(ctx, claim, gw);
    expect(first!.referral).not.toBeNull();

    const second = await scoreAndReferClaim(ctx, claim, gw);
    expect(second!.referral).toBeNull();

    const rows = await ctx.db.select().from(schema.axisSiuReferrals).where(eq(schema.axisSiuReferrals.claimId, claim.id));
    expect(rows.length).toBe(1);
  });

  it("sends the incident date as a date the model can read, not an epoch run the scrubber eats", async () => {
    const claim = await seedClaim({ incidentAt: LUHN_MS, reportedAt: LUHN_MS + 86_400_000 });
    const { gw, stub } = stubbedGateway({ replies: ['{"score":10,"indicators":[]}'] });

    await scoreFraud(ctx, claim, gw);

    const sent = lastPromptSentToProvider(stub);
    expect(sent).toContain("2026-06-16T01:00:00.000Z");
    expect(sent).toContain("2026-06-17T01:00:00.000Z");
    expect(sent, "an epoch instant reached the scrubber and was redacted as a card number").not.toContain("[[CARD_");
  });

  it("still scores a claim whose stored instant is outside the range a Date can hold", async () => {
    // FNOL rejects these at the door now, but rows predate that bound and a
    // backfill can write anything. The failure mode here is the quiet one:
    // `new Date(9e15).toISOString()` throws, `scoreFraud`'s catch returns null,
    // and the claim goes unscored with no error anywhere. `promptInstant` renders
    // it "unknown" instead, so the rest of the claim is still assessed.
    const claim = await seedClaim({ incidentAt: 9e15 });
    const { gw, stub } = stubbedGateway({
      replies: ['{"score":30,"indicators":[{"code":"late_report","weight":30,"evidenceRef":"reportedAt"}]}']
    });

    const scored = await scoreFraud(ctx, claim, gw);
    expect(scored, "an unrenderable instant silently disabled fraud scoring").not.toBeNull();
    expect(scored!.result.score).toBe(30);
    expect(lastPromptSentToProvider(stub)).toContain("unknown");
  });

  it("drops indicators with no evidenceRef and forces the score to zero when none survive", async () => {
    const claim = await seedClaim({});
    const { gw } = stubbedGateway({
      replies: ['{"score":85,"indicators":[{"code":"vibes","weight":85}]}']
    });

    const outcome = await scoreAndReferClaim(ctx, claim, gw);
    expect(outcome).toEqual({ score: 0, referral: null });
  });
});
