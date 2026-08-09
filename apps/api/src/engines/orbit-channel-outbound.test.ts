import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, PolicyJson, EntitlementsJson } from "@lyra/db";
import { sealFields, type Ctx } from "@lyra/core";
import { dispatchOutbound } from "./orbit-channel-outbound.js";
import type { Env } from "../env.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "..", "packages", "db", "migrations");
const FIELD_KEY = "test-field-key";
const tenantId = "t_1";
const now = 1_700_000_000_000;

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
let env: Env;
let conversation: typeof schema.orbitConversations.$inferSelect;
let connector: typeof schema.orbitChannelConnectors.$inferSelect;

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
  env = { FIELD_KEY } as unknown as Env;

  const sealed = await sealFields(FIELD_KEY, { accessToken: "token-123" }, ["accessToken"]);
  connector = {
    id: "ccn_1",
    tenantId,
    provider: "whatsapp-cloud-api",
    transport: "whatsapp",
    label: "Main",
    secretsJson: JSON.stringify(sealed),
    configJson: JSON.stringify({ phoneNumberId: "pn_1" }),
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  await db.insert(schema.orbitChannelConnectors).values(connector);

  conversation = {
    id: "cnv_1",
    tenantId,
    customerId: null,
    channel: "whatsapp",
    externalRef: "97150",
    connectorId: "ccn_1",
    doId: null,
    state: "human",
    assigneeRef: null,
    teamId: null,
    csat: null,
    summary: null,
    lang: "en",
    intent: null,
    sentiment: null,
    firstResponseMs: null,
    lastMessageAt: now,
    closedAt: null,
    createdAt: now,
    updatedAt: now
  };
  await db.insert(schema.orbitConversations).values(conversation);
});

afterEach(() => vi.unstubAllGlobals());

describe("dispatchOutbound", () => {
  it("sends through the resolved adapter and records a message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.out.1" }] }), { status: 200 }))
    );
    const result = await dispatchOutbound(ctx, env, conversation, connector, "On our way!");
    expect(result.externalRef).toBe("wamid.out.1");

    const [message] = await ctx.db
      .select()
      .from(schema.orbitMessages)
      .where(eq(schema.orbitMessages.id, result.messageId));
    expect(message!.content).toBe("On our way!");
    expect(message!.externalRef).toBe("wamid.out.1");
    expect(message!.deliveryStatus).toBe("sent");
    expect(message!.role).toBe("agent_human");
  });

  it("opens the sealed connector secret before calling the provider", async () => {
    const fetchMock = vi.fn(
      async (_url: unknown, _init?: { headers?: Record<string, string> }) =>
        new Response(JSON.stringify({ messages: [{ id: "wamid.out.2" }] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    await dispatchOutbound(ctx, env, conversation, connector, "hello");
    expect(fetchMock.mock.calls[0]![1]?.headers?.Authorization).toBe("Bearer token-123");
  });

  it("throws when the conversation has no external address", async () => {
    const bare = { ...conversation, externalRef: null };
    await expect(dispatchOutbound(ctx, env, bare, connector, "hi")).rejects.toThrow();
  });

  it("records no message when the provider send fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(dispatchOutbound(ctx, env, conversation, connector, "hi")).rejects.toThrow();
    const rows = await ctx.db.select().from(schema.orbitMessages);
    expect(rows).toHaveLength(0);
  });
});
