# LYRA — The AI Growth Operating System

**One sky of data. Five instruments.**

LYRA is a multi-tenant, whitelabel AI platform for financial-services distribution
(insurance aggregation, banking comparison, embedded finance), built by goNXT.
It ships as five standalone-sellable modules on one shared core:

| Module | Pillar | One-liner |
|---|---|---|
| **LYRA AXIS** | AI Operations | The policy factory — quote-to-bind automation, document intelligence, compliance ops |
| **LYRA ORBIT** | AI Customer & Partners | Agentic CX, renewal defence, embedded-insurance partner APIs |
| **LYRA SIGNAL** | AI Marketing | Generative creative, audience/LTV intelligence, SEO+AEO, autonomous budgets |
| **LYRA SCOUT** | AI Products | Whitespace detection, panel/price intelligence, product experiments, data products |
| **LYRA NORTH** | AI Insights | Executive intelligence — narrated daily briefing, anomalies, simulations, board packs |

Two deployment targets from one codebase:

1. **Cloud (primary):** Cloudflare Workers platform — Workers, D1, KV, R2, Queues,
   Durable Objects, Workflows, Vectorize, Workers AI, AI Gateway, Pages/Assets, Zero Trust.
2. **On-prem (regulated tenants):** Docker Compose stack with an internal LLM
   (vLLM or Ollama serving an open-weights model), SQLite/libSQL, MinIO, Redis.

## How to use this pack (VS Code + Claude Code / Claude Fable)

1. Clone/copy this folder to the root of a new repo.
2. Open in VS Code. `CLAUDE.md` at the root is the operating manual for Claude Code —
   it defines conventions, commands, guardrails and the build order.
3. Start Claude Code and say: *"Read CLAUDE.md and docs/14-roadmap.md, then scaffold
   Milestone 0."* Work milestone by milestone; each doc is written to be executable
   as a spec.
4. Every module doc (docs/modules/*.md) is self-sufficient: personas, screens,
   internal tools, data entities, APIs, events, agents, KPIs and acceptance criteria.

## Reading order

- docs/00-vision.md — what we're building and why
- docs/01-brand.md — brand system ("Constellation" design language)
- docs/02-architecture.md — system architecture, Cloudflare + on-prem twin
- docs/03-data-model.md — core schema (Drizzle/SQLite dialect, runs on D1 and on-prem)
- docs/04-api.md — API gateway, conventions, auth, webhooks, rate limits
- docs/05-module-functionality.md — comprehensive per-module feature & subsection reference
- docs/modules/{axis,orbit,signal,scout,north}.md — module deep specs
- docs/06-roles-and-journeys.md — every role, every journey
- docs/07-ui-design-system.md — web design system, all role workspaces
- docs/08-mobile.md — mobile app spec (Expo), offline, RTL
- docs/09-admin-and-devtools.md — per-module admin + the developer platform
- docs/10-deployment-cloudflare.md — envs, wrangler, CI/CD
- docs/11-deployment-onprem.md — Docker Compose + internal LLM
- docs/12-security-compliance.md — PDPL, CBUAE, AI governance, audit
- docs/13-testing-quality.md — TDD/EDD method, pyramid, gates
- docs/15-experience-excellence.md — premium bar, Lens engine, ambient-AI grammar
- docs/16-future-horizons.md — future functionality and the seams that carry it
- docs/14-roadmap.md — milestones and acceptance gates
- docs/17-user-spec-benchmark.md — **BUILD BENCHMARK**: 574 numbered, testable requirements + scoring method
- docs/traceability.csv — machine-readable register (tick off as you verify)
- docs/18-business-models.md — YallaCompare current & future models, generic monetisation
- docs/19-transactions-and-ledger.md — **transaction-level spec**: catalogue, state machines, double-entry ledger
- docs/20-content-and-social-engine.md — self-sufficient marketing: content production → publishing → listening
- docs/21-editions-and-verticals.md — standalone editions (Lyra Bots etc.) + domain packs
- docs/22-ui-new-surfaces.md — UI for money, social, launch and builder surfaces
- docs/23-naming-and-trademark.md — LYRA screening record and options
- docs/24-build-execution.md — **max-speed build playbook + Claude Code prompts** (live: lyra.vantax.co.za)
- docs/IMPLEMENTATION.md — **START HERE for build**: runnable M0 skeleton, config files, failing tests, and the Claude Code prompt playbook

## Naming & whitelabel

`LYRA` is the house mark; `AXIS/ORBIT/SIGNAL/SCOUT/NORTH` are functional
sub-brands that travel with the product. Whitelabel = tenant config (name, logo,
palette, domain) — **never** hard-code the house mark in UI strings; always use
the `brand.*` tokens from tenant config. A rebrand must be a config change.

> Trademark status: LYRA passed preliminary knock-out screening (no software,
> finance, insurance or MENA use found). Formal registry clearance via counsel is
> required before public launch. Do not ship public marketing surfaces before
> legal sign-off.

Live target: **lyra.vantax.co.za** — see docs/24 §2 for domain topology.

© goNXT Technology (Pty) Ltd — a Vanta X Holdings company. Confidential.
