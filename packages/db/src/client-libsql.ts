import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema.js";

/** On-prem home: libsql-server. Kept in its own entry point so the Workers
 *  bundle never pulls @libsql/client (docs/02 — one schema, two homes). */
export function makeLibsqlDb(url: string, authToken?: string) {
  return drizzle(createClient(authToken ? { url, authToken } : { url }), { schema });
}

export type LibsqlDb = ReturnType<typeof makeLibsqlDb>;
