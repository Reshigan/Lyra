import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PolicyJson, EntitlementsJson, schema } from "@lyra/db";
import { emit, permissionsForRole, type Actor, type Ctx } from "@lyra/core";
import { drainOutbox } from "./dispatch.js";

// A queue.send() that throws must not abort the drain: the failing event's
// outbox attempts have to rise (so pendingOutbox's MAX_ATTEMPTS dead-letter cap
// can ever engage) and every event behind it must still publish.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");

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
    kind: "system",
    id: "scheduler",
    tenantId: "t_1",
    grants: [{ roleKey: "tenant.admin", permissions: permissionsForRole("tenant.admin") }]
  };
}

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  ctx = {
    db: drizzle(client) as unknown as Ctx["db"],
    tenantId: "t_1",
    actor: actor(),
    requestId: "req_1",
    now: 1_700_000_000_000,
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  };
});

describe("drainOutbox", () => {
  it("marks a queue-send failure and keeps draining the events behind it", async () => {
    const first = await emit(ctx, { module: "core", type: "core.test.poison", data: {} });
    ctx = { ...ctx, now: ctx.now + 1 };
    const second = await emit(ctx, { module: "core", type: "core.test.fine", data: {} });

    const result = await drainOutbox(ctx, {
      send: async (e) => {
        if (e.id === first.id) throw new Error("queue unavailable");
      }
    });

    expect(result.queued).toBe(1);
    expect(result.published).toBe(1);
    expect(result.failed).toBe(1);

    const rows = await ctx.db.select().from(schema.eventOutbox).where(eq(schema.eventOutbox.id, first.id));
    expect(rows[0]?.publishedAt).toBeNull();
    expect(rows[0]?.attempts).toBe(1);
    expect(rows[0]?.lastError).toContain("queue unavailable");

    const ok = await ctx.db.select().from(schema.eventOutbox).where(eq(schema.eventOutbox.id, second.id));
    expect(ok[0]?.publishedAt).toBe(ctx.now);
  });

  it("closes SIGNAL's funnel when a policy is issued — the lead becomes a bind", async () => {
    // A lead the portal tracking pixel attributed to a campaign.
    await ctx.db.insert(schema.signalAttributionEvents).values({
      id: "att_lead",
      tenantId: ctx.tenantId,
      customerId: "cus_1",
      anonId: null,
      touchType: "lead",
      channel: "meta",
      campaignId: "cmp_1",
      creativeId: null,
      valueMinor: null,
      currency: null,
      subjectRef: null,
      ts: ctx.now
    });

    await emit(ctx, {
      module: "axis",
      type: "axis.policy.issued",
      subject: "pol_1",
      data: { policyId: "pol_1", customerId: "cus_1", premiumMinor: 120_000_00, currency: "AED" }
    });

    await drainOutbox(ctx);

    const binds = await ctx.db
      .select()
      .from(schema.signalAttributionEvents)
      .where(eq(schema.signalAttributionEvents.touchType, "bind"));
    expect(binds).toHaveLength(1);
    expect(binds[0]?.campaignId).toBe("cmp_1");
    expect(binds[0]?.valueMinor).toBe(120_000_00);
    expect(binds[0]?.subjectRef).toBe("pol_1");
  });
});
