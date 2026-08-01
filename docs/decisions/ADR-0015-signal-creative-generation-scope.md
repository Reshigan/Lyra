# ADR-0015 — SIGNAL creative-variant generation wired to a route; Meta/Google publish deferred

- Status: accepted
- Date: 2026-08-01
- Context: CLAUDE.md:4-6 (ambiguous spec → ADR), CLAUDE.md rule 15 (seams),
  docs/modules/signal.md §8 clause 1,
  docs/25-go-live-checklist.md M4 SIGNAL row,
  apps/api/src/engines/signal-creative.ts, apps/api/src/routes/signal.ts,
  apps/api/src/journeys.test.ts

## Context

docs/modules/signal.md §8 clause 1 reads:

```
Brief in -> N compliant ad/lp/email/social/video-script variants (ar/en) out,
reviewed and published to the connected channel.
```

An audit of `apps/api/src/engines/signal-creative.ts` found `generateCreatives`
already real: takes a brief, calls the model gateway per requested locale,
runs each variant through `checkCompliance` (docs/12-derived rules only), and
persists `signal_creatives` rows with `generatedBy: "ai"` plus one
`ai_audit_log` row per variant. What it lacked was any caller — no route
mounted it, so the engine was dead code reachable only from its own test.

The channel-publish half of the same clause (push a reviewed variant to Meta
or Google) has no engine at all, and needs an OAuth-connected ad-account
credential per tenant that does not exist in this environment.

## Decision

1. **Creative-variant generation is fixed now, at the route level.**
   `POST /v1/signal/creatives/generate` (apps/api/src/routes/signal.ts) is a
   bespoke route — same idiom as `orbit.ts`'s `/renewals/sweep` — because a
   batch-from-a-brief is not one-row CRUD. It gates on the existing
   `signal:creatives:generate` permission (already present on `signal.lead`,
   already the generic `creatives` resource's `create` permission) and calls
   `generateCreatives` through `c.get("gateway")`, never a provider SDK
   directly (CLAUDE.md rule 3). Covered end-to-end by a new case in
   `journeys.test.ts`'s `J-M1` describe block: a 403 for a persona without the
   permission, then a 201 with persisted, audited, locale-tagged variants.

2. **Meta/Google publish is deliberately deferred out of this go-live pass.**
   No credential exists to connect to either platform in this environment,
   and building a channel-publish engine against no live ad-account connection
   would be untestable dead code — the same category of undersized-fix risk
   ADR-0014 identifies for ORB-050. A reviewed variant today stops at
   "review-ready" (`signal_creatives` row, status held for human review per
   CLAUDE.md rule 4 since publish is `consequential: true`); nothing pushes it
   to a channel automatically.

3. docs/25-go-live-checklist.md's M4 SIGNAL row is updated to point here
   instead of carrying creative generation as an unscoped full gap.

## Consequences

- A tenant can generate, review and audit ad-copy variants today through the
  API; getting a variant onto an actual Meta or Google campaign still requires
  manual export until a channel connector is built.
- The next milestone that picks up channel publish starts the same way every
  engine here has: a failing acceptance test against a real (or sandboxed)
  ad-account credential, not a mocked success path.
