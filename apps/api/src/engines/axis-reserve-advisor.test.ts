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
import { comparableClosedClaims, recommendReserve, writeRecommendedReserve } from "./axis-reserve-advisor.js";

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
  const r = await seed(db, { password: "axis-reserve-test-password-2026" });
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

function stubbedGateway(opts?: { replies?: string[]; fail?: Error }): { stub: ReturnType<typeof makeStub>; gw: Gateway } {
  const stub = makeStub(opts?.fail ? { fail: opts.fail } : opts?.replies ? { replies: opts.replies } : {});
  return { stub, gw: new Gateway({ env: {}, providers: { "workers-ai": stub, anthropic: stub, "openai-compat": stub } }) };
}

type ClaimRow = typeof schema.axisClaims.$inferSelect;

/** A minimal, currently-open claim on the given peril, ready for a reserve recommendation. */
async function seedClaim(opts: { perilCode?: string | null; excessMinor?: number; coverageLimits?: Record<string, number> }): Promise<ClaimRow> {
  const at = ctx.now;
  const id = newId("clm", at);
  const row: ClaimRow = {
    id,
    tenantId,
    policyId: `pol_${id}`,
    customerId: `cust_${id}`,
    caseId: null,
    claimNo: `CLM-${id}`,
    incidentAt: at,
    reportedAt: at,
    amountMinor: null,
    settledMinor: null,
    currency: "AED",
    status: "assessing",
    fnolJson: null,
    assessorRef: null,
    policyVersionId: null,
    coverageState: "in_force",
    coverageCheckedAt: at,
    coverageJson: JSON.stringify({ limits: opts.coverageLimits ?? { thirdParty: 1_000_000 } }),
    perilCode: opts.perilCode ?? "collision",
    causeCode: "third_party",
    catCode: null,
    reserveMinor: 0,
    paidMinor: 0,
    recoveredMinor: 0,
    excessMinor: opts.excessMinor ?? 50_000,
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

/** A closed comparable claim, `monthsAgoClose` months before `ctx.now`. */
async function seedClosedClaim(opts: {
  perilCode: string;
  monthsAgoClosed: number;
  reserveMinor?: number;
  paidMinor?: number;
  settledMinor?: number | null;
}): Promise<ClaimRow> {
  const claim = await seedClaim({ perilCode: opts.perilCode });
  const closedAt = new Date(ctx.now);
  closedAt.setUTCMonth(closedAt.getUTCMonth() - opts.monthsAgoClosed);
  const settledMinor = opts.settledMinor ?? 100_000;
  await ctx.db
    .update(schema.axisClaims)
    .set({
      status: "settled",
      closedAt: closedAt.getTime(),
      reserveMinor: opts.reserveMinor ?? 0,
      paidMinor: opts.paidMinor ?? settledMinor,
      settledMinor
    })
    .where(eq(schema.axisClaims.id, claim.id));
  const [after] = await ctx.db.select().from(schema.axisClaims).where(eq(schema.axisClaims.id, claim.id));
  return (after as ClaimRow | undefined) ?? claim;
}

describe("comparableClosedClaims §G.3", () => {
  it("returns null-peril claims as no comparables at all", async () => {
    const claim = await seedClaim({ perilCode: null });
    const comparables = await comparableClosedClaims(ctx, claim);
    expect(comparables).toEqual([]);
  });

  it("matches same peril, closed within 24 months, excluding this claim and non-closed ones", async () => {
    const claim = await seedClaim({ perilCode: "flood_water" });
    const inWindow = await seedClosedClaim({ perilCode: "flood_water", monthsAgoClosed: 6, settledMinor: 200_000 });
    await seedClosedClaim({ perilCode: "fire", monthsAgoClosed: 6, settledMinor: 300_000 }); // wrong peril
    await seedClosedClaim({ perilCode: "flood_water", monthsAgoClosed: 30, settledMinor: 400_000 }); // outside window
    await seedClaim({ perilCode: "flood_water" }); // never closed

    const comparables = await comparableClosedClaims(ctx, claim);
    expect(comparables.map((c) => c.id)).toEqual([inWindow.id]);
  });
});

describe("recommendReserve / writeRecommendedReserve §G.3", () => {
  it("writes a below-threshold recommendation straight through, with the agent as setBy", async () => {
    const claim = await seedClaim({ perilCode: "collision" });
    const { gw } = stubbedGateway({
      replies: ['{"recommendedMinor":120000,"bandLowMinor":90000,"bandHighMinor":150000,"comparables":[]}']
    });

    const result = await writeRecommendedReserve(ctx, claim, gw);

    expect(result).not.toBeNull();
    expect(result!.reserve.setBy).toBe("agent:reserve-advisor");
    expect(result!.reserve.basis).toBe("ai_recommended");
    expect(result!.reserve.amountMinor).toBe(120_000);
    expect(result!.reserve.confidence).not.toBeNull();
  });

  it("propagates approval_required for an above-threshold recommendation, writing no reserve row", async () => {
    const claim = await seedClaim({ perilCode: "collision" });
    const { gw } = stubbedGateway({
      replies: ['{"recommendedMinor":6000000,"bandLowMinor":5000000,"bandHighMinor":7000000,"comparables":[]}']
    });

    await expect(writeRecommendedReserve(ctx, claim, gw)).rejects.toMatchObject({ status: 403 });

    const rows = await ctx.db
      .select()
      .from(schema.axisClaimReserves)
      .where(eq(schema.axisClaimReserves.claimId, claim.id));
    expect(rows.length).toBe(0);
  });

  it("recommends nothing and writes nothing when the gateway call fails", async () => {
    const claim = await seedClaim({ perilCode: "collision" });
    const { gw } = stubbedGateway({ fail: new Error("boom") });

    const generated = await recommendReserve(ctx, claim, gw);
    expect(generated).toBeNull();

    const written = await writeRecommendedReserve(ctx, claim, gw);
    expect(written).toBeNull();
  });
});
