# ADR-0072 — A first-party reference underwriter, reached over a service binding

Status: accepted · 2026-08-19 · amends ADR-0070 §5
Context: docs/05-modules-dist.md §4 (the comparison must not depend on how a
number was obtained), docs/16-horizons.md (build to the seams), CLAUDE.md
conventions 10 (secrets), 13 (self-sufficiency) and 15 (seams).
Code: `apps/api/src/routes/carrier-sandbox.ts`,
`apps/api/src/engines/dist-quoter.ts`, `apps/api/src/env.ts`,
`apps/api/src/node.ts`, `apps/api/wrangler.jsonc`.

## Context

ADR-0070 built the live carrier adapter and then, in §5, decided the seeded
panel would stay entirely table-priced: there was no third-party underwriter
endpoint reachable from a demo, an e2e run or a CI box, and an `api` offering
pointing at `api.falcon.example` would render a permanent error row on
lyra.vantax.co.za.

That left the seam implemented and proven in unit tests with `fetch` stubbed,
but never exercised in the product a buyer clicks through. "We have an adapter"
and "the panel you are looking at contains a price an underwriter returned over
HTTP" are different claims, and only the second one is a demo.

The missing piece was never the adapter. It was a carrier.

## Decision

### 1. The platform hosts its own reference underwriter

`POST /carrier-sandbox/quote` (`routes/carrier-sandbox.ts`) is a carrier, not a
feature. It speaks the `http-json` wire contract exactly as ADR-0070 defines it,
because **the adapter is the client and does not change shape to suit the
server**. It has its own rating logic, its own appetite, and its own
decline/refer decisions:

| Risk | Answer |
| --- | --- |
| Currency other than AED | `declined` — this carrier writes one currency |
| Driver under 21 or over 75 | `declined` — outside appetite |
| No age, or no insured value | `referred` — nothing to rate, and a guess is not a quote |
| Insured value over AED 500,000 | `referred` — above the automatic binding limit |
| Prior claims on a driver under 25 | `referred` |
| Anything else | `quoted`, deterministically |

Deterministic because a demo must be reproducible and a screenshot must stay
true. Not always `quoted`, because a panel where one carrier says yes to
everything teaches a viewer nothing — the seeded panel now shows a live
underwriter declining a 19-year-old and referring a high-value car, which is
what the comparison is *for*.

It is deliberately not a LYRA API: no tenant, no session, no `Ctx`, no audit
row, no database read. It is a stateless price calculator over the risk it was
posted. So it is mounted outside `/v1` alongside `/health`, and listed in
`UNDOCUMENTED` in `api.test.ts` rather than published in the OpenAPI document —
putting a foreign carrier's wire contract into `packages/sdk` would tell every
integrator it was ours to call.

This is convention 13 (self-sufficiency) read literally: we needed an
underwriter to demonstrate against, so we built one rather than depending on a
third party's sandbox being up.

### 2. The hop is a service binding, not the public hostname

A Worker that fetches its own zone by hostname gets Cloudflare error 1042. So
`quote_endpoint_json` grew a third field, `binding`, naming a Fetcher on `env`;
`wrangler.jsonc` gains a self service binding (`CARRIER_SANDBOX` → `lyra-api`,
and → `lyra-api-staging` inside `env.staging`, which must track the env's own
`name`). `node.ts` supplies the same binding in-process, so an e2e run and an
on-prem box take the identical path instead of rendering an error column.

`url` is still required and still guarded. It is the address the carrier answers
on — and with a service binding it is also the path the request is routed to
inside the target Worker. It is **not** a fallback: a `binding` that is named
but absent, or bound to something without a `fetch`, is an error row. Falling
back to the open internet when a binding disappears would turn a deploy mistake
into an outbound request to a host in a tenant-editable row.

### 3. Every ADR-0070 guarantee survives, including for the binding path

https-only, no IP literal, no `localhost`/`.local`/`.internal`/`.localdomain`
— all applied before the binding is consulted, so a bound carrier is not a way
around the URL guards.

`binding` reuses `authRef`'s namespace, `/^CARRIER_[A-Z0-9_]+$/`, for exactly
the reason ADR-0070 §2 gives. Provider rows are tenant-editable CRUD, and
`env` carries other things with a `fetch`: unbounded, a tenant could set
`binding: "BROWSER"` and aim a headless browser at a host of their choosing.
The namespace holds only carriers.

Every response guard is unchanged and shared: a fractional premium, a foreign
currency, a missing number and a hostile `validUntilMs` all still become the
same visible error row whether the answer arrived over `fetch` or over a
binding.

### 4. The reference underwriter declares no credential

The obvious design — a bearer token in a `CARRIER_SANDBOX_KEY` secret — is
wrong here, twice over.

CLAUDE.md convention 10 forbids a secret value in a file, so the token could
only be set by `wrangler secret put`. That is out of band: CI cannot run it and
neither can a fresh on-prem box. A seeded offering whose credential is set by
hand would price on exactly the environments where someone remembered, and show
an error row everywhere else — which is the ADR-0070 §5 failure this ADR exists
to remove, with an extra step in front of it.

And there is nothing to authenticate. The sandbox holds no data, reads no
database, and returns a price for the risk in the request body. A token would
protect a public arithmetic function.

So the seeded provider declares no `authRef`, and `dist-quoter.ts`'s existing
"no token, no `Authorization` header" path covers it — a path already tested
("calls an endpoint that declares no credential at all — a public sandbox is
legitimate"). The token path stays covered by the Falcon fixtures, which price
against a stubbed carrier and assert the header. Nothing about the credential
handling is weakened; one carrier simply has no credential, which is the true
description of it.

What it does get, because being mounted on the API makes it publicly reachable
as well as binding-reachable, is the same IP-keyed `throttle` the rest of the
unauthenticated surface uses: 60 quotes per minute per IP.

## Consequences

- The seeded panel has one `pricingMode: "api"` offering (Zenith Direct,
  `ZEN-MOT-LIVE`) whose number crossed a real HTTP boundary. It is mid-pack
  against the table-priced columns, so it is a genuine comparison and not a
  planted winner.
- An unreachable carrier costs the **public** comparison one column and nothing
  else: `routes/portal.ts` builds `offers` from `state === "quoted"` rows only,
  so a member of the public sees a shorter panel, never an error and never a
  reason string. The **authenticated** AXIS/ORBIT quote desk
  (`GET /v1/dist/quote-requests/:id/comparison`, `dist:quote_requests:read`)
  shows the same row under `unavailable` with its `state` and fixed-phrase
  `reason` — an operator has to know a carrier is down; a shopper must not be
  shown our plumbing.
- Onboarding a *real* carrier is unchanged (ADR-0070's three steps). Onboarding
  one that lives on this Worker adds `binding` and drops `authRef`.
- The self service binding must be kept in step with each environment's `name`.
  Pointing staging's binding at `lyra-api` would have staging quote through
  production.
