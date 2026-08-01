import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PolicyJson, EntitlementsJson, schema } from "@lyra/db";
import { permissionsForRole, sha256Hex, type Actor, type Ctx } from "@lyra/core";
import { executeOrbitToolCalls, ORBIT_TOOL_DEFS, orbitToolsFor, runOrbitTool } from "./orbit-tools.js";

// docs/15. ORBIT's agent acts through these handlers, not raw SQL in the AI
// route — so the registry is tested on its own, no HTTP, no model gateway.

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
    kind: "agent",
    id: "quoting",
    tenantId: "t_1",
    grants: [{ roleKey: "axis.agent", permissions: permissionsForRole("axis.agent") }]
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

async function seedPolicy(id: string, tenantId = ctx.tenantId) {
  await ctx.db.insert(schema.axisPolicies).values({
    id,
    tenantId,
    customerId: "cus_1",
    providerId: "prv_1",
    policyNo: `POL-${id}`,
    startAt: ctx.now,
    endAt: ctx.now + 365 * 86_400_000,
    premiumMinor: 500_00,
    currency: "AED",
    createdAt: ctx.now,
    updatedAt: ctx.now
  });
}

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  ctx = await makeCtx();
});

describe("fetch_policy", () => {
  it("returns a policy by id, scoped to the tenant", async () => {
    await seedPolicy("pol_1");
    const result = (await runOrbitTool(ctx, "fetch_policy", { policyId: "pol_1" })) as { id: string };
    expect(result.id).toBe("pol_1");
  });

  it("returns a policy by policy number", async () => {
    await seedPolicy("pol_2");
    const result = (await runOrbitTool(ctx, "fetch_policy", { policyNo: "POL-pol_2" })) as { id: string };
    expect(result.id).toBe("pol_2");
  });

  it("never returns another tenant's policy", async () => {
    await seedPolicy("pol_3", "t_other");
    await expect(runOrbitTool(ctx, "fetch_policy", { policyId: "pol_3" })).rejects.toMatchObject({
      status: 404
    });
  });

  it("rejects a call with neither id nor number", async () => {
    await expect(runOrbitTool(ctx, "fetch_policy", {})).rejects.toMatchObject({ status: 400 });
  });
});

describe("start_quote", () => {
  it("opens an intake case, not a bind — no money moves yet", async () => {
    const result = (await runOrbitTool(ctx, "start_quote", {
      customerId: "cus_1",
      productLine: "motor"
    })) as { id: string; kind: string; status: string; source: string };
    expect(result.kind).toBe("quote");
    expect(result.status).toBe("intake");
    expect(result.source).toBe("agent");

    const rows = await ctx.db
      .select()
      .from(schema.axisCases)
      .where(and(eq(schema.axisCases.tenantId, ctx.tenantId), eq(schema.axisCases.id, result.id)));
    expect(rows).toHaveLength(1);
  });

  it("is not consequential — no approval required", () => {
    const def = ORBIT_TOOL_DEFS.find((t) => t.name === "start_quote")!;
    expect(def.consequential).toBe(false);
  });
});

describe("create_endorsement_request", () => {
  it("is flagged consequential", () => {
    const def = ORBIT_TOOL_DEFS.find((t) => t.name === "create_endorsement_request")!;
    expect(def.consequential).toBe(true);
  });

  it("blocks on approval_required and writes no case until one exists", async () => {
    await seedPolicy("pol_4");
    await expect(
      runOrbitTool(ctx, "create_endorsement_request", {
        policyId: "pol_4",
        changes: { sumInsuredMinor: 1_200_00 }
      })
    ).rejects.toMatchObject({ status: 403, code: "approval_required" });

    const cases = await ctx.db
      .select()
      .from(schema.axisCases)
      .where(and(eq(schema.axisCases.tenantId, ctx.tenantId), eq(schema.axisCases.kind, "endorse")));
    expect(cases).toHaveLength(0);

    // The pending approval is real, not swallowed.
    const approvals = await ctx.db.select().from(schema.approvals);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.policyKey).toBe("axis.endorse");
  });

  it("proceeds once the matching approval is already granted", async () => {
    await seedPolicy("pol_5");
    const changes = { sumInsuredMinor: 1_200_00 };
    const subjectRef = `axis_endorse:pol_5:${await sha256Hex(JSON.stringify({ changes, reason: null }))}`;
    await ctx.db.insert(schema.approvals).values({
      id: "apr_1",
      tenantId: ctx.tenantId,
      subjectRef,
      policyKey: "axis.endorse",
      module: "axis",
      requestedBy: "agent:quoting",
      requestedAt: ctx.now - 1000,
      decidedBy: "user:amina",
      decision: "approved",
      reason: "within threshold",
      contextJson: null,
      decidedAt: ctx.now - 500,
      delegationId: null
    });

    const result = (await runOrbitTool(ctx, "create_endorsement_request", {
      policyId: "pol_5",
      changes
    })) as { kind: string; status: string; metaJson: string };
    expect(result.kind).toBe("endorse");
    expect(JSON.parse(result.metaJson).policyId).toBe("pol_5");
  });

  it("rejects a missing policy before touching approvals", async () => {
    await expect(
      runOrbitTool(ctx, "create_endorsement_request", { policyId: "nope", changes: { a: 1 } })
    ).rejects.toMatchObject({ status: 404 });
    const approvals = await ctx.db.select().from(schema.approvals);
    expect(approvals).toHaveLength(0);
  });
});

