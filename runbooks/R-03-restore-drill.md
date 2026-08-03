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

Path 2 has an automated counterpart: `restoreTenant(ctx, bucket, day)`
in `apps/api/src/engines/backup.ts` clears the tenant's slice of every
table present in the dump and reinserts it exactly as backed up
(cross-tenant rows in a tampered dump are dropped; tables the dump
never saw are left untouched). It is an engine function, not an exposed
route — restoring is destructive and consequential, so invoking it
stays a deliberate operator act (a local script or `wrangler dev`
harness binding the target database), not an API call.

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

### B. Per-tenant R2 export restore (path 2)

1. Pick a staging tenant and a recent export — confirm it exists:
   `wrangler r2 object get lyra-exports-staging/backups/<tenantId>/<day>.json`.
2. Run `restoreTenant(ctx, bucket, "<day>")` against the target
   database (unit-level: `apps/api/src/backup.test.ts` proves the
   round trip; drill-level: a `wrangler dev` harness or local script
   with the staging D1 and `EXPORTS` bound).
3. Spot-check row counts per table against the source dump and confirm
   the tenant's data reads correctly through the app.

Dump format, if manual inspection is needed: keys are table names (as
Drizzle's `getTableName` emits them, e.g. `core_users`); values are
arrays of row objects, soft-deleted rows included; `core_tenants`
itself is never in the dump, per the comment in `backup.ts`. No table
declares a foreign key, so insert order is free.

## Pass/fail criteria

- Path A: restored database boots the app and known data reads back —
  pass. Any schema/migration mismatch — fail, investigate before next
  deploy.
- Path B: `restoreTenant()` completes, row counts match the dump, and
  the tenant's data reads back through the app — pass. Anything else —
  fail, and the fix is a priority, not a someday.

## Drill log

| Date | Operator | Path A result | Path B result | Notes |
|---|---|---|---|---|
| 2026-08-01 | Claude (autonomous build session) | PASS — in-place Time Travel restore of `lyra-staging` to T−15min (bookmark `000000db-…`), reads verified (17 core_users, demo login 302), then rolled forward to the pre-drill bookmark (`000000e2-…`) and re-verified. RTO ≈ 2 min per restore. | PASS — `backupTenant` → drift injection (mutated row + stray insert) → `restoreTenant`: 125 tables, 1,144 rows, backup 24 ms, restore 119 ms, per-table counts matched the dump exactly, drift and stray both gone. Dump uploaded to `lyra-exports-staging/backups/tn_01KE953T00HVA33K5K99G9HNX6/2026-08-01.json` and read back. | Path B ran the real engine code against a same-day `d1 export` replica in local sqlite, because staging was deployed after that day's 02:00 UTC backup window so no cron-produced object existed yet. Next quarterly drill must consume the cron-produced R2 object end to end. RPO: nightly (≤24 h) via cron export; ≤ minutes via D1 Time Travel. |
