import type { Config } from "drizzle-kit";

export default {
  // Per-file glob, not the ./src/schema.ts barrel: drizzle-kit loads schema
  // through a CJS require that cannot resolve our ESM ".js" import specifiers.
  schema: "./src/schema/*.ts",
  out: "./migrations",
  dialect: "sqlite", // D1 (cloud) and libSQL (on-prem) share this dialect
  dbCredentials: { url: process.env.LIBSQL_URL ?? "file:./.data/lyra.db" }
} satisfies Config;
