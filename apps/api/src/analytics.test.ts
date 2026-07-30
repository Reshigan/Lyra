import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson, schema } from "@lyra/db";
import type { Ctx } from "@lyra/core";
import { onError } from "./mw.js";
import { analyticsRoutes, runDueSchedules } from "./routes/analytics.js";
import type { App, Env } from "./env.js";

// ANL-010 (warehouse feed) and ANL-012 (scheduled delivery). Both are driven
// through the real handlers with the real permission checks — the feed because
// a warehouse export that leaks a tenant is the worst bug in the product, the
// scheduler because "fired twice" is indistinguishable from "worked" in a log.

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
const HOUR = 3_600_000;

let ctx: Ctx;

/** Whatever was written to the object store this test. */
let stored: Map<string, Uint8Array>;

const bucket = {
  put: async (key: string, bytes: Uint8Array) => {
    stored.set(key, bytes);
  },
  get: async (key: string) => (stored.has(key) ? { body: stored.get(key) } : null)
} as unknown as R2Bucket;

const env = { FILES: bucket } as unknown as Env;

function actor(permissions: string[]): Ctx["actor"] {
  return { kind: "user", id: "u_test", tenantId: "t_test", grants: [{ roleKey: "test", permissions }] };
}

/** The analytics router with a fixed context — no login, the same handlers. */
function router(over: Partial<Ctx> = {}): Hono<App> {
  const app = new Hono<App>();
  app.onError(onError);
  app.use("*", async (c, next) => {
    c.set("ctx", { ...ctx, ...over });
    await next();
  });
  app.route("/v1/analytics", analyticsRoutes);
  return app;
}

async function feed(path: string, over: Partial<Ctx> = {}): Promise<{ status: number; rows: any[]; res: Response }> {
  const res = await router(over).fetch(new Request(`http://api.test${path}`), env as never);
  const text = await res.text();
  const rows = res.ok
    ? text
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    : [];
  return { status: res.status, rows, res };
}

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  for (const stmt of statements()) await client.execute(stmt);
  stored = new Map();
  const now = NOW;
  await client.execute({
    sql: `insert into core_users (id, tenant_id, email, name, locale, status, auth_provider, mfa_enrolled, created_at, updated_at)
          values ('u_owner','t_test','owner@test','Owner','en','active','password',0,?,?),
                 ('u_recipient','t_test','rec@test','Recipient','en','active','password',0,?,?)`,
    args: [now, now, now, now]
  });
  ctx = {
    db: drizzle(client) as unknown as Ctx["db"],
    tenantId: "t_test",
    actor: actor(["*:*:*"]),
    requestId: "req_test",
    now: NOW,
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  };
});

/* -------------------------------------------------------------- ANL-010 feed */

