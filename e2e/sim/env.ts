// docs/24 sim plan §3: real Cloudflare staging origins, not the local
// 127.0.0.1 ports e2e/env.ts uses for the wiped-per-run harness.
export const STAGING_WEB_ORIGIN = "https://staging.lyra.vantax.co.za";
export const STAGING_API_ORIGIN = "https://api-staging.lyra.vantax.co.za";
