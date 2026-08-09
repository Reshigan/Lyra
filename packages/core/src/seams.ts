// docs/02 §11 extension seams + docs/16 future-horizon NOW obligations.
// ADR-0018. These are type-level seams: the NOW obligation for most
// horizons is that the shape is declared and provably referenced, not that
// H1-H12 be fully built out — LATER work builds against these types
// without a rebuild (docs/16 "Horizon governance").

import { hashObject } from "./crypto.js";
import type { Channel } from "./consent.js";

// docs/02 §11 names `Channel` as a seam; it already lives in consent.ts
// (`export type Channel = keyof ChannelOptinsJson`) — reused, not redefined.

/** H1 — machine-readable shape an agent principal binds against. Carried
 * inside `core_mandates.scopeJson` (already generic JSON built for this);
 * no dedicated table. `offerHash` is content-integrity via `hashObject`,
 * not asymmetric non-repudiation — real signing is LATER (ADR-0018). */
export interface AgentOffer {
  readonly itemRef: string;
  readonly priceMinor: number;
  readonly currency: string;
  readonly termsRef: string;
  readonly expiry: number;
}
export interface SignedAgentOffer extends AgentOffer {
  readonly offerHash: string;
}
export async function signOffer(offer: AgentOffer): Promise<SignedAgentOffer> {
  return { ...offer, offerHash: await hashObject(offer) };
}
export async function verifyOfferSignature(signed: SignedAgentOffer): Promise<boolean> {
  const { offerHash, ...offer } = signed;
  return (await hashObject(offer)) === offerHash;
}

/** H2 — `autonomyLevel` already lives on `ai_agents` (packages/db/schema/
 * ai.ts) and is enforced by approvals.ts (dual-control) and
 * signal-autopilot.ts (pre-action filter). This is the declared-envelope
 * type docs/16 asks for; `reversible` documents which levels need a
 * reversal path rather than the L1 cap already enforced elsewhere. */
export type AutonomyLevel = "observe_only" | "act_with_approval" | "act_and_notify" | "act_autonomously";
export interface AutonomyEnvelope {
  readonly level: AutonomyLevel;
  readonly maxActionsPerDay?: number;
  readonly spendCapMinor?: number;
  readonly reversible: boolean;
}

/** H3 — `modality` already lives on orbit messages. Real STT/TTS providers
 * implement this later without touching call sites (LATER, ADR-0018). */
export interface SpeechProvider {
  readonly name: string;
  transcribe(audio: Uint8Array, mimeType: string): Promise<{ text: string; confidence: number }>;
  synthesize(text: string, voice: string): Promise<Uint8Array>;
}

/** H4 — external data pull, mandatory consent-purpose binding. */
export interface DataInConnector {
  readonly providerRef: string;
  readonly consentPurpose: string;
  fetch(subjectRef: string): Promise<Record<string, unknown>>;
}

/** H5 — produces the `core_identity_verifications` row. No KYC touchpoint
 * consumes `evidenceLevel` yet — accepted gap, ADR-0018. */
export interface IdentityVerifier {
  readonly method: string;
  verify(subjectRef: string, evidence: unknown): Promise<{ evidenceLevel: string; providerRef?: string }>;
}

/** H6 — usage/sensor data feeding a product's `pricingInputsJson`. */
export interface TimeseriesIngest {
  readonly source: string;
  ingest(subjectRef: string, points: ReadonlyArray<{ at: number; value: number }>): Promise<void>;
}

/** H10 — first-party connectors are shipped as extensions of this shape;
 * no third-party developer harness yet (LATER, ADR-0018). */
export interface ExtensionManifest {
  readonly id: string;
  readonly kind: "connector" | "channel" | "engine";
  readonly version: string;
  readonly capabilities: readonly string[];
  readonly tenantScopes: readonly string[];
}
export function validateExtensionManifest(m: ExtensionManifest): string[] {
  const errors: string[] = [];
  if (!m.id) errors.push("id required");
  if (!/^\d+\.\d+\.\d+$/.test(m.version)) errors.push("version must be semver");
  if (m.capabilities.length === 0) errors.push("capabilities must not be empty");
  return errors;
}

/**
 * ADR-0037 named this seam; ADR-0038 supersedes ADR-0037's original
 * interface shape with this one, after the design doc
 * (docs/specs/gap-orbit-design.md §1C) found the first shape had no room for
 * a handshake, media, or delivery receipts. `Channel` (consent.ts) is which
 * channel a tenant has opted into; `ChannelAdapter` is how a provider's wire
 * format is verified/parsed/sent — linked via `consentChannel`, not merged.
 */
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

/** Raw, unsealed provider credentials for one connector (opened via `openFields` before use). */
export type ConnectorSecrets = Record<string, string>;

export interface OutboundMessage {
  readonly conversationId: string;
  readonly to: string;
  readonly text: string;
  readonly replyToExternalRef?: string;
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
