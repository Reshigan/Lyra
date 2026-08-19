# ADR-0070 — The live carrier quote adapter: wire contract, credential namespace, and what a bad answer becomes

Status: accepted · 2026-08-19
Context: docs/05-modules-dist.md §4 (the comparison must not depend on how a
number was obtained), docs/16-horizons.md (build to the seams), CLAUDE.md
conventions 10 (secrets) and 15 (seams).
Code: `apps/api/src/engines/dist-quoter.ts`, `apps/api/src/engines/rating.ts`,
`packages/db/src/schema/core.ts` (`core_providers.quote_endpoint_json`).

## Context

`rating.ts` has always supported `pricingMode: "api"` behind an injected
`ProviderQuoter`. Nothing was ever wired into it — `quoterFor` returned
`undefined` and every seeded offering priced from a table — so the seam had
never been exercised against anything that behaves like a carrier. In a
commercial conversation with a comparison marketplace, "the interface exists"
is not the same claim as "we have called an underwriter".

Building the first adapter forced four questions the docs do not settle.

## Decision

### 1. The wire contract is `http-json`, and endpoints name their format

`core_providers.quote_endpoint_json` is `{ adapter?, url, authRef? }`.
`adapter` defaults to `"http-json"`: POST
`{ offeringCode, currency, inputs }`, expect
`{ status, premiumMinor, taxMinor?, feesMinor?, currency?, coverage?,
breakdown?, validUntilMs?, reason? }`.

`ADAPTERS` is a `Record<string, CarrierAdapter>` with one entry. It is not
speculative generality: without the lookup, an endpoint that says
`adapter: "soap-1.1"` would be silently sent an HTTP-JSON request and its
answer parsed as if the format matched. With it, an unimplemented format is a
visible error row. A second carrier adds a key.

### 2. `authRef` names a `CARRIER_*` wrangler secret, and nothing else

Credentials are never in the provider row — the row holds the *name* of a
binding, matching the schema comment that predates this work ("secrets are
wrangler/env refs, never values"). This is the same shape as the ORBIT
channel adapters' `ConnectorSecrets`.

Provider rows are tenant-editable CRUD. An unconstrained `authRef` would
therefore be an exfiltration primitive: a tenant could set
`{ url: "https://their-host/", authRef: "FIELD_KEY" }` and receive our
field-encryption key as a bearer token. So `authRef` must match
`/^CARRIER_[A-Z0-9_]+$/`, which puts every reachable binding in a namespace
that contains only carrier credentials. The seeded provider rows were renamed
to `CARRIER_FALCON_API_KEY` / `CARRIER_CEDAR_API_KEY` to sit inside it.

The same reasoning bans the outbound request from being described in an error:
`declineReason` never carries the exception text or the response body, because
both routinely echo the request, and the request carries the token. The reason
strings are fixed phrases plus a status code.

### 3. The `url` is guarded before any fetch

https only; no IPv4 or IPv6 literal host; no `localhost`, `.local`,
`.internal`, `.localdomain`. Again this is not defence against a carrier, it is
defence against tenant-authored config aiming a server-side fetch at
`169.254.169.254` or at a neighbouring internal service.

### 4. Every carrier failure is an error row; none is a number

| What the carrier does | What the caller sees |
| --- | --- |
| No answer inside `slaSeconds` | `state: "timeout"` |
| 4xx or 5xx | `state: "error"`, reason carries the status |
| Connection failure | `state: "error"`, exception text dropped |
| Body is not JSON | `state: "error"` |
| JSON, but premium missing or not a whole non-negative minor-unit integer | `state: "error"` |
| Premium in a currency the offering does not sell in | `state: "error"` — never relabelled |
| `status: "declined"` / `"referred"` | that state, with the carrier's reason, bounded to 120 chars, newlines flattened |

The single rule underneath: no field is defaulted into validity. A missing
premium is not zero, a foreign currency is not converted, a fractional minor
unit is not rounded.

`offering.minPremiumMinor` is deliberately **not** applied to a carrier quote.
It is a floor on *our* rate table; raising the number an underwriter actually
gave would invent a price nobody bound.

`validUntilMs` from the carrier is honoured only when it is a safe integer
strictly between now and now + 365d; otherwise the table branch's `now + 7d`
is used. This keeps a hostile or broken instant from reaching a `Date` — the
same class of bug closed across the codebase in the `4f115cd..09a3299` wave.

### 5. The seeded panel stays entirely table-priced

Staging is deployed and production is queued. The seed's own comment already
settles it: there is no third-party endpoint callable from a demo, an e2e run
or an on-prem box. An `api` offering on the seeded panel would render a
visible error row on lyra.vantax.co.za, which is worse than no live-API row at
all. The adapter is proven in `dist-quoter.test.ts` against a mock carrier
stubbed into `fetch`. The demo panel is unchanged; only the two provider
`authRef` *names* moved into the `CARRIER_` namespace, and nothing reads them
today.

## Consequences

- `ProviderQuoter` now receives `provider` and `now` as well as `offering`,
  `inputs` and `timeoutMs`. Existing stub quoters ignore the extra fields.
- `POST /v1/dist/shop` and the public portal shop both pass a real quoter, so
  an `api` offering configured by a tenant works without further wiring.
- Onboarding a carrier is: `wrangler secret put CARRIER_<NAME>_API_KEY`, set
  the provider's `quoteEndpointJson`, set the offering to `pricingMode: "api"`.
  No deploy.
- A carrier that does not speak JSON over HTTPS needs a new `ADAPTERS` entry,
  not a fork of the quoter.
