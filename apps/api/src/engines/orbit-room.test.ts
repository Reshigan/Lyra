import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@lyra/db";
import type { CoreDb } from "@lyra/core";
import { applyTurn, checkpoint, openRoom } from "./orbit-room.js";

// docs/16 H3: AgentRoom's actual logic (a Durable Object needs a Workers
// runtime, which this repo's plain-vitest setup does not provide — no
// @cloudflare/vitest-pool-workers here). So the reducer and the persist step
// are exercised directly, against the same libsql-in-memory harness every
// other packages/core/apps/api test uses (packages/core/src/seed.test.ts).

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
let db: CoreDb;

const TENANT_A = "ten_a";
const TENANT_B = "ten_b";
const CONVO = "cnv_1";
const CONVO_B = "cnv_2";

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  db = drizzle(client) as unknown as CoreDb;

  const now = Date.now();
  // `id` is the table's own primary key (global ULID convention), not
  // (tenantId, id) — so the two tenants' rows need distinct ids.
  for (const [tenantId, id] of [
    [TENANT_A, CONVO],
    [TENANT_B, CONVO_B]
  ] as const) {
    await db.insert(schema.orbitConversations).values({
      id,
      tenantId,
      channel: "web",
      createdAt: now,
      updatedAt: now
    });
  }
});

describe("orbit-room reducer", () => {
  it("appends turns in memory without touching the db", () => {
    let state = openRoom(TENANT_A, CONVO);
    state = applyTurn(state, { role: "customer", content: "hi", ts: 1 });
    state = applyTurn(state, { role: "agent_ai", content: "hello", ts: 2 });

    expect(state.pending).toHaveLength(2);
    expect(state.turnCount).toBe(2);
    expect(state.pending[0]).toMatchObject({ role: "customer", content: "hi" });
  });
});

describe("orbit-room checkpoint", () => {
  it("is a no-op when nothing is pending", async () => {
    const state = openRoom(TENANT_A, CONVO);
    const after = await checkpoint(db, state, Date.now());
    expect(after).toBe(state);

    const rows = await db.select().from(schema.orbitMessages);
    expect(rows).toHaveLength(0);
  });

  it("flushes pending turns to orbit_messages and clears the buffer", async () => {
    let state = openRoom(TENANT_A, CONVO);
    state = applyTurn(state, { role: "customer", content: "quote please", ts: 10 });
    state = applyTurn(state, { role: "agent_ai", content: "sure, one moment", ts: 11, aiAuditId: "aud_1" });

    const after = await checkpoint(db, state, 20);
    expect(after.pending).toHaveLength(0);
    expect(after.turnCount).toBe(2);

    const rows = await db
      .select()
      .from(schema.orbitMessages)
      .where(eq(schema.orbitMessages.conversationId, CONVO))
      .orderBy(schema.orbitMessages.ts);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ role: "customer", content: "quote please", modality: "text" });
    expect(rows[1]).toMatchObject({ role: "agent_ai", content: "sure, one moment", aiAuditId: "aud_1" });

    const convo = (
      await db
        .select()
        .from(schema.orbitConversations)
        .where(and(eq(schema.orbitConversations.tenantId, TENANT_A), eq(schema.orbitConversations.id, CONVO)))
    )[0]!;
    expect(convo.lastMessageAt).toBe(11);
    expect(convo.updatedAt).toBe(20);
  });

  it("never lets one tenant's checkpoint touch another tenant's row", async () => {
    let state = openRoom(TENANT_A, CONVO);
    state = applyTurn(state, { role: "customer", content: "hi", ts: 1 });
    await checkpoint(db, state, 5);

    const other = (
      await db
        .select()
        .from(schema.orbitConversations)
        .where(and(eq(schema.orbitConversations.tenantId, TENANT_B), eq(schema.orbitConversations.id, CONVO_B)))
    )[0]!;
    expect(other.lastMessageAt).toBeNull();

    const otherMessages = await db
      .select()
      .from(schema.orbitMessages)
      .where(eq(schema.orbitMessages.tenantId, TENANT_B));
    expect(otherMessages).toHaveLength(0);
  });
});
