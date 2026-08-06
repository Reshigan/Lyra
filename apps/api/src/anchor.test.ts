import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson } from "@lyra/db";
import { audit, type Ctx } from "@lyra/core";
import { anchorAudit } from "./engines/anchor.js";

// docs/12 §1: "hash-chained daily anchors stored to R2 EXPORTS for tamper
// evidence". The chain in D1 proves nothing on its own — whoever can rewrite a
// row can rewrite every hash after it. The anchor is the copy outside the
// database, so a rewritten history stops matching something the rewriter does
// not hold.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

const NOW = Date.UTC(2026, 5, 15, 2, 5);
const DAY = "2026-06-15";
let ctx: Ctx;
let client: ReturnType<typeof createClient>;
let stored: Map<string, string>;

const bucket = () =>
  ({
    put: async (key: string, body: string) => {
      stored.set(key, body);
    },
    get: async (key: string) => {
      const body = stored.get(key);
      return body === undefined ? null : { json: async () => JSON.parse(body) };
    }
  }) as unknown as R2Bucket;

function read(key: string): Record<string, unknown> {
  const body = stored.get(key);
  if (body === undefined) throw new Error(`nothing written to ${key}`);
  return JSON.parse(body);
}

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const stmt of statements()) await client.execute(stmt);
  stored = new Map();
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

describe("anchorAudit", () => {
  it("anchors the tenant's chain tip for the day, and reports it intact", async () => {
    await audit({ ...ctx, now: NOW - 60_000 }, { action: "core.tenant.update", subjectRef: "tn_1" });
    const last = await audit({ ...ctx, now: NOW - 30_000 }, { action: "axis.case.approve", subjectRef: "cs_1" });

    const result = await anchorAudit(ctx, bucket());
    expect(result).toMatchObject({ rows: 2, breaks: [], tipHash: last.chainHash });

    const anchor = read(`audit-anchors/t_a/${DAY}.json`);
    expect(anchor).toMatchObject({
      tenantId: "t_a",
      day: DAY,
      rows: 2,
      tipHash: last.chainHash,
      breaks: [],
      prevAnchorHash: null
    });
    // The pointer is what tomorrow chains onto, so it has to move with the day.
    expect(read("audit-anchors/t_a/latest.json")).toMatchObject({
      day: DAY,
      anchorHash: anchor.anchorHash
    });
  });

  it("chains each day's anchor onto the previous one", async () => {
    await audit(ctx, { action: "core.tenant.update", subjectRef: "tn_1" });
    await anchorAudit(ctx, bucket());
    const first = read(`audit-anchors/t_a/${DAY}.json`);

    const tomorrow = { ...ctx, now: NOW + 86_400_000 };
    await audit(tomorrow, { action: "axis.case.approve", subjectRef: "cs_1" });
    await anchorAudit(tomorrow, bucket());

    const second = read("audit-anchors/t_a/2026-06-16.json");
    expect(second.prevAnchorHash).toBe(first.anchorHash);
    // Yesterday's anchor is immutable: re-anchoring a later day must not touch it.
    expect(read(`audit-anchors/t_a/${DAY}.json`)).toEqual(first);
  });

  it("records a break when a row was edited after it was written", async () => {
    await audit(ctx, { action: "core.tenant.update", subjectRef: "tn_1" });
    await audit({ ...ctx, now: NOW + 1000 }, { action: "axis.case.approve", subjectRef: "cs_1" });
    // The tamper the anchor exists to catch: rewrite history in place.
    await client.execute(`update core_audit_log set action = 'axis.case.reject' where subject_ref = 'cs_1'`);

    const result = await anchorAudit(ctx, bucket());
    expect(result?.breaks).toHaveLength(1);
    expect(read(`audit-anchors/t_a/${DAY}.json`).breaks).toMatchObject([{ reason: "hash_mismatch" }]);
  });

  it("writes nothing for a tenant with no audit rows", async () => {
    const result = await anchorAudit(ctx, bucket());
    expect(result).toMatchObject({ rows: 0 });
    expect(stored.size).toBe(0);
  });

  it("no-ops without a bucket bound", async () => {
    await expect(anchorAudit(ctx, undefined)).resolves.toBeNull();
  });
});
