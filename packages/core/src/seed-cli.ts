// `pnpm --filter @lyra/core seed` — seeds the on-prem/local libsql database.
// Kept out of seed.ts so the Workers bundle never sees `process` or a node import.
import { makeLibsqlDb } from "@lyra/db/libsql";
import { seed } from "./seed.js";
import type { CoreDb } from "./context.js";

const db = makeLibsqlDb(
  process.env.DATABASE_URL ?? "http://127.0.0.1:8080",
  process.env.DATABASE_AUTH_TOKEN
) as unknown as CoreDb;

// `seed()` defaults to a fixed clock so unit tests get the same ULIDs every
// run. A database someone signs into wants the opposite: the demo's rolling
// windows ("this week", "last month") are empty if the fixture is a year old.
const result = await seed(db, {
  now: Date.now(),
  ...(process.env.SEED_PASSWORD ? { password: process.env.SEED_PASSWORD } : {})
});
console.log(`seeded GONXT: ${result.tenantId}`);
