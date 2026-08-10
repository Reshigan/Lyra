# ADR-0039: `eval-live` in the deploy gate needs provider secrets it doesn't have

## Status

Accepted.

## Context

`.github/workflows/deploy.yml` (commit `b4d7d02`, "close prod approval gate,
deploy-check parity") changed `deploy.yml`'s `check` job from a thin
lint/typecheck/test gate into `checks: uses: ./.github/workflows/ci.yml`
(reusable workflow, `secrets: inherit`) — so staging (on push to `main`) and
production (`workflow_dispatch`) now wait on the exact same jobs a PR does,
including `eval-live`.

`eval-live` (`ci.yml:60-74`, `.if: github.event_name != 'pull_request'`) only
skips on PRs; on push/dispatch it runs for real and requires `CF_ACCOUNT_ID` +
`CF_AI_TOKEN` (Workers AI REST) or `ANTHROPIC_API_KEY`. By design it hard-fails
when the flag is on and credentials are missing —
`packages/model-gateway/evals/live.ts:16-19`: "opt-in... because they cost
money and need network; when the flag is on and credentials are missing the
run FAILS, which is the difference between a gate and a decoration" (docs/27
§F10).

`b4d7d02` was never itself run through CI before merging (no `ci`/`deploy`
workflow run exists for it or the several commits after it until this
segment's `5e52ae3` — see run history), so this gap was invisible until now.
Checking `gh secret list`: the repo has `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` (wrangler deploy) but neither `CF_ACCOUNT_ID` /
`CF_AI_TOKEN` (distinct, Workers-AI-scoped) nor `ANTHROPIC_API_KEY`. Result:
**every push to `main` now fails `deploy`'s `checks / eval-live` job**,
blocking staging deploy entirely, and would block a `workflow_dispatch`
production deploy the same way.

## Decision

**Do not weaken or bypass `eval-live`.** CLAUDE.md: "Do not weaken tenancy,
audit, or approval flows to make tests pass," and docs/27 §F10 explicitly
chose fail-hard over skip-quietly for this exact case. Softening it to skip
when credentials are absent would turn a real model-quality gate into the
"decoration" the design doc says not to build.

**Required action (account owner, not autonomous):** add one of these as a
GitHub Actions repository secret before the next push to `main`:
- `CF_ACCOUNT_ID` + `CF_AI_TOKEN` (a Workers AI-scoped Cloudflare API token —
  not the existing `CLOUDFLARE_API_TOKEN`, which is deploy-scoped), or
- `ANTHROPIC_API_KEY`

Until one of these is set, `deploy` will stay red by design on every push to
`main`. This is a genuine go-live blocker, tracked here rather than routed
around.

## References

- `.github/workflows/deploy.yml` — `checks: uses: ./.github/workflows/ci.yml`
- `.github/workflows/ci.yml:60-74` — `eval-live` job definition and its
  `pull_request`-only skip condition
- `packages/model-gateway/evals/live.ts:16-19,80-104` — fail-hard rationale
  and the exact credential pairs it accepts
- `gh secret list` (run during this investigation) — confirms only
  `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN` exist today
