import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson, schema } from "@lyra/db";
import { permissionsForRole, seed, type Ctx } from "@lyra/core";
import { Gateway, makeStub } from "@lyra/model-gateway";
import { checkCompliance, generateCreatives, parseVariants } from "./signal-creative.js";

// Same libSQL/drizzle in-memory harness as narrator.test.ts: run every
// migration once, seed the demo tenant, and reuse one Ctx across tests.

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
  const r = await seed(db, { password: "signal-creative-test-password-2026" });
  tenantId = r.tenantId;
  ctx = {
    db,
    tenantId,
    actor: {
      kind: "user",
      id: "u_1",
      tenantId,
      grants: [{ roleKey: "signal.lead", permissions: permissionsForRole("signal.lead") }]
    },
    requestId: "req_1",
    now: Date.UTC(2026, 0, 6, 8, 0, 0),
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  };
}, 120_000);

function stubbedGateway(replies?: string[]): { stub: ReturnType<typeof makeStub>; gw: Gateway } {
  const stub = makeStub(replies ? { replies } : {});
  return { stub, gw: new Gateway({ env: {}, providers: { "workers-ai": stub, anthropic: stub, "openai-compat": stub } }) };
}

const lines = (n: number, label: string): string =>
  Array.from({ length: n }, (_, i) => `${label} variant ${i + 1}: cover that fits your car, quote in minutes.`).join(
    "\n"
  );

describe("checkCompliance", () => {
  it("passes copy with no banned claim", () => {
    const result = checkCompliance("Quote your motor cover in minutes, no paperwork.");
    expect(result.status).toBe("passed");
    expect(result.findings).toEqual([]);
  });

  it("flags a guarantee-of-cover claim", () => {
    const result = checkCompliance("Guaranteed acceptance, no medical needed.");
    expect(result.status).toBe("flagged");
    expect(result.findings[0]!.rule).toBe("no_guarantee_of_cover");
  });

  it("flags an unsourced comparison superlative", () => {
    const result = checkCompliance("The cheapest motor cover in the UAE, period.");
    expect(result.status).toBe("flagged");
    expect(result.findings[0]!.rule).toBe("comparison_claim_requires_source");
  });
});

describe("parseVariants", () => {
  it("splits one variant per non-empty line", () => {
    expect(parseVariants("line one\n\nline two\n  \nline three")).toEqual(["line one", "line two", "line three"]);
  });
});

describe("generateCreatives", () => {
  it("splits the default 20 variants 10/10 across en and ar, each audited against a real ai_audit_log row", async () => {
    const { stub, gw } = stubbedGateway([lines(10, "en"), lines(10, "ar")]);

    const result = await generateCreatives(ctx, gw, {
      kind: "ad",
      brief: "Motor insurance quote-to-bind promo for the January search campaign."
    });

    expect(result.variants).toHaveLength(20);
    expect(result.variants.filter((v) => v.locale === "en")).toHaveLength(10);
    expect(result.variants.filter((v) => v.locale === "ar")).toHaveLength(10);
    expect(result.auditIds).toHaveLength(2);

    // Both gateway calls carry module/purpose/tier per CLAUDE.md rule 3.
    expect(stub.calls).toHaveLength(2);
    for (const call of stub.calls) {
      expect(call.module).toBe("signal");
      expect(call.purpose).toBe("creative.generate");
      expect(call.tier).toBe("standard");
    }

    // Every persisted row exists and links to a real ai_audit_log row.
    for (const v of result.variants) {
      const [row] = await ctx.db
        .select()
        .from(schema.signalCreatives)
        .where(and(eq(schema.signalCreatives.tenantId, tenantId), eq(schema.signalCreatives.id, v.id)));
      expect(row).toBeDefined();
      expect(row!.locale).toBe(v.locale);
      expect(row!.generatedBy).toBe("ai");
      expect(row!.aiAuditId).toBe(v.aiAuditId);
      expect(row!.complianceStatus).toBe("passed");

      const [audit] = await ctx.db
        .select()
        .from(schema.aiAuditLog)
        .where(eq(schema.aiAuditLog.id, v.aiAuditId));
      expect(audit).toBeDefined();
      expect(audit!.tenantId).toBe(tenantId);
      expect(audit!.module).toBe("signal");
      expect(audit!.purpose).toBe("creative.generate");
    }
  });

  it("persists a flagged variant rather than dropping it, and never marks it passed", async () => {
    const flaggedBatch = [
      "Clean quote-to-bind flow, cover in minutes.",
      "Guaranteed acceptance on every application.", // should flag: no_guarantee_of_cover
      "Compare your cover options with confidence.",
      "The cheapest motor cover in the UAE, full stop." // should flag: comparison_claim_requires_source
    ].join("\n");
    const { gw } = stubbedGateway([flaggedBatch]);

    const result = await generateCreatives(ctx, gw, {
      kind: "ad",
      brief: "Motor renewal nudge.",
      locales: ["en"],
      count: 4
    });

    expect(result.variants).toHaveLength(4);
    const flagged = result.variants.filter((v) => v.complianceStatus === "flagged");
    const passed = result.variants.filter((v) => v.complianceStatus === "passed");
    expect(flagged).toHaveLength(2);
    expect(passed).toHaveLength(2);
    expect(flagged.map((v) => v.complianceFindings[0]!.rule).sort()).toEqual(
      ["comparison_claim_requires_source", "no_guarantee_of_cover"].sort()
    );

    // Every variant is still written — a flagged draft is inspectable, not silently dropped.
    const rows = await ctx.db.select().from(schema.signalCreatives).where(eq(schema.signalCreatives.tenantId, tenantId));
    const ids = new Set(result.variants.map((v) => v.id));
    const persisted = rows.filter((r) => ids.has(r.id));
    expect(persisted).toHaveLength(4);
    for (const row of persisted) {
      const matching = result.variants.find((v) => v.id === row.id)!;
      expect(row.complianceStatus).toBe(matching.complianceStatus);
      if (matching.complianceStatus === "flagged") {
        expect(row.complianceNotesJson).not.toBeNull();
        const notes = JSON.parse(row.complianceNotesJson!);
        expect(notes.findings.length).toBeGreaterThan(0);
      } else {
        expect(row.complianceNotesJson).toBeNull();
      }
    }
  });

  it("keeps ar prompts native — a separate call from en, never a translation pass", async () => {
    const { stub, gw } = stubbedGateway([lines(2, "en"), lines(2, "ar")]);

    await generateCreatives(ctx, gw, {
      kind: "social",
      brief: "Health cross-sell.",
      locales: ["en", "ar"],
      count: 4
    });

    expect(stub.calls).toHaveLength(2);
    const enUser = stub.calls[0]!.messages.find((m) => m.role === "user")!.content;
    const arUser = stub.calls[1]!.messages.find((m) => m.role === "user")!.content;
    expect(enUser).toContain("English");
    expect(arUser).toContain("Arabic");
  });
});
