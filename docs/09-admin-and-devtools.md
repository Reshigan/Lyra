# 09 — Admin Surfaces & Developer Platform

Principle: **every module runs itself.** Each module ships its own Admin
console (configuration, policies, health) and Dev console (keys, sandbox,
logs) so a standalone module sale is operable without the rest of the suite.
Above them sit Tenant Admin and Platform Admin.

## 1. Per-module Admin consoles (route `/m/{module}/admin`)

Common frame (packages/core/admin-kit): settings registry with schema-driven
forms, change diff + audit on save, environment badge, module **kill switch**
(pause agents), health tiles (queue depth, error rate, AI spend today).

Module-specific panels are specced in each module doc §"Admin". Summary:
- AXIS: SOPs, ranking criteria, SLA policies, provider connectors, approval
  policies, extraction templates, routing.
- ORBIT: channels/BSP, persona & tone, tool matrix, journey guardrails
  (quiet hours/frequency — floor values locked), QA rubric, handover routing,
  partner plans & revshare.
- SIGNAL: brand kit, banned claims, channel OAuth, budget bounds, disclosure
  templates, suppression sources.
- SCOUT: sources & crawl politeness, thresholds, k-anonymity floor (≥20,
  raise-only), hypothesis library, export policy.
- NORTH: metric registry approvals, audience/sensitivity mapping, brief
  schedule & locales, connectors, targets.

## 2. Tenant Admin (route `/admin`)

People & roles (invite, SSO group mapping, deactivate) · Brand studio (logos,
palette with live contrast report, email identity, domains + auto SSL) ·
Policies (auto-approve allowlist, AI budget, retention, locales, quiet hours
defaults) · Entitlements view (what's licensed; request upgrades) · Billing
(plan, usage meters: seats/tokens/API calls, invoices) · Consent registry
(search a customer's consent history) · Data tools (import wizards, export,
right-to-erasure trigger) · Integrations directory (PSPs, BSPs, ad platforms,
warehouses — connect/disconnect with scopes shown) · Audit search (core +
AI logs, export signed bundle).

## 3. Platform Admin (goNXT staff, separate app area behind CF Access)

Tenant lifecycle (create/suspend; provisioning runbook automated: DB shard or
dedicated D1, KV records, seed, smoke tests) · Entitlement & plan management ·
Global flags & staged rollouts (per-tenant %) · DLQ browser + replay ·
Model-gateway ops (provider health, tier routing overrides, global budget
guard) · Cost explorer (per tenant: AI tokens, storage, egress) · Impersonate-
with-consent (tenant admin approves; banner shown; fully logged) · Status page
publisher · Release notes composer (in-app changelog per module).

## 4. Developer Platform (route `/dev`, role dev.*)

- **Keys & apps:** test/live keys, scopes by module+permission, rotation,
  last-used; OAuth clients for partner apps.
- **Docs:** OpenAPI reference (generated), guides per module, SDK snippets
  (TS/Python/cURL), Postman/Bruno export.
- **Sandbox:** synthetic tenant "Aldebaran" with deterministic fixtures;
  scenario builder (seed a renewal cohort, seed an anomaly) so demos and
  tests are reproducible; reset button.
- **Webhook studio:** register endpoints, send test events, delivery log
  with payload/signature inspector, replay.
- **Logs & traces:** request logs (redacted), AI call log (hashes + meta),
  trace_id search; live tail for sandbox.
- **Extension points (v1.1):** custom tools for ORBIT agents (signed HTTP
  tools with JSON schema), SCOUT custom signal feeds, NORTH metric push —
  each with a validation harness in the console.
- **CLI:** `lyra` CLI (packages/sdk/cli): login, keys, seed, tail, deploy
  hosted-page bundles.

## 5. Development capabilities inside the product (low-code, governed)

- Journey builder (ORBIT), SOP builder (AXIS), audience builder (SIGNAL),
  metric definitions (NORTH), landing blocks (SIGNAL/SCOUT) — all versioned,
  draft→review→publish with diff, rollback one click, and simulate/dry-run
  before publish. These are the "internal development" tools that let a
  tenant extend behaviour without code, within guardrails that cannot be
  configured away (consent, quiet hours, approval floors, k-anonymity).

## 6. Observability & support surfaces

Per-module health page (public-safe) · in-app support widget routed to
goNXT (or tenant's own desk via webhook) · error boundaries show trace_id ·
weekly ops digest email to module admins (queues, spend, incidents).
