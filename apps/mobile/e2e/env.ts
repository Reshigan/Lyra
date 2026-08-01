import { resolve } from "node:path";
import { tmpdir } from "node:os";

// ponytail: duplicates e2e/env.ts's shape (root is Playwright-only fixture
// wiring, not meant to be imported by an app package) with a distinct DB path
// and port so a Detox run never collides with a concurrent `pnpm e2e`.
const ROOT = resolve(tmpdir(), "lyra-mobile-e2e");

export const DB_PATH = resolve(ROOT, "e2e.db");
export const FILES_DIR = resolve(ROOT, "files");
export const LIBSQL_URL = `file:${DB_PATH}`;
// Written by 01-sign-in-enrol once the fresh seed's one-time TOTP setup key is
// on screen; read by 04-returning-sign-in, which needs the same secret to
// compute a live code for the *second* login. Wiped by setup() every run
// alongside the DB it belongs to, so it can never outlive the enrolment it
// was captured from.
export const SECRET_CACHE_PATH = resolve(ROOT, "totp-secret.json");

export const API_PORT = 8788;
export const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;

// Matches DEFAULT_PASSWORD in packages/core/src/seed.ts — the GONXT demo
// tenant, this suite's only fixture, never a live credential.
export const SEED_PASSWORD = "Gonxt-Demo-2026!";
export const TENANT_SLUG = "gonxt";

// One persona reused across every spec (see e2e/README.md): amina.saleh is the
// only seeded role with core:users:read (packages/core/src/rbac.ts
// tenant.admin), so she is also the only persona whose Home screen shows an
// "Administration" nav item with real list/detail rows to assert against.
export const TENANT_ADMIN = { email: "amina.saleh@gonxt.ae", name: "Amina Saleh" } as const;
