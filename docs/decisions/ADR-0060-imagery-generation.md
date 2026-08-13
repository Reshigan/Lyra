# ADR-0060 — Imagery generation runs through model-gateway as a sibling of complete/embed

Status: accepted · 2026-08-13

## Context

Signal Studio's `PostArt` component (`apps/web/app/routes/signal-studio.tsx`)
renders creatives as SVG placeholders only; `signal_creatives.contentRef`
(`packages/db/src/schema/signal.ts`) already anticipates a file id but nothing
writes one. CLAUDE.md §3 requires all model access go through
`packages/model-gateway` with tenant/module/purpose/actor on every call,
written to `ai_audit_log`; §4 requires an eval golden set before any prompt/
model integration ships.

`Gateway` (`packages/model-gateway/src/gateway.ts`) already has two call
shapes — `complete()` (chat, with `checkOutput`) and `embed()` (vectors, no
output check). Image generation is closer to `embed()`: one provider round
trip, no conversational output to guard, but it does take free-text input
(a creative brief) that deserves the same input guardrail `complete()` runs.

## Decision

1. **New purpose `"creative.image_generate"`**, `{module: "signal",
   customerFacing: false}` in `purposes.ts`, alongside the existing
   `creative.generate` / `creative.variant` / `aeo.draft` signal purposes.
2. **New `ImageRequest`/`ImageResponse` types** in `types.ts`, and an
   optional `generateImage?()` on `Provider` — optional because only
   Workers AI implements it; Anthropic/OpenAI-compat providers don't need a
   stub method they'll never be routed to.
3. **`Gateway.generateImage(ctx, req)`** mirrors `embed()`'s flow: kill
   switch → budget → resolve model → provider call → cost → charge →
   `writeAudit()`. It runs `checkInput(req.prompt)` first (same function
   `complete()` runs on messages) and records hits into the audit flags —
   it does **not** block, matching `checkInput`'s existing contract (all
   its hits are `severity: "warn"`; only `checkOutput` blocks, and there is
   no text output here to check).
4. **`writeAudit()`'s `req` parameter is widened** from `ModelRequest` to
   `Pick<ModelRequest, "module" | "purpose" | "tier" | "subjectRef">` — it
   never read anything else. `generateImage()` passes a synthetic object
   with a fixed `tier: "standard"` (`ImageRequest` has no tier; images
   aren't offered at multiple quality/cost tiers yet).
5. **`IMAGE_CATALOGUE`/`IMAGE_MODEL` in `models.ts`**, parallel to
   `CATALOGUE`/routes but keyed by a flat `costMicroPerImage` instead of
   per-token pricing — a single round trip has no input/output token split.
   Cloud route: Workers AI `@cf/black-forest-labs/flux-1-schnell`.
6. **Storage reuses the existing `files`/R2 pattern** from
   `storeExport()` (`apps/api/src/routes/analytics.ts`): write bytes to the
   existing `FILES` R2 binding (already declared for both prod and staging
   in `apps/api/wrangler.jsonc`, no new resource), hash with the existing
   `sha256Hex()`, insert a `schema.files` row, and set
   `signal_creatives.contentRef` to that file id. No schema migration.
7. **Eval: register `evals/creative-image/` against the existing
   `scoreInjection` scorer** in `run.ts`'s `SCORERS` map, rather than
   writing a bespoke scorer. `scoreInjection` scores `checkInput()`
   directly — the exact function `generateImage()`'s guardrail step calls —
   so a new golden set of image-brief jailbreak/clean cases is fully
   scored by the function that already exists, the same way `"axis-copilot"`
   and `"orbit-draft"` both already reuse `scoreGroundedness`.

## Alternatives rejected

**Call Workers AI directly from the Signal engine.** Forbidden by CLAUDE.md
§3 — every model call must carry tenant/module/purpose/actor and land in
`ai_audit_log` via the gateway.

**Bespoke image-eval scorer.** The only new production logic is a
`checkInput()` call already covered by `scoreInjection`; a second scorer
scoring the same function would be duplicate code for no new coverage.

**Block generation on a guardrail hit.** Would make `generateImage()`
inconsistent with `complete()`, where `checkInput` hits are advisory. Actual
misuse containment is `checkOutput`-equivalent moderation on the returned
image, which is out of scope until a provider offers it — tracked as a
follow-up, not blocking this ADR.

## Consequences

- No new Cloudflare resource, no new schema migration.
- `writeAudit()`'s narrower parameter type is a compile-time-checked
  contract: any future field it starts reading off `req` will fail to
  compile for the synthetic image-request object until `generateImage()`
  is updated too.
- Image cost accounting is flat-per-image, not proportional to prompt
  length; if a future model prices by resolution or step count, that's a
  new `ImageModelDef` field, not a rework of this shape.