describe("warehouse feed", () => {
  it("ships only the caller's tenant, and stamps the tenant on every row", async () => {
    await seedPolicies();
    const { status, rows } = await feed("/v1/analytics/feed/policies");
    expect(status).toBe(200);
    expect(rows.map((r) => r.id)).toEqual(["pol_1", "pol_2"]);
    expect(rows.every((r) => r.tenant_id === "t_test")).toBe(true);
  });

  it("answers NDJSON, one row per line", async () => {
    await seedPolicies();
    const { res } = await feed("/v1/analytics/feed/policies");
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
  });

  it("resumes from its cursor without repeating or dropping a row", async () => {
    await seedPolicies();
    const first = await feed("/v1/analytics/feed/policies?limit=1");
    expect(first.rows.map((r) => r.id)).toEqual(["pol_1"]);
    expect(first.res.headers.get("x-lyra-more")).toBe("true");

    const cursor = first.res.headers.get("x-lyra-cursor");
    expect(cursor).toBeTruthy();
    const second = await feed(`/v1/analytics/feed/policies?limit=1&cursor=${encodeURIComponent(cursor!)}`);
    expect(second.rows.map((r) => r.id)).toEqual(["pol_2"]);

    // The warehouse keeps the last cursor and polls again later: nothing new,
    // and nothing it has already loaded comes back a second time.
    const third = await feed(
      `/v1/analytics/feed/policies?cursor=${encodeURIComponent(second.res.headers.get("x-lyra-cursor")!)}`
    );
    expect(third.rows).toEqual([]);
    expect(third.res.headers.get("x-lyra-more")).toBe("false");
  });

  it("honours an incremental `since` watermark", async () => {
    await seedPolicies();
    const { rows } = await feed(`/v1/analytics/feed/policies?since=${NOW + HOUR}`);
    expect(rows.map((r) => r.id)).toEqual(["pol_2"]);
  });

  it("rejects a cursor that is not one of ours", async () => {
    await seedPolicies();
    expect((await feed("/v1/analytics/feed/policies?cursor=not-a-cursor")).status).toBe(400);
  });

  it("masks a PII column unless the caller holds core:pii:view", async () => {
    await seedPolicies();
    const masked = await feed("/v1/analytics/feed/policies", {
      actor: actor(["analytics:exports:create", "axis:policies:read"])
    });
    expect(masked.rows.map((r) => r.customer_id)).toEqual(["•us_1", "•us_2"]);

    const clear = await feed("/v1/analytics/feed/policies", {
      actor: actor(["analytics:exports:create", "axis:policies:read", "core:pii:view"])
    });
    expect(clear.rows.map((r) => r.customer_id)).toEqual(["cus_1", "cus_2"]);
  });

  it("refuses a caller who cannot read the dataset", async () => {
    await seedPolicies();
    const res = await feed("/v1/analytics/feed/policies", { actor: actor(["analytics:exports:create"]) });
    expect(res.status).toBe(403);
  });

  it("refuses a caller who can read the dataset but may not export", async () => {
    await seedPolicies();
    const res = await feed("/v1/analytics/feed/policies", { actor: actor(["axis:policies:read"]) });
    expect(res.status).toBe(403);
  });

  it("refuses an unknown dataset instead of guessing a table", async () => {
    expect((await feed("/v1/analytics/feed/core_users")).status).toBe(400);
  });

  it("records the pull in the audit log", async () => {
    await seedPolicies();
    await feed("/v1/analytics/feed/policies");
    const rows = await ctx.db.select().from(schema.auditLog);
    expect(rows.map((r) => r.action)).toContain("analytics.feed.read");
  });
});

/* --------------------------------------------------------- ANL-012 delivery */

describe("scheduled delivery", () => {
  it("runs a due schedule exactly once and files it in the recipient's inbox", async () => {
    await seedPolicies();
    const scheduleId = await seedSchedule({ recipients: ["u_recipient"] });

    const first = await runDueSchedules(system(), bucket);
    const second = await runDueSchedules(system(), bucket);
    expect([first, second]).toEqual([1, 0]);

    const exports_ = await ctx.db.select().from(schema.analyticsExports);
    expect(exports_.length).toBe(1);
    expect(exports_[0]?.state).toBe("ready");
    expect(stored.size).toBe(1);

    const notes = await ctx.db.select().from(schema.notifications);
    expect(notes.length).toBe(1);
    expect(notes[0]?.userId).toBe("u_recipient");
    // Rule 7: an inbox row carries an i18n key, never an English sentence.
    expect(notes[0]?.titleKey).toMatch(/^[a-z0-9_.]+$/);
    expect(notes[0]?.subjectRef).toBe(exports_[0]?.id);

    const row = (await ctx.db.select().from(schema.analyticsSchedules).where(eq(schema.analyticsSchedules.id, scheduleId)))[0];
    expect(row?.lastState).toBe("done");
    expect(row?.lastRunAt).toBe(NOW);
    expect(row?.nextRunAt).toBeGreaterThan(NOW);

    const audit = await ctx.db.select().from(schema.auditLog);
    expect(audit.map((a) => a.action)).toContain("analytics.schedule.deliver");
  });

  it("leaves a paused schedule alone", async () => {
    await seedPolicies();
    await seedSchedule({ status: "paused" });
    expect(await runDueSchedules(system(), bucket)).toBe(0);
  });

  it("leaves a schedule that is not due yet alone", async () => {
    await seedPolicies();
    await seedSchedule({ nextRunAt: NOW + HOUR });
    expect(await runDueSchedules(system(), bucket)).toBe(0);
  });

  it("stays inside the schedule's tenant", async () => {
    await seedPolicies();
    await seedSchedule({});
    // The scheduler for another tenant must not deliver this one.
    expect(await runDueSchedules({ ...system(), tenantId: "t_other" }, bucket)).toBe(0);
  });

  it("alerts the owner when a run fails, and reschedules rather than wedging", async () => {
    const scheduleId = await seedSchedule({ reportId: "rep_missing" });
    expect(await runDueSchedules(system(), bucket)).toBe(0);

    const row = (await ctx.db.select().from(schema.analyticsSchedules).where(eq(schema.analyticsSchedules.id, scheduleId)))[0];
    expect(row?.lastState).toBe("failed");
    expect(row?.nextRunAt).toBeGreaterThan(NOW);

    const notes = await ctx.db.select().from(schema.notifications);
    expect(notes.length).toBe(1);
    expect(notes[0]?.userId).toBe("u_owner");
    expect(notes[0]?.kind).toBe("alert");
  });

  it("alerts the owner when a recipient has nowhere to deliver to", async () => {
    await seedPolicies();
    await seedSchedule({ recipients: ["u_recipient", "nobody@example.com"] });
    expect(await runDueSchedules(system(), bucket)).toBe(1);

    const row = (await ctx.db.select().from(schema.analyticsSchedules))[0];
    expect(row?.lastState).toBe("partial");
    const notes = await ctx.db.select().from(schema.notifications);
    expect(notes.filter((n) => n.kind === "alert").map((n) => n.userId)).toEqual(["u_owner"]);
  });

  it("masks PII in a scheduled artefact — the scheduler holds no permissions", async () => {
    await seedPolicies();
    await seedSchedule({ format: "csv", dimensions: ["customerId"] });
    expect(await runDueSchedules(system(), bucket)).toBe(1);
    const csv = new TextDecoder().decode([...stored.values()][0]!);
    expect(csv).not.toContain("cus_1");
  });
});

