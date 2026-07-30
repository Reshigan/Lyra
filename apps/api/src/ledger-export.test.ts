import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { seed } from "@lyra/core";
import { schema, type Db } from "@lyra/db";
import { app } from "./index.js";
import type { Env } from "./env.js";

// LED-REP. The finance reports as files: same permission as the screen beside
// them, same numbers, and a row in the audit log every time one leaves.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

const exec = { waitUntil() {}, passThroughOnException() {} };

let database: Db;
let env: Env;
const tokens: Record<string, string> = {};

/** The controller reads everything; the analyst reads journals but not client money. */
const CONTROLLER = "faisal.omar@gonxt.ae";
const ANALYST = "rana.hadid@gonxt.ae";

async function fetchAs(email: string | null, path: string, method = "GET", payload?: unknown): Promise<Response> {
  const token = email ? tokens[email] : undefined;
  return app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
    }),
    env as never,
    exec as never
  );
}

beforeAll(async () => {
  const client = createClient({ url: ":memory:" });
  for (const stmt of statements()) await client.execute(stmt);
  database = drizzle(client) as unknown as Db;
  await seed(database as never);
  env = {
    DB_CLIENT: database,
    // Staging so the persona door is open — the password path costs a TOTP and
    // proves nothing about exports.
    ENVIRONMENT: "staging",
    APP_ORIGIN: "http://localhost:5173"
  } as unknown as Env;

  for (const email of [CONTROLLER, ANALYST]) {
    const res = await fetchAs(null, "/v1/auth/demo/login", "POST", { email });
    const body = (await res.json()) as { token: string };
    tokens[email] = body.token;
  }

  // Real money in the ledger, so an export is a report and not an empty grid.
  const posted = await fetchAs(CONTROLLER, "/v1/ledger/txn/PREM-COLLECT", "POST", {
    idempotencyKey: "led-export-collect-1",
    currency: "AED",
    grossMinor: 120_000_00,
    args: { amountMinor: 120_000_00, memo: "premium received" }
  });
  expect(posted.status).toBe(201);
}, 60_000);

describe("finance report exports", () => {
  const CASES = [
    ["xlsx", "spreadsheetml.sheet", "PK"],
    ["pdf", "application/pdf", "%PDF"],
    // The CSV opens on a UTF-8 BOM, so its signature starts three bytes in.
    ["csv", "text/csv", "Acc"],
    ["json", "application/json", "{"]
  ] as const;

  for (const [format, contentType, magic] of CASES) {
    it(`renders the trial balance as ${format}`, async () => {
      const res = await fetchAs(CONTROLLER, `/v1/ledger/reports/trial-balance/export?format=${format}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain(contentType);
      expect(res.headers.get("content-disposition")).toContain(`filename="trial-balance-`);

      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(bytes.byteLength).toBeGreaterThan(64);
      // The first bytes are the format's own signature: a file that opens, not
      // a placeholder with the right content-type on it.
      expect(new TextDecoder().decode(bytes.slice(0, 8))).toContain(magic);
    });
  }

  it("puts real numbers, in minor units under a money column, into the payload", async () => {
    const res = await fetchAs(CONTROLLER, "/v1/ledger/reports/trial-balance/export?format=json");
    const table = (await res.json()) as {
      columns: { key: string; label: string; kind: string }[];
      rows: Record<string, number>[];
      totals: Record<string, number>;
    };
    const debit = table.columns.find((c) => c.key === "debitMinor");
    expect(debit?.kind).toBe("money");
    // The currency rides in the header so the number stays a number.
    expect(debit?.label).toContain("AED");
    expect(table.rows.length).toBeGreaterThan(0);
    expect(table.totals.debitMinor).toBe(120_000_00);
    expect(table.totals.debitMinor).toBe(table.totals.creditMinor);
  });

  it("exports every report the screen can show", async () => {
    for (const key of ["trial-balance", "pnl", "balance-sheet", "aged", "commission", "client-money"]) {
      const res = await fetchAs(CONTROLLER, `/v1/ledger/reports/${key}/export?format=csv`);
      expect(res.status, key).toBe(200);
      const text = await res.text();
      // Header row at least — a report with no rows still names its columns.
      expect(text.split("\r\n")[0]!.length, key).toBeGreaterThan(0);
    }
  });

  it("refuses an unknown report and an unknown format", async () => {
    expect((await fetchAs(CONTROLLER, "/v1/ledger/reports/nonsense/export")).status).toBe(404);
    expect((await fetchAs(CONTROLLER, "/v1/ledger/reports/pnl/export?format=doc")).status).toBe(400);
  });

  it("gates each report on that report's own permission", async () => {
    // The analyst holds ledger:journals:read and not ledger:client_money:read,
    // so the same door opens on one report and stays shut on the other.
    expect((await fetchAs(ANALYST, "/v1/ledger/reports/trial-balance/export?format=csv")).status).toBe(200);
    expect((await fetchAs(ANALYST, "/v1/ledger/reports/client-money/export?format=csv")).status).toBe(403);
    expect((await fetchAs(null, "/v1/ledger/reports/trial-balance/export?format=csv")).status).toBe(401);
  });

  it("writes an audit row for every export", async () => {
    const rows = await database
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "ledger.report.export"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.subjectRef === "report:client-money")).toBe(true);
  });
});
