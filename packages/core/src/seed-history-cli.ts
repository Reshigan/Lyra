import { drizzle } from "drizzle-orm/sqlite-proxy";
import { and, eq } from "drizzle-orm";
import { schema } from "@lyra/db";
import { seedHistory } from "./seed/history.js";
import { seedModuleHistory } from "./seed/history-modules.js";
import { seedOpsConfig } from "./seed/ops-config.js";
import { d1Endpoint, d1Proxy, parseArgs, pickTenant } from "./seed-history-d1.js";
import type { CoreDb } from "./context.js";

// Backfills a deployed tenant's ledger with trading history (see seed/history.ts).
// The deployed databases are D1, which has no local driver, so this talks to the
// D1 HTTP API through drizzle's sqlite-proxy: drizzle builds the SQL, the proxy
// posts it, and the seeder is the same code the unit tests run against libsql.
//
//   CF_ACCOUNT_ID=… CF_API_TOKEN=… pnpm --filter @lyra/core seed:history \
//     --database <d1-database-id> [--days 365] [--tenant <id>]
//
// Three passes: the ledger (seed/history.ts), the operating history the ledger
// implies — contracts, claims, quotes, campaigns, statements
// (seed/history-modules.ts) — and the ORBIT desk configuration
// (seed/ops-config.ts), which a tenant seeded before those tables existed has no
// other way to get, since seed() refuses to run twice. All three are idempotent,
// so a re-run costs read traffic and writes nothing.
//
// The token needs D1 Write. Never pass it on the command line — it would land in
// the shell history of whoever runs this.
//
// Everything decidable without a network sits in seed-history-d1.ts, where it is
// unit-tested and mutation-gated; this file is the env reads and the three calls.

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) throw new Error("seed:history: CF_ACCOUNT_ID and CF_API_TOKEN must be set");

  const db = drizzle(d1Proxy(d1Endpoint(accountId, args.database), token), { schema }) as unknown as CoreDb;

  // Only read the tenant table when there is something to resolve.
  const tenants = args.tenant
    ? []
    : await db.select({ id: schema.tenants.id, slug: schema.tenants.slug }).from(schema.tenants);
  const tenantId = pickTenant(tenants, args.tenant);

  // Postings are attributed to a real finance user where the tenant has one, so
  // the audit trail reads like the close it imitates rather than "system".
  const [controller] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.email, "faisal.omar@gonxt.ae")))
    .limit(1);

  const now = Date.now();
  const options = { days: args.days, now, postedBy: controller?.id };
  const ledger = await seedHistory(db, tenantId, options);
  const modules = await seedModuleHistory(db, tenantId, options);
  const opsConfig = await seedOpsConfig(db, tenantId, now);
  console.log(
    `seed:history ${args.database} tenant=${tenantId}`,
    JSON.stringify({ ledger, modules, opsConfig })
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
