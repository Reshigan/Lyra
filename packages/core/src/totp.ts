// RFC 4648 base32 + RFC 6238 TOTP on WebCrypto only, so the same code runs on
// Workers and Node (docs/02). PLAT-012: MFA available to every user;
// PLAT-013: mandatory for staff and admin roles.
//
// ponytail: TOTP only. WebAuthn is the other half of PLAT-012 and needs an
// attestation store; add it when a tenant asks for hardware keys.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of input.toUpperCase().replace(/[=\s-]/g, "")) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("invalid base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A fresh shared secret. 20 bytes is the RFC 4226 recommendation for SHA-1. */
export function totpSecret(): string {
  const buf = new Uint8Array(20);
  crypto.getRandomValues(buf);
  return base32Encode(buf);
}

export const TOTP_STEP_SEC = 30;
export const TOTP_DIGITS = 6;

/** The code for one counter step. SHA-1 because that is what authenticators do. */
export async function totpAt(secret: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secret) as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const message = new Uint8Array(8);
  // Counter is a 64-bit big-endian integer; JS bit ops are 32-bit, so the high
  // word is divided out rather than shifted.
  let high = Math.floor(counter / 0x1_0000_0000);
  let low = counter >>> 0;
  for (let i = 3; i >= 0; i--) {
    message[i] = high & 255;
    high >>>= 8;
    message[i + 4] = low & 255;
    low >>>= 8;
  }
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, message as unknown as BufferSource));
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/**
 * Verify a submitted code. `window` counts steps either side of now, which
 * covers ordinary clock drift between a phone and the edge — one step (±30s)
 * is the usual setting and widening it widens the guessing surface.
 */
export async function totpVerify(
  secret: string,
  code: string,
  now: number,
  window = 1
): Promise<boolean> {
  const submitted = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(submitted)) return false;
  const counter = Math.floor(now / 1000 / TOTP_STEP_SEC);
  let ok = false;
  for (let drift = -window; drift <= window; drift++) {
    // No early return: every candidate is compared so a valid code costs the
    // same wall time as an invalid one.
    const expected = await totpAt(secret, counter + drift);
    let diff = 0;
    for (let i = 0; i < TOTP_DIGITS; i++) diff |= expected.charCodeAt(i) ^ submitted.charCodeAt(i);
    ok = ok || diff === 0;
  }
  return ok;
}

/** The `otpauth://` URI an authenticator app scans. Label carries the issuer. */
export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SEC)
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

/**
 * Recovery codes. Stored hashed alongside the secret so a lost phone is a
 * support-free recovery; each one is single use.
 */
export function recoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const buf = new Uint8Array(5);
    crypto.getRandomValues(buf);
    const raw = base32Encode(buf).slice(0, 8);
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return codes;
}
