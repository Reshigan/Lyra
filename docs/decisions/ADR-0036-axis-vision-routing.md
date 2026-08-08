# ADR-0036: AXIS document vision extraction — routing, screenshot contract, on-prem ceiling

## Status

Accepted.

## Context

docs/specs/gap-axis-design.md §G.5 says the platform "does not actually read
documents — it reads text someone else extracted," because `ExtractBody`
required a caller-supplied `rawText`. The fix routes
`POST /v1/axis/documents/:id/extract` through a two-stage pipeline — render the
document's stored file to a page image, then run a vision model over it via
the gateway — with `rawText` kept as an optional override, not removed. Three
things in that fix need a recorded decision because the obvious choice for
each has a real alternative: which model serves vision calls, what contract
the render step speaks, and what on-prem tenants do without it.

## Decisions

1. **`rawText` optional, not replaced.** `ExtractBody.rawText` moves from
   required to `.optional()`
   (`apps/api/src/routes/axis.ts:136-143`). Given, the route takes the text
   path unchanged. Omitted, it renders and reads the image instead. Tests and
   any doc type whose text is already in hand (e.g. a text-layer PDF where
   OCR would be wasted, per §G.5) skip rendering entirely by supplying
   `rawText` directly — this is not a fallback for a broken vision path, it's
   a first-class second entry point. Contract impact: none. Hand-written
   `Op` entries in `apps/api/src/openapi.ts` emit a generic
   `{ type: "object" }` body schema for module-router endpoints (they don't
   encode per-field requiredness), and `packages/sdk/src/generated.ts`
   already types this route's body as `Record<string, unknown>` — so this is
   a runtime validation change invisible to the published contract, not a
   breaking change requiring a version bump.

2. **Vision calls pin `modelKey: "claude-haiku-4-5"` directly, bypassing tier
   routing.** `resolveModel`'s tier→catalogue mapping
   (docs/02-architecture.md §9) has no Workers AI entry with vision input
   support today. Rather than let `tier: "standard"` resolve to a model that
   can't take `images`, the vision call names Anthropic's model explicitly
   via the `modelKey` override added to `CompleteRequest`
   (`packages/model-gateway/src/types.ts:56-62`) — the same override
   mechanism any future caller needing a specific capability, not "whatever
   this tier resolves to today," can reuse. `modelKey` still passes through
   `resolveModel`'s on-prem residency pin — it names *which* catalogue entry,
   not a way to route around residency. Alternative rejected: add a
   vision-capable Workers AI entry now — no such entry exists to add; that's
   a catalogue change for whenever Workers AI ships one, not something this
   route should block on.

3. **Screenshot contract mirrors the existing PDF-render contract, one verb
   over.** `apps/api/src/engines/export/render.ts` already defines
   `BrowserBinding` as a bare `fetch(req: Request): Promise<Response>` —
   Cloudflare Browser Rendering's REST shape — specifically so an on-prem
   `render` HTTP service can implement the same contract with no code branch
   (docs/02 §9, docs/11 §3). `renderDocumentPages`
   (`apps/api/src/engines/axis-document-render.ts`) reuses that exact
   interface and posts to a sibling path, `/v1/screenshot`, alongside the
   existing `/v1/pdf` — same binding, same request/response shape
   (base64 bytes in, image bytes out), opposite direction (rasterize a page
   in vs. assemble a PDF out). A tenant's on-prem `render` service, once
   built, adds one route handler to an existing service rather than standing
   up a second one.

4. **Page 1 only, for now.** `renderDocumentPages` renders a single page —
   marked `ponytail:` in the source. Both doc types with an extraction schema
   today (`eid`, `mulkiya`; docs/modules/axis.md §8) are single-page
   real-world documents, so a page-count-then-render loop would be
   unexercised code. The upgrade path is explicit in the comment: a
   multi-page doc type needs a page-count call before this function, added
   when that doc type exists, not speculatively now.

5. **On-prem tenants must supply `rawText`; vision is a cloud-only capability
   until an on-prem `render` service exists.** `ctx.policy.dataResidency ===
   "on-prem"` with no `rawText` is a 400
   (`apps/api/src/routes/axis.ts:167-169`), not a silent attempt to call a
   binding that isn't there. This is a real ceiling, not a bug: on-prem has
   no Browser Rendering equivalent deployed yet (`infra/onprem` has no
   `render` service today), and decision 2's vision model is an Anthropic
   cloud call, which on-prem tenants' residency policy already forbids
   regardless of rendering. Closing this ceiling is two independent projects
   — an on-prem `render` HTTP service satisfying `BrowserBinding` (decision 3
   makes this a small addition once someone builds it), and an on-prem
   vision-capable model (vLLM/Ollama with a vision checkpoint) — neither
   scoped here. Until both land, on-prem's document intelligence stays
   text-in, same as before this change.

## References

- `apps/api/src/routes/axis.ts:136-280` — `ExtractBody`, the two-path
  extract route.
- `apps/api/src/engines/axis-document-render.ts` — `renderDocumentPages`,
  the screenshot call.
- `apps/api/src/engines/export/render.ts:22-27` — `BrowserBinding`, the
  contract both render paths share.
- `packages/model-gateway/src/types.ts:56-62` — `CompleteRequest.images` /
  `modelKey`.
- `packages/model-gateway/evals/axis-vision/` — `fieldAccuracyMin`,
  `pageRoutingAccuracyMin`, `hallucinatedFieldRateMax` gates for this path.
- `docs/specs/gap-axis-design.md` §G.5 — the spec this ADR implements.
- `docs/02-architecture.md` §9 — Browser Rendering / on-prem twin, model
  catalogue.
