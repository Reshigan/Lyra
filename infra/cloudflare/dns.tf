# DNS records for the platform hostnames (docs/24 §2 topology).
#
# Division of labour (infra/cloudflare/README.md): everything `wrangler
# deploy` manages stays out of Terraform. A Workers custom domain
# (`"custom_domain": true` in wrangler.jsonc) makes Cloudflare create and own
# its DNS record on first deploy — so `lyra`, `api.lyra`, `staging.lyra` and
# `api.staging.lyra` are deliberately NOT declared here; re-declaring them
# would have two writers fighting over one record.
#
# What nothing else creates, this file declares: the proxied wildcard that
# serves tenant workspaces (`aldebaran.lyra.vantax.co.za` -> web worker,
# tenant resolved by hostname) and the two sub-portal CNAMEs from the docs/24
# hostname table. The wildcard needs a proxied wildcard record plus a Workers
# route — the route half lives in apps/web/wrangler.jsonc when that phase
# ships; the record half is here.

resource "cloudflare_dns_record" "tenant_wildcard" {
  zone_id = var.zone_id
  name    = "*.lyra.vantax.co.za"
  type    = "A"
  content = "192.0.2.1" # placeholder origin — Workers routes intercept before origin is consulted
  proxied = true
  ttl     = 1 # 1 = auto when proxied

  comment = "Tenant workspaces wildcard (docs/24 §2). Proxied so waf.tf applies; served by the web worker via its *.lyra route."
}

resource "cloudflare_dns_record" "dev_portal_cname" {
  zone_id = var.zone_id
  name    = "dev.lyra.vantax.co.za"
  type    = "CNAME"
  content = "lyra.vantax.co.za"
  proxied = true
  ttl     = 1

  comment = "Developer portal + API reference (docs/24 §2). Points at the web worker's apex until the portal gets its own worker."
}

resource "cloudflare_dns_record" "admin_portal_cname" {
  zone_id = var.zone_id
  name    = "admin.lyra.vantax.co.za"
  type    = "CNAME"
  content = "lyra.vantax.co.za"
  proxied = true
  ttl     = 1

  comment = "Platform admin, goNXT staff only (docs/24 §2). Must sit behind Cloudflare Access + MFA before it serves anything."
}