/* -------------------------------------------------------------------- seeds */

/** The cron actor: a system principal with no grants at all. */
function system(): Ctx {
  return { ...ctx, actor: { kind: "system", id: "scheduler", tenantId: ctx.tenantId, grants: [] } };
}

async function seedPolicies(): Promise<void> {
  const base = {
    tenantId: "t_test",
    providerId: "prv_1",
    offeringId: "off_1",
    status: "active",
    currency: "AED",
    endAt: NOW + 365 * 24 * HOUR,
    commissionMinor: 0,
    createdAt: NOW,
    updatedAt: NOW
  };
  await ctx.db.insert(schema.axisPolicies).values([
    { ...base, id: "pol_1", policyNo: "P-1", customerId: "cus_1", premiumMinor: 125_00, startAt: NOW },
    { ...base, id: "pol_2", policyNo: "P-2", customerId: "cus_2", premiumMinor: 175_00, startAt: NOW + HOUR },
    { ...base, id: "pol_3", policyNo: "P-3", customerId: "cus_3", premiumMinor: 999_00, startAt: NOW, tenantId: "t_other" }
  ]);
}

async function seedSchedule(over: {
  recipients?: string[];
  status?: string;
  nextRunAt?: number;
  reportId?: string;
  format?: string;
  dimensions?: string[];
}): Promise<string> {
  if (!over.reportId) {
    await ctx.db.insert(schema.reports).values({
      id: "rep_1",
      tenantId: "t_test",
      key: "gwp",
      module: "axis",
      nameJson: JSON.stringify({ en: "Premium" }),
      definitionJson: JSON.stringify({
        dataset: "policies",
        metrics: ["gwp"],
        ...(over.dimensions ? { dimensions: over.dimensions } : {})
      }),
      piiLevel: "none",
      requiredPermission: "axis:policies:read",
      ownerRef: "user:u_owner",
      scope: "tenant",
      system: false,
      createdAt: NOW,
      updatedAt: NOW
    });
  }
  const id = "sch_1";
  await ctx.db.insert(schema.analyticsSchedules).values({
    id,
    tenantId: "t_test",
    reportId: over.reportId ?? "rep_1",
    dashboardId: null,
    nameJson: JSON.stringify({ en: "Weekly premium" }),
    cron: "0 6 * * *",
    timezone: "Asia/Dubai",
    format: over.format ?? "csv",
    recipientsJson: JSON.stringify(over.recipients ?? ["u_owner"]),
    paramsJson: null,
    locale: "en",
    status: over.status ?? "active",
    lastRunAt: null,
    lastState: null,
    nextRunAt: over.nextRunAt ?? NOW - HOUR,
    createdBy: "user:u_owner",
    createdAt: NOW,
    updatedAt: NOW
  });
  return id;
}
