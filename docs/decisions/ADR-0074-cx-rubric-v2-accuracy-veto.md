# ADR-0074 — cx-rubric-v2: accuracy caps the CX score

**Date:** 2026-08-26
**Status:** Accepted
**Supersedes:** the equal-weight mean in `cx-rubric-v1`
**Builds on:** docs/13 §3.3 (CX quality rubric ≥ 4.2, ar+en separately),
docs/13 §3.4 (frozen judge version, n=5, judge changes are ADR'd)

## Context

The live CX gate (`evals/live-cx-quality`, added `d259a95`) went red on its
first run with real credentials, and it was right to:

```
live-cx-quality
  PASS rubric.ar = 5.000 (need >= 4.2)
  PASS rubric.en = 4.950 (need >= 4.2)
  FAIL reject = 4.000 (need <= 3.5)
```

The two `expectPass: false` cases are a flat fabrication. The conversation says
"assessment in progress, no payout figure yet"; the reply says "approved for
AED 7,500 and the money is already on its way". Both locales scored 4.000 out
of 5.

4.000 is not a judge that has stopped reading. With four equally weighted
dimensions on a 1–5 integer scale it is the arithmetic of a judge reading
correctly: accuracy 1, clarity 5, tone 5, actionability 5, mean 4.0. The reply
*is* clear, warm and actionable. It is also false. `cx-rubric-v1` averages those
together and calls the result 80%.

The failure is therefore in the rubric, not in the threshold and not in the
fixture. Raising `rejectMax` to 4.1 would make the gate green while leaving the
defect in place, and the defect is not confined to the eval: `parseCxScore` is
the same function ORBIT's QA sweep calls
(`apps/api/src/engines/orbit-qa.ts:81`). Production today stores 80/100 for an
invented settlement figure and discards the accuracy score before it reaches
`breakdownJson`. A reviewer scanning the QA wall for weak replies would never
see it.

For a regulated insurance surface, an invented payout is not three-quarters of
a good reply. Accuracy is a gate the other dimensions sit behind.

## Decision

**1. Accuracy caps the composite.** `cx-rubric-v2` scores the four dimensions as
before, then returns `min(mean, accuracy)`. A reply that invents a fact cannot
score above its accuracy mark however well it is written; a reply that is
accurate is unaffected, because `accuracy >= mean` is the ordinary case only
when the other dimensions drag the mean below it — and there the mean still
governs. On the reject fixtures this yields 1.0 rather than 4.0.

A cap, not a weight. Weighting accuracy at (say) 0.7 keeps the property we are
trying to remove: enough polish still buys a passing score. A cap says the
thing we actually mean — the reply is worth no more than it is true.

**2. The dimensions travel with the score.** `parseCxScore` returns a number and
throws the breakdown away, which is why the eval could only report "4.000" and
this ADR had to reconstruct the cause by arithmetic. `parseCxDimensions`
returns the per-dimension object; `parseCxScore` keeps its signature and is
defined in terms of it. The live scorer prints the dimensions of any case that
misses its threshold, and ORBIT's QA sweep stores them in `breakdownJson`.

**3. The judge version bumps to `cx-rubric-v2`** (docs/13 §3.4: scores from two
versions are not comparable). `CX_JUDGE_VERSION` travels inside the prompt, so
runs kept as evidence name the rubric they were scored against. Existing
`orbit_qa_scores` rows keep `judgeVersion: "cx-rubric-v1"` in their breakdown
and are not rewritten — a re-score is an ops action, not a migration.

**4. The prompt gains one sentence** telling the judge that accuracy is scored
against the conversation alone and that an unsupported number is a 1. This is
the rubric being explicit about what v1 left to inference; it is inside the
version bump.

**5. `rejectMax` stays at 3.5.** It was a first estimate and it was a defensible
one: the question it asks is "did the rubric mark this down", and 3.5 is a
reasonable line for that. Under v2 the reject cases land at 1.0, so the gate
passes with room rather than by tuning.

## Consequences

- The canned `cx-quality` task's numbers move, because its fixtures are judge
  replies and the aggregation changed. Its thresholds are unchanged; the
  fixtures now include a low-accuracy case so the canned half gates the cap
  itself and not only the mean.
- ORBIT QA scores drop for fluent-but-unsupported replies, which is the point.
  Tenants comparing a v2 score against a v1 score in the same chart are
  comparing two rubrics; the QA wall reads `judgeVersion` from the breakdown.
- `min(mean, accuracy)` is only correct while accuracy is the sole
  veto dimension. A second veto (say, a compliance dimension) is a v3 and
  another ADR.

## Alternatives rejected

- **Raise `rejectMax` to 4.1.** Green gate, unchanged defect, and it would have
  shipped the production QA hole with a passing test standing over it.
- **Weight accuracy 0.7 / others 0.1.** Softer version of the same problem: the
  fabrication scores 1.9, under the ceiling, but the property "polish buys
  score" survives for the next fixture.
- **Score accuracy as a separate metric and gate it separately.** Cleaner in
  isolation, but ORBIT's QA column stores one number and the reviewer's screen
  reads one number. Two scores means picking one for the UI, which is this
  decision again with an extra step.
