# ADR-0043: J-C1 ships self-serve up to document handover, not payment

## Status

Accepted. Supersedes ADR-0041's J-C1 half (ADR-0042-j-c4-public-dsar-intake
already superseded its J-C4 half).

## Context

ADR-0041 deferred both consumer journeys as staff-mediated. It was written
before the distribution panel existed. Since then:

- `apps/api/src/routes/dist.ts` grew a real fan-out and ranking engine
  (`POST /v1/dist/quote-requests/shop`): a panel is resolved per product,
  eligibility is checked per offering, table-priced offerings quote in
  session, manual ones refer, and the outcomes are ranked. This is exactly
  the "ranking algorithm is a product decision" that ADR-0041 said had to be
  designed first — it has been, for the operator.
- `apps/api/src/routes/portal.ts` is already an unauthenticated surface with
  throttling, tenant resolution by slug, and a system `Ctx` per handler
  (ADR-0030), and it now also carries the public DSAR intake (ADR-0042).

So three of the four things ADR-0041 named as missing for J-C1 are no longer
missing. The remaining one is real: **no PSP is contracted**, and none is on
the approved-services list in docs/02 §9. Binding cover is also
`consequential: true` under CLAUDE.md §4, so same-session self-issuance would
need an approval path that deliberately does not exist for a stranger.

The engine was reachable only by an authenticated operator. Leaving it there
while the public surface still captured bare leads meant the platform could
price a panel in 200ms and still make a visitor wait for a callback.

## Decision

**J-C1 ships self-serve through document handover. Payment and issuance stay
human.**

1. **One engine, two doors.** The fan-out was extracted to
   `apps/api/src/engines/shop.ts` (`runShop`) and is called by both the
   operator route and the public portal. There is no second, weaker pricing
   path for the public — a divergence there is how a portal ends up quoting
   prices the back office will not honour. Audit and event emission stay in
   the callers, because the actor differs.

2. **The one-time token is the credential.** A visitor has no session. The
   lead response returns a 48-hex-char token; only its SHA-256 lives in
   `dist_quote_requests.portal_token_hash`. Re-opening the comparison,
   accepting an offer and uploading a document all require it. An unknown id
   and a wrong token return the same 404, so the endpoint is not an oracle
   for which quote ids exist.

3. **The comparison shows only what a stranger may see.** Commission,
   provider value scoring and decline reasons are excluded from the portal
   projection. The ranking criterion itself *is* shown (`rankedBy:
   "total_price"`) — docs/06 J-C1 says "declared criteria visible", and a
   comparison that hides how it sorted is the thing the journey is written
   against. A test asserts the serialized body matches none of
   `/commission|valueScore|declineReason/i`.

4. **Accept converts, it does not bind.** `POST …/accept` sets the request to
   `converted` and records the chosen offering. It creates no case, no
   policy, no ledger entry, and takes no money. The response's `nextStep` is
   `"documents"`. A staff member issues cover afterwards through the existing
   AXIS path, which keeps CLAUDE.md §4 intact.

5. **Documents come in as files, not as a camera integration.** The upload
   endpoint is multipart with a 10MB cap, an image/PDF allowlist, and its own
   per-IP throttle; rows land in `files` as `kind: "customer_document"`,
   `piiLevel: "high"`. Mobile camera capture is the same endpoint with a
   different picker — no separate ingest path is built for it.

6. **No payment step.** Not deferred vaguely: there is nothing to integrate
   with until a PSP is chosen under docs/02 §9, which needs its own ADR.
   The customer's last self-serve act is sending documents.

A referred offering (a manual-pricing panel member) leaves the request at
`fanned_out` rather than `complete`, and the portal surfaces the count. The
priced offers are comparable immediately; the referral answers out of band.

## Consequences

- ADR-0041 no longer describes the build for either journey and should be read
  as historical.
- `docs/25-go-live-checklist.md`'s J-C1 line moves from deferred to shipped,
  minus payment.
- The web comparison page (`apps/web/app/routes/portal.$tenantSlug.quotes.$id.tsx`)
  is public and therefore has no shell, no nav and no session — it renders from
  the tenant's brand config alone, like the rest of `/portal`.

## References

- `apps/api/src/engines/shop.ts`, `apps/api/src/routes/portal.ts`,
  `apps/api/src/portal.test.ts`.
- `packages/db/migrations/0024_sharp_hiroim.sql` — `portal_token_hash`.
- ADR-0030 — the public portal surface and its "never money-affecting" rule,
  which this decision keeps.
- ADR-0041 — superseded for J-C1. ADR-0042 (public DSAR intake) — superseded
  it for J-C4.
- docs/06 §2 J-C1; docs/02 §9 approved services; CLAUDE.md §4.
