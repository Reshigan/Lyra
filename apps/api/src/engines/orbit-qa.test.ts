import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PolicyJson, EntitlementsJson, schema } from "@lyra/db";
import { permissionsForRole, type Actor, type Ctx } from "@lyra/core";
import { CX_JUDGE_VERSION, Gateway, makeStub } from "@lyra/model-gateway";
import { sweepQaScores } from "./orbit-qa.js";

// The QA agent's scoring sweep. These tests pin the contract the coaching
// reads: only closed conversations get scored, an already-scored one is
// never re-scored, a conversation with no agent reply cannot be judged for
// reply quality, and scores land under `agent:qa` on the cx-judge rubric so
// Team Lead review and coaching work unchanged.

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

function judgeGateway(score5: number | Record<string, number>) {
  const reply = JSON.stringify(
    typeof score5 === "number"
      ? Object.fromEntries(["accuracy", "clarity", "tone", "actionability"].map((k) => [k, score5]))
      : score5
  );
  const stub = makeStub({ replies: [reply] });
  return new Gateway({ env: {}, providers: { "workers-ai": stub, anthropic: stub, "openai-compat": stub } });
}

async function seedConversation(opts: { state?: string; withReply?: boolean; withCustomerMsg?: boolean } = {}): Promise<string> {
  const id = `cnv_${Math.random().toString(36).slice(2, 8)}`;
  await ctx.db.insert(schema.orbitConversations).values({
    id,
    tenantId: "t_1",
    customerId: "cus_1",
    channel: "whatsapp",
    state: opts.state ?? "closed",
    lang: "en",
    createdAt: NOW - 86_400_000,
    updatedAt: NOW
  });
  if (opts.withCustomerMsg !== false) {
    await ctx.db.insert(schema.orbitMessages).values({
      id: `msg_c_${Math.random().toString(36).slice(2, 6)}`,
      tenantId: "t_1",
      conversationId: id,
      role: "customer",
      modality: "text",
      content: "I need help with my policy",
      ts: NOW - 3_600_000
    });
  }
  if (opts.withReply !== false) {
    await ctx.db.insert(schema.orbitMessages).values({
      id: `msg_a_${Math.random().toString(36).slice(2, 6)}`,
      tenantId: "t_1",
      conversationId: id,
      role: "agent_human",
      modality: "text",
      content: "Here is exactly what happens next with your policy.",
      ts: NOW - 1_800_000
    });
  }
  return id;
}

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  ctx = await makeCtx();
  // The seeded `qa` agent row the sweep resolves its tier and prompt from.
  await ctx.db.insert(schema.aiAgents).values({
    id: "agt_qa",
    tenantId: "t_1",
    key: "qa",
    module: "core",
    nameJson: JSON.stringify({ en: "Quality reviewer" }),
    autonomyLevel: "suggest",
    tier: "standard",
    promptRef: null,
    createdAt: NOW,
    updatedAt: NOW
  });
});

describe("sweepQaScores", () => {
  it("scores closed conversations under agent:qa on the 0-100 scale", async () => {
    const convId = await seedConversation();
    const scored = await sweepQaScores(ctx, judgeGateway(4));
    expect(scored).toBe(1);

    const [row] = await ctx.db.select().from(schema.orbitQaScores).where(eq(schema.orbitQaScores.conversationId, convId));
    expect(row?.scoredBy).toBe("agent:qa");
    expect(row?.score).toBe(80); // 4/5 → 80/100
    expect(row?.rubricKey).toBe("cx_judge");
  });

  // ADR-0074. Under v1 this reply — clear, warm, actionable, and inventing a
  // payout figure — stored 80/100 with the accuracy score discarded, so nobody
  // reviewing the QA wall could see what was wrong with it.
  it("caps a fluent fabrication at its accuracy score and stores the breakdown", async () => {
    const convId = await seedConversation();
    const dimensions = { accuracy: 1, clarity: 5, tone: 5, actionability: 5 };
    expect(await sweepQaScores(ctx, judgeGateway(dimensions))).toBe(1);

    const [row] = await ctx.db.select().from(schema.orbitQaScores).where(eq(schema.orbitQaScores.conversationId, convId));
    expect(row?.score).toBe(20); // 1/5, not the 4.0 mean
    expect(JSON.parse(row!.breakdownJson!)).toEqual({
      judgeVersion: CX_JUDGE_VERSION,
      score5: 1,
      dimensions
    });
  });

  it("never re-scores a conversation that already has a QA score", async () => {
    const convId = await seedConversation();
    expect(await sweepQaScores(ctx, judgeGateway(4))).toBe(1);
    expect(await sweepQaScores(ctx, judgeGateway(2))).toBe(0);

    const rows = await ctx.db.select().from(schema.orbitQaScores).where(eq(schema.orbitQaScores.conversationId, convId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.score).toBe(80); // first verdict stands
  });

  it("skips open conversations — judging an unfinished story is wrong", async () => {
    await seedConversation({ state: "bot" });
    expect(await sweepQaScores(ctx, judgeGateway(4))).toBe(0);
  });

  it("skips conversations with no agent reply — nothing to judge for quality", async () => {
    await seedConversation({ withReply: false });
    expect(await sweepQaScores(ctx, judgeGateway(4))).toBe(0);
    expect(await ctx.db.select().from(schema.orbitQaScores)).toHaveLength(0);
  });
});
