variable "cloudflare_api_token" {
  description = "Cloudflare API token scoped for Terraform (Zone Settings:Edit, Firewall Services:Edit, Workers R2 Storage:Edit). Never the wrangler deploy token."
  type        = string
  sensitive   = true
}

variable "account_id" {
  description = "Cloudflare account id (08596e523c096f04b56d7ae43f7821f4 per `wrangler whoami` for the lyra-staging account; lyra-prod uses its own account per docs/10 §1 account-blast-isolation)."
  type        = string
}

variable "zone_id" {
  description = "Zone id for the domain this workspace targets (lyra.vantax.co.za or its staging subdomain's zone)."
  type        = string
}

variable "environment" {
  description = "staging or prod — selects bucket name suffix (apps/api/wrangler.jsonc's -staging convention)."
  type        = string
  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment must be \"staging\" or \"prod\"."
  }
}

variable "turnstile_domains" {
  description = "Domains the Turnstile widget is valid on."
  type        = list(string)
}
