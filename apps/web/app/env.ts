/**
 * Worker bindings, mirrored from wrangler.jsonc. Hand-written rather than
 * generated so `tsc --noEmit` needs no build step before it can run.
 */
export interface Env {
  ENVIRONMENT: string;
  /** Origin of apps/api. Same-origin is never assumed; CORS is configured. */
  API_ORIGIN: string;
  SESSION_COOKIE: string;
  /**
   * docs/10 §6 Turnstile site key (`infra/cloudflare/turnstile.tf`). Public, so
   * a `vars` entry rather than a secret. Unset means the public forms render no
   * challenge — see components/turnstile.tsx.
   */
  TURNSTILE_SITE_KEY?: string;
}
