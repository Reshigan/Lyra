import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DB_PATH, LIBSQL_URL } from "./env.js";

// Mirrors e2e/global-setup.ts (root, Playwright): migrate + seed the same
// single-tenant GONXT fixture, but into this suite's own DB file so a Detox
// run never fights the web e2e run for the same sqlite file.
//
// Detox has no `webServer` equivalent (unlike playwright.config.ts) — this
// script only prepares the database. The API itself must already be running
// against it before `detox test`; see e2e/README.md for the exact command.
export default function setup(): void {
  const root = resolve(import.meta.dirname, "../../..");
  // Always fresh: unlike the web e2e (whose webServer can keep a prior run's
  // API process holding the file open), nothing else has this file open
  // between Detox runs, so wiping it is safe and keeps personas re-enrollable.
  rmSync(dirname(DB_PATH), { recursive: true, force: true });
  mkdirSync(dirname(DB_PATH), { recursive: true });

  const dbEnv = { ...process.env, LIBSQL_URL, DATABASE_URL: LIBSQL_URL };
  execFileSync("pnpm", ["--filter", "@lyra/db", "migrate"], { cwd: root, env: dbEnv, stdio: "inherit" });
  execFileSync("pnpm", ["--filter", "@lyra/core", "seed"], { cwd: root, env: dbEnv, stdio: "inherit" });
}

setup();
