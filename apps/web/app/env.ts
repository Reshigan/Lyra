/**
 * Worker bindings, mirrored from wrangler.jsonc. Hand-written rather than
 * generated so `tsc --noEmit` needs no build step before it can run.
 */
export interface Env {
  ENVIRONMENT: string;
  /** Origin of apps/api. Same-origin is never assumed; CORS is configured. */
  API_ORIGIN: string;
  SESSION_COOKIE: string;
}
