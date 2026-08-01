# ADR-0018 — SEAM-Hx: seam interfaces + `@seam:Hx` contract tests

Status: accepted
Date: 2026-08-01

## Context

docs/16-future-horizons.md, docs/17 §16 and docs/02 §11 require: each of the
12 future horizons (H1-H12) has a NOW obligation built today, an interface
living in `packages/core/seams`, and at least one contract test tagged
`@seam:Hx` by M6 close. Audit before this ADR: `packages/core/seams` did not
exist; `grep -rn "@seam"` returned zero hits outside docs. Genuinely 0/12.

A full-codebase audit (schema, routes, engines) found the NOW data
substrate already exists for most horizons — it was built module-by-module
(H9's `payment_plan_json` comment literally says "H9 reserved") but never
collected under a named seam or proven by a tagged test. Per horizon:

| Horizon | Verdict | Evidence |
|---|---|---|
| H1 Agentic commerce | PARTIAL | `agent` channel (orbit.ts:11), `core_mandates` (core.ts:474) exist; no signed-offer shape |
| H2 Autonomy ladder | PARTIAL | `autonomyLevel` on `ai_agents` (ai.ts:17), enforced by `approvals.ts` dual-control + `signal-autopilot.ts` filter; no envelope type |
| H3 Voice/multimodal | PARTIAL | `modality` enum (orbit.ts:42) consumed by orbit-room/agent-room; no `SpeechProvider` seam |
| H4 Open finance | SATISFIED | `standardMappingJson` (core.ts:176), consent purposes (signal.ts:15) |
| H5 Digital identity | PARTIAL | `core_identity_verifications` + `evidenceLevel` (core.ts:493) exist; no KYC touchpoint consumes it yet |
| H6 Sensor/usage pricing | PARTIAL | `pricingInputsJson` (core.ts:177) exists; no ingest seam |
| H7 Parametric | SATISFIED | `structure`, `parametricTriggerJson` (core.ts:173-175) |
| H8 Takaful | SATISFIED | `structure`, `takafulJson` (core.ts:173-174) |
| H9 Premium financing | SATISFIED | `paymentPlanJson` (axis.ts:141), `financier_ref` (ledger.ts:385) |
| H10 Marketplace | MISSING | nothing — no manifest concept anywhere |
| H11 Compounding intelligence | SATISFIED | `core_memories` (core.ts:508), `north_scenarios` exercised by J-E3 |
| H12 Regulation as data | SATISFIED | `core_rulepacks` (core.ts:539), `rulepackApplications` tracking |

## Decision

1. **`packages/core/src/seams.ts`** is the seam layer docs/02 §11 requires.
   It holds the 9 named interfaces (`Channel`, `AutonomyEnvelope`,
   `SpeechProvider`, `IdentityVerifier`, `DataInConnector`,
   `TimeseriesIngest`, `ExtensionManifest`, plus `Rulepack`/`CoreMemory` type
   aliases over the existing `@lyra/db` schema rows). H7-H9 have no named
   interface in docs/02 §11 — they are pure data-model fields and stay that
   way; their contract test asserts the field, not an interface.

2. **H1** gets one addition beyond a type wrapper: `signOffer` /
   `verifyOfferSignature` in seams.ts, hashing an `AgentOffer` with the
   existing `hashObject` (packages/core/src/crypto.ts) — content-integrity,
   not asymmetric non-repudiation. The signed offer is carried inside
   `core_mandates.scopeJson`, which was already generic JSON built for
   exactly this; no migration. Real cryptographic signing (keypair, HSM) is
   LATER, per docs/16 H1.

3. **H2** ships `AutonomyEnvelope` as a type only. L1 cap is already
   enforced — `approvals.ts`'s dual-control gate and
   `signal-autopilot.ts`'s pre-action filter both read `autonomyLevel`
   today. docs/16's "reversal function **or** L1 cap enforced" is satisfied
   by the existing cap; a per-action `reversalFn` is LATER.

4. **H3, H4, H5, H6** ship as interfaces with no runtime implementation —
   the NOW obligation is the seam existing and being provably referenced by
   real fields/routes, not a working provider. H5 in particular: AXIS's KYC
   flow does not yet read `evidenceLevel` — recorded here as a known,
   accepted gap under this ADR rather than silently missing; wiring it into
   AXIS onboarding is a functional change beyond seam scope and stays
   LATER.

5. **H10** is genuinely new: `ExtensionManifest` interface +
   `validateExtensionManifest()` (id, semver version, non-empty
   capabilities, tenant scopes). No third-party developer harness — first-
   party "extensions" are documented as the shape, not yet shipped through
   it. Full harness stays LATER per docs/16 H10.

6. **Contract tests**: `packages/core/src/seams.test.ts`, one `it` per
   horizon, title prefixed `@seam:Hx` so `grep -rn "@seam"` and CI's tag
   filter both find them. Each proves the NOW obligation: a DB round-trip
   for schema-only horizons (H1, H5, H7, H8, H9, H11, H12), a type-level
   fake-implementation round-trip for interface-only horizons (H2, H3, H4,
   H6), a manifest-validation check for H10. `SEAM-999` (no seam bypassed
   without an ADR) is this document.

## Consequences

- 12/12 horizons now have ≥1 passing `@seam:Hx` test; docs/25 checklist
  SEAM row can close.
- H5's KYC-consumption gap and H1/H10's LATER items are explicit, not
  silently dropped — future work reads this ADR before touching either.
- No schema migration: H1's offer shape rides in existing `scopeJson`.
