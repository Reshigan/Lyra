import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { schema, PolicyJson, EntitlementsJson } from "@lyra/db";
import { type Ctx } from "@lyra/core";
import { processChannelEvents, type ChannelConnectorRow } from "./orbit-channel-inbound.js";

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
const tenantId = "t_1";
const now = 1_700_000_000_000;

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  const db = drizzle(client) as unknown as Ctx["db"];
  ctx = {
    db,
    tenantId,
    actor: { kind: "system", id: "test", tenantId, grants: [] },
    requestId: "req_1",
    now,
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  };
});

const connector: ChannelConnectorRow = {
  id: "ccn_1",
  tenantId,
  provider: "whatsapp-cloud-api",
  transport: "whatsapp",
  label: "Main WhatsApp",
  secretsJson: "{}",
  configJson: "{}",
  status: "active",
  createdAt: now,
  updatedAt: now
};

describe("processChannelEvents", () => {
  it("creates a customer, a conversation and a message for a first-time handle", async () => {
    const result = await processChannelEvents(ctx, connector, [
      { kind: "message", message: { externalRef: "wamid.1", handle: "97150", displayName: "Amina", text: "Hello", modality: "text", sentAt: now } }
    ]);
    expect(result).toEqual({ processed: 1, skipped: 0 });

    const [identity] = await ctx.db
      .select()
      .from(schema.orbitChannelIdentities)
      .where(eq(schema.orbitChannelIdentities.handle, "97150"));
    expect(identity).toBeDefined();

    const [customer] = await ctx.db.select().from(schema.customers).where(eq(schema.customers.id, identity!.customerId));
    expect(JSON.parse(customer!.nameJson).en).toBe("Amina");

    const [conversation] = await ctx.db
      .select()
      .from(schema.orbitConversations)
      .where(eq(schema.orbitConversations.customerId, identity!.customerId));
    expect(conversation!.connectorId).toBe("ccn_1");
    expect(conversation!.externalRef).toBe("97150");

    const [message] = await ctx.db.select().from(schema.orbitMessages).where(eq(schema.orbitMessages.externalRef, "wamid.1"));
    expect(message!.content).toBe("Hello");
    expect(message!.conversationId).toBe(conversation!.id);
  });

  it("reuses the existing conversation for a returning handle", async () => {
    await processChannelEvents(ctx, connector, [
      { kind: "message", message: { externalRef: "wamid.1", handle: "97150", text: "Hi", modality: "text", sentAt: now } }
    ]);
    await processChannelEvents(ctx, connector, [
      { kind: "message", message: { externalRef: "wamid.2", handle: "97150", text: "Again", modality: "text", sentAt: now + 1000 } }
    ]);

    const conversations = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.tenantId, tenantId));
    expect(conversations).toHaveLength(1);

    const messages = await ctx.db.select().from(schema.orbitMessages).where(eq(schema.orbitMessages.conversationId, conversations[0]!.id));
    expect(messages).toHaveLength(2);
  });

  it("de-dupes a redelivered webhook by externalRef", async () => {
    const event = {
      kind: "message" as const,
      message: { externalRef: "wamid.1", handle: "97150", text: "Hi", modality: "text" as const, sentAt: now }
    };
    const first = await processChannelEvents(ctx, connector, [event]);
    const second = await processChannelEvents(ctx, connector, [event]);
    expect(first).toEqual({ processed: 1, skipped: 0 });
    expect(second).toEqual({ processed: 0, skipped: 1 });
  });

  it("skips an ignored event without touching the database", async () => {
    const result = await processChannelEvents(ctx, connector, [{ kind: "ignored", why: "unsupported" }]);
    expect(result).toEqual({ processed: 0, skipped: 1 });
  });

  it("updates a message's delivery status from a status receipt", async () => {
    await processChannelEvents(ctx, connector, [
      { kind: "message", message: { externalRef: "wamid.1", handle: "97150", text: "Hi", modality: "text", sentAt: now } }
    ]);
    await processChannelEvents(ctx, connector, [{ kind: "status", receipt: { externalRef: "wamid.1", status: "delivered", at: now + 500 } }]);

    const [message] = await ctx.db.select().from(schema.orbitMessages).where(eq(schema.orbitMessages.externalRef, "wamid.1"));
    expect(message!.deliveryStatus).toBe("delivered");
  });
});
