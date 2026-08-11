# ADR-0048: Catalogue names resolve for any signed-in actor

## Status

Accepted.

## Context

ADR-0046 made `users` and `teams` resolvable on `/v1/names` for any signed-in
actor, and closed by saying the `DIRECTORY` set is a seam: adding a resource to
it needs an ADR of its own. This is that ADR, for the catalogue:
`providers`, `products`, `channels` and `offerings`.

SCOUT's panel intelligence table (apps/web/app/routes/scout-panel.tsx) lists one
row per carrier under a column headed CARRIER, and rendered
`pv_01KE953T00ZW7MDGZ9JFSXYSZQ` in it — six rows of ULIDs on the screen whose
entire purpose is comparing named carriers on price and conversion. The same
gap hits every AXIS quote row (`providerId`), every product-shaped ref on a
policy, the ledger settlement queue (whose COUNTERPARTY column read
`channel:ch_01KE…95NX`), and the mobile equivalents.

The permission that gates the resolve is `core:providers:read` — a catalogue
administration grant. `packages/core/src/rbac.ts` gives `scout.analyst`
benchmark reads and no core-catalogue rights, correctly: an analyst should not
be able to edit the panel. But they must be able to read the carrier's name,
which is the vocabulary of their whole job.

Alternatives are the ones ADR-0046 already weighed and rejected in the same
shape: widening a dozen roles to the full catalogue resource, or minting a
permission everybody holds.

## Decision

`providers`, `products`, `channels` and `offerings` join `users` and `teams` in
`DIRECTORY`. Every other property of the endpoint is unchanged and is what makes
this safe:

- **Tenant scope holds** — `scoped(ctx, …)`, so a ref from another tenant
  resolves to nothing.
- **One display column** — `name`, chosen from `DISPLAY_COLUMNS`. Commission
  terms, appointment status, rating hooks and every other column stay behind
  `core:providers:read`.
- **One string, not a row** — the caller must already hold the ref. There is no
  filtering, no listing, no enumeration of the catalogue.
- **Masking holds** — none of the four declares PII today; if one ever does, the
  same `mask()` path applies without a change here.
- **List, record and write paths are untouched.**

A second, smaller fact surfaced while wiring this up: the registry mints
the catalogue as `prv`/`prd`/`chn`/`off`, but every seeded tenant carries
`pv`/`pr`/`ch`/`of`. Those rows resolved to nothing regardless of permission.
They join `usr` in the `ALIASES` table, the same remedy ADR-0046 applied to
users.

## Consequences

A carrier's or product's name is now readable by anyone signed into the tenant
who already holds its id. That is the same fact as the panel on the wall: these
are the counterparties the tenant trades with and the things it sells, and they
are printed on quotes, policies and statements the same actors already read.

The seam rule from ADR-0046 stands and now covers six resources. The line it
draws is: a resource may join `DIRECTORY` when its display name is shared
vocabulary rather than a fact about one party's business. A customer's name is
not shared vocabulary; a carrier's is.
