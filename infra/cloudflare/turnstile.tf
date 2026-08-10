# docs/10-deployment-cloudflare.md §6: "Turnstile on public forms."
# Provisions the widget only — wiring the sitekey into a specific apps/web
# form is a follow-up app-side task (see README.md).

resource "cloudflare_turnstile_widget" "public_forms" {
  account_id = var.account_id
  name       = "lyra-public-forms-${var.environment}"
  domains    = var.turnstile_domains
  mode       = "managed"
}

output "turnstile_sitekey" {
  value       = cloudflare_turnstile_widget.public_forms.sitekey
  description = "Public sitekey — safe to embed client-side once a form is wired up."
}

output "turnstile_secret" {
  value       = cloudflare_turnstile_widget.public_forms.secret
  sensitive   = true
  description = "Server-side verification secret — set via `wrangler secret put TURNSTILE_SECRET`, never as a var."
}
