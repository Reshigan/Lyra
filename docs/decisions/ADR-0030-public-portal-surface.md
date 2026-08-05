# ADR-0030 — A public, unauthenticated comparison-site surface

- Status: accepted
- Date: 2026-08-04
- Context: CLAUDE.md:4-6 (ambiguous spec), CLAUDE.md §1/§5/§7/§14 (tenancy,
  brand tokens, i18n, domain-pack vocabulary), docs/02-architecture.md
  (approved third-party list, §9)

## Context

No customer-facing public portal existed anywhere in LYRA. The product needed
one screen a lead can land on straight from an ad — brand, active products,
"get a quote" — with no LYRA session and no tenant-scoped caller, matching
`yallacompare.com`'s comparison-site structure. Every other authenticated
surface assumes a `Ctx` built from a session (`apps/api/src/auth.ts`); this
visitor has none.

The nearest precedent is the partner-signup form: `/v1/onboarding/partners/signup`
is already listed in `PUBLIC` (`apps/api/src/mw.ts:36`) as a route with no
session to authenticate against. But a comparison site's URL carries a dynamic
tenant slug (`/v1/portal/:tenantSlug/site`), which an exact-match `Set` cannot
express — `PUBLIC` is string equality (`apps/api/src/mw.ts:20-38`), not a
pattern matcher.

## Decision

**A dedicated router, public by shape, not by name.** `portalRoutes`
(`apps/api/src/routes/portal.ts:15`) is mounted at `/v1/portal`
(`apps/api/src/index.ts:86`). `withContext` skips authentication for any path
starting `/v1/portal/`, alongside the existing `/v1/auth/sso/*` prefix rule
(`apps/api/src/mw.ts:44-48`) — a prefix check next to the exact-match `PUBLIC`
set, not an entry inside it, because the tenant slug varies per request.

**Two endpoints, minimum surface.** `GET /:tenantSlug/site` returns only
`{tenant:{name,brand}, products:[{id,line,name,providerName}]}`
(`apps/api/src/routes/portal.ts:46-54`) — brand and active-product listing,
nothing pricing-internal (`pricingInputsJson`, `takafulJson` never serialize;
asserted by `apps/api/src/portal.test.ts:90`). `POST /:tenantSlug/leads`
accepts a strict `LeadBody` (`apps/api/src/routes/portal.ts:57-66`) and writes
a quote request, never a policy, claim, or anything money-affecting.

**The route builds its own system `Ctx`, same as no other public route does.**
Unlike partner signup (which creates the tenant), a lead against an existing
tenant needs a real tenant-scoped `Ctx` to reuse `audit`/`emit`/tenancy-safe
writes. `ctxFor` is called with a synthetic `actor: {kind:"system",
id:"portal-lead", grants: []}` (`apps/api/src/routes/portal.ts:158-170`) —
grants stay empty; the route never checks a permission because there is no
human actor behind it, only a visitor. `activeTenant` 404s an unknown or
inactive tenant rather than leaking existence (`apps/api/src/routes/portal.ts:24-29`),
and a product-id from a different tenant 404s the same way
(`apps/api/src/routes/portal.ts:145-156`) rather than a generic 400 — an
enumeration probe learns nothing.

**A lead auto-provisions a `direct-web` channel and a lookup-keyed customer,
never a duplicate on repeat visits.** `findOrCreateDirectWebChannel`
(`apps/api/src/routes/portal.ts:68-95`) and `findOrCreateCustomer`
(`apps/api/src/routes/portal.ts:97-134`) key on `distChannels.key` and a
sha256 of the lowercased email respectively, so the same visitor's second
lead reuses both rows (`apps/api/src/portal.test.ts:138-161`) instead of
fanning out duplicate customers per submission.

**Abuse control is a per-email throttle, not RBAC.** `throttle(c.env,
"portal-lead:" + email, LEAD_MAX=3, LEAD_WINDOW_SEC=24h)`
(`apps/api/src/routes/portal.ts:21-22,140`) is the only defense against a
scripted flood — there is no session to rate-limit by actor, so the email
itself is the key, accepting that an attacker can rotate emails to bypass it.

## Consequences

- `/v1/portal/*` is a second, narrower unauthenticated prefix rule alongside
  SSO's, and both need auditing together if either changes — a future
  reviewer must grep `mw.ts` for prefix rules, not just the `PUBLIC` set.
- The email-hash throttle is defeated by an attacker who varies the email
  per request; there is no IP-based or Turnstile-style secondary control yet.
  Acceptable for go-live because the write surface is a quote request, not a
  financial or contractual one — upgrading this is a route-level addition
  under docs/02 §9's approved-services list if a CAPTCHA provider is added.
  Currency is hardcoded to `AED` (`apps/api/src/routes/portal.ts:20`)
  pending a second launch market.
- `nationalIdHash` is repurposed as a lead lookup key before any KYC exists
  (`apps/api/src/routes/portal.ts:110-112`) — a real customer-matching pass
  still has to happen when staff work the quote request; this ADR does not
  claim the portal lead is a verified customer.
- The frontend route (`apps/web/app/routes/portal.$tenantSlug.tsx`) has no
  idempotency-key header on its lead submission, matching the backend's
  email-hash dedupe instead of CLAUDE.md §12's idempotency-key pattern — that
  pattern is reserved for money/contractual-state transactions, and a quote
  request is neither.
