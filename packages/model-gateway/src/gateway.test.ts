import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson, schema } from "@lyra/db";
import { permissionsForRole, AppError, type Ctx } from "@lyra/core";
import { charge, checkBudget, dayKey } from "./budget.js";
import { Gateway } from "./gateway.js";
import { resolveModel, costMicro, CATALOGUE } from "./models.js";
import { rehydrate, scrubMessages } from "./scrub.js";
import { makeStub } from "./providers/stub.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "db", "migrations");

function migrationStatements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

const NOW = 1_700_000_000_000;
let client: Client;
let ctx: Ctx;

function makeCtx(policy: Record<string, unknown> = {}): Ctx {
  return {
    db: drizzle(client) as unknown as Ctx["db"],
    tenantId: "t_1",
    actor: {
      kind: "user",
      id: "u_1",
      tenantId: "t_1",
      grants: [{ roleKey: "axis.agent", permissions: permissionsForRole("axis.agent") }]
    },
    requestId: "req_1",
    now: NOW,
    locale: "en",
    policy: PolicyJson.parse(policy),
    entitlements: EntitlementsJson.parse({})
  };
}

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of migrationStatements()) await client.execute(sql);
  ctx = makeCtx();
});

describe("routing", () => {
  it("routes every cloud tier to workers-ai", () => {
    for (const tier of ["fast", "standard", "reasoning"] as const) {
      expect(resolveModel(tier).provider).toBe("workers-ai");
    }
  });

  it("pins on-prem tenants internal even against an override", () => {
    const def = resolveModel("reasoning", { onPrem: true, overrides: { reasoning: "claude-opus-5" } });
    expect(def.provider).toBe("openai-compat");
  });

  it("upgrades to a tool-capable model when the request carries tools", () => {
    expect(CATALOGUE["llama-3.1-8b"]!.tools).toBe(false);
    expect(resolveModel("fast", { needsTools: true }).tools).toBe(true);
  });

  it("rounds cost up so a tenant is never under-billed", () => {
    expect(costMicro(CATALOGUE["llama-3.1-8b"]!, 1, 0)).toBe(1);
  });
});

describe("scrubber", () => {
  it("keeps one placeholder per value across messages and rehydrates", () => {
    const { messages, map, flags } = scrubMessages([
      { role: "user", content: "rania@gonxt.ae asked about +971 50 123 4567" },
      { role: "assistant", content: "I will email rania@gonxt.ae" }
    ]);
    expect(messages[0]!.content).not.toContain("rania@gonxt.ae");
    expect(messages[0]!.content).toContain("[[EMAIL_1]]");
    expect(messages[1]!.content).toContain("[[EMAIL_1]]");
    expect(flags).toContain("pii_email");
    expect(rehydrate(messages[1]!.content, map)).toBe("I will email rania@gonxt.ae");
  });

  it("destroys secrets rather than placeholding them", () => {
    const { messages, map, flags } = scrubMessages([
      { role: "user", content: "token cfat_Z7kFeYokfDSr9qwDsORFNMcH7rhl" }
    ]);
    expect(messages[0]!.content).toBe("token [[REDACTED]]");
    expect(flags).toContain("secret_in_prompt");
    expect(map.size).toBe(0);
  });
});

