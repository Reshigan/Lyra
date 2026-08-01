# SLO & error-budget policy

Satisfies docs/17 NFR-007 and the policy referenced by docs/10 §6.

## 1. Service level objectives

| Service | Objective | Window |
|---|---|---|
| API (`apps/api`, non-AI routes) | 99.9% availability, p95 latency < 150ms | rolling 28d |
| AI routes (model-gateway backed) | 99.5% availability (excludes provider outage, see §4) | rolling 28d |
| Web app (`apps/web`, Cloudflare Workers) | 99.9% availability | rolling 28d |

Availability = successful responses (status < 500, or a 5xx caused by caller
input) / total requests, measured from Workers Logs. p95 latency excludes AI
routes, whose latency is bounded by the upstream model, not our code.

## 2. Error budget

99.9% over 28 days = 40.3 minutes of budget. 99.5% = 3h 21m.

Burn is tracked from the same Workers Logs / Analytics Engine data that
feeds the NORTH platform dashboards (docs/10 §6) — no separate SLO
pipeline. There is no dedicated burn-rate alert wired yet (Sentry and
Logpush→R2 are the credential-gated pieces; see docs/25 §6); until that
lands, burn is checked manually at each weekly ops review from the
Analytics Engine TELEMETRY dataset.

## 3. Freeze rule

Per docs/13 §6: **error-budget burn > 50% in the current window freezes
feature work.** While frozen:

- Only reliability, bugfix, and rollback work merges.
- The freeze is lifted when burn drops back under 50%, or the window
  rolls over, whichever comes first.
- The on-call engineer (or, pre-on-call-rotation, whoever is driving
  ops that week) declares and lifts the freeze; no separate approval
  process — this is a operational call, not a change-management one.

## 4. Exclusions

- Upstream model provider outages (Workers AI, Anthropic) count against
  the AI-route budget only if we failed to degrade gracefully (docs/15
  ambient-AI grammar requires a visible "why" and a quiet failure mode,
  not a hard error) — a clean fallback to "AI unavailable" is not a
  budget-consuming failure.
- Scheduled maintenance windows, announced ≥ 24h ahead, are excluded.

## 5. Review cadence

Reviewed every retro (docs/13 §6), same cadence as the flaky-test
quarantine list.
