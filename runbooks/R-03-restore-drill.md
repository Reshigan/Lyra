# R-03 — Quarterly restore drill

Satisfies docs/17 DEP-007 ("restore drill performed and documented
periodically") and the runbook referenced in docs/10 §6.

## Cadence

Quarterly, on a staging tenant. Record the outcome in the log at the
bottom of this file — date, operator, RTO/RPO actually observed.

## What backs this system up

Two independent mechanisms, per docs/10 §6:

1. **D1 Time Travel** — Cloudflare platform default, 30-day
   point-in-time-restore, no application code involved. This is the
   primary restore path for "we broke prod, roll the whole DB back."
2. **Nightly D1→R2 export** (`apps/api/src/engines/backup.ts`,
   `backupTenant()`) — one JSON blob per tenant per day, every table
   that carries `tenant_id`, soft-deleted rows included. Written to the
   `EXPORTS` R2 bucket (`lyra-exports` / `lyra-exports-staging`) at key
   `backups/<tenantId>/<YYYY-MM-DD>.json`, during the 02:00–02:15 UTC
   cron tick. Retention: 90d via R2 lifecycle rule (docs/10 §7). This is
   the per-tenant path — restoring or auditing one tenant without
   touching anyone else's data.

There is **no automated restore script** for path 2 today — writing the
export was in scope, reading it back was not. This drill exercises the
manual procedure below and is the reason the gap is flagged (not
silently assumed working) in docs/25 §6.

## Drill procedure

### A. D1 Time Travel restore (path 1)

1. In the Cloudflare dashboard (or `wrangler d1 time-travel`), pick the
   staging D1 database and a restore point within the last 30 days.
2. Restore to a **new** D1 database — never restore over the live one
   mid-drill.
3. Point a local `wrangler dev` at the restored database
   (`--d1=<restored-db-id>`) and confirm the app boots and a known
   tenant's data reads back correctly.
4. Tear down the restored database once verified.

Expected RTO: minutes (Cloudflare-managed). This path does not restore
a single tenant in isolation — it is whole-database.

### B. Per-tenant R2 export restore (path 2, manual)

1. Pick a staging tenant and a recent export:
   `wrangler r2 object get lyra-exports-staging/backups/<tenantId>/<day>.json`.
2. Parse the JSON. Keys are table names (as Drizzle's `getTableName`
   emits them, e.g. `core_users`, `orbit_conversations`); values are
   arrays of row objects, soft-deleted rows included.
3. For each table, in an FK-safe order (parents before children — see
   `packages/db/src/schema/*.ts` for the dependency order; `core_tenants`
   itself is never in the dump, per the comment in `backup.ts`), insert
   rows into the target D1 with `INSERT OR REPLACE`.
4. Spot-check row counts per table against the source dump and confirm
   the tenant's data reads correctly through the app.

This path is slower and entirely manual today — the FK ordering step is
the main failure point. **Flagged gap:** build a `restoreTenant()`
counterpart to `backupTenant()` that replays the dump in dependency
order, so this stops being a hand-run procedure. Until then, this
section of the drill exists to prove the manual path still works, not
to prove it's fast.

## Pass/fail criteria

- Path A: restored database boots the app and known data reads back —
  pass. Any schema/migration mismatch — fail, investigate before next
  deploy.
- Path B: dump downloads, parses, and at least one table's rows are
  successfully reinserted and read back — pass. Anything else — fail,
  and the gap above becomes a priority, not a someday.

## Drill log

| Date | Operator | Path A result | Path B result | Notes |
|---|---|---|---|---|
| — | — | — | — | No drill run yet — this runbook is new. First drill due within one quarter of go-live. |
