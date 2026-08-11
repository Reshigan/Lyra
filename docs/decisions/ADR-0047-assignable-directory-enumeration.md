# ADR-0047: The assignable directory enumerates staff and teams

## Status

Accepted. Extends ADR-0046, which resolved staff names but deliberately did not
enumerate them.

## Context

Five screens asked a person to type a ULID into a free-text box to assign work:

- `apps/web/app/routes/axis-board.tsx` — `ownerRef`
- `apps/web/app/routes/axis-exceptions.tsx` — `ownerRef`
- `apps/web/app/routes/claims-desk.tsx` — `handlerRef`
- `apps/web/app/routes/conversation.tsx` — `toRef` (handover)
- `apps/web/app/routes/signal-studio.tsx` — `ownerRef`

Each field takes `user:us_01KE…VNK5` or `team:tm_01KE…T8HK`. Nobody knows a
colleague's ULID, so in practice the assignment either never happened or
happened to a typo — a case assigned to a ref that names nothing looks assigned
and is not. There was no assignee picker anywhere in the product; the only
screen listing staff at all was `/admin/staff`, behind `core:users:read`.

A picker needs a list, and ADR-0046 was explicit that name *resolution* (ref in,
one string out) is not the same act as *enumeration* (no input, the whole
directory out), and that enumeration would need a decision of its own. This is
that decision.

The alternatives considered:

1. **Reuse `GET /v1/core/users`.** It is the staff-administration collection:
   filters, columns, pagination, email, status, MFA state — and it is gated on
   `core:users:read`, which the agents doing the assigning do not hold. Widening
   that grant is the option ADR-0046 already rejected.
2. **A typeahead search endpoint** (`?q=`) returning matches only. Marginally
   less enumeration in theory: any caller can walk it by querying each letter,
   so what it really buys is debounce logic and a loading state on five screens.
3. **One flat list of assignable refs**, capped, fetched by the loader, rendered
   as a native `<select>`. A tenant's staff list is bounded by the tenant's
   payroll, and a native select is keyboard-searchable for free.

## Decision

`GET /v1/directory` returns `{ entries: [{ ref, name }] }` for any signed-in
actor in the tenant. `?kind=user` or `?kind=team` narrows it.

- **Two columns, never a row.** `ref` and a display name. No email, no status,
  no roles, no MFA state, no `providerId` — the tests assert the response body
  contains none of them.
- **Tenant scope holds.** Both queries go through `scoped()`, so no ref from
  another tenant can appear.
- **Masking holds.** `users.name` is PII; without `core:pii:view` the caller
  reads `Layla A•• M•••••••`, the same string every other read path gives them.
  A masked name still identifies the right colleague in a list you work with
  daily, which is all a picker needs.
- **Suspended accounts are omitted.** A suspended account is a row, not somebody
  to hand a case to. Invited-but-not-yet-active staff stay listed: assigning
  their first case is often why they were invited.
- **Capped at 500 entries**, unpaginated by design — big enough for every real
  org chart, small enough that the endpoint is not a table walk.
- **Write paths are untouched.** Who may assign what is still decided by the
  action's own permission; this endpoint only names the candidates.

## Consequences

Any signed-in user can list their colleagues' names and team names. Inside a
tenant that is the staff directory in the hallway, and it is the precondition
for any assignment UI existing at all.

The list is what the five screens render, so an assignment now submits a ref
that resolves. The seam is the endpoint: a screen that needs a different
population (agents on shift, licensed adjusters) filters server-side by adding a
`kind`, not by pushing a richer row to the client.

If a tenant ever needs staff hidden from other staff — a bureau or
shared-tenancy arrangement — this becomes the same tenant policy flag ADR-0046
describes, applied in one more place.
