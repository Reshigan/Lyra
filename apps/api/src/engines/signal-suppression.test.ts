import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PolicyJson, EntitlementsJson, schema } from "@lyra/db";
import {
  chainFor,
  consume,
  pendingOutbox,
  recordConsent,
  permissionsForRole,
  type Actor,
  type Ctx
} from "@lyra/core";
import { onConsentUpdated, SUPPRESSION_AUDIENCE_NAME } from "./signal-suppression.js";

// docs/25 M4 SIGNAL row: "suppression propagation test" — consent withdrawal to
// suppression across live campaigns, expressed as a timestamp-delta assertion
// rather than a real 15-minute wait.

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

async function makeCtx(now = 1_700_000_000_000): Promise<Ctx> {
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

async function liveCampaign(audienceId: string) {
  const id = "cmp_" + audienceId;
  await ctx.db.insert(schema.signalCampaigns).values({
    id,
    tenantId: ctx.tenantId,
    name: "Motor search",
    objective: "acq",
    audienceId,
    channelsJson: "[]",
    budgetJson: "{}",
    state: "live",
    ownerRef: "user:noor",
    createdAt: ctx.now,
    updatedAt: ctx.now
  });
  return id;
}

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  ctx = await makeCtx();
});

describe("SIGNAL suppression propagation", () => {
  it("adds the withdrawing customer to the suppression audience and cascades to live campaigns", async () => {
    // Suppression audience already exists (as the seed creates it) — this
    // test exercises the "update, don't duplicate" path; the second test
    // below covers "create if none exists yet".
    await ctx.db.insert(schema.signalAudiences).values({
      id: "aud_suppression",
      tenantId: ctx.tenantId,
      name: SUPPRESSION_AUDIENCE_NAME,
      definitionJson: JSON.stringify({ any: [] }),
      sizeCached: 0,
      refreshPolicy: "hourly",
      consentPurposes: "none",
      createdBy: "user:noor",
      createdAt: ctx.now - 1000,
      updatedAt: ctx.now - 1000
    });

    // A targeting audience that excludes the suppression audience, and a live
    // campaign that targets it — matching seed/signal.ts.
    await ctx.db.insert(schema.signalAudiences).values({
      id: "aud_motor",
      tenantId: ctx.tenantId,
      name: "Motor, no health",
      definitionJson: JSON.stringify({ any: [], excludeAudienceId: "aud_suppression" }),
      refreshPolicy: "daily",
      consentPurposes: "marketing",
      createdBy: "user:noor",
      createdAt: ctx.now,
      updatedAt: ctx.now
    });
    const campaignId = await liveCampaign("aud_motor");

    // A draft campaign on the same audience must NOT get a propagation entry.
    await ctx.db.insert(schema.signalCampaigns).values({
      id: "cmp_draft",
      tenantId: ctx.tenantId,
      name: "Draft copy",
      objective: "acq",
      audienceId: "aud_motor",
      channelsJson: "[]",
      budgetJson: "{}",
      state: "draft",
      ownerRef: "user:noor",
      createdAt: ctx.now,
      updatedAt: ctx.now
    });

    const before = await pendingOutbox(ctx.db);
    expect(before).toHaveLength(0);

    await recordConsent(ctx, {
      customerId: "cu_1",
      purposes: { marketing: false },
      channels: { whatsapp: true },
      source: "portal"
    });

    const pending = await pendingOutbox(ctx.db);
    const envelope = pending.find((e) => e.type === "core.consent.updated");
    expect(envelope).toBeDefined();
    expect(envelope!.data).toMatchObject({ customerId: "cu_1", purposes: { marketing: false } });

    const result = await consume(ctx.db, envelope!, "signal.suppression", (e) => onConsentUpdated(ctx, e), ctx.now);
    expect(result).toBe("processed");

    const suppression = await ctx.db
      .select()
      .from(schema.signalAudiences)
      .where(eq(schema.signalAudiences.name, SUPPRESSION_AUDIENCE_NAME));
    expect(suppression).toHaveLength(1);
    expect(suppression[0]!.sizeCached).toBe(1);
    expect(suppression[0]!.lastRefreshedAt).toBe(ctx.now);

    // Under 15 minutes: the propagation audit row lands at the same instant as
    // the event, not on some later sweep. Real timer would be un-unit-testable.
    const chain = await chainFor(ctx);
    const propagated = chain.filter((r) => r.action === "signal.suppression.propagated");
    expect(propagated).toHaveLength(1);
    expect(propagated[0]!.subjectRef).toBe(`signal_campaign:${campaignId}`);
    expect(propagated[0]!.ts - envelope!.ts).toBeLessThan(15 * 60_000);
    expect(propagated[0]!.ts).toBe(envelope!.ts);

    // Idempotent: replaying the same envelope must not duplicate the audit row
    // or double-count the suppression audience.
    const again = await consume(ctx.db, envelope!, "signal.suppression", (e) => onConsentUpdated(ctx, e), ctx.now);
    expect(again).toBe("duplicate");
    const chainAfter = await chainFor(ctx);
    expect(chainAfter.filter((r) => r.action === "signal.suppression.propagated")).toHaveLength(1);
    const suppressionAfter = await ctx.db
      .select()
      .from(schema.signalAudiences)
      .where(eq(schema.signalAudiences.name, SUPPRESSION_AUDIENCE_NAME));
    expect(suppressionAfter[0]!.sizeCached).toBe(1);
  });

  it("is idempotent when a second customer withdraws consent and reuses the same audience row", async () => {
    await ctx.db.insert(schema.signalAudiences).values({
      id: "aud_motor",
      tenantId: ctx.tenantId,
      name: "Motor, no health",
      definitionJson: JSON.stringify({ any: [], excludeAudienceId: "aud_suppression" }),
      refreshPolicy: "daily",
      consentPurposes: "marketing",
      createdBy: "user:noor",
      createdAt: ctx.now,
      updatedAt: ctx.now
    });
    await liveCampaign("aud_motor");

    await recordConsent(ctx, {
      customerId: "cu_1",
      purposes: { marketing: false },
      channels: {},
      source: "portal"
    });
    const first = (await pendingOutbox(ctx.db)).find((e) => e.type === "core.consent.updated")!;
    await consume(ctx.db, first, "signal.suppression", (e) => onConsentUpdated(ctx, e), ctx.now);

    const later = { ...ctx, now: ctx.now + 1000 };
    await recordConsent(later, {
      customerId: "cu_2",
      purposes: { marketing: false },
      channels: {},
      source: "portal"
    });
    const second = (await pendingOutbox(later.db)).find(
      (e) => e.type === "core.consent.updated" && e.id !== first.id
    )!;
    await consume(later.db, second, "signal.suppression", (e) => onConsentUpdated(later, e), later.now);

    const suppression = await ctx.db
      .select()
      .from(schema.signalAudiences)
      .where(eq(schema.signalAudiences.name, SUPPRESSION_AUDIENCE_NAME));
    expect(suppression).toHaveLength(1); // find-or-create, not a duplicate row
    expect(suppression[0]!.sizeCached).toBe(2);
  });
});
