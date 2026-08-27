# ADR-0075 — On-prem deployments have no image generation, and say so

**Date:** 2026-08-27
**Status:** Accepted
**Builds on:** ADR-0010 (on-prem stack lives in `ops/`), ADR-0060 (AI imagery
for SIGNAL creatives), docs/02 §9 (approved third-party services)
**Closes:** the first of the two ADRs F67 asks for
(docs/27-feature-gap-register.md)

## Context

Text and embeddings each have two homes; images have one.

`resolveModel` (`packages/model-gateway/src/models.ts:79`) branches on
`opts.onPrem` and pins every tier to `ONPREM_ROUTES`, enforcing that pin over a
tenant's own override because the alternative is a data-residency breach —
`models.ts:87` says exactly that in its own comment. `embed()` repeats the
shape at `gateway.ts:243`: `EMBED_MODEL` is `{ cloud: "bge-m3", onprem:
"internal-embed" }` and the ternary picks by `ctx.policy.dataResidency`.

`generateImage` had neither. It read `IMAGE_CATALOGUE[IMAGE_MODEL.cloud]`
unconditionally (`gateway.ts:352`), and `IMAGE_MODEL` is a one-key map:
`{ cloud: "flux-schnell" }`, provider `workers-ai`.

F67 filed this as latent on the grounds that nothing outside the gateway calls
`generateImage`. That was wrong, and the correction is why this ADR exists
rather than a ponytail comment. `apps/api/src/engines/signal-creative.ts:289`
calls it from `generateCreativeImage`, which is routed at
`apps/api/src/routes/signal.ts:195` as `POST /v1/signal/creatives/image`. The
route is permission-gated (`signal:creatives:generate`) and not residency-gated.
So an on-prem tenant — one whose whole reason for being on-prem is that
prompts do not leave the building — could send an operator-authored image brief
to Cloudflare Workers AI, over a path the text and embedding paths both refuse.

## Decision

**On-prem deployments do not generate images.** `generateImage` reads
`ctx.policy.dataResidency` and throws before the provider call, the same field
the other two paths read.

Not a fallback to cloud, and not a silent no-op. The two rejected alternatives:

- *Route it to the cloud anyway.* This is the breach. It is precisely what
  `models.ts:87` refuses to do for text, and doing it for images would mean the
  residency guarantee holds for the two paths a reviewer checks first and fails
  on the third.
- *Add an image server to `ops/`.* The stack already runs Ollama, vLLM behind a
  `gpu` profile and TEI embeddings (`ops/docker-compose.yml:132-168`), so
  "add another model service" looks cheap. It is not: a diffusion server is a
  new approved third-party image (docs/02 §9 — an ADR of its own), a second GPU
  workload contending with vLLM on the same host, a `models:` volume large
  enough for diffusion weights, and — the part that decides it — an output whose
  quality nothing here can measure. LYRA has no visual-quality gate. Shipping a
  second image model with no way to compare it against the first means an
  on-prem tenant gets *different* imagery with no evidence it is acceptable
  imagery. That gate is F67's second ADR and is not written yet.

So this is a capability an on-prem deployment does not have, stated plainly,
rather than a tier to downgrade quietly.

## Consequences

- `POST /v1/signal/creatives/image` returns **403 `onprem_no_image_model`** for
  an on-prem tenant, as problem+json like every other refusal. An `AppError`
  rather than the bare `Error`s beside it in `generateImage`: those guard
  unreachable catalogue config, where 500 is honest, while this is a policy
  refusal on a request the platform understood — and an untyped throw on a live
  route is a 500 the caller cannot act on. 403 and not 402 `not_entitled`:
  nothing about this is a billing tier, and framing a residency guarantee as a
  plan limit invites someone to try upgrading out of it.
- SIGNAL's creative flow keeps working on-prem for everything else: ad copy is
  text and routes internally, and `signal-studio.tsx` renders the SVG post-card
  client-side with no model involved at all.
- The seam is the upgrade path, not a rewrite. Give `IMAGE_MODEL` an `onprem`
  key beside `EMBED_MODEL`'s and this guard becomes the same ternary
  `embed()` already uses — one line, in one place, once the two questions above
  are answered.
- The guard is pinned by `gateway.test.ts`'s third on-prem sibling, beside the
  `complete()` and `embed()` residency tests, and it asserts the provider was
  never called rather than only that an error was raised.

## What this does not decide

Which diffusion server LYRA would run if an on-prem tenant needs imagery, and
what visual-quality threshold would gate it. Both stay open. The point of
refusing now is that neither has to be guessed at under deadline the day a
tenant asks.
