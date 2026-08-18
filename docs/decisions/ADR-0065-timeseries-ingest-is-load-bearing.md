# ADR-0065 — The H6 timeseries seam is load-bearing, and a reprice is an endorsement

Status: accepted · 2026-08-18
Context: docs/16 §H6, docs/27 revenue line F5, `packages/core/src/seams.ts:75`,
`apps/api/src/engines/telematics.ts`, `packages/model-gateway/src/ubi.ts`,
`docs/superpowers/plans/2026-08-18-telematics-ubi.md`

## Decision

Usage-based pricing ships as an implementation *of* the H6 seam, not beside it.
`TelematicsIngest` implements `TimeseriesIngest` verbatim, and a telemetry-driven
price change runs through `endorsePolicy` — the same pricing call, referral
guard, approval gate, posting recipe, audit trail and event as an
underwriter-typed endorsement. Five choices follow from that and are frozen here.

**1. `source` is the series key, one adapter instance per series.**
`TimeseriesIngest`'s point shape is `{ at, value }` — a value with no metric
name. So the series identity has to live on the adapter, and it does:
`new TelematicsIngest(ctx, "telematics:obd:km", policy)` is the kilometres
adapter, `…:harsh_brake` is another instance. The same string is the
`axis_telemetry_points.source` column, the key the model is shown, and the
`evidenceRef` a proposed factor must name. One string, one meaning, end to end.
The alternative — widening H6's point shape with a metric field — would change a
published seam for no capability the instance-per-series shape lacks. H6 stays
as written (CLAUDE.md #15).

**2. The model reasons in parts per million, never in money.**
`parseUbi` returns `premiumDeltaPpm`, a signed proportion; the engine converts it
against the premium the stored contract already holds. Handing a model minor
units would let it invent an amount no contract has to agree with, and a wrong
number would then be indistinguishable from a right one. A proportion can only
be wrong by degree, and degree is clampable.

**3. The clamp is ±250 000 ppm (±25%), enforced in the parser.**
`MAX_REPRICE_PPM` lives in `packages/model-gateway/src/ubi.ts` and applies before
any engine sees the reply, so a model that returns 900% cannot bill it and no
call site can forget the guard. The parser also drops any factor without a
non-empty `evidenceRef`, and zeroes the adjustment entirely when no evidenced
factor survives: an unexplainable price change is not a price change, however
confident the reply sounded. The clamp bounds a single step to a quarter of the
current premium, and repeated maximal downward steps cannot walk a premium to
zero either: the engine converts ppm with `Math.round`, which rounds half
toward +∞, so P=1→1, P=2→2, P=3→2, P=4→3 — a positive integer premium always
keeps at least one minor unit.

The hole the zero-premium guard closes is a different one: a cover that is
*already* at `premiumMinor === 0`. A manual endorsement can write one —
`EndorseBody.premiumMinor` is `nonnegative()` — and because the engine prices a
reprice as a ratio of the stored premium, every later reprice on such a cover
would move premium, tax and commission by nothing while stamping a new version
each time. The engine refuses at or below zero rather than flooring silently: a
zero premium is not a price.

**4. `UBI-REPRICE` has a recipe, and it is deliberately identical to `ENDORSE`'s.**
The plan that preceded this branch said the type would have no recipe of its own.
It has one (`packages/ledger/src/recipes.ts:485`), and the identity is the point:
`POST /v1/txn/{type}` validates every financial type against the recipe table, so
a type without a row is a type nobody can post. The two codes differ in
**provenance, not in posting** — the ledger records that a sensor moved the
price rather than an underwriter, which is the first question asked when a
customer disputes a premium, while the money lands in exactly the same place.
`endorsePolicy` therefore builds `ENDORSE`'s recipe whatever `opts.type` says,
and that divergence between type and recipe is intentional and commented at both
sites. `opts.type` additionally prefixes the ledger idempotency key
(`axis.ubi-reprice:…` vs `axis.endorse:…`) *and* the approval subject ref, so a
reprice and a manual endorsement carrying the same change set can neither
collide on one ledger key nor spend each other's approval — an underwriter
approving a manual +10% must not silently authorise a sensor-driven one.

Both are scoped to the version being superseded, not to the change set alone:
`axis.ubi-reprice:<policy>:<version>:<changeSetHash>:<premiumDeltaMinor>:<proRataDays>`
and
`axis_ubi_reprice:<policy>:<version>:<changeSetHash>`. `changeSetHashOf` covers
`{changes, reason}` and *not* the price, so two reprices proposing the same
factor codes at the same weights but a different `premiumDeltaPpm` hash
identically. On the hash alone the second one replayed the first's settled
transaction — `runTxn` returns a settled txn untouched and posts no journal —
while `endorsePolicy` carried on, superseded the version and stamped the policy
at the new premium. That is money state with no journal behind it (CLAUDE.md
#12). Exactly one endorsement can supersede a given version (§C.2), so the
version id is the honest scope: a genuine duplicate off the same version still
collides, a real second price move gets its own key. This amends the subject-ref
convention in docs/specs/gap-axis-design.md §A.3; the property that convention
existed for — an agent-raised and a desk-raised endorsement of one change set
sharing an approval — survives, because both read the same current version.

The **ledger** key carries `:<premiumDeltaMinor>:<proRataDays>` as well (both
legs, the `.refund` one included); the subject ref does not. The version is
the full scope only until a retry re-reads it: the charge `runTxn` settles,
something throws before the version insert — the refund leg, an eviction — and
the retry finds the same still-current version. If that retry prices
differently, which is exactly the reprice whose model returns another
`premiumDeltaPpm` for the same factor codes, the key collided again and the
version was superseded against a replayed transaction. Those two fields are the
honest discriminator: off a fixed version the new premium is
`current.premiumMinor + premiumDeltaMinor` and every other quote field derives
from that plus `proRataDays`, so the pair determines the whole quote. Neither
posted amount does alone — `share()` maps a band of premium deltas onto one
`chargeMinor` (100_174 and 100_175 against a 100_000 premium both charge 184 and
carry different commission legs), and `premiumDeltaMinor` by itself cannot tell a
back-dated re-issue from the original at the same target premium. A genuine
duplicate of the identical request still collides; two prices off one version
cannot. This does *not* make the path atomic — an abandoned settled charge is still an over-post
needing compensation, and that remains open — but it holds the invariant that
matters: no money state moves without a journal behind it. The amount stays off
the subject ref on purpose: an approval's identity is the request a human is
being asked about, not the number it happens to compute to, and forking it on
the amount would stop an agent-raised and a desk-raised change sharing one
decision.

**Version scoping orphans a pending approval.** A consequence of the subject ref
naming the version: an approval raised against version V no longer matches a
retry after any intervening endorsement or reprice, because `gate`
(`packages/core/src/approvals.ts:222`) matches `(subjectRef, policyKey)` exactly,
so the granted row is left unspent and the retry raises a second request. That is
the safer default — the base premium and therefore `amountMinor` changed, and
`approvals.ts:247` already refuses to reuse an approval granted for less — but
desks will accumulate approved-but-unactioned rows and need a way to see them.

**The residual on the `/reprice` fallback key.** `POST
/v1/axis/policies/:id/reprice` derives its idempotency key from the current
version when the client sends no `Idempotency-Key` header, and a successful
reprice changes that version. An un-keyed retry after a settled reprice
therefore derives a different key, and if fresh telemetry has landed in the new
window it will price again. That is accepted, and it is a documented limit
rather than a hidden one: with no client key, such a retry is indistinguishable
from a genuine second reprice request, and pricing new telemetry is the correct
answer to the second. What the fallback does provide is collapsing an immediate
double submit — two requests in flight together read the same current version,
derive one key, and the later one is refused as in-flight before it reaches the
model (pinned in `apps/api/src/axis-telemetry.test.ts`). A client that needs
exactly-once across a lost response must send `Idempotency-Key`.

**5. The priced watermark is pricing history. No version boundary participates.**
Unpriced exposure starts at `max(policy.startAt, last stamped ubi.windowEnd)` —
inception, because exposure before the cover began is not covered exposure, and
the end of the last window a reprice actually priced, because that is the only
thing already billed. Nothing else is consulted. A version boundary is where the
*price* changed, not where *pricing* got up to, and three successive attempts to
derive the watermark from one (`effective.effectiveFrom`, then `versionAt(now)`,
then the max of that and the last window) each shipped a money defect: the last
of them put the start in the future the moment a pending forward-dated
endorsement's date arrived, stranding telemetry the ingest guard had already
accepted. `unpricedFrom` (`apps/api/src/engines/telematics.ts`) is now two
bounds and one query, and a change that reintroduces a version lookup there is
reintroducing that class of defect.

The invariant it exists to hold is **accepted implies priceable**: a point the
ingest doorway accepts is a point some future window prices. That is why the
ingest guard and the reprice window read the same function and not two
expressions that happen to agree — a watermark that can move forward for a
reason unrelated to pricing can always open a gap between the two, and exposure
that falls in it is silently under-billed with a balanced journal every time, so
no ledger invariant catches it.

A test pinning this must assert **which exposure was priced** — in minor units,
or in window bounds — not that a reprice happened. Every one of the four
Criticals this rule has produced survived a suite that asserted liveness
(`repriced === true`, a non-empty series, a bare status code). An assertion that
would still pass if the window silently doubled or silently dropped a day is not
the assertion.

## The gap this records

**Consent is not enforced at ingest.** docs/16 §H6 names a consent purpose
`telemetry`; nothing checks it. LYRA's only consent store today is
`signal_contacts.consent_purposes`, a marketing-scoped, contact-scoped column
with no link to a cover and no `telemetry` purpose in use. `TelematicsIngest`
authorises on the RBAC permission `axis:policies:telemetry` and on the batch
naming the right cover, and stops there. In production that means a tenant can
post readings against a customer's cover, and reprice on them, without a stored
record of that customer having agreed to be measured.

This is a real compliance gap, not a deferred nicety: the whole reason
`core_products.pricing_inputs_json` declares behavioural inputs is that declared
inputs are auditable (docs/12 §4), and a declared input gathered without consent
is the failure mode that argument is meant to prevent. It is recorded rather than
closed because closing it needs a consent model LYRA does not have — subject-scoped
rather than contact-scoped, with purposes beyond marketing — and inventing one
inside a pricing engine would put it in the wrong place.

**The reprice does not ask what the customer was told.** The referral guard
refuses a factor the product does not price on (`pricingInputsJson` is the
allowlist), so a factor can only reach a price if the product declared it. But
nothing checks that the *customer* was shown that declaration.

## The seam that closes it

A consent check belongs in front of `TelematicsIngest.ingest`, not inside it: the
seam's contract is "store these points", and the caller is what knows the purpose.
When a subject-scoped consent store exists, the route
(`POST /v1/axis/policies/:id/telemetry`) gains the check and the engine is
unchanged. Until then, the deployment note below is the mitigation.

Fairness auditing extends the same way. The factors that moved a price are stored
on the version (`termsJson.ubi`, carrying the model-gateway audit id, the window,
every surviving factor and how many were dropped), so "which model call, on which
telemetry, changed this premium" is answerable from the contract without a new
table. A fairness audit reads that field; it does not need the engine widened.

## Deployment note

The ingest and reprice routes are live but nothing calls them: there is no device
integration, no fleet import and no scheduled reprice sweep. A price moves only
when an operator with `axis:policies:endorse` posts to `/reprice`, and even then
the transaction is consequential and stops at the approval gate unless the tenant
has explicitly automated `axis.endorse`. No tenant should automate it before the
consent gap above is closed. Seeded environments carry no telemetry points, so
the first tick after this branch ships changes nothing on its own.

## Alternatives considered

**A second pricing engine for UBI.** Rejected. A telemetry-driven price change is
a mid-term endorsement in every respect that matters — same pro-rata arithmetic,
same commission movement, same regulatory footing — and a parallel engine would
have had to re-derive all of it, then drift from it. Reusing `endorsePolicy` is
also what made the approval gate free: the reprice inherited it rather than
needing its own.

**Letting the model return a premium.** Rejected — see decision 3. It also
removes the clamp's meaning: a bounded proportion is checkable against the stored
contract, an absolute amount is only checkable against itself.

**Widening `TimeseriesIngest` with a metric name.** Rejected. Instance-per-series
already expresses it, the seam is published, and a change to a published seam
needs a reason stronger than taste.

**Blocking ingest until a consent store exists.** Rejected. It would leave the H6
seam with no production implementation and the revenue line unbuildable, while
delivering no protection an unwired route does not already give — nothing calls
these routes yet. The gap is written down here and the autonomy guidance above is
the interim control.

## Consequences

- H6 has its first production implementation, so its shape is now frozen against
  a real caller: changing `TimeseriesIngest` means changing `TelematicsIngest`
  and needs an ADR.
- A telemetry reprice is indistinguishable from an endorsement in the ledger's
  money, and distinguishable in its provenance. Reporting that groups by
  transaction type sees `UBI-REPRICE` separately; reporting that groups by
  account does not, and should not.
- Any tenant enabling usage-based pricing before the consent gap closes carries
  the compliance risk in their own policy decision, not in code. That is a
  weaker control than an enforced check, and it is stated here so it is not
  mistaken for one.
- The spec's instruction to record this in ADR-0062 is stale: 0062-0064 were
  claimed by the Group C lineage and 0066 by Group D. This lineage takes 0065,
  the remaining gap.
