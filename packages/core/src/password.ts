import { base64url, base64urlDecode, timingSafeEqual } from "./crypto.js";

// PBKDF2-SHA256 via WebCrypto: the only KDF available on both Workers and Node
// without a native dependency. Format: `pbkdf2$<iterations>$<salt>$<hash>`,
// self-describing so the cost can be raised without breaking old hashes.

const ITERATIONS = 210_000; // OWASP 2023 floor for PBKDF2-SHA256
const KEY_BITS = 256;
// The Workers runtime rejects a single deriveBits call above this ("Pbkdf2
// failed: iteration counts above 100000 are not supported"), so the cost above
// it is reached by chaining calls instead of one long one.
const MAX_PER_CALL = 100_000;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits"
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    KEY_BITS
  );
  return new Uint8Array(bits);
}

/**
 * Total work is `iterations`, split into chunks the runtime accepts. Each chunk
 * salts the next, so the chain costs the sum and is at least as strong as its
 * final chunk. A hash of 100k or fewer iterations derives in one call, exactly
 * as it did before chaining, so it stays verifiable.
 */
async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  let next = salt;
  let remaining = iterations;
  do {
    const chunk = Math.min(remaining, MAX_PER_CALL);
    next = await pbkdf2(password, next, chunk);
    remaining -= chunk;
  } while (remaining > 0);
  return next;
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) throw new Error("password must be at least 12 characters");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${base64url(salt)}$${base64url(hash)}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !salt || !hash) return false;
  const derived = await derive(password, base64urlDecode(salt), Number(iter));
  return timingSafeEqual(base64url(derived), hash);
}

/** True when the hash was made with a weaker cost than we now require. */
export function needsRehash(stored: string): boolean {
  const [, iter] = stored.split("$");
  return Number(iter) < ITERATIONS;
}
