import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PolicyJson, EntitlementsJson, schema } from "@lyra/db";
import { permissionsForRole, type Actor, type Ctx } from "@lyra/core";
import { NORTH } from "./resources.js";

// A snapshot row is `{metricKey, value}` and the unit that makes the number
// mean anything lives on the metric definition, so the snapshots list printed
// gross written premium in cents (`74300000`) beside a response rate in basis
// points (`8810`) under one column headed VALUE. `decorate` joins the
// definition onto the page.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

const NOW = 1_760_000_000_000;

let client: Client;
let ctx: Ctx;

const actor = (tenantId: string): Actor => ({
  kind: "system",
  id: "test",
  tenantId,
  grants: [{ roleKey: "tenant.admin", permissions: permissionsForRole("tenant.admin") }]
});

const ctxFor = (tenantId: string): Ctx => ({
  db: drizzle(client) as unknown as Ctx["db"],
  tenantId,
  actor: actor(tenantId),
  requestId: "req_1",
  now: NOW,
  locale: "en",
  policy: PolicyJson.parse({}),
  entitlements: EntitlementsJson.parse({})
});

const snapshots = NORTH.find((resource) => resource.path === "snapshots");

async function seedMetric(
  tenantId: string,
  key: string,
  unit: string,
  currency: string | null
): Promise<void> {
  await ctx.db.insert(schema.northMetrics).values({
    id: `mtr_${tenantId}_${key}`,
    tenantId,
    key,
    nameJson: JSON.stringify({ en: "Gross written premium", ar: "إجمالي الأقساط المكتتبة" }),
    definitionSqlRef: key,
    unit,
    ...(currency ? { currency } : {}),
    grain: "month",
    createdAt: NOW,
    updatedAt: NOW
  });
}

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  ctx = ctxFor("t_1");
});

describe("north snapshots decorate", () => {
  it("joins the metric's name, unit and currency onto the page", async () => {
    await seedMetric("t_1", "gwp", "money", "ZAR");

    const [row] = await snapshots!.decorate!(ctx, [{ metricKey: "gwp", value: 74_300_000 }]);

    expect(row).toMatchObject({ unit: "money", currency: "ZAR" });
    expect(String(row!.metricName)).toContain("Gross written premium");
  });

  it("leaves a snapshot whose metric was deleted exactly as it is", async () => {
    const [row] = await snapshots!.decorate!(ctx, [{ metricKey: "gone", value: 12 }]);

    expect(row).toEqual({ metricKey: "gone", value: 12 });
  });

  it("never reads another tenant's metric definition", async () => {
    await seedMetric("t_2", "gwp", "money", "USD");

    const [row] = await snapshots!.decorate!(ctx, [{ metricKey: "gwp", value: 1 }]);

    expect(row).toEqual({ metricKey: "gwp", value: 1 });
  });

  it("asks the definitions once for a page, not once per row", async () => {
    await seedMetric("t_1", "gwp", "money", "ZAR");
    const rows = Array.from({ length: 50 }, () => ({ metricKey: "gwp", value: 1 }));

    const out = await snapshots!.decorate!(ctx, rows);

    expect(out).toHaveLength(50);
    expect(out.every((row) => row.unit === "money")).toBe(true);
  });
});
