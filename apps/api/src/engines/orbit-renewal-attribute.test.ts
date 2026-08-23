import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PolicyJson, EntitlementsJson, schema } from "@lyra/db";
import { permissionsForRole, type Actor, type Ctx, type Envelope } from "@lyra/core";
import { onRenewalDecided, saveRateByStrategy } from "./orbit-renewal-attribute.js";

// The retention loop's write half. These tests pin what the quality screen
// stands on: a decided renewal folds in the campaign-window conversations
// and their latest QA score, an unscored conversation contributes nothing
// rather than a zero, and the by-strategy save-rate keeps both denominators
// so a two-sample comparison can be refused as noise.

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
const NOW = Date.parse("2026-08-20T12:00:00Z");

function actor(): Actor {
  return {
    kind: "system",
    id: "scheduler",
    tenantId: "t_1",
    grants: [{ roleKey: "tenant.admin", permissions: permissionsForRole("tenant.admin") }]
  };
}

async function makeCtx(now = NOW): Promise<Ctx> {
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

function decidedEvent(renewalId: string, outcome: "accepted" | "lost"): Envelope {
  return {
    id: `evt_${Math.random().toString(36).slice(2, 8)}`,
    ts: ctx.now,
    tenant_id: ctx.tenantId,
    module: "orbit",
    type: outcome === "accepted" ? "orbit.renewal.accepted" : "orbit.renewal.lost",
    actor: "system:portal",
    subject: renewalId,
    data: { policyRef: "pol_1", customerId: "cus_1" },
    v: 1
  };
}

let n = 0;

async function seedRenewal(opts: { state?: string; strategy?: string; customerId?: string; decidedAt?: number | null } = {}): Promise<string> {
  const id = `ren_${++n}`;
  await ctx.db.insert(schema.orbitRenewals).values({
    id,
    tenantId: "t_1",
    policyRef: `pol_${n}`,
    customerId: opts.customerId ?? "cus_1",
    expiryAt: NOW + 30 * 86_400_000,
    strategy: opts.strategy ?? "human",
    state: opts.state ?? "accepted",
    outcomeReason: opts.state === "lost" ? "customer_declined" : "customer_accepted",
    ownerRef: "user:1",
    decidedAt: opts.decidedAt === undefined ? NOW : opts.decidedAt,
    createdAt: NOW - 40 * 86_400_000,
    updatedAt: NOW
  });
  return id;
}

async function seedConversation(customerId: string, createdAt: number): Promise<string> {
  const id = `conv_${Math.random().toString(36).slice(2, 8)}`;
  await ctx.db.insert(schema.orbitConversations).values({
    id,
    tenantId: "t_1",
    customerId,
    channel: "whatsapp",
    state: "closed",
    lang: "en",
    createdAt,
    updatedAt: createdAt
  });
  return id;
}

async function seedQaScore(conversationId: string, score: number): Promise<void> {
  await ctx.db.insert(schema.orbitQaScores).values({
    id: `qa_${Math.random().toString(36).slice(2, 8)}`,
    tenantId: "t_1",
    conversationId,
    rubricKey: "resolution",
    score,
    scoredBy: "agent:qa",
    ts: NOW
  });
}

beforeEach(async () => {
  n = 0;
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  ctx = await makeCtx();
});

describe("onRenewalDecided", () => {
  it("attributes an accepted renewal with its campaign-window QA score", async () => {
    const renewalId = await seedRenewal();
    const convId = await seedConversation("cus_1", NOW - 5 * 86_400_000);
    await seedQaScore(convId, 88);

    const attribution = await onRenewalDecided(ctx, decidedEvent(renewalId, "accepted"));
    expect(attribution).toMatchObject({
      renewalId,
      outcome: "accepted",
      conversationCount: 1,
      qaScore: 88,
      strategy: "human"
    });
  });

  it("counts zero conversations when the customer renewed without talking to us — and says so rather than skipping", async () => {
    const renewalId = await seedRenewal();
    const attribution = await onRenewalDecided(ctx, decidedEvent(renewalId, "accepted"));
    expect(attribution).not.toBeNull();
    expect(attribution?.conversationCount).toBe(0);
    expect(attribution?.qaScore).toBeNull();
  });

  it("ignores conversations outside the campaign window", async () => {
    const renewalId = await seedRenewal();
    // 60 days ago — outside the 45-day window.
    await seedConversation("cus_1", NOW - 60 * 86_400_000);

    const attribution = await onRenewalDecided(ctx, decidedEvent(renewalId, "accepted"));
    expect(attribution?.conversationCount).toBe(0);
  });

  it("an unscored conversation contributes nothing rather than a zero", async () => {
    const renewalId = await seedRenewal();
    await seedConversation("cus_1", NOW - 5 * 86_400_000); // never scored

    const attribution = await onRenewalDecided(ctx, decidedEvent(renewalId, "lost"));
    expect(attribution?.qaScore).toBeNull();
  });

  it("attributes lost renewals too — the loop covers failures, not just saves", async () => {
    const renewalId = await seedRenewal({ state: "lost" });
    const attribution = await onRenewalDecided(ctx, decidedEvent(renewalId, "lost"));
    expect(attribution?.outcome).toBe("lost");
  });

  it("returns null for events that are not renewal outcomes", async () => {
    expect(await onRenewalDecided(ctx, { ...decidedEvent("ren_x", "accepted"), type: "axis.policy.issued" })).toBeNull();
  });
});

describe("saveRateByStrategy", () => {
  it("keeps both denominators per strategy", async () => {
    await seedRenewal({ strategy: "auto_requote", state: "accepted" });
    await seedRenewal({ strategy: "auto_requote", state: "lost" });
    await seedRenewal({ strategy: "auto_requote", state: "accepted" });
    await seedRenewal({ strategy: "human", state: "lost" });

    const rates = await saveRateByStrategy(ctx, NOW - 86_400_000);
    const auto = rates.find((r) => r.strategy === "auto_requote");
    const human = rates.find((r) => r.strategy === "human");
    expect(auto).toMatchObject({ decided: 3, accepted: 2 });
    expect(human).toMatchObject({ decided: 1, accepted: 0 });
  });

  it("excludes undecided renewals from both denominators", async () => {
    await seedRenewal({ state: "accepted" });
    await seedRenewal({ state: "offered" }); // not decided yet

    const rates = await saveRateByStrategy(ctx, NOW - 86_400_000);
    expect(rates[0]?.decided).toBe(1);
  });
});
