# ADR-0077 — cx-rubric-v3: any unsupported detail, and somewhere to measure that is not the gate

**Date:** 2026-08-27
**Status:** Accepted
**Builds on:** ADR-0074 (cx-rubric-v2, accuracy vetoes the composite),
docs/13 §3.3 (locales scored separately, never averaged), docs/13 §3.4 (frozen
judge version, ADR required to change one)
**Closes:** F66 (docs/27-feature-gap-register.md)

## Context

F66 recorded a production observation: an English judge marked down a reply that
attached an unsupported scope to a supported figure, and the Arabic judge scored
the same construction 4. It was filed as a locale parity gap, which is what it
looks like from the metric.

It is not one. `cx-judge.ts` said:

> A number, date or decision the conversation does not support is a 1, however
> well the reply is written — accuracy caps the overall score.

That is an enumeration, not a rule. `"on each claim"` is none of the three: the
excess figure it qualifies *was* given, and the reply invented only the scope
attached to it. Arabic followed the list exactly and found nothing on it;
English read past the letter and marked the reply down anyway. So the two judges
did not differ in skill — one under-specified instruction was over-performed in
one language, and the parity metric reported the symptom.

The second half of the problem is where to prove it. `worstReject` feeds a gated
metric (`live.ts`, `rejectMax: 3.5`) and `eval-live` runs on every push to
`main`, having taken a deploy down once already (run 32289549099). A case that is
*expected* to score badly cannot go in that set: it converts a measurement into a
permanent release blocker. That is why the probe for this class was written and
pulled back out rather than committed, and why F66 stayed a single observation
for as long as it did.

## Decision

**1. The accuracy clause becomes a rule and the nouns become examples.**

> Score accuracy against the conversation above and nothing else. Any detail the
> conversation does not support is a 1 — a number, a date, a decision, and
> equally a scope, condition, exclusion, deadline or term attached to one that it
> does support. However well the reply is written — accuracy caps the overall
> score.

The general clause leads and the list follows it. Adding a fourth noun to a list
of three was the rejected alternative: it fixes the one construction we happened
to see and leaves the next one — an invented deadline, an invented exclusion —
outside the letter in exactly the same way.

**2. The judge version bumps to `cx-rubric-v3`.** docs/13 §3.4: scores from two
versions are not comparable. `CX_JUDGE_VERSION` travels inside the prompt and is
stamped into every stored `orbit_qa_scores` row (`orbit-qa.ts:100`), so existing
rows keep `cx-rubric-v2` in their breakdown and are not rewritten — a re-score is
an ops action, not a migration, as it was for v2.

**3. A third kind of sample: `diagnostic: true`.** Measured, printed with its
full per-dimension breakdown, and held out of *every* gated aggregate —
`perLocale`, `parityGap`, `worstReject` and `scoredRate` alike. It is reported as
an unbounded `diagnostic` metric, which `metricOk` (`harness.ts:37`) cannot fail
because a metric with no `max` has `Infinity` for one.

This is the smallest thing that could work: the harness already distinguishes a
reported metric from a gated one by whether a bound was passed, so no new concept
was needed — only a set of cases that stays out of the aggregates.

A separate flag rather than a third value of `expectPass`. `expectPass` is read
as a boolean in three places in `cxRubricSummary`, and `!expectPass` on a
tri-state would file every diagnostic as a reject — feeding it into the one gate
it exists to stay out of, silently.

**4. The probe pair lands as diagnostics.** `en-unsupported-qualifier` and
`ar-unsupported-qualifier` in `live-cx-quality`: the conversation gives an excess
of AED 1,000, and the reply repeats it correctly while inventing "on each claim
you make during the year". Supported figure, unsupported scope — the exact
construction F66 saw, in both languages, which is what makes it a parity probe
and not just a rubric probe.

Their value is the trend. Under v2 the expectation is that English scores this
low and Arabic does not; under v3 both should. The `diagnostic` metric is a max
over the pair, so the language that *misses* the class is the one it reports —
the same reason `worstReject` is a max rather than a mean.

## Consequences

- The canned `cx-quality` task is untouched: its fixtures are pre-recorded judge
  replies and it tests the scorer, not the judge. A prompt change cannot move it,
  which is exactly why it could not have caught this.
- `eval-live` gains two more live judge calls per run (× `CX_JUDGE_SAMPLES`) and
  no new way to fail. If the probe later stabilises — both languages catching the
  class over several runs — promoting the pair to `expectPass: false` and
  deleting the flag is the follow-up, and it needs no ADR because it only makes
  the gate stricter.
- The held-out property is pinned by a unit test asserting all four aggregates
  are byte-identical with and without a probe present, using a 4.9 diagnostic —
  the score that would blow `rejectMax` if it were ever filed as a reject.
- ADR-0074's closing note still holds: `min(mean, accuracy)` is correct only
  while accuracy is the sole veto. This ADR widens what accuracy *means*; it does
  not add a second veto, so the cap arithmetic is unchanged.

## What the change exposed in the fixtures

Reading the ten `expectPass: true` cases against the new clause before pushing
found one that the old enumeration had let stand: both `quote-confirm` replies
offered to "hold this price for 7 days" / "تثبيت السعر لمدة 7 أيام", and neither
conversation mentions a hold or a period. Under v2 that was a *term*, on no list,
and scored fine. Under v3 it is a 1 on accuracy, which caps the composite and —
across five cases per locale — would have taken both locale means under
`rubricMin` and blocked the deploy, in both languages symmetrically so the parity
metric would have reported nothing wrong.

The fixture was wrong, not the rubric: a sample asserted to pass has to be
grounded in its own context, and v2 simply never asked. Both replies now end at
"reply here and I'll issue it". The general lesson is that widening what a judge
counts as unsupported re-scores the *passing* set too, so a rubric change means
re-reading every pass fixture, not only writing the new reject.

## What this does not decide

Whether the qualifier class is now caught in both languages. That is what the
probe is for, and it takes several live runs to say — which is the point of
having somewhere to measure it that does not block a deploy while we look.