describe("executeOrbitToolCalls", () => {
  it("records one ai_tool_calls row per call and returns tool-result messages", async () => {
    await seedPolicy("pol_6");
    await ctx.db.insert(schema.aiRuns).values({
      id: "air_1",
      tenantId: ctx.tenantId,
      agentKey: "quoting",
      module: "orbit",
      purpose: "orbit.copilot",
      actorRef: "agent:quoting",
      autonomyLevel: "act_with_approval",
      trigger: "user",
      state: "running",
      inputHash: "",
      startedAt: ctx.now
    });

    const messages = await executeOrbitToolCalls(
      ctx,
      "air_1",
      [
        { id: "call_1", name: "fetch_policy", args: { policyId: "pol_6" } },
        { id: "call_2", name: "create_endorsement_request", args: { policyId: "pol_6", changes: { a: 1 } } }
      ],
      new Set(ORBIT_TOOL_DEFS.map((d) => d.name))
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("tool");
    expect(messages[0]!.toolCallId).toBe("call_1");
    expect(JSON.parse(messages[0]!.content).id).toBe("pol_6");

    const gated = JSON.parse(messages[1]!.content);
    expect(gated.error).toBe("approval_required");
    expect(gated.approvalId).toBeTruthy();

    const rows = await ctx.db
      .select()
      .from(schema.aiToolCalls)
      .where(and(eq(schema.aiToolCalls.tenantId, ctx.tenantId), eq(schema.aiToolCalls.runId, "air_1")))
      .orderBy(schema.aiToolCalls.seq);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.outcome).toBe("ok");
    expect(rows[0]!.consequential).toBe(false);
    expect(rows[1]!.outcome).toBe("awaiting_approval");
    expect(rows[1]!.consequential).toBe(true);
    expect(rows[1]!.approvalId).toBeTruthy();
  });

  it("turns an unknown tool into an error row, not a thrown exception", async () => {
    await ctx.db.insert(schema.aiRuns).values({
      id: "air_2",
      tenantId: ctx.tenantId,
      agentKey: "quoting",
      module: "orbit",
      purpose: "orbit.copilot",
      actorRef: "agent:quoting",
      autonomyLevel: "act_with_approval",
      trigger: "user",
      state: "running",
      inputHash: "",
      startedAt: ctx.now
    });
    const messages = await executeOrbitToolCalls(
      ctx,
      "air_2",
      [{ id: "call_9", name: "delete_everything", args: {} }],
      new Set(ORBIT_TOOL_DEFS.map((d) => d.name))
    );
    expect(JSON.parse(messages[0]!.content).error).toBeTruthy();
    const rows = await ctx.db
      .select()
      .from(schema.aiToolCalls)
      .where(and(eq(schema.aiToolCalls.tenantId, ctx.tenantId), eq(schema.aiToolCalls.runId, "air_2")));
    expect(rows[0]!.outcome).toBe("error");
  });

  it("never executes a tool outside the agent's allowlist, even if HANDLERS has it", async () => {
    await seedPolicy("pol_7");
    await ctx.db.insert(schema.aiRuns).values({
      id: "air_3",
      tenantId: ctx.tenantId,
      agentKey: "quoting",
      module: "orbit",
      purpose: "orbit.copilot",
      actorRef: "agent:quoting",
      autonomyLevel: "act_with_approval",
      trigger: "user",
      state: "running",
      inputHash: "",
      startedAt: ctx.now
    });

    const messages = await executeOrbitToolCalls(
      ctx,
      "air_3",
      [{ id: "call_10", name: "fetch_policy", args: { policyId: "pol_7" } }],
      new Set(["start_quote"])
    );

    expect(JSON.parse(messages[0]!.content).error).toBeTruthy();
    const rows = await ctx.db
      .select()
      .from(schema.aiToolCalls)
      .where(and(eq(schema.aiToolCalls.tenantId, ctx.tenantId), eq(schema.aiToolCalls.runId, "air_3")));
    expect(rows[0]!.outcome).toBe("error");
  });
});

describe("orbitToolsFor", () => {
  it("returns every tool def when the agent carries no allowlist", () => {
    expect(orbitToolsFor({ toolsJson: null })).toHaveLength(ORBIT_TOOL_DEFS.length);
  });

  it("filters to the agent's allowlist", () => {
    const defs = orbitToolsFor({ toolsJson: JSON.stringify(["fetch_policy"]) });
    expect(defs.map((d) => d.name)).toEqual(["fetch_policy"]);
  });
});
