import { drizzle } from "drizzle-orm/sqlite-proxy";
import { and, eq } from "drizzle-orm";
import { schema } from "@lyra/db";
import { seedHistory } from "./seed/history.js";
import { seedModuleHistory } from "./seed/history-modules.js";
import type { CoreDb } from "./context.js";

// Backfills a deployed tenant's ledger with trading history (see seed/history.ts).
// The deployed databases are D1, which has no local driver, so this talks to the
// D1 HTTP API through drizzle's sqlite-proxy: drizzle builds the SQL, the proxy
// posts it, and the seeder is the same code the unit tests run against libsql.
//
//   CF_ACCOUNT_ID=… CF_API_TOKEN=… pnpm --filter @lyra/core seed:history \
//     --database <d1-database-id> [--days 365] [--tenant <id>]
//
// Two passes: the ledger (seed/history.ts) and the operating history the ledger
// implies — contracts, claims, quotes, campaigns, statements
// (seed/history-modules.ts). Both are idempotent, so a re-run costs read traffic
// and writes nothing.
//
// The token needs D1 Write. Never pass it on the command line — it would land in
// the shell history of whoever runs this.

interface Args {
  database: string;
  days: number;
  tenant?: string | undefined;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) flags.set(argv[i]!.replace(/^--/, ""), argv[i + 1] ?? "");
  const database = flags.get("database");
  if (!database) throw new Error("seed:history: --database <d1-database-id> is required");
  return { database, days: Number(flags.get("days") ?? 365), tenant: flags.get("tenant") || undefined };
}

function makeD1Db(accountId: string, databaseId: string, token: string): CoreDb {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/raw`;

  return drizzle(async (sql, params, method) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ sql, params })
    });
    const body = (await response.json()) as {
      success: boolean;
      errors?: { message: string }[];
      result?: { results?: { rows?: unknown[][] } }[];
    };
    if (!response.ok || !body.success) {
      // D1's own message names the constraint or the parameter count, which is
      // the only useful thing here — the HTTP status never is.
      throw new Error(`D1: ${body.errors?.map((e) => e.message).join("; ") ?? response.status}`);
    }
    // `/raw` answers with positional rows, which is the shape sqlite-proxy wants;
    // `/query` answers with objects and would silently produce undefined columns.
    const rows = body.result?.[0]?.results?.rows ?? [];
    return { rows: method === "get" ? (rows[0] ?? []) : rows };
  }, { schema }) as unknown as CoreDb;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) throw new Error("seed:history: CF_ACCOUNT_ID and CF_API_TOKEN must be set");

  const db = makeD1Db(accountId, args.database, token);

  let tenantId = args.tenant;
  if (!tenantId) {
    const tenants = await db.select({ id: schema.tenants.id, slug: schema.tenants.slug }).from(schema.tenants);
    if (tenants.length !== 1) {
      throw new Error(
        `seed:history: ${tenants.length} tenants in this database — pass --tenant (${tenants.map((t) => `${t.slug}=${t.id}`).join(", ")})`
      );
    }
    tenantId = tenants[0]!.id;
  }

  // Postings are attributed to a real finance user where the tenant has one, so
  // the audit trail reads like the close it imitates rather than "system".
  const [controller] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.email, "faisal.omar@gonxt.ae")))
    .limit(1);

  const options = { days: args.days, now: Date.now(), postedBy: controller?.id };
  const ledger = await seedHistory(db, tenantId, options);
  const modules = await seedModuleHistory(db, tenantId, options);
  console.log(
    `seed:history ${args.database} tenant=${tenantId}`,
    JSON.stringify({ ledger, modules })
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
