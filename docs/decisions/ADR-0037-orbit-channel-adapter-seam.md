# ADR-0037: `ChannelAdapter` seam for ORBIT inbound/outbound channels

## Status

Accepted.

## Context

docs/27-feature-gap-register.md F6 says ORBIT has no inbound channel — every
`orbit_conversations` row today is created by a human agent or an internal
caller, never by an external message arriving over WhatsApp, email, or web
chat. Closing F6 means one route that can receive a payload from any of
those providers and turn it into an `orbit_messages` row, and one dispatch
path that can send a reply back out over whichever channel the conversation
is bound to.

`docs/02-architecture.md` §11 and `packages/core/src/seams.ts` already name
`Channel` as a seam — but `Channel` is taken. `packages/core/src/consent.ts`
defines `export type Channel = keyof ChannelOptinsJson` (the opt-in surface:
`"email" | "sms" | "whatsapp" | ...`), and `seams.ts:9-10` already carries a
comment flagging the collision: *"docs/02 §11 names `Channel` as a seam; it
already lives in consent.ts ... reused, not redefined."* That comment was
written for the eventual day this ADR exists — the consent `Channel` names
*which* channel a tenant has opted into; it has no shape for *how* a
provider's inbound webhook is verified and parsed, or how an outbound
message is dispatched to that provider's API. Two different concerns, one
name already spoken for.

CLAUDE.md rule 15 (build to the seams, docs/16) requires an ADR when adding
a seam beyond today's single case, since `ChannelAdapter` will initially
ship with exactly one implementation (a webhook-based text channel) but
must not hard-code that one case into the interface.

## Decision

**Add `ChannelAdapter` to `packages/core/src/seams.ts`, distinct from the
existing `Channel` type, following the same pattern as the file's other H1-H10
interfaces (`SpeechProvider`, `DataInConnector`, `IdentityVerifier`).**

```ts
/** H-none (not yet numbered in docs/16; tracked as new in docs/27 F6/F7) —
 * an inbound/outbound message channel. Distinct from `Channel` in
 * consent.ts (which channel a tenant), not the wire shape (webhook auth,
 * inbound parse, outbound dispatch) — see this file's line ~9 for the
 * naming-collision note this ADR resolves. */
export interface ChannelAdapter {
  readonly kind: string;
  verifyInbound(req: { headers: Record<string, string>; rawBody: string }): boolean;
  parseInbound(rawBody: string): { externalRef: string; from: string; text: string } | null;
  sendOutbound(to: string, text: string): Promise<{ externalRef: string }>;
}
```

Rejected alternatives:

1. **Reuse/extend `Channel` from consent.ts.** Rejected: `Channel` is a
   `keyof` derived from a JSON opt-in shape, not an interface — it has no
   room for methods, and widening it to carry `verifyInbound`/`sendOutbound`
   would make every opt-in check site (consent reads) drag in webhook-auth
   types it never needs. Different lifecycles, different files, same word
   only by coincidence.
2. **No seam — build the WhatsApp/webhook integration directly into the
   route handler.** Rejected: F6/F7's design (docs/specs/gap-orbit-design.md
   §0, §CAPABILITY 1) already commits to inbound channels being plural over
   time (webhook text channel first; the design's own §4 ceilings name
   voice/SMS as later horizons). CLAUDE.md rule 15 exists precisely so the
   second channel is a new `ChannelAdapter` implementation, not a rewrite of
   the first one's route.
3. **Name it `InboundChannel`/`MessageChannel` instead of `ChannelAdapter`.**
   Rejected for symmetry with the file's existing naming (`DataInConnector`,
   `IdentityVerifier` — noun + role suffix), and `ChannelAdapter` reads
   unambiguously next to `Channel` rather than inviting the same collision
   this ADR is resolving.

The one shipping implementation (`WebhookChannelAdapter`, T2 in the F6/F7
plan) is a real webhook-verification + JSON-parse implementation, not a
stub — per docs/16 "Horizon governance," the NOW obligation is a provably
referenced shape, and here it is provably referenced by an actual working
adapter, not a placeholder.

## References

- `docs/27-feature-gap-register.md` F6, F7 — the gaps this seam unblocks.
- `docs/specs/gap-orbit-design.md` §0, §CAPABILITY 1 — the `Channel` seam
  the design doc calls for, now disambiguated as `ChannelAdapter`.
- `packages/core/src/seams.ts:9-10` — the pre-existing comment flagging this
  exact collision.
- `packages/core/src/consent.ts` — `Channel` (opt-in), the type this ADR
  does not touch.
- CLAUDE.md rule 15 (build to the seams) — why this needed an ADR at all.
- `docs/superpowers/plans/2026-08-08-orbit-f6-f7.md` — the implementation
  plan that adds `ChannelAdapter` and its first implementation.
