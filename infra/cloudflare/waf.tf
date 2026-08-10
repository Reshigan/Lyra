# docs/10-deployment-cloudflare.md §6: "Security headers, WAF managed rules,
# Turnstile on public forms, bot fight on hosted pages."

resource "cloudflare_ruleset" "waf_managed" {
  zone_id     = var.zone_id
  name        = "lyra managed WAF"
  description = "Cloudflare Managed Ruleset at the request-firewall phase"
  kind        = "zone"
  phase       = "http_request_firewall_managed"

  rules = [{
    action = "execute"
    action_parameters = {
      id = "efb7b8c949ac4650a09736fc376e9aee" # Cloudflare Managed Ruleset id (stable across zones)
    }
    expression  = "true"
    description = "Deploy Cloudflare Managed Ruleset"
    enabled     = true
  }]
}

resource "cloudflare_bot_management" "this" {
  zone_id    = var.zone_id
  fight_mode = true
}
