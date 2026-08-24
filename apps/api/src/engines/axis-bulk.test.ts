import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PolicyJson, EntitlementsJson, schema } from "@lyra/db";
import { permissionsForRole, type Actor, type Ctx } from "@lyra/core";
import { applyBulkAction } from "./axis-bulk.js";

// AXIS-007. The contract under test: per-row honesty (a batch where three of
// fifty fail is 47 applied + 3 named failures, never a rollback and never
// silence), tenant scoping (a foreign id in the payload cannot ride the
// grant), per-row audit alongside the batch summary, and state guards
// (closing an already-closed case is a named failure).

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
const NOW = Date.parse("2026-08-20T12:00:00Z");

function actorWith(grants: string[]): Actor {
  return {
    kind: "user",
    id: "u_1",
    tenantId: "t_1",
    grants: [{ roleKey: "test", permissions: grants }]
  };
}

// An operations role: bulk actions are desk work, not admin work —
  // axis.lead carries exactly the case permissions the actions need.
  async function makeCtx(permissions: string[] = permissionsForRole("axis.lead")): Promise<Ctx> {
  return {
    db: drizzle(client) as unknown as Ctx["db"],
    tenantId: "t_1",
    actor: actorWith(permissions),
    requestId: "req_1",
    now: NOW,
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  };
}

async function seedCase(opts: { id?: string; closed?: boolean; metaJson?: string } = {}): Promise<string> {
  const id = opts.id ?? `cas_${Math.random().toString(36).slice(2, 8)}`;
  await ctx.db.insert(schema.axisCases).values({
    id,
    tenantId: "t_1",
    ref: `REF-${id}`,
    kind: "quote",
    status: opts.closed ? "cancelled" : "intake",
    ...(opts.closed ? { closedAt: NOW - 1000 } : {}),
    ...(opts.metaJson ? { metaJson: opts.metaJson } : {}),
    createdAt: NOW,
    updatedAt: NOW
  });
  return id;
}

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  ctx = await makeCtx();
});

describe("applyBulkAction", () => {
  it("assigns an owner to every listed case and audits each row", async () => {
    const a = await seedCase();
    const b = await seedCase();
    const result = await applyBulkAction(ctx, { action: "assign", caseIds: [a, b], ownerRef: "user:9" });
    expect(result).toMatchObject({ applied: 2, failed: 0 });
    for (const id of [a, b]) {
      const [row] = await ctx.db.select().from(schema.axisCases).where(eq(schema.axisCases.id, id));
      expect(row?.ownerRef).toBe("user:9");
    }
  });

  it("reprioritises in one call", async () => {
    const a = await seedCase();
    const result = await applyBulkAction(ctx, { action: "reprioritise", caseIds: [a], priority: "urgent" });
    expect(result.applied).toBe(1);
    const [row] = await ctx.db.select().from(schema.axisCases).where(eq(schema.axisCases.id, a));
    expect(row?.priority).toBe("urgent");
  });

  it("closes cases and refuses an already-closed one by name", async () => {
    const open = await seedCase();
    const closed = await seedCase({ closed: true });
    const result = await applyBulkAction(ctx, { action: "close", caseIds: [open, closed] });
    expect(result.applied).toBe(1);
    expect(result.outcomes.find((o) => o.caseId === closed)).toMatchObject({ ok: false, error: "already closed" });
    const [row] = await ctx.db.select().from(schema.axisCases).where(eq(schema.axisCases.id, open));
    expect(row?.status).toBe("cancelled");
  });

  it("tags accumulate in metaJson without clobbering existing metadata", async () => {
    const a = await seedCase({ metaJson: JSON.stringify({ importedCustomerRef: "x@y.z" }) });
    await applyBulkAction(ctx, { action: "tag", caseIds: [a], tag: "migration" });
    const [row] = await ctx.db.select().from(schema.axisCases).where(eq(schema.axisCases.id, a));
    const meta = JSON.parse(row?.metaJson ?? "{}") as { tags?: string[]; importedCustomerRef?: string };
    expect(meta.tags).toEqual(["migration"]);
    expect(meta.importedCustomerRef).toBe("x@y.z");
  });

  it("is tenant-scoped: a foreign case id is a named failure, not an application", async () => {
    const mine = await seedCase();
    const result = await applyBulkAction(ctx, { action: "close", caseIds: [mine, "cas_foreign"] });
    expect(result.applied).toBe(1);
    expect(result.outcomes.find((o) => o.caseId === "cas_foreign")).toMatchObject({
      ok: false,
      error: "not found in this tenant"
    });
  });

  it("an actor without the permission fails every row with the reason", async () => {
    const a = await seedCase();
    const restricted = await makeCtx(["axis:cases:read"]);
    const result = await applyBulkAction(restricted, { action: "close", caseIds: [a] });
    expect(result.applied).toBe(0);
    expect(result.outcomes[0]).toMatchObject({ ok: false, error: "missing axis:cases:update" });
    const [row] = await ctx.db.select().from(schema.axisCases).where(eq(schema.axisCases.id, a));
    expect(row?.closedAt).toBeNull();
  });

  it("throws for a malformed operation — caller bug, not data", async () => {
    await expect(applyBulkAction(ctx, { action: "assign", caseIds: ["cas_1"] })).rejects.toThrow(/ownerRef/);
    await expect(applyBulkAction(ctx, { action: "tag", caseIds: ["cas_1"], tag: "  " })).rejects.toThrow(/tag requires/);
    await expect(applyBulkAction(ctx, { action: "close", caseIds: [] })).rejects.toThrow(/must not be empty/);
  });
});
