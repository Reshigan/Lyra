import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PolicyJson, EntitlementsJson, schema } from "@lyra/db";
import { permissionsForRole, type Actor, type Ctx } from "@lyra/core";
import { importCases, parseCsv, validateRow } from "./axis-case-import.js";

// AXIS-001's bulk half. These tests pin the parser's RFC 4180 honesty
// (quoted commas, escaped quotes), the per-row contract (every row either
// becomes a case or appears in errors with its line number — never silently
// dropped), duplicate handling as a boring skip rather than an alarm, and
// the wholesale refusal when the file lacks a required column.

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

function actor(): Actor {
  return {
    kind: "system",
    id: "scheduler",
    tenantId: "t_1",
    grants: [{ roleKey: "tenant.admin", permissions: permissionsForRole("tenant.admin") }]
  };
}

async function makeCtx(now = NOW): Promise<Ctx> {
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

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  ctx = await makeCtx();
});

describe("parseCsv", () => {
  it("parses plain rows", () => {
    const { rows } = parseCsv("ref,kind,customerRef\nC1,quote,a@b.c\n");
    expect(rows).toEqual([{ line: 2, cells: { ref: "C1", kind: "quote", customerRef: "a@b.c" } }]);
  });

  it("handles quoted fields containing commas and escaped quotes", () => {
    const { rows } = parseCsv('ref,note\nC1,"said ""hello, world"" twice"');
    expect(rows[0]?.cells.note).toBe('said "hello, world" twice');
  });

  it("reports malformed lines with their line number instead of dropping them", () => {
    const { parseErrors } = parseCsv("ref,kind,customerRef\nC1,quote\n");
    expect(parseErrors).toHaveLength(1);
    expect(parseErrors[0]).toMatchObject({ line: 2, ref: "C1" });
  });

  it("treats blank lines as nothing, not errors", () => {
    const { rows, parseErrors } = parseCsv("ref,kind,customerRef\n\nC1,quote,a@b.c\n");
    expect(rows).toHaveLength(1);
    expect(parseErrors).toHaveLength(0);
  });
});

describe("validateRow", () => {
  it("rejects an unknown kind with the allowed list", () => {
    const result = validateRow({ ref: "C1", kind: "magic", customerRef: "a@b.c" }, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error).toContain("kind must be one of");
  });

  it("rejects a negative valueMinor", () => {
    const result = validateRow({ ref: "C1", kind: "quote", customerRef: "a@b.c", valueMinor: "-5" }, 2);
    expect(result.ok).toBe(false);
  });

  it("folds unknown columns into extra rather than dropping them", () => {
    const result = validateRow({ ref: "C1", kind: "quote", customerRef: "a@b.c", branch: "deira" }, 2);
    expect(result.ok && result.value.extra.branch).toBe("deira");
  });
});

describe("importCases", () => {
  it("creates cases and reports per-row errors honestly", async () => {
    const csv = [
      "ref,kind,customerRef,valueMinor,currency",
      "IMP-1,quote,amina@test.example,120000,AED",
      "IMP-2,bind,unknown@nowhere.example,",
      ",quote,x@y.z,,",
      "IMP-3,magic,x@y.z,,"
    ].join("\n");

    const result = await importCases(ctx, csv);
    // IMP-1 imports; IMP-2's row is short a column (parse error); the blank
    // ref and the bad kind are row errors. Every failure is named with its
    // line — nothing silently dropped.
    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(3);
    expect(result.errors.map((e) => e.line)).toEqual([3, 4, 5]);

    const [first] = await ctx.db.select().from(schema.axisCases).where(eq(schema.axisCases.ref, "IMP-1"));
    expect(first).toMatchObject({ kind: "quote", source: "import", valueMinor: 120000, currency: "AED" });
  });

  it("links customers by email when they exist", async () => {
    await ctx.db.insert(schema.customers).values({
      id: "cus_imp",
      tenantId: "t_1",
      nameJson: JSON.stringify("Amina Al Farsi"),
      emailsJson: JSON.stringify(["amina@test.example"]),
      locale: "en",
      createdAt: NOW,
      updatedAt: NOW
    });
    await importCases(ctx, "ref,kind,customerRef\nIMP-9,quote,amina@test.example\n");
    const [row] = await ctx.db.select().from(schema.axisCases).where(eq(schema.axisCases.ref, "IMP-9"));
    expect(row?.customerId).toBe("cus_imp");
  });

  it("counts re-imported refs as duplicates, not errors", async () => {
    const csv = "ref,kind,customerRef\nIMP-1,quote,a@b.c\n";
    await importCases(ctx, csv);
    const second = await importCases(ctx, csv);
    expect(second.created).toBe(0);
    expect(second.skippedDuplicate).toBe(1);
    expect(second.errors).toHaveLength(0);
  });

  it("refuses a file missing a required column wholesale", async () => {
    // badRequest carries the detail separately from its "Bad request" title,
    // so assert on the captured error's detail, not the message.
    const promise = importCases(ctx, "ref,kind\nIMP-1,quote\n");
    await expect(promise).rejects.toMatchObject({ detail: 'import file is missing the required column "customerRef"' });
    const rows = await ctx.db.select().from(schema.axisCases);
    expect(rows).toHaveLength(0);
  });

  it("is tenant-scoped: another tenant's same-ref case does not collide", async () => {
    await importCases(ctx, "ref,kind,customerRef\nIMP-1,quote,a@b.c\n");
    const other = { ...(await makeCtx()), tenantId: "t_2" };
    const result = await importCases(other, "ref,kind,customerRef\nIMP-1,quote,a@b.c\n");
    expect(result.created).toBe(1);
    expect(result.skippedDuplicate).toBe(0);
  });
});
