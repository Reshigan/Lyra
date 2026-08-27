# ADR-0076 — A generated image is gated on what it is *used for*, not on how it looks

**Date:** 2026-08-27
**Status:** Accepted
**Builds on:** ADR-0060 (AI imagery for SIGNAL creatives), ADR-0075 (on-prem
has no image generation), docs/13 §3.4 (frozen judge versions, ADR required to
change a judge), CLAUDE.md §4 (AI features are eval-first)
**Closes:** the second of the two ADRs F67 asks for
(docs/27-feature-gap-register.md)

## Context

CLAUDE.md §4 is unconditional: before writing any prompt, agent or model
integration, author the golden set and thresholds. Every text and vision path
in the platform obeys it. `generateImage` does not, and F67 named the reason —
`evals/creative-image/` is scored by `scoreInjection` (`evals/run.ts:977`) and
its cases are jailbreak prompts asserting `expectHit: true`. That measures
prompt-injection screening on the image path. It measures nothing about the
image.

The obvious next move is "add an image eval", and it is the wrong one. Every
scorer in `evals/run.ts` — all sixteen — takes model output that is *text* and
compares it to an expected value. The nearest sibling looks like a
counter-example and is not: `scoreAxisVision` (`run.ts:186`) sends an image and
scores the **extraction**, field by field against `c.expected`, with a
`hallucinatedFieldRate` for fields the document does not contain. Its subject is
still a string. There is no expected value for a generated picture. Two runs of
`flux-schnell` on the same brief return different images and both may be fine,
so neither pixel comparison nor an expected-output golden set has any meaning
here.

That leaves a model judging the image, which is where the honest cost shows up.
docs/13 §3.4 requires a frozen judge version and an ADR to change one, because a
judge that drifts silently re-scores history. A visual judge is a second model,
in a second modality, with the same freeze obligation and none of the
determinism — and F66 (docs/27) is the standing evidence that a *text* judge's
rubric can be under-specified in a way that goes unnoticed for months. Buying a
visual judge to gate a capability one module uses on one route is the expensive
answer to a question nobody has yet asked in production.

## Decision

**No aesthetic gate. Gate the properties a wrong image would actually break.**

The three that matter are decidable without judging taste, and two of them
already have homes:

1. **Safety of the brief.** Already gated. `evals/creative-image/` screens the
   prompt for injection before the provider is called, and stays exactly as it
   is. Renaming the directory to say "injection" was considered and rejected —
   `run.ts:977` maps it and the register now records what it does; a rename buys
   a clearer name and costs a broken path.
2. **Residency.** Already gated, by ADR-0075: an on-prem tenant gets a 403, not
   a differently-sourced image.
3. **Consequence.** A generated creative is `consequential: true` the moment it
   leaves the building. CLAUDE.md §4's human-in-the-loop rule is the gate, and
   it is stronger than any judge: a person looks at the image before it is sent.
   An eval that scores 4.2/5 on a rubric and an operator who says "not that one"
   are not the same instrument, and only one of them is accountable.

So the visual-quality gate for the imagery LYRA generates today **is the
approval step**, and that is a decision rather than an omission.

Rejected alternatives:

- *A model-judged rubric now (brand fit, brief adherence, artefact-freeness).*
  The right shape when there is something to compare — see below — and premature
  without it. It costs a frozen judge, a second modality in the eval harness, and
  a threshold nobody can currently calibrate, to gate one route whose output a
  human already approves.
- *Pixel or perceptual-hash comparison against reference images.* Diffusion is
  non-deterministic by construction. This gates the seed, not the quality, and
  goes red on a provider-side model update that changed nothing anyone cares
  about.
- *Ship the model swap and eyeball it.* This is the failure CLAUDE.md §4 exists
  to prevent, and the one F67 was actually pointing at.

## The trigger

This ADR is not "never". It names the event that makes a measured gate worth its
cost, so the next person does not have to re-derive it:

**When a second image model becomes a candidate** — an on-prem diffusion server
(ADR-0075's open question), a provider swap, or a tier change — a *comparative*
gate becomes both meaningful and cheap, because there is finally something to
compare. The shape is A/B on a fixed brief set with human adjudication recorded
as the golden labels, not an absolute score out of five. Until then there is one
model, and "is `flux-schnell` good?" has no answer a threshold can hold.

## Consequences

- `IMAGE_MODEL` stays a one-key map and `generateImage` keeps its single
  catalogue lookup. Adding an `onprem` key (ADR-0075) or a second cloud key now
  requires this ADR to be revisited *first*, because the trigger above fires
  exactly then.
- SIGNAL's creative flow is unchanged; the approval step it already has is now
  documented as load-bearing rather than incidental, which means removing it is
  an ADR and not a UX simplification.
- F67 is closed. Both ADRs it asked for exist: ADR-0075 decided what on-prem
  does, this one decided what quality means and when it gets measured.

## What this does not decide

Which rubric a comparative visual judge would use, or what its thresholds are.
Deliberately — those are calibrated against the first real candidate pair, not
guessed at in advance. Guessing them now is the same mistake as F66's accuracy
clause: a rubric written before anything exercised it.
