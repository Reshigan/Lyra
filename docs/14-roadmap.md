# 14 — Roadmap & Milestones (build order for Claude Code)

Each milestone ends with an acceptance checklist; do not proceed while any
box is unchecked. Estimated sequencing, not calendar promises.

**Method:** every milestone OPENS by committing its failing acceptance suite
(`@accept:Mx` + journey specs) per docs/13 §1, and CLOSES only when that
suite, the eval gates, the premium-bar pass (docs/15 §6) and the milestone's
horizon-seam contract tests (`@seam:Hx`, docs/16) are green.

## M0 — Foundation
Scaffold monorepo per CLAUDE.md layout; packages/config; CI skeleton;
packages/db with core_ tables + migrations; tenancy middleware + `withTenant`;
better-auth with email+password; Constellation tokens + 10 core components
with stories; apps/web shell (auth, left rail, ⌘K stub); apps/api health +
OpenAPI pipeline; Aldebaran seed; local dev (`pnpm dev`) one-command.
**Accept:** login as seeded tenant.admin; create user with role; cross-tenant
read test fails correctly; CI green; RTL pseudo-locale renders.

## M1 — Core platform
RBAC bundles + authz matrix test; audit logs (core+ai) with export; consent
ledger + suppression event; files (R2 signed flows) + DocViewer; event bus +
inbox/outbox + DLQ admin; model-gateway with workers-ai + anthropic +
openai-compat adapters, tiers, budget DO, eval harness with 3 golden sets;
notification channel DO; Tenant Admin v1 (people, brand studio with contrast
check, policies); Platform Admin v1 (tenant lifecycle, flags); Dev portal v1
(keys, docs, webhook studio).
**Accept:** J-A1, J-A2, J-D1 e2e green; consent withdrawal suppresses a test
send < 15 min; eval gate wired to CI.

## M2 — AXIS v1
Cases, documents+extraction (eid/mulkiya, census normaliser), quote runner
with 3 connector types + mock providers, Production Board, Case Room,
Verify/Exceptions queues, approvals engine, SOP builder, process events,
recon workspace, AXIS admin+dev consoles, module KPIs.
**Accept:** AXIS §8 checklist; J-O1/J-O2/J-O3 e2e; extraction eval ≥ 0.95.

## M3 — ORBIT v1
AgentRoom DO + web widget + WhatsApp connector; agent console + supervisor
wall; tools registry integration (quote/bind via AXIS events); QA scorer;
renewal engine + book UI + hosted one-tap renewal; journey builder with
locked guardrails; partner portal + embedded quote/bind + sandbox mocks;
ORBIT admin+dev consoles.
**Accept:** ORBIT §8; J-C2/J-C3/J-X1/J-X3 e2e; injection suite passes against
live tool registry.

## M4 — SIGNAL v1
Creative studio (ar/en) + compliance pre-flight + review lane; hosted pages
engine; audiences + suppression; Google/Meta connectors; budget autopilot
with bounds + undo; experiments + attribution pixel; AEO units + monitor;
cockpit; SIGNAL admin+dev.
**Accept:** SIGNAL §8; J-M1/J-M2 e2e; suppression propagation test.

## M5 — SCOUT v1
Harvester connectors (internal + RSS/sitemap-diff/reviews) with politeness
controls; clustering + momentum; Radar + dossier lifecycle; panel bench from
AXIS outcomes + wording differ; experiment pages; k-anon data products;
SCOUT admin+dev.
**Accept:** SCOUT §8; J-P1/J-P2 e2e; k-anon unit tests.

## M6 — NORTH v1 + Mobile + On-prem
Metric registry + connectors (warehouse read, CSV, push); snapshot workflow;
anomaly + driver analysis; Narrator with verification gate (en+ar); Today
view; scenarios v1; board packs + PDF + distribution log; decision log;
NORTH admin+dev. Mobile app: auth, role tabs, Brief, unified Approvals, doc
capture, agent pocket console, push+deeplinks, offline outbox. On-prem
compose stack + capability adapters + `lyra onprem` CLI + parity smoke.
**Accept:** NORTH §8; J-E1/J-E2/J-E3, J-CO1 e2e; mobile Detox five flows;
`onprem smoke` green with internal LLM serving all tiers; every docs/16
horizon has ≥1 passing `@seam:Hx` contract test; Lens engine live for all
roles with reset affordance.

## Post-v1 (v1.1 backlog, tracked, not started)
Voice channel · TikTok connector · Helm chart · custom agent tools GA ·
KSA/Egypt rulepacks · FIPS images · investor data room mode in NORTH ·
tenant-branded mobile builds pipeline.
