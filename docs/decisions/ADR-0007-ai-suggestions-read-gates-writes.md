# ADR-0007 — `ai:suggestions:read` gates the suggestion writes too

- Status: accepted, with known debt — the split below is the user's call
- Date: 2026-07-30
- Context: docs/15 §4 (ambient AI patterns), docs/06 §1 (roles),
  CLAUDE.md guardrail "do not weaken tenancy, audit, or approval flows"

## Context

The ambient AI grammar (docs/15 §4) only works if a surface that nobody accepts
can be found and retired. That measurement is the suggestion table: a row per
suggestion shown, resolved later with `accepted` / `edited` / `dismissed` /
`expired`, aggregated by `GET /v1/ai/suggestions/acceptance`
(`apps/api/src/routes/ai.ts:229-264`), where an edit counts as a hit
(`apps/api/src/routes/ai.ts:260-261`).

Two endpoints write to that table:

- `POST /v1/ai/suggestions` — record that a suggestion was shown
  (`apps/api/src/routes/ai.ts:169-199`)
- `POST /v1/ai/suggestions/:id/outcome` — record what the user did with it
  (`apps/api/src/routes/ai.ts:201-226`)

There is no `ai:suggestions:write` permission. The full permission list
(`packages/core/src/rbac.ts:145-153`) contains exactly one suggestion
permission, `ai:suggestions:read` (`packages/core/src/rbac.ts:149`).

## Decision

Both write endpoints are gated on `ai:suggestions:read`
(`apps/api/src/routes/ai.ts:175`, `:203`). The generic CRUD resource for the
same table uses it for `read` **and** `update`
(`apps/api/src/resources.ts:407-410`) and declares no `create` permission at
all, so the CRUD router generates no POST for it
(`apps/api/src/crud.ts:338`) — the hand-written route is the only create path.
The published contract says the same (`apps/api/src/openapi.ts:94-95`).

The rationale is recorded in place at `apps/api/src/routes/ai.ts:171-174`:

> "Suggestion rows are the evidence behind 'does this surface earn its place'
> and behind /suggestions/acceptance. Ungated, any session in the tenant could
> manufacture that evidence. Same permission the CRUD resource uses for the
> suggestions table (resources.ts), so there is one answer per actor."

The grant rule is recorded at `packages/core/src/rbac.ts:200-204`:

> "`ai:suggestions:read` rides with every `<module>:ai:invoke`. It gates reading
> a suggestion row *and* recording its outcome, so a persona that is shown an
> ambient suggestion (docs/15 §4) cannot report back without it — and a surface
> nobody can measure is a surface that can never be retired."

That coupling is what makes one permission workable today: the set of actors who
can be *shown* an ambient suggestion and the set who can *record* one are
intended to be the same set. Splitting the permission without splitting the
grants would produce roles that see suggestions and cannot report on them, which
is the failure the single permission exists to avoid.

**Blast radius as it stands.** 19 roles hold the literal grant
(`packages/core/src/rbac.ts:218`, `:234`, `:250`, `:262`, `:279`, `:289`,
`:296`, `:307`, `:317`, `:325`, `:333`, `:341`, `:355`, `:362`, `:368`, `:375`,
`:381`, `:392`, `:408`). Two more reach it by wildcard: `platform.admin` holds
`*:*:*` (`packages/core/src/rbac.ts:215`) and `tenant.admin` holds `ai:*:read`
(`packages/core/src/rbac.ts:225`), both matched by the segment-wise `matches()`
at `packages/core/src/rbac.ts:466-472`. Twenty-one roles in total can write
suggestion telemetry.

## The known debt

Naming a write `…:read` is dishonest in the one place a permission string has to
be honest — an audit reading of a role's grants. Someone auditing
`packages/core/src/rbac.ts` sees 21 roles with a read-only-sounding grant, and
none of them are read-only with respect to this table.

The concrete risk is narrower than the name suggests, and worth stating exactly:

- `POST /suggestions/:id/outcome` scopes its update to
  `eq(schema.aiSuggestions.userId, ctx.actor.id)`
  (`apps/api/src/routes/ai.ts:222`). An actor can only resolve rows they own. No
  actor can rewrite anyone else's telemetry.
- But `POST /suggestions` accepts an arbitrary `surface` and `module`
  (`apps/api/src/routes/ai.ts:179-180`) and stamps `userId` from the session
  (`apps/api/src/routes/ai.ts:189`). So an actor **can** create unlimited rows
  attributed to themselves, in any module, on any surface, and then resolve
  every one of them as `accepted`.
- `GET /suggestions/acceptance` aggregates across the whole tenant with no
  per-user weighting (`apps/api/src/routes/ai.ts:233-256`). One motivated actor
  can therefore move the number that decides whether a surface stays.

Gating the writes on *something* reduces that population from "any session in
the tenant" to 21 roles. It does not eliminate it, and no permission split
would — the fix for manufactured telemetry is rate limiting or per-user
weighting in the aggregate, not a finer permission.

## The proposed split — not applied, and it is the user's call

Add `ai:suggestions:write` to `PERMISSIONS`
(`packages/core/src/rbac.ts:149`), gate `POST /suggestions` and
`POST /suggestions/:id/outcome` on it, change the CRUD resource's `update` to
it (`apps/api/src/resources.ts:409`), update `apps/api/src/openapi.ts:94-95`,
and add the new grant to all 19 roles that currently hold the read.

That last clause is the whole cost: the split is only safe if every role that
holds the read also gets the write on the same commit. Anything less breaks the
docs/15 §4 feedback loop for whichever role is missed, silently — a suggestion
shown and never reported looks identical to a suggestion nobody accepted.

**Options, with what each buys:**

| Option | Buys | Costs |
| --- | --- | --- |
| **A. Leave as-is** | Zero churn. Behaviour is already correct and documented here and in the code comments. | A permission whose name lies. Every future reader re-derives this. |
| **B. Split, grant write to all 19** | Honest names. Read and write become separable later without another migration. | 19 role edits plus a migration for tenants with customised roles; no behaviour change on day one, so it is pure hygiene. |
| **C. Split, grant write only where an AI surface is actually rendered** | Honest names *and* a smaller write population. | Requires knowing which roles genuinely see ambient surfaces. Getting it wrong silently blinds the acceptance metric for those roles. |
| **D. Rename to `ai:suggestions:use`** | One string change, no grant changes, no lying name — "use" covers read and report. | Breaks the `module:resource:action` convention's action vocabulary; still one permission for two operations. |

No option is obviously right, and the choice is a product/governance one rather
than a technical one. **B** is the conventional answer; **A** is defensible while
the roles that see suggestions and the roles that report them remain identical
by design. This ADR does not pick, and no code was changed.

## Consequences

- The permission name will keep surprising readers until the split happens. The
  two code comments (`apps/api/src/routes/ai.ts:171-174`,
  `packages/core/src/rbac.ts:200-204`) plus this ADR are the mitigation.
- `apps/api/src/ai.test.ts:108` and `:120` assert the current gate by name. Any
  split must update them, and its own comment at
  `apps/api/src/ai.test.ts:21` records the coupling.
- The acceptance metric is self-reported and forgeable within a tenant by any of
  21 roles. Nothing currently rate-limits `POST /v1/ai/suggestions`. If that
  number ever drives a real retirement decision, it needs a guard that is not a
  permission.
- Roles with no AI surface at all are excluded by the same rule that grants it,
  which produces at least one gap the product may not want. See ADR-0008.
