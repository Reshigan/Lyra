import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, desc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { id as newId, schema } from "@lyra/db";
import { EntitlementsJson, PolicyJson } from "@lyra/db";
import { permissionsForRole, seed, type Ctx } from "@lyra/core";
import { Gateway, makeStub } from "@lyra/model-gateway";
import { sweepConversationDrafts } from "./orbit-draft.js";

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
  const r = await seed(db, { password: "orbit-draft-test-password-2026" });
  tenantId = r.tenantId;
  ctx = {
    db,
    tenantId,
    actor: {
      kind: "user",
      id: "u_1",
      tenantId,
      grants: [{ roleKey: "orbit.admin", permissions: permissionsForRole("orbit.admin") }]
    },
    requestId: "req_1",
    now: Date.UTC(2026, 5, 1, 9, 0, 0),
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  };
}, 120_000);

// The seed ships its own ORBIT inbox, including a hand-written pending draft.
// Clearing it makes every assertion here about the rows this file wrote.
beforeEach(async () => {
  await ctx.db.delete(schema.orbitMessages);
  await ctx.db.delete(schema.orbitConversations);
  await ctx.db.delete(schema.aiRuns);
});

function gatewayWith(reply: string): Gateway {
  const stub = makeStub({ replies: [reply] });
  return new Gateway({ env: {}, providers: { "workers-ai": stub, anthropic: stub, "openai-compat": stub } });
}

/** A conversation whose newest message is the customer's — the only shape the
 *  sweep drafts for. Returns the conversation id. */
async function seedWaitingConversation(question = "How much is my renewal?"): Promise<string> {
  const customerId = newId("cus", ctx.now);
  await ctx.db.insert(schema.customers).values({
    id: customerId,
    tenantId,
    type: "person",
    nameJson: JSON.stringify({ en: "Amina Haddad" }),
    kycStatus: "verified",
    locale: "en",
    createdAt: ctx.now,
    updatedAt: ctx.now
  } as never);

  const convId = newId("cnv", ctx.now);
  await ctx.db.insert(schema.orbitConversations).values({
    id: convId,
    tenantId,
    customerId,
    channel: "whatsapp",
    state: "bot",
    lang: "en",
    lastMessageAt: ctx.now - 60_000,
    createdAt: ctx.now - 60_000,
    updatedAt: ctx.now - 60_000
  } as never);

  await ctx.db.insert(schema.orbitMessages).values({
    id: newId("omg", ctx.now),
    tenantId,
    conversationId: convId,
    role: "customer",
    modality: "text",
    content: question,
    ts: ctx.now - 60_000
  } as never);

  return convId;
}

const messagesOf = async (convId: string): Promise<(typeof schema.orbitMessages.$inferSelect)[]> =>
  ctx.db
    .select()
    .from(schema.orbitMessages)
    .where(and(eq(schema.orbitMessages.tenantId, tenantId), eq(schema.orbitMessages.conversationId, convId)))
    .orderBy(desc(schema.orbitMessages.ts));

