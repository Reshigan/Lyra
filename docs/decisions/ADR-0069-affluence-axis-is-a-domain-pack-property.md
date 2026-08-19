# ADR-0069 — The targetable axes, and the affluence scale, belong to the domain pack

Date: 2026-08-19
Status: accepted

## Context

`packages/core/src/targeting.ts` decided who a SIGNAL campaign may be aimed at
with two module constants: `TARGETABLE_AXES` (`lsm`, `ageband`, `region`,
`language`, `lifestage`) and `LSM_BANDS`, ten descriptors of the SAARF/BRC
Living Standards Measure. LSM is a South African scale. It does not exist in the
Gulf, and a UAE buyer (the yallacompare shape in docs/21 §5) segments its book
on its own measure of affluence.

Under the old constants that buyer's only opt-out was to stop tagging on `lsm`,
which left the platform with **no affluence axis at all** — the single most
important dimension in a media plan — while `TARGETABLE_AXES` still refused
whatever axis it did use. That is exactly the failure CLAUDE.md §14 (never
hard-code industry nouns) and §15 (implement against the seam, never today's
single case) exist to prevent, and docs/21 §3 already frames the answer: packs
are configuration that *renames and restricts*.

## Decision

1. **A pack declares its targeting vocabulary.** `TargetingPack` is
   `{ axes: readonly string[]; affluence: AffluenceScale | null }`, where
   `AffluenceScale` is `{ axis, label, bands: {band,label}[] }`. `isTargetable`,
   `countAttributes`, `targetablePool` and the new `affluenceBandOf` all take an
   optional trailing `pack?: string`. Omitted means the default pack, so every
   existing caller keeps byte-identical behaviour.
2. **The registry lives in `targeting.ts` itself**, as a `Map` (not an object
   literal — `{}["constructor"]` is truthy, the same trap
   `packages/model-gateway/src/vocabulary.ts` avoids). No new file and no new
   package: the file must stay pure and DB-free so the evals score the code the
   engine runs. Unknown and missing pack names degrade to `insurance-retail`;
   degrading to an empty pack would silently un-target a tenant.
3. **`PROTECTED_AXES` stays in core and is not pack-configurable.**
   `defineTargetingPack` strips any protected axis from a pack's declaration and
   nulls an affluence scale carried on one, and `isTargetable` refuses them
   again on the way out. A pack may restrict; it may never re-admit `race`.
   Tested directly, including the case of a protected axis dressed up as the
   affluence scale.
4. **Two packs ship, so the seam is proven rather than asserted.**
   - `insurance-retail` — today's axes and today's ten LSM descriptors,
     verbatim. A pure refactor: default-pack prompts and UI are byte-identical.
   - `insurance-gulf` — `incomequintile` in place of `lsm`, labelled
     "Income quintile", five bands Q1-Q5. The scale is **deliberately generic**:
     there is no SAARF/BRC equivalent for the GCC that we hold, and naming a
     branded index we do not have would be a fabricated citation inside a prompt
     a human funds a campaign against. Q1-Q5 are quintiles of the tenant's own
     declared-income data, tagged `incomequintile:1`..`:5` when the book is
     loaded. The tenant owns the cut; Lyra owns only the vocabulary.
5. **The prompt reads the pack, not the noun.** `AudienceEvidence.pack` and
   `PlanAudience.pack` carry it; evidence lines label a cell off
   `affluenceBandOf`, and the campaign-plan lines say
   `LSM bands in the pool: 7, 8` or `Income quintile bands in the pool: 4, 5`
   depending on the pack. `apps/api`'s `attributeCounts`, `suggestTargeting` and
   `planAudience` pass `ctx.policy.domainPack`.

## The name we did not change

`TargetingProposal.lsm` and `PlanAudience.lsm` still spell the band list `lsm`
even though it is now whichever scale the pack uses. It is a **wire field**:
`suggestTargeting` persists it at `signal_audiences.definitionJson.targeting.lsm`
and both `apps/api/src/engines/signal-campaign-plan.ts` and
`apps/web/app/routes/signal.shared.ts` read it back. Renaming it without a
migration silently blanks the band line for every audience already stored, and
renaming it *with* one is a bigger change than the seam it would tidy. The
upgrade path, when a rename is worth a migration: write both `lsm` and `bands`,
read `bands ?? lsm`, drop `lsm` a release later. This is the decision in this
ADR most worth arguing with.

## Consequences

- A new market is a registry entry plus its band descriptors — no change to the
  counting, the suppression, the prompt or the parser.
- A tenant that switches pack re-reads its stored bands under the new scale's
  label. That is intended (`planAudience` reads the pack live) and is only
  meaningful if both packs band on the same axis; otherwise the axis stops being
  targetable and the cells fall out at the next suggestion.
- `insurance-gulf` is a *targeting* pack only. It has no entry in
  `packages/model-gateway/src/vocabulary.ts` or `apps/web/app/modules/vocabulary.ts`,
  so it renames no nouns yet; adding those is additive and needs no ADR.
- The k-anonymity floor and the "the model never sees a customer row" boundary
  are untouched: a pack chooses vocabulary, never suppression.
