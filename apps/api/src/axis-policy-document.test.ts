import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson, schema } from "@lyra/db";
import type { Ctx } from "@lyra/core";
import { issuePolicyDocument } from "./engines/axis-policy-document.js";

// docs/27 F5 §D.11. The certificate is the document handed to a third party, so
// the one thing it must never do is fail to exist: the cover dates it prints
// come off a stored version row, and a row written before the API bounded its
// write surfaces can hold an instant no `Date` can. `toISOString()` throws
// RangeError on those, and the throw is mid-render — no document at all, rather
// than a document with one unreadable line.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const NOW = Date.UTC(2026, 5, 15, 12);
const YEAR = 365 * 86_400_000;

let ctx: Ctx;

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  const statements = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) await client.execute(stmt);
  ctx = {
    db: drizzle(client) as unknown as Ctx["db"],
    tenantId: "t_test",
    actor: {
      kind: "user",
      id: "u_runner",
      tenantId: "t_test",
      grants: [{ roleKey: "owner", permissions: ["*:*:*"] }]
    },
    requestId: "req_doc",
    now: NOW,
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  };
});

/** One bound contract and its version-1 terms, with the cover dates given. */
async function policyWithCover(effectiveFrom: number, effectiveTo: number) {
  const policy = {
    id: "pol_1",
    tenantId: ctx.tenantId,
    customerId: "cus_1",
    providerId: "prv_1",
    policyNo: "POL-0001",
    startAt: effectiveFrom,
    endAt: effectiveTo,
    premiumMinor: 120_000,
    currency: "AED",
    currentVersionId: "pov_1",
    status: "active",
    createdAt: NOW,
    updatedAt: NOW
  };
  await ctx.db.insert(schema.axisPolicies).values(policy);
  await ctx.db.insert(schema.axisPolicyVersions).values({
    id: "pov_1",
    tenantId: ctx.tenantId,
    policyId: policy.id,
    versionSeq: 1,
    reason: "issue",
    effectiveFrom,
    effectiveTo,
    premiumMinor: 120_000,
    currency: "AED",
    termsJson: JSON.stringify({ cover: "comprehensive" }),
    state: "effective",
    issuedBy: "user:u_runner",
    issuedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW
  });
  return policy as never;
}

describe("policy document — cover dates no Date can hold", () => {
  it("issues the certificate anyway", async () => {
    const policy = await policyWithCover(NOW - YEAR, 9e15);

    const issued = await issuePolicyDocument(ctx, policy, { kind: "certificate" });

    expect(issued.kind).toBe("certificate");
    const files = await ctx.db.select().from(schema.files);
    expect(files).toHaveLength(1);
  });

  it("still issues one for a term a Date can hold", async () => {
    const policy = await policyWithCover(NOW - YEAR, NOW);

    const issued = await issuePolicyDocument(ctx, policy, { kind: "certificate" });

    expect(issued.kind).toBe("certificate");
  });
});
