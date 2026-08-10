# docs/10-deployment-cloudflare.md §7: "R2 lifecycle (exports 90d, logs 400d)".
# Bucket names must match apps/api/wrangler.jsonc's r2_buckets exactly.

locals {
  suffix         = var.environment == "prod" ? "" : "-staging"
  exports_bucket = "lyra-exports${local.suffix}"
  logs_bucket    = "lyra-logs${local.suffix}"
}

resource "cloudflare_r2_bucket_lifecycle" "exports" {
  account_id  = var.account_id
  bucket_name = local.exports_bucket

  rules = [{
    id      = "expire-90d"
    enabled = true
    conditions = {
      prefix = ""
    }
    delete_objects_transition = {
      condition = {
        max_age = 90 * 24 * 60 * 60
        type    = "Age"
      }
    }
  }]
}

resource "cloudflare_r2_bucket_lifecycle" "logs" {
  account_id  = var.account_id
  bucket_name = local.logs_bucket

  rules = [{
    id      = "expire-400d"
    enabled = true
    conditions = {
      prefix = ""
    }
    delete_objects_transition = {
      condition = {
        max_age = 400 * 24 * 60 * 60
        type    = "Age"
      }
    }
  }]
}
