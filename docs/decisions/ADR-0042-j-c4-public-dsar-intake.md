# ADR-0042: J-C4 ships with a public DSAR intake; verification stays staff-side

## Status

Accepted. Supersedes ADR-0041 for J-C4; narrows ADR-0041 for J-C1 (see
ADR-0043 for the J-C1 half).

## Context

ADR-0041 deferred J-C4's self-serve intake on the grounds that a data-subject
request must prove it comes from the data subject before any package or
erasure runs, and that no identity-verification method exists
(`IdentityVerifier`, `packages/core/src/seams.ts` H5, has no implementation;
`docs/12` names no method).

That reasoning conflated two steps. **Intake** and **fulfilment** are not the
same act. Fulfilment absolutely requires verification — it discloses or
destroys personal data. Intake requires nothing: it records that someone
asked. Deferring intake because fulfilment needs verification meant the
only door to a data-subject right was a staff member typing the request in
after hearing about it through some other channel. A right nobody can
exercise without first reaching a human is not the right docs/06 §J-C4
specifies ("portal request → … → confirmation, < 30 days").

The verification gap is real and is not closed here.

## Decision

**Ship a public J-C4 intake. Record the request unverified. Keep every
fulfilment step exactly where ADR-0041 left it — behind staff.**

1. `POST /v1/portal/:tenantSlug/privacy-requests` (public by shape, per
   `mw.ts`'s `/v1/portal/*` bypass) writes one `compliance_dsar_requests`
   row: `state: "received"`, `channel: "portal"`, `verificationRef: null`.
   Nothing downstream — packaging, erasure, disclosure — runs off this row
   until `tenant.compliance` staff verify the subject and set
   `verificationRef`. The null is load-bearing: it is what keeps the queue
   honest about which requests have been proven.
2. **The response must not depend on whether the subject exists.** The route
   best-effort links the email to a `customers` row and stores the result in
   `customerId`, but returns the same status and the same body shape either
   way. A public form that answered differently for a known address would be
   a customer-enumeration oracle. This is asserted, not merely intended
   (`apps/api/src/portal.test.ts`, "answers an unknown subject exactly like a
   known one"; `e2e/privacy-portal.spec.ts`).
3. **202, not 201.** What was accepted is the request, not the outcome.
4. The subject's own words are kept: `dsar_requests.subject_note` (new
   column, migration `0023`). A rectification or objection request is
   unusable without them, and validating input then discarding it is the
   defect the leads route was already fixed for.
5. Rate limits mirror the leads route: 3 per email and 10 per IP per 24h.
6. `dueAt` is `now + 30 days` — the tenant's own service target, matching
   `packages/core/src/seed/compliance.ts`. `docs/12` states no statutory
   period and this does not invent one.
7. The web page (`/portal/:tenantSlug/privacy`, en + ar) is linked from the
   storefront footer. An unreachable door is not a door.

## Consequences

- A stranger can now put an unverified row in a tenant's compliance queue.
  That is the intended cost of a public right, bounded by the rate limits;
  the queue was always going to hold unverified requests, they simply used
  to arrive by email.
- When `IdentityVerifier` gets an implementation, the natural change is to
  call it from this route and set `verificationRef` on the way in. Nothing
  here forecloses that: the field already exists and is already the gate.
- ADR-0041's J-C4 paragraphs, and the corresponding line in
  `docs/25-go-live-checklist.md`, no longer describe the build.

## References

- `docs/06-roles-and-journeys.md` §J-C4; `docs/12` §Rights.
- ADR-0041 — superseded for J-C4.
- `apps/api/src/routes/portal.ts`, `apps/api/src/portal.test.ts`.
- `apps/web/app/routes/portal.$tenantSlug.privacy.tsx`, `e2e/privacy-portal.spec.ts`.
- `packages/db/migrations/0023_odd_mystique.sql` — `subject_note`.
- `packages/core/src/seams.ts` H5 — `IdentityVerifier`, still unimplemented.
