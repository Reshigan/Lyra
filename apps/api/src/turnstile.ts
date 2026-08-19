import { forbidden } from "@lyra/core";
import type { Env } from "./env.js";

/**
 * Bot protection on the two forms a stranger can post to without any session or
 * token — portal lead capture (J-C1) and public DSAR intake (J-C4). Rate limits
 * already bound how fast one email or IP can hit them; Turnstile is what stops a
 * botnet spreading the same volume across thousands of addresses (docs/10 §6).
 *
 * The gate is off until `TURNSTILE_SECRET` is bound, so `pnpm dev`, the on-prem
 * twin and CI keep posting these forms unchallenged. It turns itself on the day
 * the account owner applies `infra/cloudflare/turnstile.tf` and sets the secret —
 * no code change, no flag to remember.
 *
 * Turning it on is two settings, not one, and the order matters. This secret is
 * the half that refuses; `TURNSTILE_SITE_KEY` in apps/web/wrangler.jsonc is the
 * half that renders the widget the token comes from. Set the secret while web
 * still has no site key and every one of these forms 403s. Set the site key
 * first, deploy web, then put the secret. apps/web/wrangler.jsonc says the same
 * next to the var.
 */
export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(env: Env, token: string | undefined, ip?: string): Promise<void> {
  const secret = env.TURNSTILE_SECRET;
  if (!secret) return;
  if (!token) throw forbidden("turnstile");

  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);

  // Fails closed: an unreachable or unhappy siteverify refuses the submission
  // rather than waving it through. A public form that stops accepting during a
  // Cloudflare outage is recoverable; one that stops challenging is not.
  let success = false;
  try {
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body: form });
    if (res.ok) success = ((await res.json()) as { success?: boolean }).success === true;
  } catch {
    success = false;
  }
  if (!success) throw forbidden("turnstile");
}
