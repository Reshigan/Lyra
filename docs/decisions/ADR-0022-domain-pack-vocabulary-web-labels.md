# ADR-0022 — Domain-pack vocabulary substitutes at web label resolution

Date: 2026-08-01
Status: accepted

## Context

CLAUDE.md §14 and docs/21 §3 require that industry nouns ("policy", "premium",
"insurer") never be hard-coded in UI strings: the active domain pack renames
them so the same code sells outside insurance. The tenant's policy already
carries `domainPack` (packages/db/src/json.ts, default `insurance-retail`) and
`GET /v1/me` already returns the policy, so the pack name reaches the web
client with no API change. What was missing was the substitution point: the
workspace label tables (apps/web/app/modules/*.ts) spelled insurance nouns as
English/Arabic literals with nothing above them.

docs/21 §3 draws the safety line: **vocabulary changes are safe, entity
remapping is not.** This ADR is deliberately on the safe side of that line.

## Decision

1. **One seam, in the label chain.** `labelsFor(spec, locale, pack?)`
   (apps/web/app/modules/spec.ts) now consults a per-pack vocabulary table
   *before* the workspace's own catalogue:
   pack → workspace labels → shared `common.*` → raw key.
   Because every generic screen (routes/module.tsx, routes/record.tsx, the
   onboarding checklist) and every enum badge (`optionLabel`) already resolves
   through `labelsFor`, one parameter renames tabs, columns, form fields and
   option values everywhere at once.
2. **Vocabulary lives in apps/web/app/modules/vocabulary.ts** as
   `pack → locale → labelKey → string`. Keys are the same bare and qualified
   keys the workspace tables use. A pack absent from the table — including the
   default `insurance-retail` — is identity, so an unknown or future pack name
   degrades to the shipped labels rather than breaking.
3. **The pack name rides the shell.** routes/workspace.tsx plucks
   `me.policy.domainPack` (string-narrowed, defaulting to `insurance-retail`)
   into `ShellData.domainPack`; screens pass `shell?.domainPack` to
   `labelsFor`.
4. **One non-insurance pack ships as proof:** `retail-ecom`
   (policy→order, premium→order value, claim→return, renewal→reorder,
   insurer/underwriter→supplier), en + ar, exercised by
   apps/web/app/modules/spec.label.test.ts.
5. **Governance "policy" is not insurance "policy".** `policyKey` (approval /
   threshold policies) and admin's `policyJson` (tenant settings) are platform
   vocabulary and are deliberately excluded from pack tables.

## Consequences

- Renaming a noun for a vertical is a data edit in one file plus its test —
  no component or spec changes, which is exactly the property CLAUDE.md §14
  asks for.
- Entity remapping (different tabs, merged resources) remains out of scope,
  as docs/21 §3 requires a migration plan; a pack here can only rename what
  exists.

## Deferred (tracked follow-ups)

- **Bespoke route labellers.** quote-compare.tsx, commission-statement.tsx,
  commission-clawback.tsx and ledger.shared.ts keep private label tables with
  insurance literals; each needs its `labelsIn`/`labeller` routed through
  `vocabulary()` the way onboarding.tsx now is.
- **Mobile.** apps/mobile/src/i18n.ts has its own catalogue; same seam applies
  when a non-insurance tenant ships on mobile.
- **Prompt-side vocabulary (docs/21 §7.1).** System prompts in the API engines
  must read nouns from the pack at prompt time; today they are noun-neutral or
  insurance-flavoured per module. To be addressed when the first
  non-insurance tenant onboards, behind the same `policy.domainPack` field.
