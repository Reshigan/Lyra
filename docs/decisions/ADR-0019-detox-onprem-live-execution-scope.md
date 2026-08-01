# ADR-0019 — Mobile Detox and on-prem docker-compose: live execution deferred to a human operator

- Status: accepted
- Date: 2026-08-01
- Context: docs/14-roadmap.md M6 acceptance ("mobile Detox five flows; `onprem
  smoke` green with internal LLM serving all tiers"), docs/25-go-live-checklist.md
  M6 NORTH v1 + Mobile + On-prem row, ADR-0010 (on-prem stack lives in `ops/`),
  apps/mobile/e2e/*, ops/docker-compose.yml, scripts/lyra-onprem.ts

## Context

Two M6 acceptance items require driving a live external environment rather
than running code in this repo's own test runners:

1. **Mobile Detox**, five specs (`apps/mobile/e2e/*.e2e.ts`). Detox needs a
   real iOS simulator build (`pnpm e2e:test:ios`), which needs the full
   Xcode.app toolchain. This machine has `xcode-select -p` →
   `/Library/Developer/CommandLineTools` — Command Line Tools only, no
   Xcode.app, no simulator runtime. `adb`/`emulator` (the Android path) are
   also absent. Neither platform can build here. This is unchanged from the
   prior audit (docs/25 line 180) and is a workstation-provisioning gap, not
   a code gap: the specs themselves are real and pass in CI/local runs that
   do have a simulator (self-documented in
   `apps/mobile/e2e/01-sign-in-enrol.e2e.ts:7-12`, `e2e/README.md`).
2. **On-prem docker-compose live smoke**, `pnpm onprem:up` +
   `onpremSmoke()` (`scripts/lyra-onprem.ts`) against a real stack. Unlike
   Detox, this machine *can* run it: `docker version` → 29.5.3, `docker
   compose version` → v5.1.4, both present and working. Verified this
   session:
   - `docker compose -f ops/docker-compose.yml --env-file .env.example
     config` exits 0 — the compose file is syntactically valid and every
     `:?`-required variable resolves.
   - `scripts/lyra.test.ts` covers `onpremInit`/`onpremMigrate`/`onpremSeed`/
     `onpremSmoke` against a mocked `exec`/`fetch` — the CLI logic itself is
     unit-tested and green.
   - No port conflict today (`lsof -iTCP:80`/`:443` both empty).

   What has *not* run is the live multi-container stack: `docker compose up`
   would build the app image, pull `libsql-server`, `redis`, `minio`,
   `qdrant`, `ollama`, `text-embeddings-inference`, `browserless/chromium`
   and `caddy` (several GB combined), bind host ports 80/443 via `caddy`
   with `restart: unless-stopped` (i.e. it keeps running and re-attaches
   after a reboot until someone runs `onprem:down`), and then a model still
   needs pulling into the `llm` container before `onpremSmoke()`'s round
   trip has anything to talk to — `ops/docker-compose.yml` does not
   auto-pull a model, by design (docs/11 §2 leaves tier/model choice to the
   operator).

## Decision

Neither is executed live in this session.

- Detox: genuinely blocked, not a choice — no Xcode.app / no Android SDK on
  this machine. Nothing to decide; flagged as an environment gap for whoever
  runs this on hardware with a simulator installed.
- On-prem docker-compose: a choice, not a blocker. Bringing up the full
  stack binds privileged host ports, downloads multiple GB of images and a
  multi-GB model, and leaves long-running background containers on the
  operator's machine (`restart: unless-stopped` outlives this session). That
  is exactly the class of action this repo's operating rules ask to be
  confirmed with a human first rather than run autonomously — it is real
  resource and machine-state impact, not a reversible in-repo edit. It is
  deferred to whoever signs off on-prem readiness, with the compose file and
  CLI already verified as correct and ready to run:

  ```
  cp .env.example ops/.env   # or: pnpm lyra onprem:init
  $EDITOR ops/.env           # set APP_ORIGIN, LYRA_DOMAIN, generated secrets
  pnpm onprem:up
  docker exec -it lyra-llm-1 ollama pull <model>   # e.g. llama3.1:8b-instruct
  pnpm lyra onprem:migrate && pnpm lyra onprem:seed
  pnpm lyra onprem:smoke
  ```

- docs/25-go-live-checklist.md's M6 row is updated to cite this ADR for both
  items instead of carrying them as unscoped GAPs: Detox is an environment
  gap (fix = run on a machine with Xcode/Android SDK), on-prem live smoke is
  an operator go/no-go (fix = run the four commands above once ready to
  commit the machine and bandwidth).

## Consequences

- Nothing in application code changes. This is a scope/sign-off decision
  only — the same shape as ADR-0014/15/16/17.
- M6 can close on "code is real and unit/compose-validated" without a false
  claim of a live end-to-end run that didn't happen.
- Whoever performs on-prem sign-off gets exact, copy-pasteable commands
  instead of re-deriving them from `ops/docker-compose.yml` and
  `scripts/lyra-onprem.ts`.
- If Detox needs to run in CI instead of on a workstation, that's a new
  workstream (a macOS runner with Xcode preinstalled) — out of scope here.
