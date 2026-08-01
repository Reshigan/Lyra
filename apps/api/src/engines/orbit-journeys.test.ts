import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PolicyJson, EntitlementsJson, schema } from "@lyra/db";
import { permissionsForRole, recordConsent, type Actor, type Ctx } from "@lyra/core";
import { triggerJourney } from "./orbit-journeys.js";

// docs/05 §Journeys: "consent & quiet-hours & frequency caps baked in as
// unremovable floors". Confirmed gap: orbitJourneys/orbitJourneyRuns were
// CRUD-only, nothing ever walked a graph or created a run.

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
    kind: "system",
    id: "scheduler",
    tenantId: "t_1",
    grants: [{ roleKey: "tenant.admin", permissions: permissionsForRole("tenant.admin") }]
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

function graph(cooldownDays: number | undefined = 1) {
  return JSON.stringify({
    nodes: [
      { key: "start", type: "trigger", on: "orbit.renewal.raised" },
      { key: "email_offer", type: "message", channel: "email" },
      { key: "end", type: "end" }
    ],
    edges: [
      { from: "start", to: "email_offer" },
      { from: "email_offer", to: "end" }
    ],
    ...(cooldownDays === undefined ? {} : { cooldownDays })
  });
}

async function seedJourney(id: string, patch: { status?: string; graphJson?: string } = {}) {
  await ctx.db.insert(schema.orbitJourneys).values({
    id,
    tenantId: ctx.tenantId,
    key: "renewal_45d",
    version: 1,
    nameJson: JSON.stringify({ en: "Renewal" }),
    graphJson: patch.graphJson ?? graph(),
    status: patch.status ?? "active",
    createdBy: "user:noor",
    createdAt: ctx.now
  });
}

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  ctx = await makeCtx();
});

describe("triggerJourney", () => {
  it("creates one run row per customer in the cohort, positioned on the node after the trigger", async () => {
    await seedJourney("jrn_1");
    const result = await triggerJourney(ctx, "jrn_1", ["cus_1", "cus_2", "cus_3"]);
    expect(result.triggered).toEqual(["cus_1", "cus_2", "cus_3"]);

    const runs = await ctx.db
      .select()
      .from(schema.orbitJourneyRuns)
      .where(and(eq(schema.orbitJourneyRuns.tenantId, ctx.tenantId), eq(schema.orbitJourneyRuns.journeyId, "jrn_1")));
    expect(runs).toHaveLength(3);
    for (const r of runs) {
      expect(r.node).toBe("email_offer");
      expect(r.state).toBe("running");
    }
  });

  it("refuses to trigger a paused or retired journey", async () => {
    await seedJourney("jrn_paused", { status: "paused" });
    await expect(triggerJourney(ctx, "jrn_paused", ["cus_1"])).rejects.toMatchObject({ status: 409 });
  });

  it("refuses to trigger an active journey with no cooldownDays field at all — frequency caps are unremovable (ORB-051)", async () => {
    // graph(undefined) would trip the helper's own `= 1` default (JS default
    // params fire on an explicit `undefined` argument too), so build the
    // no-cooldown-field graph directly instead.
    const noCooldown = JSON.stringify({
      nodes: [
        { key: "start", type: "trigger", on: "orbit.renewal.raised" },
        { key: "email_offer", type: "message", channel: "email" }
      ],
      edges: [{ from: "start", to: "email_offer" }]
    });
    await seedJourney("jrn_uncapped", { graphJson: noCooldown });
    await expect(triggerJourney(ctx, "jrn_uncapped", ["cus_1"])).rejects.toMatchObject({ status: 400 });
  });

  it("refuses to trigger an active journey with cooldownDays explicitly 0 — frequency caps are unremovable (ORB-051)", async () => {
    await seedJourney("jrn_zero", { graphJson: graph(0) });
    await expect(triggerJourney(ctx, "jrn_zero", ["cus_1"])).rejects.toMatchObject({ status: 400 });
  });

  it("does not double-trigger the same contact inside the journey's cooldown window", async () => {
    await seedJourney("jrn_cd", { graphJson: graph(30) }); // 30-day cooldown

    const first = await triggerJourney(ctx, "jrn_cd", ["cus_1"]);
    expect(first.triggered).toEqual(["cus_1"]);

    const soon = { ...ctx, now: ctx.now + 5 * 86_400_000 }; // 5 days later, inside cooldown
    const second = await triggerJourney(soon, "jrn_cd", ["cus_1"]);
    expect(second.triggered).toEqual([]);
    expect(second.skippedCooldown).toEqual(["cus_1"]);

    const runs = await ctx.db
      .select()
      .from(schema.orbitJourneyRuns)
      .where(and(eq(schema.orbitJourneyRuns.tenantId, ctx.tenantId), eq(schema.orbitJourneyRuns.journeyId, "jrn_cd")));
    expect(runs).toHaveLength(1); // the unique (tenant, journey, customer) index holds

    const later = { ...ctx, now: ctx.now + 31 * 86_400_000 }; // past the 30-day cooldown
    const third = await triggerJourney(later, "jrn_cd", ["cus_1"]);
    expect(third.triggered).toEqual(["cus_1"]);

    const runsAfter = await ctx.db
      .select()
      .from(schema.orbitJourneyRuns)
      .where(and(eq(schema.orbitJourneyRuns.tenantId, ctx.tenantId), eq(schema.orbitJourneyRuns.journeyId, "jrn_cd")));
    expect(runsAfter).toHaveLength(1);
    expect(runsAfter[0]!.updatedAt).toBe(later.now);
  });

  it("excludes a contact who has withdrawn consent", async () => {
    await seedJourney("jrn_consent");
    await recordConsent(ctx, {
      customerId: "cus_withdrawn",
      purposes: { marketing: false },
      channels: {},
      source: "portal"
    });

    const result = await triggerJourney(ctx, "jrn_consent", ["cus_ok", "cus_withdrawn"]);
    expect(result.triggered).toEqual(["cus_ok"]);
    expect(result.skippedConsent).toEqual(["cus_withdrawn"]);

    const runs = await ctx.db
      .select()
      .from(schema.orbitJourneyRuns)
      .where(and(eq(schema.orbitJourneyRuns.tenantId, ctx.tenantId), eq(schema.orbitJourneyRuns.journeyId, "jrn_consent")));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.customerId).toBe("cus_ok");
  });

  it("does not exclude a customer who has never recorded any consent", async () => {
    await seedJourney("jrn_none");
    const result = await triggerJourney(ctx, "jrn_none", ["cus_new"]);
    expect(result.triggered).toEqual(["cus_new"]);
  });
});
