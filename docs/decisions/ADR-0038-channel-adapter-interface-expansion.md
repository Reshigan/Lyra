# ADR-0038: Expand `ChannelAdapter` beyond ADR-0037's shape

## Status

Accepted. Supersedes the interface code sample in ADR-0037 (not its naming
decision, not its rejected alternatives — those stand).

## Context

ADR-0037 accepted a `ChannelAdapter` seam and shipped this interface:

```ts
export interface ChannelAdapter {
  readonly kind: string;
  verifyInbound(req: { headers: Record<string, string>; rawBody: string }): boolean;
  parseInbound(rawBody: string): { externalRef: string; from: string; text: string } | null;
  sendOutbound(to: string, text: string): Promise<{ externalRef: string }>;
}
```

`packages/core/src/seams.ts` (checked directly: 91 lines, current) has never
implemented this — ADR-0037 recorded the decision but no code followed. So
there is no existing implementation to break; there is a design doc
(`docs/specs/gap-orbit-design.md` §1C) written after ADR-0037 that needs a
richer shape and found the accepted one couldn't carry it:

- No `challenge()` — WhatsApp/Meta's webhook verify-token handshake has
  nothing to answer through `verifyInbound(): boolean`.
- No media — `verifyInbound`/`parseInbound` return only `{ externalRef,
  from, text }`; a customer's photo of a claim form has no field to land in.
- No status receipts — a delivery/read callback from the provider is not a
  new message, and `parseInbound` returns one shape for both or null.
- `verifyInbound` returning `boolean` cannot distinguish "bad signature"
  from "this is a GET handshake, not a POST" — both need different HTTP
  responses.

The design doc's own §5 point 3 names this directly: *"Adding `ChannelAdapter`
is therefore creating the seam, not implementing to one — arguably an
ADR-worthy act."* CLAUDE.md rule 15 requires an ADR to widen or bypass a
documented seam. This is that ADR.

## Decision

**Replace the interface. Keep the name, the file, and ADR-0037's naming
rationale (distinct from `Channel` in consent.ts) unchanged.**

```ts
export interface InboundMessage {
  readonly externalRef: string;
  readonly handle: string;
  readonly displayName?: string;
  readonly text: string;
  readonly modality: "text" | "voice" | "image" | "video" | "document";
  readonly media?: readonly {
    readonly providerId: string;
    readonly mime: string;
    readonly filename?: string;
    readonly bytes?: number;
  }[];
  readonly sentAt: number;
  readonly windowExpiresAt?: number;
}

export interface DeliveryReceipt {
  readonly externalRef: string;
  readonly status: "sent" | "delivered" | "read" | "failed";
  readonly at: number;
  readonly error?: string;
}

export type InboundEvent =
  | { readonly kind: "message"; readonly message: InboundMessage }
  | { readonly kind: "status"; readonly receipt: DeliveryReceipt }
  | { readonly kind: "ignored"; readonly why: string };

export interface VerifiedRequest {
  readonly rawBody: string;
  readonly headers: Headers;
  readonly query: URLSearchParams;
}

export interface ChannelAdapter {
  readonly provider: string;
  readonly transport: "whatsapp" | "email" | "web" | "voice" | "agent";
  readonly consentChannel: Channel | null;
  challenge?(req: VerifiedRequest, secrets: ConnectorSecrets): string | null;
  verify(req: VerifiedRequest, secrets: ConnectorSecrets, now: number): Promise<void>;
  parse(req: VerifiedRequest): InboundEvent[];
  fetchMedia(
    providerId: string,
    secrets: ConnectorSecrets,
    config: Record<string, unknown>
  ): Promise<{ body: ArrayBuffer; mime: string; filename?: string }>;
  send(
    out: OutboundMessage,
    secrets: ConnectorSecrets,
    config: Record<string, unknown>
  ): Promise<{ externalRef: string }>;
}
```

(`ConnectorSecrets` and `OutboundMessage` are defined alongside this in
`seams.ts` by the same task that adds this block — Task 1 of
`docs/superpowers/plans/2026-08-08-orbit-f6-f7.md`.)

Why each change over ADR-0037's shape:

- `verify` throws instead of returning `boolean` — the route needs to
  distinguish a bad signature (401) from a malformed request (400), which a
  bare `boolean` can't carry. Throwing lets each adapter raise its own
  typed error.
- `challenge` is optional — only providers with a handshake step (WhatsApp)
  implement it; a Mailgun-shape webhook has none.
- `parse` returns `InboundEvent[]`, not one `{ externalRef, from, text } |
  null` — a single webhook delivery can bundle several events (WhatsApp
  batches), and status receipts are not messages.
- `fetchMedia` is a separate call, not inline on the event, because the
  provider's media API needs the adapter's own auth and the caller decides
  whether to fetch (e.g., skip on a disabled feature flag).
- `provider`/`transport`/`consentChannel` replace `kind`: `provider` names
  the concrete adapter (`"whatsapp-cloud-api"`, `"mailgun"`), `transport`
  is the coarser grouping the design doc's rate limiting and UI need, and
  `consentChannel` links to the pre-existing opt-in `Channel` from
  consent.ts (`null` for transports with no consent concept, e.g. an
  internal agent channel) — this is the one place the two `Channel`
  concepts touch, and it is a link, not a merge.

Rejected alternatives:

1. **Keep ADR-0037's interface, adapt the design around it.** Rejected: the
   design doc was written to the real requirements of a webhook route that
   must handshake, fetch media, and tell messages from receipts. Shrinking
   the design to fit a four-method interface would drop already-decided
   scope (media handling, delivery receipts) to preserve an interface that
   was accepted before any of these requirements were enumerated.
2. **Add a second, richer interface (`ChannelAdapterV2`) alongside the
   original.** Rejected: ADR-0037's interface has zero implementations.
   Versioning a seam that nothing implements protects nothing and adds a
   name nobody needs.
3. **Fold `challenge`, `fetchMedia` into `verify`/`parse` to keep the
   method count down.** Rejected: `challenge` runs on GET (no body to
   verify), `verify`/`parse` run on POST — conflating them means every
   adapter re-derives which HTTP method it's in from inside one method
   instead of the route doing it once.

## References

- `docs/specs/gap-orbit-design.md` §1C, §5 point 3 — the requirements this
  interface serves and the doc's own "arguably an ADR-worthy act" framing.
- `docs/decisions/ADR-0037-orbit-channel-adapter-seam.md` — naming decision
  (kept), rejected alternatives 1-3 (kept), interface code sample
  (superseded by this ADR).
- `packages/core/src/seams.ts:9-10` — the `Channel`/`ChannelAdapter` naming
  collision note both ADRs resolve.
- `packages/core/src/consent.ts` — `Channel` (opt-in), linked via
  `consentChannel`, not redefined.
- CLAUDE.md rule 15 (build to the seams) — why widening an accepted seam
  before its first implementation still needs an ADR.
- `docs/superpowers/plans/2026-08-08-orbit-f6-f7.md` — Task 1, the first
  implementation of this shape.
