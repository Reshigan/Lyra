# ADR-0027 — Impersonation is a time-boxed session swap, not a new authority

- Status: accepted
- Date: 2026-08-03
- Context: docs/06 (platform staff), docs/16 §H (build to the seams), CLAUDE.md §4
  (human-in-the-loop), §12 (transaction integrity)

## Context

Platform support and engineering staff need to see what a tenant sees to
diagnose a problem or fix a support ticket. `Actor.impersonating` already
exists in `packages/core/src/rbac.ts` as a reserved seam, `platform.support`
already carries `core:impersonate:use`, and `core.impersonate` is already an
approval policy in `packages/core/src/approvals.ts`
(`dualControl: "always", neverAutoApprove: true`). None of it is wired to a
route — a platform user cannot actually impersonate anyone today.

The risk is a new privilege-escalation path: whatever mechanism grants a
platform user a tenant-scoped `Ctx` must not become a way to mint permissions
the target user doesn't have, and must not silently outlive the diagnostic
reason it was opened for.

## Decision

Impersonation is a **session swap, not a new code path through `can()`**.

- New table `core_impersonation_sessions` (tenantId = the *target* tenant,
  platformUserId, targetUserId, approvalId, reason, startedAt, expiresAt,
  endedAt). Global-adjacent table, but every row is scoped to the tenant being
  entered — it is not a `core_platform_*` table, because every read/write it
  gates is single-tenant.
- `POST /v1/platform/impersonation/start` requires the `core.impersonate`
  approval (already `dualControl: "always"`, so it never self-approves) and
  writes a session row with `expiresAt = startedAt + 30min`.
- Once approved, every subsequent request from that platform user carrying
  the session token gets a normal, single-tenant `Ctx` for the *target*
  tenant, built by `ctxFor()` exactly as any tenant user's request is —
  **not a special impersonation `Ctx` shape**. `Actor.grants` are the
  platform user's own grants scoped to that tenant's role, never `*:*:*`
  carried in. `Actor.impersonating = true` is the only difference, and it
  changes nothing `can()` evaluates — it only changes what audit rows record.
- `ctxFor()` (`apps/api/src/auth.ts`) checks `expiresAt` on every request for
  a session-swapped actor; past it, the session row is closed (`endedAt` set)
  and the request falls back to the platform user's own home-tenant `Ctx`,
  same as if no impersonation session existed. The platform user is never
  locked out of their own session by a lapsed swap — they simply need to
  start a new (re-approved) session to keep impersonating. No renewal
  endpoint — the friction of re-approval is intentional, but it applies only
  to regaining the swap, not to the platform user's own access.
- `POST /v1/platform/impersonation/:id/end` closes the session early. Every
  action taken during the session is audited normally (existing audit path),
  tagged `impersonating: true` and carrying the session id, so the platform
  user's real identity and the approval that authorized the session are
  always one join away.

## Consequences

- No new authorization primitive: `can()` is unchanged, permissions are
  unchanged, and an impersonated session can only do what the platform user's
  own tenant-scoped grant allows — not what the target user could do and not
  everything platform staff can do elsewhere.
- Every impersonated action is indistinguishable from a normal audited action
  except for one boolean and one session id, so no separate "impersonation
  audit view" is needed — the existing audit log and its existing
  `core:audit:read` permission cover it.
- A session that is never explicitly ended still stops mattering at 30
  minutes; there is no code path that trusts a session past `expiresAt`.
- `/platform` (the workspace this is reached from) is CF-Access-gated at the
  edge in addition to RBAC, per docs/06 — this ADR only covers the
  application-level swap, not the edge control.
