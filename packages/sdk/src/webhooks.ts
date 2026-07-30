// Verification for the outbound webhooks apps/api/src/dispatch.ts sends.
// WebCrypto only, so the same helper runs on Workers, Node 22 and Deno.
//
// The wire format, byte for byte:
//   x-lyra-event      axis.case.issued
//   x-lyra-event-id   ev_01J...
//   x-lyra-timestamp  1730000000000        (epoch ms, as a string)
//   x-lyra-signature  v1=<hex HMAC-SHA256 of `${timestamp}.${rawBody}`>
// The key is the webhook's shared secret. Verify against the raw body text —
// re-serialising a parsed object changes the bytes and the signature with them.

/** The event envelope (docs/04 §7). `data` is shaped by `type`. */
export interface Envelope {
  id: string;
  ts: number;
  tenant_id: string;
  module: string;
  /** e.g. `axis.case.issued` */
  type: string;
  actor: string;
  subject?: string;
  data: unknown;
  v: 1;
}

export class WebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookError";
  }
}

export interface VerifyOptions {
  /**
   * How stale a delivery may be. A retried delivery is re-signed with the
   * retry's clock, so this bounds replay rather than delivery lag.
   */
  toleranceMs?: number;
  /** Injectable for tests. */
  now?: number;
}

const DEFAULT_TOLERANCE_MS = 5 * 60_000;

type HeaderBag = Headers | Record<string, string | undefined>;

function header(headers: HeaderBag, name: string): string | undefined {
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }
  const bag = headers as Record<string, string | undefined>;
  return bag[name] ?? bag[name.toLowerCase()];
}

/**
 * Verify a delivery and return its envelope. Throws WebhookError on anything
 * that does not check out — there is no "probably fine" outcome here.
 */
export async function verifyWebhook(
  secret: string,
  rawBody: string,
  headers: HeaderBag,
  options: VerifyOptions = {}
): Promise<Envelope> {
  const signature = header(headers, "x-lyra-signature");
  const timestamp = header(headers, "x-lyra-timestamp");
  if (!signature) throw new WebhookError("missing x-lyra-signature");
  if (!timestamp) throw new WebhookError("missing x-lyra-timestamp");

  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) throw new WebhookError("x-lyra-timestamp is not a number");
  const tolerance = options.toleranceMs ?? DEFAULT_TOLERANCE_MS;
  if (Math.abs((options.now ?? Date.now()) - sent) > tolerance) {
    throw new WebhookError("timestamp outside tolerance");
  }

  const [version, digest] = signature.split("=");
  if (version !== "v1" || !digest) throw new WebhookError("unsupported signature version");

  const expected = await hmacHex(secret, `${timestamp}.${rawBody}`);
  if (!timingSafeEqual(digest, expected)) throw new WebhookError("signature mismatch");

  try {
    return JSON.parse(rawBody) as Envelope;
  } catch {
    throw new WebhookError("body is not valid JSON");
  }
}

/* ------------------------------------------------------------------ crypto */
// Duplicated from @lyra/core rather than imported: this package is what a
// partner installs, and it must not drag the platform's domain code with it.

const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
