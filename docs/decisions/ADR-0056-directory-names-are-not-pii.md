# ADR-0056 — A colleague's name is the org chart, not a data subject's PII

Status: accepted · 2026-08-12
Supersedes nothing. Refines ADR-0046 (directory carve-out in `/v1/names`).

## Context

Two defects on the same line of `apps/api/src/routes/names.ts`.

**1. The org chart was masked from the org.** The home decisions queue rendered
"Requested by Layla H•••••"; the ORBIT console's WITH column and its handover
FROM/TO did the same. ADR-0046 carved the staff directory out of
`core:users:read` so an agent could learn who is holding a conversation — and
then masked the answer, because `core_users.name` is declared PII and no agent
role carries `core:pii:view`. The carve-out resolved the ref and returned an
unreadable string.

docs/12 §2 is PDPL-aligned minimisation: it protects **data subjects**. A
colleague inside the same tenant is not a data subject of that tenant — they are
the org chart, and every screen that says who did what is naming a coworker to a
coworker.

**2. A customer's real name leaked to actors without `core:pii:view`.** The
masker looked up `resource.pii[column]`. For a `*Json` display column the map
declares itself per locale (`CUSTOMER_PII` has `nameJson.en` / `nameJson.ar`,
not `nameJson`), so the lookup found nothing and the name went out in full —
while the list beside it, which masks the hydrated row through `crud.ts` `view()`,
showed the mask. The same customer rendered two different ways on one screen.

## Decision

- `/v1/names` does not mask the display column of a `DIRECTORY` resource
  (`users`, `teams`, `providers`, `products`, `channels`, `offerings`). These are
  the tenant's own staff and catalogue; naming them is not a reveal.
- Every other resource resolves its PII kind through `piiKind()`, which accepts
  a per-locale declaration (`nameJson.en`) for a `*Json` display column. A
  customer stays masked exactly as their list row is.
- The carve-out remains display-column-only, tenant-scoped, and never touches
  the list, record or write paths. Secret columns are still stripped, and a
  user's `email` is unreachable here: `name` precedes `email` in
  `DISPLAY_COLUMNS`, so the email column is never the one read.

## Consequences

- Screens that name a colleague read as prose again. No new permission was
  granted: the same actors resolve the same refs, they just get the whole name.
- An actor with `core:customers:read` but not `core:pii:view` now sees
  "Falcon F••••••" where `/v1/names` previously handed them "Falcon Freight".
  This is a fix, not a regression — it is what the record and list paths have
  always returned.
- `core_users.name` stays declared PII for the CRUD paths. A staff directory
  export is still a reveal; naming one ref in a queue is not.

## Alternatives rejected

- **Grant the agent roles `core:pii:view`.** Widens a permission that also
  unmasks customer email, phone and national-ID hash, to fix a colleague's name.
- **Drop `name` from the `users` PII map.** Unmasks the staff list and the staff
  record too, where a bulk read is exactly what minimisation is for.
