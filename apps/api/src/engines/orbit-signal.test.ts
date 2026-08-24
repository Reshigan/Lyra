import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PolicyJson, EntitlementsJson, schema } from "@lyra/db";
import { permissionsForRole, type Actor, type Ctx } from "@lyra/core";
import { detectLang } from "./orbit-signal.js";

// The conversation-signal engine. Language detection is deterministic and
// these tests pin its exact contract: Arabic script is unambiguous, Arabizi
// needs two independent markers (one alone misroutes English like "3rd" or
// "7 days"), and plain English stays English.

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

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  ctx = await makeCtx();
});

describe("detectLang", () => {
  it("reads Arabic script as ar", () => {
    expect(detectLang("مرحبا، أريد تجديد البوليصة")).toBe("ar");
  });

  it("reads plain English as en", () => {
    expect(detectLang("I want to renew my policy please")).toBe("en");
  });

  it("does not let a single numeral marker flip English to ar", () => {
    // "3rd" and "7 days" are English; one marker is too weak.
    expect(detectLang("My policy starts on the 3rd of next month")).toBe("en");
    expect(detectLang("It will take 7 days to process")).toBe("en");
  });

  it("reads Arabizi — two or more markers — as ar", () => {
    // "yalla" + "khalas": distinct Arabizi markers in one Latin-script message.
    expect(detectLang("yalla khalas I want it done")).toBe("ar");
  });

  it("handles mixed Arabic/English by the Arabic script's presence", () => {
    expect(detectLang("أريد renew my policy")).toBe("ar");
  });
});

describe("applySignal via sweep integration", () => {
  it("writes lang and sentiment onto the conversation", async () => {
    await ctx.db.insert(schema.orbitConversations).values({
      id: "cnv_1",
      tenantId: "t_1",
      customerId: "cus_1",
      channel: "whatsapp",
      state: "bot",
      lang: "en",
      createdAt: NOW,
      updatedAt: NOW
    });
    const { applySignal } = await import("./orbit-signal.js");
    await applySignal(ctx, "cnv_1", { lang: "ar", sentiment: -42 });
    const [row] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_1"));
    expect(row?.lang).toBe("ar");
    expect(row?.sentiment).toBe(-42);
  });

  it("clamps sentiment into the column's -100..100 range", async () => {
    await ctx.db.insert(schema.orbitConversations).values({
      id: "cnv_2",
      tenantId: "t_1",
      customerId: "cus_1",
      channel: "whatsapp",
      state: "bot",
      lang: "en",
      createdAt: NOW,
      updatedAt: NOW
    });
    const { applySignal } = await import("./orbit-signal.js");
    await applySignal(ctx, "cnv_2", { lang: "en", sentiment: -500 });
    const [row] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_2"));
    expect(row?.sentiment).toBe(-100);
  });
});
