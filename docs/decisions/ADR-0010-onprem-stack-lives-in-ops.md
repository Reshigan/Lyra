# ADR-0010 — The on-prem stack lives in `ops/`, and there is no `infra/`

- Status: accepted
- Date: 2026-07-30
- Context: CLAUDE.md "Repository layout (target)", docs/11 §1 (on-prem stack)

## Context

CLAUDE.md's target layout (CLAUDE.md:23-25) declares:

```
/infra
  /cloudflare     # wrangler.jsonc per app, Terraform for accounts/zones (optional)
  /onprem         # docker-compose.yml, Dockerfiles, Caddyfile, model configs
```

and CLAUDE.md:40 gives the command as
`docker compose -f infra/onprem/docker-compose.yml up`.

**There is no `infra/` directory in the repository.** The on-prem stack is in
`ops/`: `ops/docker-compose.yml`, `ops/Dockerfile`, `ops/Dockerfile.dockerignore`
and `ops/Caddyfile`.

The code already agrees with `ops/`, not with CLAUDE.md. `package.json:20-21`:

```json
"onprem:up": "docker compose -f ops/docker-compose.yml up -d",
"onprem:down": "docker compose -f ops/docker-compose.yml down",
```

README.md:51 documents `ops/` in its tree and README.md:140 gives the same
`ops/docker-compose.yml` command.

The `/infra/cloudflare` half never had content to hold. Wrangler configuration
belongs to the Worker it configures and lives with it —
`apps/web/wrangler.jsonc` and `apps/api/wrangler.jsonc`. Moving those under
`infra/cloudflare/` would separate a Worker from its bindings for no gain, and
the Terraform the spec calls "(optional)" does not exist.

## Decision

`ops/` is the home of the on-prem stack. Wrangler configuration stays beside
each Worker. `infra/` is not created.

CLAUDE.md:23-25 and CLAUDE.md:40 are stale and should be corrected to match. As
a documentation-only change this ADR does not make that edit; it is the record
until someone does.

Two other drifts in the same layout block, recorded here so the correction is
made once:

- **`/apps/agents` does not exist.** CLAUDE.md:15 declares it ("Durable Objects
  + Workflows: agent runtime, schedulers"). `apps/` contains `api`, `mobile` and
  `web`. The agent runtime currently lives inside the API
  (`apps/api/src/routes/ai.ts`).
- **`packages/ledger` is not in the layout block.** It exists and is a
  workspace package. CLAUDE.md:17-22 lists seven packages; the repo has eight.

## Consequences

- Anyone following CLAUDE.md literally will create `infra/onprem/`, producing a
  second, empty on-prem tree beside the real one. This has already happened in
  documentation: docs/11-deployment-onprem.md:7 titles its stack section
  "(infra/onprem/docker-compose.yml)", docs/IMPLEMENTATION.md:94 draws
  `infra/onprem/` in its tree, and docs/IMPLEMENTATION.md:122 quotes the old
  `onprem:up` script that no longer matches `package.json:20`.
- `.github/workflows/security.yml:95` says container image scanning "lands when
  `infra/onprem` ships a Dockerfile". `ops/Dockerfile` exists, so the trigger
  condition is already met but is written against a path that will never appear
  — the scan job is blocked on a false premise. This is the one place where the
  drift has a live consequence rather than a cosmetic one.
- docs/24-build-execution.md:110 scopes a workstream to `infra/*`. That glob
  matches nothing, so the workstream's file boundary is effectively "wrangler
  configs and `.github/workflows`" only.
- `ops/` is a broader name than `infra/onprem/`. It will attract unrelated
  operational files (runbooks, scripts, dashboards) unless someone pushes back.
  `scripts/` already exists at the root for that purpose, and the boundary
  between the two is undefined.
- Choosing `ops/` costs nothing to reverse — it is four files and one
  `package.json` line — but reversing it means editing README.md in two places
  as well, and the spec would then be right for the first time.
