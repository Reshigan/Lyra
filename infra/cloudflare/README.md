# infra/cloudflare — Terraform

Config-as-code for the zone/account-level Cloudflare settings that
`wrangler.jsonc` doesn't cover: R2 lifecycle rules and the WAF/Turnstile/bot
security stack from docs/10-deployment-cloudflare.md §6-7. Everything
`wrangler deploy` already manages (Workers, D1, KV, queues, DOs) stays in
`apps/*/wrangler.jsonc` — do not duplicate those bindings here.

## Status: drafted, not applied

This has never been run against a real account. Applying it is a
shared-infra mutation (R2 lifecycle rules can delete real export/log data if
wrong; WAF/bot settings affect live traffic) — the kind of action this repo's
CLAUDE.md and go-live checklist treat as needing a deliberate human
go-ahead, not an autonomous `terraform apply`.

Before the first `terraform apply`:

1. **Token scope.** The Cloudflare API token needs `Zone.Zone Settings:Edit`,
   `Zone.Firewall Services:Edit`, and `Account.Workers R2 Storage:Edit` (the
   token used earlier in this project's sessions carried none of the R2 or
   zone-firewall scopes — confirmed via `wrangler whoami`). Reissue or use a
   separate token scoped for Terraform; don't widen the wrangler deploy
   token's scope just for this.
2. **Fill in `terraform.tfvars`** (gitignored — see `.gitignore` entry below):
   ```hcl
   cloudflare_api_token = "..."
   account_id           = "..."   # 08596e523c096f04b56d7ae43f7821f4 per `wrangler whoami`
   zone_id              = "..."   # zone id for lyra.vantax.co.za — look up via
                                   # `wrangler` isn't the right tool for this; use the
                                   # Cloudflare dashboard or `cloudflare_zone` data source
   ```
3. `terraform init && terraform plan` — read the plan before ever applying.
   Nothing in CI runs `terraform apply` for this directory; that stays a
   manual, reviewed step.

## What this declares

- **R2 lifecycle** (`r2_lifecycle.tf`): `lyra-exports`/`lyra-exports-staging`
  expire objects after 90 days, `lyra-logs`/`lyra-logs-staging` after 400
  days — docs/10 §7. `lyra-files*` is deliberately absent: docs/10 §6 calls
  for versioning on FILES, not expiry, and R2 versioning isn't yet exposed
  as a Terraform resource in the `cloudflare/cloudflare` provider — enable it
  by hand in the dashboard (Bucket → Settings → Object versioning) until it
  is.
- **WAF + bot stack** (`waf.tf`): Cloudflare Managed Ruleset at the zone's
  `http_request_firewall_managed` phase, and Bot Fight Mode. Both are
  docs/10 §6 requirements with no code-side dependency — nothing in
  `apps/api`/`apps/web` checks these are on.
- **Turnstile** (`turnstile.tf`): one managed widget scoped to the zone's
  domains. This resource provisions the widget (sitekey + secret, secret
  written to a `wrangler secret`-style output, never to state in plaintext
  beyond what Terraform state already requires encrypting at rest).

  The app side is wired: the challenge renders on the two forms a stranger
  can post to with no session and no token — portal lead capture
  (`portal.$tenantSlug.tsx`, J-C1) and public DSAR intake
  (`portal.$tenantSlug.privacy.tsx`, J-C4) — and `apps/api`
  (`src/turnstile.ts`) verifies the response against siteverify before
  either handler writes anything. Every other form on the platform sits
  behind a session or a one-time token and is not challenged.

  Both sides are off until their binding exists, so `pnpm dev`, the on-prem
  twin and CI are unaffected. To turn it on after `terraform apply`:

  ```bash
  terraform output turnstile_sitekey            # → apps/web wrangler.jsonc vars.TURNSTILE_SITE_KEY
  terraform output -raw turnstile_secret | \
    wrangler secret put TURNSTILE_SECRET --config apps/api/wrangler.jsonc
  ```

  Set both or neither: a site key with no secret challenges visitors and
  verifies nothing; a secret with no site key rejects every submission,
  because no widget is rendered to produce a token.

## Applying per environment

Two workspaces, matching the two Cloudflare accounts in docs/10 §1
(`lyra-staging`, `lyra-prod`):

```bash
terraform workspace new staging   # once
terraform workspace select staging
terraform apply -var-file=staging.tfvars
```

Repeat with a `prod.tfvars` workspace before go-live. Do not apply to prod
without having applied and verified staging first.
