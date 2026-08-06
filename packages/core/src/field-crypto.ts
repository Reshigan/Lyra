import { base64url, base64urlDecode } from "./crypto.js";

// docs/12 §1: "field-level encryption ... for national IDs and bank details".
// AES-256-GCM over WebCrypto rather than libsodium sealed boxes — the reasoning
// and what that trades away is ADR-0032. Everything else here follows from the
// same rule as crypto.ts: one implementation that runs unmodified on Workers,
// Node 22 and the on-prem container.

const PREFIX = "enc.v1.";
const IV_BYTES = 12;
const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * The secret is a wrangler secret (`FIELD_KEY`), i.e. an arbitrary-length
 * string, and AES-GCM wants exactly 32 bytes — SHA-256 is the boring way to
 * bridge the two. Not a KDF: the input is already high-entropy random, so
 * there is no password to stretch.
 */
async function keyFor(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export function isSealed(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export async function sealField(secret: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(secret), enc.encode(plaintext));
  const packed = new Uint8Array(IV_BYTES + ct.byteLength);
  packed.set(iv);
  packed.set(new Uint8Array(ct), IV_BYTES);
  return PREFIX + base64url(packed);
}

/** Throws on a wrong key or an edited ciphertext — GCM authenticates, so both look the same. */
export async function openField(secret: string, sealed: string): Promise<string> {
  if (!isSealed(sealed)) throw new Error("not a sealed field");
  const packed = base64urlDecode(sealed.slice(PREFIX.length));
  if (packed.length <= IV_BYTES) throw new Error("sealed field is truncated");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: packed.slice(0, IV_BYTES) },
    await keyFor(secret),
    packed.slice(IV_BYTES)
  );
  return dec.decode(plain);
}

/**
 * `unknown`, not `string | null`: an extraction record carries the model's
 * reserved keys beside the fields (`_bbox` is an object), and a nested value is
 * simply not a sealable field — both halves below skip anything that is not a
 * string, so they travel through untouched.
 */
type Values = Record<string, unknown>;

/**
 * Seal the named fields of an extracted record in place. Fields that are absent,
 * null, or already sealed are left exactly as they are — sealing runs on every
 * write path, including one that re-saves a row it just read.
 */
export async function sealFields<T extends Values>(
  secret: string,
  values: T,
  names: Iterable<string>
): Promise<T> {
  const out = { ...values };
  for (const name of names) {
    const value = out[name];
    if (typeof value !== "string" || isSealed(value)) continue;
    (out as Values)[name] = await sealField(secret, value);
  }
  return out;
}

/** The read half: opens whatever is sealed, keyed off the envelope rather than a field list. */
export async function openFields<T extends Values>(secret: string, values: T): Promise<T> {
  const out = { ...values };
  for (const [name, value] of Object.entries(out)) {
    if (isSealed(value)) (out as Values)[name] = await openField(secret, value);
  }
  return out;
}
