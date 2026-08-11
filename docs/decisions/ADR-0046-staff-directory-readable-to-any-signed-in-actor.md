# ADR-0046: The staff directory resolves names for any signed-in actor

## Status

Accepted.

## Context

`/v1/names` (apps/api/src/routes/names.ts, ADR-0033) resolves refs to display
names and gates every resource on that resource's own read permission — an
ungated name lookup is a read side channel onto data the caller cannot
otherwise see. That rule is right for customers, policies, cases and campaigns.

It fails for the two resources that name people. On the ORBIT live console the
WITH column and the FROM/TO of every handover note rendered
`user:us_01KE…VNK5` and `team:tm_01KE…T8HK` at the agent whose queue it is,
because naming a colleague requires `core:users:read` — a staff-administration
grant. No tenant hands staff-admin rights to someone whose job is answering a
chat, and it would be wrong to: `packages/core/src/rbac.ts` gives `orbit.agent`
customer reads and PII view, deliberately not user or team writes. The same gap
hits every screen that shows an assignee, an approver or a receiving team, on
web and on mobile.

The alternatives considered:

1. **Widen the roles** — add `core:users:read` and `core:teams:read` to a dozen
   role definitions. That grants the whole users collection: list, record,
   filter, export, every column the resource exposes. Far more access than
   "who is holding this conversation", handed to far more roles.
2. **A new `core:directory:read` permission** granted in every role's base set.
   Honest, but it is a permission that is always held by everyone, which is the
   shape of a permission that should not exist.
3. **Name resolution treats the staff directory as tenant-common.** One set in
   one file, scoped to the one endpoint that returns a single display string.

## Decision

`users` and `teams` resolve on `/v1/names` for any signed-in actor in the
tenant. Everything else about the request is unchanged:

- **Tenant scope holds.** The query still runs through `scoped(ctx, …)`, so a
  ref from another tenant resolves to nothing, as it did before.
- **Masking holds.** `users.name` is declared PII, so an actor without
  `core:pii:view` reads `Layla A•• M•••••••` — the same string every other read
  path gives them.
- **Secret columns are unreachable.** The endpoint returns one display column
  chosen from `DISPLAY_COLUMNS`; a password hash is not on that list and never
  leaves the server.
- **One string, not a row.** No email, no roles, no status, no filtering and no
  enumeration: the caller must already hold the ref to learn the name behind it.
- **List, record and write paths are untouched.** `core:users:read` still gates
  every one of them.

## Consequences

Any signed-in user can turn a user or team ref they already hold into a display
name. Inside a tenant that is the same fact as the org chart on the wall, and
it is what the screens have always implied: docs/15's ambient grammar says an
artifact must say who made it, and "us_01KE…VNK5 made it" says nothing.

The `DIRECTORY` set is the seam. Adding a resource to it is a decision of this
size and needs an ADR of its own; the two members are the two that name people.

If a tenant ever needs staff names hidden from other staff — a shared-tenancy
or bureau arrangement — this becomes a policy flag on the tenant rather than a
permission, because the default must stay "colleagues have names".
