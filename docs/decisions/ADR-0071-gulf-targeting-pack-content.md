# ADR-0071 — What the Gulf targeting pack contains, and why nationality is not in it

Date: 2026-08-19
Status: accepted

## Context

ADR-0069 built the seam: a domain pack declares its own targetable axes and its
own affluence scale, so a Gulf tenant is not stuck with the SAARF/BRC LSM scale
that only exists in southern Africa. It shipped `insurance-gulf` as the proving
second pack, but nothing selected it and nothing filled it:

- The seeded demo tenant (GONXT, gonxt.ae) priced in AED off a UAE carrier panel
  and rendered en/ar — and declared `domainPack: "insurance-retail"`, so every
  targeting surface offered it LSM 1-10.
- Every seeded customer carried `tagsJson: null`. `countAttributes` therefore
  returned nothing, `targetablePool` returned nothing, and
  `suggestTargeting` threw `no customer attributes survive a k-anonymity floor
  of 20`. The seam worked and had nothing to work on.

This ADR is about the pack's *content*, not the seam. The seam is ADR-0069 and
is unchanged.

## Decision

### 1. The seeded tenant runs on `insurance-gulf`

`packages/core/src/seed.ts` now writes `domainPack: "insurance-gulf"` in the
tenant's `PolicyJson`. A UAE book prices in AED off a UAE panel; it does not
segment on a South African index.

### 2. The axes

`insurance-gulf` declares `incomequintile`, `ageband`, `region`, `language`,
`lifestage`.

| Axis | Why it is in |
| --- | --- |
| `incomequintile` | The affluence axis, which every media plan is bought on. See §3. |
| `ageband` | Motor and health both price on it, and it is the axis a creative brief is actually written against. |
| `region` | For this pack, the seven emirates. See §4. |
| `language` | en/ar is a real Gulf split and the platform already renders both directions (CLAUDE.md §7). A creative in the wrong language is wasted spend, so this is a media axis, not a preference field. |
| `lifestage` | single / couple / family / empty-nest. Drives the product (single-car motor vs family cover) without touching household composition as a protected characteristic. |

Nothing else. An axis absent from the list is refused rather than allowed
(`isTargetable` defaults closed), so adding one later is a deliberate edit here.

### 3. The affluence scale is an unbranded income quintile

Q1-Q5 over the tenant's own declared household income, tagged
`incomequintile:1`..`:5` by whoever loads the book. Not a named market index.

