import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { id as newId, schema } from "@lyra/db";
import { EntitlementsJson, PolicyJson } from "@lyra/db";
import { permissionsForRole, seed, type Ctx } from "@lyra/core";
import { Gateway, makeStub } from "@lyra/model-gateway";
import { sweepWhitespace } from "./scout-whitespace.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "..", "packages", "db", "migrations");

function migrationStatements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

let client: Client;
let ctx: Ctx;
let tenantId: string;

beforeAll(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of migrationStatements()) await client.execute(sql);
  const db = drizzle(client) as unknown as Ctx["db"];
  const r = await seed(db, { password: "scout-whitespace-test-password-2026" });
  tenantId = r.tenantId;
  ctx = {
    db,
    tenantId,
    actor: {
      kind: "user",
      id: "u_1",
      tenantId,
      grants: [{ roleKey: "scout.admin", permissions: permissionsForRole("scout.admin") }]
    },
    requestId: "req_1",
    now: Date.UTC(2026, 0, 6, 8, 0, 0),
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  };
}, 120_000);

function stubbedGateway(opts?: { replies?: string[]; fail?: Error }): { stub: ReturnType<typeof makeStub>; gw: Gateway } {
  const stub = makeStub(opts?.fail ? { fail: opts.fail } : opts?.replies ? { replies: opts.replies } : {});
  return { stub, gw: new Gateway({ env: {}, providers: { "workers-ai": stub, anthropic: stub, "openai-compat": stub } }) };
}

// clusterSignals' novelty term wants distinct customers; checkKAnonymity's
// DEFAULT_K_FLOOR (20) wants a cell this size or bigger to come out `visible`.
// "motor" already has seed's own case/quote plus two active policies, so a
// fresh category with zero coverage and 20 same-window quotes clears both the
// momentum-above-average and coverage-below-average bars against it.
async function seedQuoteCluster(category: string, count: number, at: number): Promise<void> {
  const rows = Array.from({ length: count }, (_, i) => ({
    caseId: newId("cs", at + i),
    quoteId: newId("qt", at + i)
  }));
  await ctx.db.insert(schema.axisCases).values(
    rows.map((r, i) => ({
      id: r.caseId,
      tenantId,
      ref: `WSP-TEST-${category}-${i}`,
      kind: "quote",
      customerId: `cust_${category}_${i}`,
      productLine: category,
      status: "quoted",
      source: "web",
      createdAt: at,
      updatedAt: at
    })) as never
  );
  await ctx.db.insert(schema.axisQuotes).values(
    rows.map((r) => ({
      id: r.quoteId,
      tenantId,
      caseId: r.caseId,
      providerId: "prov_test",
      premiumMinor: 100_000,
      currency: "AED",
      source: "manual",
      createdAt: at,
      updatedAt: at
    })) as never
  );
}

describe("sweepWhitespace", () => {
  it("drafts a candidate's description through the gateway and persists the reply", async () => {
    await seedQuoteCluster("home", 20, ctx.now);
    const { stub, gw } = stubbedGateway({ replies: ["Home demand is climbing fast against a thin book."] });

    const count = await sweepWhitespace(ctx, gw);
    expect(count).toBe(1);
    expect(stub.calls[0]!.module).toBe("scout");
    expect(stub.calls[0]!.purpose).toBe("whitespace.describe");
    expect(stub.calls[0]!.tier).toBe("reasoning");

    const [row] = await ctx.db
      .select()
      .from(schema.scoutWhitespaces)
      .where(and(eq(schema.scoutWhitespaces.tenantId, tenantId), eq(schema.scoutWhitespaces.category, "home")));
    expect(row).toBeDefined();
    expect(row!.description).toBe("Home demand is climbing fast against a thin book.");
  });

  it("falls back to the deterministic template when the gateway call fails", async () => {
    await seedQuoteCluster("travel", 20, ctx.now);
    const { gw } = stubbedGateway({ fail: new Error("boom") });

    const count = await sweepWhitespace(ctx, gw);
    expect(count).toBe(1);

    const [row] = await ctx.db
      .select()
      .from(schema.scoutWhitespaces)
      .where(and(eq(schema.scoutWhitespaces.tenantId, tenantId), eq(schema.scoutWhitespaces.category, "travel")));
    expect(row).toBeDefined();
    expect(row!.description).toMatch(/^travel: demand momentum \d+ vs\. \d+ policies on the book$/);
  });
});
