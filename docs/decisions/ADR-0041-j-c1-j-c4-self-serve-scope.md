# ADR-0041: J-C1 and J-C4 ship as staff-mediated, not self-serve, for v1

## Status

Superseded — ADR-0042 (J-C4 public intake) and ADR-0043 (J-C1 self-serve
comparison) replace both halves of this decision. Kept for the record.

## Context

`docs/06-roles-and-journeys.md` §2 specs two consumer journeys with no
matching build:

- **J-C1 Get covered:** land → 3-field quick quote → *ranked offers* → docs
  via camera → *pay (PSP redirect)* → policy delivered same session.
- **J-C4 Exercise privacy rights:** *portal request* (access/erasure) →
  automated package/erasure workflow → confirmation, < 30 days.

What exists today:

- **J-C1:** ADR-0030's `/v1/portal/:tenantSlug` is a lead-capture MVP by
  deliberate design — `POST /:tenantSlug/leads` "writes a quote request,
  never a policy, claim, or anything money-affecting" (ADR-0030,
  Decision §2). There is no offer-ranking engine behind it, no camera/OCR
  doc intake on the public surface, no PSP integration, and no self-issuance
  path. A lead becomes a policy only through AXIS staff working the request.
- **J-C4:** `compliance:dsar:create`/`:read`/`:fulfil` (`packages/core/src/rbac.ts:210`,
  `apps/api/src/resources.ts:783-788`) back a real DSAR case-management
  surface (`/compliance`, gated on `compliance:dsar:read`) with erasure
  logging and completeness tracking (PLAT-038). No role granted to
  `customer` holds `compliance:dsar:*` — a request reaches `dsarRequests`
  only when tenant-compliance staff enter it, not through a consumer-facing
  intake form.

`docs/14-roadmap.md`'s M0-M6 acceptance criteria name neither journey.
Building either gap to spec would mean: an offer-ranking/comparison engine,
camera-based document capture and extraction on an unauthenticated surface,
a PSP integration (approved-services list, docs/02 §9, none contracted
yet), and a self-issuance approval path (CLAUDE.md §4 human-in-the-loop) for
J-C1; and a new unauthenticated intake form plus identity-verification step
(a DSAR request must prove it's the data subject before any package or
erasure runs) for J-C4. None of this is a byproduct of any milestone
already built, matching the shape of ADR-0035 and ADR-0040's deferrals.

## Decision

**Ship v1 with both journeys staff-mediated; the self-serve steps are
backlog, not go-live scope.**

- J-C1's lead-capture portal (ADR-0030) is the v1 realization of "land →
  quick quote". Ranking, camera intake, PSP payment, and same-session
  issuance are deferred — each needs its own design pass (a ranking
  algorithm is a product decision; PSP choice needs a docs/02 §9 ADR of its
  own) and are not built speculatively here.
- J-C4's DSAR workflow ships staff-initiated: a customer's access/erasure
  request reaches the tenant through an existing channel (WhatsApp/email
  per J-C2, or a support contact), and `tenant.compliance` staff open the
  case in `/compliance` from there. The 30-day SLA and audit trail
  (erasure-completeness job, `erasureLog` immutable table) already hold;
  only the intake step is staff-mediated instead of self-serve.
- No e2e spec is added for the full J-C1/J-C4 flows as specced in docs/06,
  since the flows they'd exercise don't exist. `docs/06`'s journey list
  should be read against this ADR: J-C1/J-C4 are aspirational end states,
  not current-build acceptance criteria — the roadmap's own milestones
  already omit them, this ADR just makes that omission a recorded decision.

## References

- `docs/06-roles-and-journeys.md` §2 — J-C1, J-C4 specs.
- ADR-0030 — the lead-capture portal that is J-C1's actual v1 scope.
- `apps/api/src/resources.ts:783-788`, `packages/core/src/rbac.ts:210` —
  DSAR permission surface, staff-only today.
- `docs/14-roadmap.md` — M0-M6 acceptance criteria, neither journey named.
- ADR-0035, ADR-0040 — same deferral shape (missing prerequisite
  infrastructure, no milestone acceptance criteria demands it).
