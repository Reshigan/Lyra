import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson, schema } from "@lyra/db";
import type { Ctx } from "@lyra/core";
import { nudgeApiKeyRotation } from "./engines/api-key-rotation.js";

// docs/10 §6: "API keys 90d nudge." One check: a live key past 90 days nudges
// its owner once, a fresh key doesn't, and a second sweep doesn't nudge twice.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

const NOW = Date.UTC(2026, 5, 15, 12);
const DAY_MS = 86_400_000;
let ctx: Ctx;

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  for (const stmt of statements()) await client.execute(stmt);
  await client.execute({
    sql: `insert into core_api_keys (id, tenant_id, name, prefix, key_hash, mode, scopes_json, created_by, created_at)
          values ('key_old','t_a','Old key','qvk_live_old1','h','live','[]','user:u_1',?),
                 ('key_new','t_a','New key','qvk_live_new1','h','live','[]','user:u_1',?)`,
    args: [NOW - 91 * DAY_MS, NOW - 10 * DAY_MS]
  });
  ctx = {
    db: drizzle(client) as unknown as Ctx["db"],
    tenantId: "t_a",
    actor: { kind: "system", id: "scheduler", tenantId: "t_a", grants: [] },
    requestId: "req_test",
    now: NOW,
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  };
});

describe("nudgeApiKeyRotation", () => {
  it("nudges only the key past 90 days, and only once", async () => {
    const first = await nudgeApiKeyRotation(ctx);
    expect(first).toBe(1);
    const notes = await ctx.db.select().from(schema.notifications);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.subjectRef).toBe("key_old");
    expect(notes[0]?.userId).toBe("u_1");

    const second = await nudgeApiKeyRotation(ctx);
    expect(second).toBe(0);
    expect((await ctx.db.select().from(schema.notifications)).length).toBe(1);
  });
});
