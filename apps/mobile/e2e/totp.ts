// ponytail: subpath import (not the "@lyra/core" barrel) — totp.ts has zero
// deps, but the barrel re-exports modules that import @lyra/db, which needs
// the @cloudflare/workers-types ambient D1Database global this app's
// tsconfig ("types": []) doesn't provide.
import { totpAt, TOTP_STEP_SEC } from "@lyra/core/totp";

/** The code a fresh authenticator would show right now for `secret`. */
export function currentTotp(secret: string): Promise<string> {
  return totpAt(secret, Math.floor(Date.now() / 1000 / TOTP_STEP_SEC));
}
