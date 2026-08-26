import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema.js";

/**
 * A held write lock is a wait, not a failure. A `file:` database has more than
 * one writer whenever a second process opens it — the API server and an e2e
 * fixture seeding rows against the same file — and libSQL's default is to
 * raise SQLITE_BUSY the instant the lock is held rather than wait for it.
 * That surfaces as a test that passes on a fast machine and fails on a loaded
 * CI runner: `delete from orbit_renewals` in e2e/save-desk.spec.ts:126 took
 * the deploy of f622a2e down this way while passing locally in 18s.
 *
 * Five seconds is longer than any write this codebase makes and short enough
 * that a genuine deadlock still fails the run instead of hanging it.
 */
const BUSY_TIMEOUT_MS = 5_000;

/** On-prem home: libsql-server. Kept in its own entry point so the Workers
 *  bundle never pulls @libsql/client (docs/02 — one schema, two homes). */
export function makeLibsqlDb(url: string, authToken?: string) {
  // `timeout` is @libsql/client's busy timeout and applies only to file:
  // databases; it is inert for a remote libsql-server URL, so it is set
  // unconditionally rather than sniffed off the scheme.
  return drizzle(createClient(authToken ? { url, authToken, timeout: BUSY_TIMEOUT_MS } : { url, timeout: BUSY_TIMEOUT_MS }), {
    schema
  });
}

export type LibsqlDb = ReturnType<typeof makeLibsqlDb>;