describe("sweepConversationDrafts", () => {
  it("drafts a pending reply for a conversation waiting on us", async () => {
    const convId = await seedWaitingConversation();

    const drafted = await sweepConversationDrafts(ctx, gatewayWith("I will confirm the renewal figure shortly."));
    expect(drafted).toBe(1);

    const [newest] = await messagesOf(convId);
    expect(newest?.role).toBe("agent_ai");
    // No deliveryStatus is what makes it a draft the inbox offers for approval.
    expect(newest?.deliveryStatus).toBeNull();
    expect(newest?.aiAuditId).toBeTruthy();

    const [run] = await ctx.db.select().from(schema.aiRuns).where(eq(schema.aiRuns.subjectRef, convId));
    expect(run?.state).toBe("succeeded");
    expect(run?.trigger).toBe("schedule");
    expect(run?.outputRef).toBe(newest?.aiAuditId);
  });

  it("does not draft twice — the draft itself is the guard", async () => {
    await seedWaitingConversation();
    expect(await sweepConversationDrafts(ctx, gatewayWith("I will confirm shortly."))).toBe(1);
    expect(await sweepConversationDrafts(ctx, gatewayWith("Second draft."))).toBe(0);
  });

  it("refuses a draft that states a number the context never gave", async () => {
    const convId = await seedWaitingConversation();

    const drafted = await sweepConversationDrafts(ctx, gatewayWith("Your renewal premium is 2650 AED."));
    expect(drafted).toBe(0);

    const [newest] = await messagesOf(convId);
    expect(newest?.role).toBe("customer");

    const [run] = await ctx.db.select().from(schema.aiRuns).where(eq(schema.aiRuns.subjectRef, convId));
    expect(run?.state).toBe("refused");
    expect(run?.confidence).toBeLessThan(95);
  });

  it("skips the sweep when the drafting agent is paused", async () => {
    await seedWaitingConversation();
    await ctx.db
      .update(schema.aiAgents)
      .set({ status: "paused" })
      .where(and(eq(schema.aiAgents.tenantId, tenantId), eq(schema.aiAgents.key, "service")));

    expect(await sweepConversationDrafts(ctx, gatewayWith("Anything at all."))).toBe(0);

    await ctx.db
      .update(schema.aiAgents)
      .set({ status: "active" })
      .where(and(eq(schema.aiAgents.tenantId, tenantId), eq(schema.aiAgents.key, "service")));
  });

  // Regression: `isoDay` was `new Date(ms).toISOString()`, which throws
  // RangeError outside ±8.64e15. It runs inside `buildContext`, i.e. *before*
  // the aiRuns insert and outside draftReply's try — so the throw landed in the
  // sweep's own catch and that customer was skipped on every tick, forever,
  // with no run row and no error code to see it by.
  it("gives the model a whole day for an expiry outside the four-digit years", async () => {
    // `promptInstant` has a third return the docstring on `isoDay` did not
    // count: an in-range instant far enough from now that ISO-8601 uses the
    // expanded year form, `-251540-02-03T09:46:40.000Z` — what a bad import or a
    // sign flip puts in a date column. Ten characters of that is `-251540-02`, a
    // month with no day, handed to the model as if it were a whole date.
    const convId = await seedWaitingConversation();
    const [conv] = await ctx.db
      .select()
      .from(schema.orbitConversations)
      .where(eq(schema.orbitConversations.id, convId));

    await ctx.db.insert(schema.axisPolicies).values({
      id: newId("pol", ctx.now),
      tenantId,
      customerId: conv!.customerId!,
      providerId: "prv_wide",
      policyNo: "POL-WIDE-1",
      startAt: -8e15,
      endAt: ctx.now + 365 * 86_400_000,
      premiumMinor: 100_000,
      currency: "AED",
      status: "active",
      createdAt: ctx.now,
      updatedAt: ctx.now
    } as never);

    const stub = makeStub({ replies: ["I will confirm shortly."] });
    const gateway = new Gateway({ env: {}, providers: { "workers-ai": stub, anthropic: stub, "openai-compat": stub } });
    expect(await sweepConversationDrafts(ctx, gateway)).toBe(1);

    const sent = stub.calls[0]!.messages.map((m) => m.content).join("\n");
    expect(sent).toContain("-251540-02-03");
  });

  it("still drafts when a policy carries an instant no Date can hold", async () => {
    const convId = await seedWaitingConversation();
    const [conv] = await ctx.db
      .select()
      .from(schema.orbitConversations)
      .where(eq(schema.orbitConversations.id, convId));

    await ctx.db.insert(schema.axisPolicies).values({
      id: newId("pol", ctx.now),
      tenantId,
      customerId: conv!.customerId!,
      providerId: "prv_range",
      policyNo: "POL-RANGE-1",
      startAt: ctx.now,
      endAt: 9e15,
      premiumMinor: 100_000,
      currency: "AED",
      status: "active",
      createdAt: ctx.now,
      updatedAt: ctx.now
    } as never);

    expect(await sweepConversationDrafts(ctx, gatewayWith("I will confirm shortly."))).toBe(1);

    const [run] = await ctx.db.select().from(schema.aiRuns).where(eq(schema.aiRuns.subjectRef, convId));
    expect(run?.state).toBe("succeeded");
  });
});
