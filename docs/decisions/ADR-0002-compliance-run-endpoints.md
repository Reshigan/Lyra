# ADR-0002 — Screening, evidence export and retention are runs, not forms

- Status: accepted
- Date: 2026-07-30
- Context: docs/12 §3 §4 §5, docs/19 §4 (`SANCTIONS-SCREEN`, `AUDIT-EXPORT`),
  docs/17 PLAT-088 / JRN-CO1, CLAUDE.md §15 (build to the seams)

## Context

Three compliance capabilities held a permission and a UI tab but no way to
happen: `compliance:screenings:run`, `compliance:evidence:export` and
`compliance:retention:run`. Their rows carry values no person can supply —
`query_hash`, `manifest_json`, `bundle_hash`, `rows_affected`, `rows_held` — so
a create form filled in by a human produces a record that looks like evidence
and is not. The generated CRUD create is the same lie with a JSON body.

Three questions the specs do not answer outright.

**1. Which screening provider?** docs/02 §9 approves Cloudflare, Anthropic via
AI Gateway, Resend, Twilio/Unifonic, Sentry and Stripe. No sanctions, PEP or
adverse-media list is on it, and adding one is a procurement decision with a
data-residency dimension (docs/12 §2 cross-border), not an implementation
detail.

**2. Is a run approval-gated?** docs/12 §4 says consequential actions are
*registry-flagged*. The two registries are `APPROVAL_POLICIES`
(packages/core/src/approvals.ts) and `TXN_TYPES` (packages/ledger/src/types.ts).
`SANCTIONS-SCREEN` and `AUDIT-EXPORT` are both registered with approval `null`,
and no approval policy key exists for either, nor for a retention purge.

**3. What does a retention run delete?** docs/12 §3 names the record classes
("policy docs 7y default, conversations 24m default — tenant-tunable above
floors") and §5 calls the evidence "policy config + purge job logs". The
schema's own comment enumerates `messages|files|ai_audit|consent`.

## Decision

**Screening runs behind a `ScreeningProvider` seam with a stub implementation.**
The interface takes a normalised query and returns a result plus hits; the
endpoint owns the `query_hash`, the row, the block and the audit. The shipped
implementation is named `stub` in `compliance_screenings.provider`, matches only
two deliberately fake tokens (`lyra-test-hit`, `lyra-test-inconclusive`) and
returns `clear` for everything else. Every hit it produces carries
`"stub": true` in `hits_json`, and the screening screen states that no provider
is configured and the result is not a sanctions check. A real provider is one
implementation of the interface plus an ADR naming it under docs/02 §9. This is
not a decision to screen badly: it is a decision not to imply that we screen at
all until a list is bought.

**A hit blocks and emits; it does not reach into another module.** docs/19 §4
says "hit → case + block". The endpoint sets `blocked` and emits
`compliance.screening.hit`; `case_ref` stays null until a consumer of that event
opens the case. Writing an AXIS case from the compliance router would be the
direct cross-module call CLAUDE.md §6 forbids.

**Runs are not approval-gated, because the registry does not flag them.**
`gate()` throws on an unknown policy key, so gating any of these would mean
inventing a policy in packages/core — a registry entry is a governance decision,
not a route decision. What is gated is the permission: `compliance:screenings:run`,
`compliance:evidence:export`, `compliance:retention:run`. Two consequences are
handled locally instead: an evidence bundle is built but never delivered (the
`approved_by` and `delivered_to` columns and the `delivered` state are the seam
for an outbound send, which is the step docs/12 §4 would actually flag), and a
retention purge defaults to a dry run.

**Retention purges one class, by policy, with the cutoff computed server-side.**
`policy_key` is `messages`; the cutoff is `now - policy.retention.messagesMonths`
clamped to the 24-month floor from docs/12 §3, never a number from the request —
"tenant-tunable above floors" means the tenant may keep data longer, never
shorter, and a client-supplied cutoff is a purge parameter an attacker would
choose. `dryRun` defaults to true and writes no run row; a plan is not a run.
Legal holds are honoured: a message whose conversation or customer is under an
unreleased hold counts into `rows_held` and is not deleted (schema comment on
`compliance_legal_holds`). `files`, `ai_audit` and `consent` are refused with a
400 naming the supported keys — purging files means purging R2 objects and the
erasure-completeness job of PLAT-038, and purging consent contradicts the
immutable consent ledger of docs/12 §2.

**The bundle is a reproducible zip and the bundle hash is the hash of it.**
docs/12 §3 asks for "PDF + JSONL + hash manifest". `engines/export/render.ts`
renders the PDF, `engines/export/zip.ts` stores the entries with fixed
timestamps, `manifest.json` inside the archive carries a sha256 per entry, and
`bundle_hash` is sha256 over the archive bytes — so the manifest is inside what
the hash covers, and identical scope produces an identical hash. Hashing is
`crypto.subtle` via `sha256Hex`; no dependency was added.

## Consequences

- No tenant can be told a subject is clear of sanctions. The screening surface
  says so in words, on every result.
- `case_ref` is null on every hit until an event consumer opens the case.
- An evidence bundle can be built and downloaded but never marked delivered over
  the API; delivery arrives with the approval policy that should gate it.
- A retention purge is irreversible and holds no second pair of eyes. The dry-run
  default and the server-computed cutoff are what stand in for one. Adding
  `compliance.retention_purge` to `APPROVAL_POLICIES` and calling `gate()` before
  the delete is the upgrade, and it is a one-line change at the call site.
- The generated CRUD create for `screenings`, `evidence-bundles` and
  `retention-runs` would still accept a hand-written hash. The hand-written
  router shadows those three POSTs with a 400 pointing at the run endpoint
  (Hono returns handlers in registration order — apps/api/src/index.ts), so there
  is one way to create each of these rows. Dropping `create` from those three
  resources in apps/api/src/resources.ts would make the shadow unnecessary.