describe("budget", () => {
  it("charges usage and hard-stops at 100%", async () => {
    const small = makeCtx({ aiBudgetDailyTokens: 100, aiBudgetDailyCostMicro: 1_000_000 });
    expect((await checkBudget(small, "axis")).ok).toBe(true);

    const warn = await charge(small, { tokensIn: 80, tokensOut: 0, costMicro: 5 }, "axis");
    expect(warn.crossedWarning).toBe(true);
    expect(warn.stopped).toBe(false);

    const stop = await charge(small, { tokensIn: 30, tokensOut: 0, costMicro: 5 }, "axis");
    expect(stop.stopped).toBe(true);

    const after = await checkBudget(small, "axis");
    expect(after.ok).toBe(false);
    expect(after.reason).toBe("tokens");
    expect(after.state.day).toBe(dayKey(NOW));
  });

  it("refuses the next call once the budget is spent", async () => {
    const small = makeCtx({ aiBudgetDailyTokens: 10, aiBudgetDailyCostMicro: 10 });
    await charge(small, { tokensIn: 20, tokensOut: 0, costMicro: 20 }, "axis");
    const gw = new Gateway({ env: {}, providers: { stub: makeStub() } });
    await expect(
      gw.complete(small, { module: "axis", purpose: "test", tier: "fast", messages: [] })
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe("gateway.complete", () => {
  const stubbed = (replies?: string[]) => {
    const stub = makeStub(replies ? { replies } : {});
    // The stub answers for whichever provider the router picks.
    return {
      stub,
      gw: new Gateway({
        env: {},
        providers: { "workers-ai": stub, anthropic: stub, "openai-compat": stub },
        customerFacing: new Set(["quote_summary"])
      })
    };
  };

  it("scrubs outbound, rehydrates inbound and audits the call", async () => {
    const { stub, gw } = stubbed(["Tell [[EMAIL_1]] the cover starts Monday."]);
    const res = await gw.complete(ctx, {
      module: "axis",
      purpose: "quote_summary",
      tier: "fast",
      subjectRef: "quote:q_1",
      messages: [{ role: "user", content: "summarise for rania@gonxt.ae" }]
    });

    expect(stub.calls[0]!.messages[0]!.content).not.toContain("rania@gonxt.ae");
    expect(res.text).toBe("Tell rania@gonxt.ae the cover starts Monday.");
    expect(res.provider).toBe("workers-ai");
    expect(res.usage.costMicro).toBeGreaterThan(0);

    const audit = await ctx.db.select().from(schema.aiAuditLog);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.outcome).toBe("ok");
    expect(audit[0]!.subjectRef).toBe("quote:q_1");
    // Hashes, never content.
    expect(JSON.stringify(audit[0]!)).not.toContain("rania@gonxt.ae");

    const budget = await ctx.db.select().from(schema.aiBudgets);
    expect(budget[0]!.tokensUsed).toBe(res.usage.tokensIn + res.usage.tokensOut);
  });

  it("blocks a regulated claim on a customer-facing purpose and still bills it", async () => {
    const { gw } = stubbed(["You are fully covered, risk-free."]);
    const res = await gw.complete(ctx, {
      module: "axis",
      purpose: "quote_summary",
      tier: "fast",
      messages: [{ role: "user", content: "am I covered?" }]
    });

    expect(res.text).toBe("");
    expect(res.finishReason).toBe("refusal");
    expect(res.flags).toContain("regulated_claim");

    const audit = await ctx.db.select().from(schema.aiAuditLog);
    expect(audit[0]!.outcome).toBe("refused");
    const events = await ctx.db.select().from(schema.aiGuardrailEvents);
    expect(events.some((e) => e.rule === "regulated_claim" && e.severity === "block")).toBe(true);
    const budget = await ctx.db.select().from(schema.aiBudgets);
    expect(budget[0]!.tokensUsed).toBeGreaterThan(0);
  });

  it("warns but does not block the same claim on an internal purpose", async () => {
    const { gw } = stubbed(["We will pay the claim."]);
    const res = await gw.complete(ctx, {
      module: "axis",
      purpose: "internal_note",
      tier: "fast",
      messages: [{ role: "user", content: "draft a note" }]
    });
    expect(res.text).toBe("We will pay the claim.");
    expect(res.flags).toContain("regulated_claim");
  });

  it("audits a provider failure as an error", async () => {
    const gw = new Gateway({
      env: {},
      providers: { "workers-ai": makeStub({ fail: new Error("boom") }) }
    });
    await expect(
      gw.complete(ctx, { module: "axis", purpose: "test", tier: "fast", messages: [] })
    ).rejects.toThrow("boom");
    const audit = await ctx.db.select().from(schema.aiAuditLog);
    expect(audit[0]!.outcome).toBe("error");
  });

  it("embeds through the same budget path", async () => {
    const stub = makeStub();
    const gw = new Gateway({ env: {}, providers: { "workers-ai": stub } });
    const res = await gw.embed(ctx, { module: "scout", purpose: "index", texts: ["motor cover", "تأمين"] });
    expect(res.vectors).toHaveLength(2);
    expect(res.model).toBe("@cf/baai/bge-m3");
    const budget = await ctx.db.select().from(schema.aiBudgets);
    expect(budget[0]!.tokensUsed).toBeGreaterThan(0);
  });
});
