# docs/10-deployment-cloudflare.md §6: "Turnstile on public forms."
# Provisions the widget. The app side is already wired to it — apps/web renders
# the challenge on the portal lead and DSAR forms, apps/api verifies the
# response — and stays dormant until these outputs are bound (see README.md).

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
