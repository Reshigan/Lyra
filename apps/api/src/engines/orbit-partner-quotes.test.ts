import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PolicyJson, EntitlementsJson, schema } from "@lyra/db";
import { decide, permissionsForRole, type Actor, type Ctx } from "@lyra/core";
import { advancePartner } from "./onboarding.js";
import { requestPartnerQuote } from "./orbit-partner-quotes.js";

// docs/05 §Partner & Embedded Platform: "sandbox with mock quotes". No real
// partner adapter exists anywhere in the repo (routes/dist.ts's `quoterFor`
// always returns undefined) — a quote against a sandbox partner must be
// obviously synthetic, and promotion to live must go through the existing
// `dist.partner_activate` approval gate, not a shortcut.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "..", "packages", "db", "migrations");

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

let client: Client;
let ctx: Ctx;

function actor(): Actor {
  return {
    kind: "user",
    id: "amina",
    tenantId: "t_1",
    grants: [{ roleKey: "orbit.partners", permissions: permissionsForRole("orbit.partners") }]
  };
}

async function makeCtx(now = 1_770_000_000_000): Promise<Ctx> {
  return {
    db: drizzle(client) as unknown as Ctx["db"],
    tenantId: "t_1",
    actor: actor(),
    requestId: "req_1",
    now,
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  };
}

async function seedPartner(id: string, patch: Partial<typeof schema.orbitPartners.$inferInsert> = {}) {
  await ctx.db.insert(schema.orbitPartners).values({
    id,
    tenantId: ctx.tenantId,
    name: "Acme Telco",
    kind: "telco",
    revshareJson: JSON.stringify({ pct: 10 }),
    sandboxFlag: true,
    status: "active",
    stage: "sandbox",
    createdAt: ctx.now,
    updatedAt: ctx.now,
    ...patch
  });
}

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  ctx = await makeCtx();
});

describe("requestPartnerQuote", () => {
  it("returns a clearly-marked synthetic quote while the partner is in sandbox mode", async () => {
    await seedPartner("prt_1");

    const result = await requestPartnerQuote(ctx, "prt_1", {
      productLine: "motor",
      amountMinor: 100_000,
      currency: "AED"
    });

    expect(result.mode).toBe("sandbox");
    expect(result.synthetic).toBe(true);
    expect(result.quotedPremiumMinor).toBeGreaterThan(0);

    const txns = await ctx.db
      .select()
      .from(schema.orbitPartnerTxns)
      .where(and(eq(schema.orbitPartnerTxns.tenantId, ctx.tenantId), eq(schema.orbitPartnerTxns.partnerId, "prt_1")));
    expect(txns).toHaveLength(1);
    expect(txns[0]!.kind).toBe("quote");
    expect(txns[0]!.revshareCalcMinor).toBe(Math.round(txns[0]!.amountMinor * 0.1));
  });

  it("never touches a real integration — same synthetic pricing function regardless of partner", async () => {
    await seedPartner("prt_a", { name: "Bank A" });
    await seedPartner("prt_b", { name: "Bank B", revshareJson: null });

    const a = await requestPartnerQuote(ctx, "prt_a", { productLine: "motor", amountMinor: 200_000, currency: "AED" });
    const b = await requestPartnerQuote(ctx, "prt_b", { productLine: "motor", amountMinor: 200_000, currency: "AED" });
    expect(a.quotedPremiumMinor).toBe(b.quotedPremiumMinor);
    expect(b.quotedPremiumMinor).toBeGreaterThan(0);
  });

  it("blocks promotion to live without the dist.partner_activate approval, then marks quotes live-mode once approved", async () => {
    await seedPartner("prt_2");
    // advancePartner walks the ladder one rung at a time; put the partner one
    // step short of `live` so the very next call is the consequential one.
    await ctx.db
      .update(schema.orbitPartners)
      .set({ stage: "sandbox" })
      .where(eq(schema.orbitPartners.id, "prt_2"));

    await expect(advancePartner(ctx, "prt_2")).rejects.toMatchObject({ status: 403, code: "approval_required" });

    const stillSandbox = await requestPartnerQuote(ctx, "prt_2", {
      productLine: "motor",
      amountMinor: 100_000,
      currency: "AED"
    });
    expect(stillSandbox.mode).toBe("sandbox");

    const approvals = await ctx.db.select().from(schema.approvals);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.policyKey).toBe("dist.partner_activate");

    await decide(ctx, approvals[0]!.id, "approved", "diligence complete");
    const { stage } = await advancePartner(ctx, "prt_2");
    expect(stage).toBe("live");

    const live = await requestPartnerQuote(ctx, "prt_2", {
      productLine: "motor",
      amountMinor: 100_000,
      currency: "AED"
    });
    expect(live.mode).toBe("live");
    expect(live.synthetic).toBe(false);
  });

  it("rejects a quote for a suspended partner", async () => {
    await seedPartner("prt_3", { status: "suspended", suspendedAt: 1, suspendedReason: "billing dispute" });
    await expect(
      requestPartnerQuote(ctx, "prt_3", { productLine: "motor", amountMinor: 100_000, currency: "AED" })
    ).rejects.toMatchObject({ status: 409 });
  });
});
