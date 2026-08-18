import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { schema } from "@lyra/db";
import type { Ctx } from "@lyra/core";
import { TXN_PRECONDITIONS } from "./preconditions.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "db", "migrations");

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

let ctx: Ctx;

async function freshCtx(): Promise<Ctx> {
  const client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  return {
    db: drizzle(client) as unknown as Ctx["db"],
    tenantId: "t_test",
    actor: {
      kind: "user",
      id: "u_test",
      tenantId: "t_test",
      grants: [{ roleKey: "owner", permissions: ["*:*:*"] }]
    },
    requestId: "req_test",
    now: Date.UTC(2026, 5, 15, 12),
    locale: "en",
    policy: {} as any,
    entitlements: {} as any
  };
}

beforeEach(async () => {
  ctx = await freshCtx();
});

describe("AD-PLACEMENT precondition", () => {
  it("refuses when no disclosure has been presented for the subjectRef", async () => {
    const precondition = TXN_PRECONDITIONS["AD-PLACEMENT"]!;
    await expect(precondition(ctx, { subjectRef: "campaign:no-disclosure" })).rejects.toThrow();
  });

  it("refuses when the disclosure is older than 24 hours", async () => {
    await ctx.db.insert(schema.disclosures).values({
      id: "dsc_stale",
      tenantId: ctx.tenantId,
      key: "ad_placement",
      locale: "en",
      subjectRef: "campaign:stale",
      customerId: null,
      wordingHash: "deadbeef",
      wordingRef: null,
      criteriaJson: null,
      channel: "web",
      acknowledgedAt: null,
      ts: ctx.now - 25 * 60 * 60 * 1000
    });
    const precondition = TXN_PRECONDITIONS["AD-PLACEMENT"]!;
    await expect(precondition(ctx, { subjectRef: "campaign:stale" })).rejects.toThrow();
  });

  it("passes when a fresh disclosure exists for the subjectRef", async () => {
    await ctx.db.insert(schema.disclosures).values({
      id: "dsc_fresh",
      tenantId: ctx.tenantId,
      key: "ad_placement",
      locale: "en",
      subjectRef: "campaign:fresh",
      customerId: null,
      wordingHash: "deadbeef",
      wordingRef: null,
      criteriaJson: null,
      channel: "web",
      acknowledgedAt: null,
      ts: ctx.now - 60 * 60 * 1000
    });
    const precondition = TXN_PRECONDITIONS["AD-PLACEMENT"]!;
    await expect(precondition(ctx, { subjectRef: "campaign:fresh" })).resolves.toBeUndefined();
  });
});

function fakeCtx(aggregationMin: number, status = "published") {
  return {
    tenantId: "t1",
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{ aggregationMin, status }])
        })
      })
    }
  } as any;
}

/**
 * AppError carries the human-readable title as `message` and the specific
 * cause as `detail` (see ledger.test.ts), so asserting on `toThrow(/…/)`
 * would only ever test the fixed "Conflict" title — assert on `detail`.
 */
async function rejects(p: Promise<unknown>, detail: RegExp): Promise<void> {
  await expect(p).rejects.toThrow();
  try {
    await p;
  } catch (e) {
    expect((e as { detail?: string }).detail ?? String(e)).toMatch(detail);
  }
}

describe("TXN_PRECONDITIONS[DPROD-DELIVER]", () => {
  it("throws conflict when cellCount is below the product's aggregationMin", async () => {
    const c = fakeCtx(50);
    await rejects(
      TXN_PRECONDITIONS["DPROD-DELIVER"]!(c, { dataProductId: "dp1", cellCount: 10 }),
      /k-anonymity/i
    );
  });

  it("refuses a product that is not published, whatever the cell count", async () => {
    // A draft was never approved for sale and a suspended one has been pulled,
    // often for the same disclosure reasons this gate exists to enforce.
    await rejects(
      TXN_PRECONDITIONS["DPROD-DELIVER"]!(fakeCtx(50, "draft"), { dataProductId: "dp1", cellCount: 500 }),
      /not published/i
    );
    await rejects(
      TXN_PRECONDITIONS["DPROD-DELIVER"]!(fakeCtx(50, "suspended"), { dataProductId: "dp1", cellCount: 500 }),
      /not published/i
    );
  });

  it("passes when cellCount meets the product's aggregationMin", async () => {
    const c = fakeCtx(50);
    await expect(
      TXN_PRECONDITIONS["DPROD-DELIVER"]!(c, { dataProductId: "dp1", cellCount: 50 })
    ).resolves.toBeUndefined();
  });
});
