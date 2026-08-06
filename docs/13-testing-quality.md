# 13 — Test-Driven Development & Quality Strategy

LYRA is a TDD codebase. Tests are not verification after the fact; they
are the specification, written first, at every level. This doc defines the
method, the pyramid, the AI-evaluation discipline, and the gates.

## 1. The method (how every feature is built)

**Double-loop, outside-in:**

```
┌ Acceptance loop (days) ─────────────────────────────────────┐
│  failing journey/acceptance test (from docs/06 + module §8) │
│   ┌ Unit loop (minutes) ────────────────┐                   │
│   │ red → green → refactor, repeatedly  │  … until the      │
│   └──────────────────────────────────────┘  outer test greens│
└──────────────────────────────────────────────────────────────┘
```

- Milestone start = commit the milestone's full acceptance suite, failing
  (`@accept:Mx`, `@journey:J-XX`). This is the walking skeleton's to-do list.
- Behaviour lives where its test lives: domain rules in unit tests
  (packages/core), wiring in integration tests, user value in e2e.
- Test names read as spec sentences: `renewal offer is suppressed when
  marketing consent is withdrawn`. A stranger should learn the product by
  reading test titles.
- Refactor step is mandatory — green code that hasn't been cleaned isn't done.
- PR review checks test-first evidence; impl-only diffs for new behaviour are
  returned.

## 2. The pyramid

- **Unit (vitest, workers pool)** — packages/core domain logic, db queries
  (in-memory libsql), gateway adapters (recorded fixtures), UI logic hooks.
  Target < 60s wall clock; the inner loop must be instant (`vitest --watch`).
- **Integration (miniflare bindings)** — module routers, event flows
  (emit→consume→state), approval engine, tenancy guards, authz matrix
  (auto-generated: every route × role → expected status).
- **Contract** — OpenAPI schema conformance, event envelope versioning,
  webhook signatures, SDK compatibility (consumer-driven pacts for partner
  embedded APIs; a partner-facing change without a pact update fails CI).
- **E2E (Playwright)** — the journey catalogue IS the e2e catalogue: every
  J-ID in docs/06 has ≥ 1 spec; runs against PR preview with the Aldebaran
  deterministic sandbox.
- **Mobile (Detox + Maestro)** — five signature flows (docs/08 §7), RTL
  snapshots, offline outbox replay, biometric-approval mock.
- **Visual & a11y** — Storybook stories are test fixtures: Chromatic-style
  visual diffs (Playwright screenshots) on the design system incl. RTL and
  density variants; axe-core on every story and key routes; premium-bar
  checklist (docs/15 §6) automated where measurable (contrast, focus,
  skeleton-shape parity, INP budget).

## 3. Eval-driven development for AI (EDD)

The TDD analogue for model behaviour — **the eval is the failing test**:

1. Write the golden set + threshold before the prompt/agent exists:
   `packages/model-gateway/evals/{task}/cases.jsonl` + `thresholds.json`.
2. Implement until threshold passes on the pinned model; record the run
   artifact (model, prompt hash, score) in the PR.
3. Gates: extraction field-F1 ≥ 0.95 (ar+en separately), CX quality rubric ≥
   4.2/5 (ar+en separately — parity gap ≤ 0.2), compliance classifier recall
   ≥ 0.98 on hard-block set, NORTH numeric verification = 100%, injection
   suite pass = 100% against the live tool registry.
4. Determinism discipline: evals run at temperature 0 where the task allows;
   generative-quality tasks use LLM-judge with a frozen judge version and
   n=5 sampling; judge changes are themselves ADR'd.
5. Production drift: weekly sampled re-scores; regression opens an incident
   with the failing samples attached.
6. Model/provider swaps (incl. on-prem models) must pass the full gate before
   a tier assignment — no exceptions for demos.

## 4. Non-functional (also test-first: budgets are assertions)

- **Load (k6):** API mixes at 5× projected peak; AgentRoom fan-out 10k
  concurrent conversations, message p95 < 400ms excluding model; queue
  drain-rate assertions. Budgets live in k6 thresholds — a perf regression is
  a red test, not a dashboard opinion.
- **Frontend budgets as CI assertions:** Lighthouse-CI (LCP < 2.0s 4G,
  INP < 200ms), route JS ≤ budgets in docs/07 §7, skeleton-to-content layout
  shift CLS < 0.02.
- **Chaos-lite drills:** model provider 503 → tier fallback; BSP outage →
  queue + notice; D1 replica lag; each drill is a scripted test with
  assertions, run weekly in staging.
- **Security:** ZAP baseline; tenancy fuzz (random tenant-swap attempts must
  403/404); prompt-injection suite in CI; secrets-in-prompt scanner.
- **i18n/RTL:** pseudo-locale build must render without breaks; Arabic copy
  review lane blocks release.

## 5. Fixtures & determinism

Aldebaran synthetic tenant generator (packages/core/fixtures): seeded,
deterministic — customers, policies, conversations, campaigns, market
signals, one planted anomaly, one planted whitespace. All suites assert
against seeds, never against wall-clock or randomness (inject clock + rng).
No production data below prod — enforced by lint rule on connection strings.

## 6. Gates & ratchets (CI is the referee)

Merge requires: unit+integration+contract green · affected e2e green ·
eval gates green (if AI touched) · mutation score ≥ 70% on packages/core &
model-gateway (raise-only ratchet) · a11y zero criticals · budgets green ·
changelog entry. Milestone close requires the full `@accept:Mx` suite green
plus the premium-bar manual pass (docs/15 §6). Flaky = Sev-2, quarantined
and fixed in 48h; the quarantine list must trend to zero and is reviewed in
every retro. Error-budget burn > 50% freezes features for reliability work.

The mutation gate runs on the source a change touches, not the whole tree:
packages/core alone is 14,277 mutants, roughly ten hours on a CI runner, so a
whole-tree run was killed by the job ceiling every time and the gate reported
nothing (2026-08-06). The break threshold is unchanged — a change that leaves
the code it edits below 70% still fails. `pnpm mutation` with `STRYKER_SINCE`
unset is the whole-tree sweep, for a local or scheduled run.