There is no SAARF/BRC equivalent for the GCC that we hold a licence to. ADR-0069
§4 already settled the general rule and this is the concrete application:
naming an index we do not have would put a fabricated citation into a system
prompt that a human funds a campaign against. A quintile is honest because it is
self-describing — the tenant owns the cut, Lyra owns only the vocabulary — and
the band labels say exactly that ("Q5 — highest fifth of declared household
income") rather than implying an external authority.

It is genuinely weaker than LSM: a quintile is relative to one book, so two
tenants' Q5s are not comparable and a cross-tenant benchmark on it would be
meaningless. That is the price of not inventing a citation, and it is the right
price.

### 4. `region` means emirates, and needs no new machinery

`region:dubai`, `region:abu-dhabi`, `region:sharjah`, `region:ajman`,
`region:umm-al-quwain`, `region:ras-al-khaimah`, `region:fujairah`.

Checked and deliberately *not* built: pack-declared *values*. In
`TargetingPack` only the affluence axis carries declared bands, because only it
needs a per-band descriptor for the prompt. Every other axis is counted straight
off whatever the tenant tagged, so the emirates are already expressible with
zero code. A value vocabulary would buy validation of tag spelling and would
cost a second place every pack has to be edited; when a tenant miskeys an
emirate the cell simply falls below the k-anonymity floor and is suppressed,
which is a survivable failure. Revisit if tag spelling drift is ever observed in
practice.

### 5. Nationality and residency are protected, not omitted

**Nationality band is the single biggest UAE motor-pricing and media-targeting
axis in actual market practice.** A UAE media buyer asks for it first. Leaving
it out costs this pack real selling power, and the honest thing is to say so
rather than to quietly ship an axis list that happens not to mention it.

It stays out, and it stays out *mechanically*:
`packages/core/src/targeting.ts` `PROTECTED_AXES` gains `nationality`,
`nationalorigin` and `residency`.

The reasoning:

1. A nationality tag is a working proxy for `race` and `ethnicity`, which that
   same list already refuses. A compliance floor that any pack can route around
   by choosing a synonym is not a floor.
2. Residency status (citizen / resident / visitor) is the same proxy one step
   removed, and in a Gulf book it correlates with national origin almost
   perfectly.
3. Putting them in `PROTECTED_AXES` rather than merely leaving them out of the
   pack's `axes` means `defineTargetingPack` strips them from *any* pack that
   declares them, and `isTargetable` refuses them again on the way out. A future
   pack author cannot re-enable them without editing the compliance floor and a
   test that says why.

What this does **not** decide: an underwriter may still *rate* on residency
where the regulator permits it. Rating is a quote-engine input, priced per risk
and disclosed; targeting is choosing who hears an offer at all. This ADR is
about the second.

The prompts move with the floor: the forbidden lists in
`audience-brief.ts` and `campaign-plan.ts` now name nationality, national origin
and residency status, so the model is told the rule and the parser enforces it.
Eval case `aud-14` feeds a `nationality=expat` cell through the parser and
asserts it is dropped while the legitimate selection beside it survives.

### 6. The seeded book is tagged

`packages/core/src/seed/history-modules.ts` writes `axis:value` tags for all 180
history customers, deterministically (no random source; `scatter()` is a 32-bit
avalanche over the existing `hashOf`, because `hashOf` alone is near-linear in a
numeric key and ordering the book by it banded the book by row order).

Shape: Dubai 74 / Abu Dhabi 46 / Sharjah 28 carry the book, the four northern
emirates are thin; age bands peak at 35-44; quintiles are exactly 30 each,
because a quintile that is not a fifth is a lie about the word. The emirate lean
shows up in the joint instead — and the deliberate finding left for SCOUT is
that **Sharjah is 28 customers with nobody above the middle quintile**, a real
segment gap rather than noise. Six cells sit below `DEFAULT_K_FLOOR` on purpose
(four emirates, the youngest and oldest age bands) so the floor visibly binds in
the demo instead of never being reached.

Businesses (one row in six) get `region` and `language` only. A company has no
age band, life stage or household income quintile, and inventing them is what a
buyer notices first.

## Consequences

- The demo tenant can propose an audience at all, which it could not before.
- A second GCC tenant (KSA, SAR) reuses `insurance-gulf` **unchanged**: the axes
  are the same, `region` is free-text so Riyadh/Makkah/Eastern Province need no
  code, `language` is already en/ar, and the quintile is over that tenant's own
  book. What it would have to change lives outside this pack — currency and
  locale in `PolicyJson`, the carrier panel, and the rating tables. If a KSA
  tenant ever needs a *different* affluence measure, that is a new pack entry,
  not an edit to this one.
- `packages/model-gateway/src/vocabulary.ts` registers `insurance-gulf` with the
  same prompt nouns as the ZA default (a Gulf motor book still sells policies).
  Registered rather than left to fall through, so the seeded tenant's nouns are
  a decision on the page.
- Not changed: `apps/web/app/modules/vocabulary.ts`. That table renames
  *insurance* nouns for non-insurance packs; a Gulf insurance tenant wants the
  insurance nouns, which the workspace catalogue already carries in both en and
  ar. An `insurance-gulf` entry there would be a byte-for-byte duplicate of 17
  Arabic strings that *takes precedence* over the catalogue — a second source of
  truth against docs/26's one-concept-one-term rule. An unregistered pack reads
  as identity there, which is the documented and correct degradation.
- Not changed: `apps/api/src/engines/axis-policy-document.ts`, whose own pack
  table falls back to `insurance-retail` nouns — which are the right nouns for a
  Gulf insurance tenant.
- `TargetingProposal.lsm` is still spelled `lsm` on the wire for every pack, per
  ADR-0069 "The name we did not change".

## Alternatives rejected

- **Ship `nationality` as a targetable axis with a consent gate.** Rejected: the
  gate would be per-tenant policy, and the axis is a race proxy regardless of
  who consented to what. Consent to hold an attribute is not consent to be
  advertised to on it.
- **A GCC "social grade" scale invented for the purpose.** Rejected as a
  fabricated authority — the same failure as citing an index we do not licence,
  with an extra layer of invention.
- **Leave nationality merely undeclared in the pack.** Rejected: the next pack
  author declares it in good faith and nothing stops them.
