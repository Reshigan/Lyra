import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeAll, describe, expect, it } from "vitest";
import { id as newId, schema } from "@lyra/db";
import { EntitlementsJson, PolicyJson } from "@lyra/db";
import { permissionsForRole, seed, type Ctx } from "@lyra/core";
import { Gateway, makeStub } from "@lyra/model-gateway";
import { registerFnol } from "./axis-fnol.js";

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
  const r = await seed(db, { password: "axis-fnol-test-password-2026" });
  tenantId = r.tenantId;
  ctx = {
    db,
    tenantId,
    actor: {
      kind: "user",
      id: "u_1",
      tenantId,
      grants: [{ roleKey: "axis.admin", permissions: permissionsForRole("axis.admin") }]
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

/** A policy in force across `ctx.now`, with an `effective` version §G.1 tests can register a claim against. */
async function seedPolicy(): Promise<string> {
  const at = ctx.now;
  const policyId = newId("pol", at);
  const versionId = newId("plv", at);
  const startAt = at - 30 * 24 * 3600 * 1000;
  const endAt = at + 335 * 24 * 3600 * 1000;

  await ctx.db.insert(schema.axisPolicies).values({
    id: policyId,
    tenantId,
    customerId: `cust_${policyId}`,
    providerId: "prov_test",
    policyNo: `POL-${policyId}`,
    currentVersionId: versionId,
    versionSeq: 1,
    startAt,
    endAt,
    premiumMinor: 100_000,
    currency: "AED",
    status: "active",
    createdAt: at,
    updatedAt: at
  } as never);

  await ctx.db.insert(schema.axisPolicyVersions).values({
    id: versionId,
    tenantId,
    policyId,
    versionSeq: 1,
    reason: "issue",
    effectiveFrom: startAt,
    effectiveTo: endAt,
    premiumMinor: 100_000,
    currency: "AED",
    termsJson: JSON.stringify({ excessMinor: 50_000, limits: { thirdParty: 1_000_000 } }),
    state: "effective",
    issuedBy: "u_1",
    issuedAt: at,
    createdAt: at,
    updatedAt: at
  } as never);

  return policyId;
}

describe("registerFnol §G.1 triage", () => {
  it("fills blank perilCode/causeCode/complexity through the gateway and stashes the audit id", async () => {
    const policyId = await seedPolicy();
    const { stub, gw } = stubbedGateway({
      replies: ['{"perilCode":"collision","causeCode":"third_party","complexity":"standard"}']
    });

    const { claim } = await registerFnol(
      ctx,
      { policyId, description: "Rear-ended at a red light by another driver." },
      gw
    );

    expect(stub.calls[0]!.module).toBe("axis");
    expect(stub.calls[0]!.purpose).toBe("axis.fnol.triage");
    expect(stub.calls[0]!.tier).toBe("fast");

    expect(claim.perilCode).toBe("collision");
    expect(claim.causeCode).toBe("third_party");
    expect(claim.complexity).toBe("standard");

    const fnol = JSON.parse(claim.fnolJson!) as { triage?: { perilCode: string; aiAuditId: string } };
    expect(fnol.triage?.perilCode).toBe("collision");
    expect(fnol.triage?.aiAuditId).toBeTruthy();
  });

  it("never overwrites a typed-in perilCode/causeCode, and never calls the gateway for them", async () => {
    const policyId = await seedPolicy();
    const { stub, gw } = stubbedGateway({
      replies: ['{"perilCode":"fire","causeCode":"electrical_fault","complexity":"complex"}']
    });

    const { claim } = await registerFnol(
      ctx,
      {
        policyId,
        perilCode: "collision",
        causeCode: "third_party",
        description: "Rear-ended at a red light by another driver."
      },
      gw
    );

    expect(stub.calls.length).toBe(0);
    expect(claim.perilCode).toBe("collision");
    expect(claim.causeCode).toBe("third_party");
    expect(claim.complexity).toBe("standard");
  });

  it("falls back to null codes and standard complexity when the gateway call fails", async () => {
    const policyId = await seedPolicy();
    const { gw } = stubbedGateway({ fail: new Error("boom") });

    const { claim } = await registerFnol(
      ctx,
      { policyId, description: "Rear-ended at a red light by another driver." },
      gw
    );

    expect(claim.perilCode).toBeNull();
    expect(claim.causeCode).toBeNull();
    expect(claim.complexity).toBe("standard");
  });

  it("registers a claim with no triage at all when no gateway is passed", async () => {
    const policyId = await seedPolicy();

    const { claim } = await registerFnol(ctx, { policyId, description: "Rear-ended at a red light." });

    expect(claim.perilCode).toBeNull();
    expect(claim.causeCode).toBeNull();
    expect(claim.complexity).toBe("standard");
    const fnol = JSON.parse(claim.fnolJson!) as { triage?: unknown };
    expect(fnol.triage).toBeUndefined();
  });
});
