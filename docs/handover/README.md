# LYRA — Transition-to-Support Handover Pack

**Document date:** 2026-08-18
**Describes commit:** `c7f1f57` on `main` (`feat(orbit): partner bind chain — C6, F1 (#24)`)
**Previous revision:** 2026-08-13, commit `a295218` — see §7 for what changed
**Repository:** <https://github.com/Reshigan/Lyra>
**Live system:** <https://lyra.vantax.co.za> (API: <https://api.lyra.vantax.co.za>)

---

## 1. What this pack is for

This pack hands LYRA over from the **build team** (who wrote it) to a
**support and operations team** (who will run it). It is the complete set of
documents a person needs to keep the platform alive, answer user questions,
diagnose failures, and know what was deliberately left unfinished — without
having to read the source or ask the original authors.

It is deliberately separate from the build specification in [`docs/`](../).
Those documents say what LYRA *should* be and why; this pack says what LYRA
*is* as of the commit above, where it runs, and what to do when it misbehaves.

**Where the two disagree, this pack describes reality and says so explicitly.**
Several spec paths in [`docs/`](../) and [`CLAUDE.md`](../../CLAUDE.md) do not
match the code as built (for example, the on-prem stack lives in
[`ops/`](../../ops), not `infra/onprem/`). Each divergence is called out where
it matters, with the real path.

## 2. Audience

| Reader | Read for |
|---|---|
| **Support engineer** (first line) | Triage, common issues, how to reproduce a user's problem, when to escalate — files 01, 02, 04, 05, 09 |
| **Operations / SRE** (second line) | Deploys, rollbacks, monitoring, incident handling, environment access — files 01, 02, 03, 07 |
| **QA / UAT tester** | Manual test scripts, the journey catalogue, what "working" looks like — files 05, 06 |
| **Product owner / delivery manager** | What is done, what is deferred, which decisions are already locked by ADR — files 05, 08 |
| **A new developer joining support** | All of it, in the order in §4 |

Assumed prior knowledge: none about LYRA. Assumed technical baseline: comfortable
with a terminal, `git`, `npm`/`pnpm`, and reading TypeScript. Cloudflare Workers
experience is helpful but the pack explains what it needs.

## 3. Contents

| File | What it covers |
|---|---|
| [`README.md`](README.md) | This page — what the pack is, who it is for, reading order, and the commit it describes |
| [`01-system-overview.md`](01-system-overview.md) | What LYRA is, its modules, the monorepo layout, the request path from browser to database, the event bus, the model gateway, multi-tenancy, and the Cloudflare/on-prem dual-home story |
| [`02-environments-and-access.md`](02-environments-and-access.md) | Every environment (local, staging, production), how to run and deploy each, where configuration lives, what secrets exist and how they are set, the seeded demo users, and how to request access |
| [`03-operations-runbook.md`](03-operations-runbook.md) | Deploy and rollback procedures, migrations, monitoring and alerting, backup/restore, and incident response |
| [`04-support-playbook.md`](04-support-playbook.md) | Ticket triage, the common-issue catalogue with diagnosis steps, and the escalation ladder |
| [`05-use-cases.md`](05-use-cases.md) | The business journeys as numbered use cases — what each role does end to end, and which module serves it |
| [`06-test-scripts.md`](06-test-scripts.md) | Manual UAT scripts for the key journeys, plus a map of the automated suites (unit, integration, e2e, evals) and how to run them |
| [`07-data-and-integrations.md`](07-data-and-integrations.md) | The data model, tenancy columns, external integrations (channels, providers, PSPs), and the scheduled jobs |
| [`08-known-gaps-and-backlog.md`](08-known-gaps-and-backlog.md) | Open gaps, known defects, deliberate deferrals, and the ADR decisions that constrain future work |
| [`09-glossary.md`](09-glossary.md) | Domain vocabulary (insurance and financial-services terms) and platform vocabulary (module names, seam names, internal jargon) |

## 4. Read this first — recommended order

**Everyone, before anything else:**

1. **[`01-system-overview.md`](01-system-overview.md)** — nothing else in the
   pack makes sense without the mental model of modules, monorepo layout and
   request path. Budget 30 minutes.
2. **[`09-glossary.md`](09-glossary.md)** — skim it, then keep it open in a tab.
   LYRA uses both insurance vocabulary and invented platform names (AXIS,
   ORBIT, seams, domain packs); tickets will use both.
3. **[`02-environments-and-access.md`](02-environments-and-access.md)** — get
   your access requested on day one, because approvals take time. Get a local
   stack running while you wait.

**Then, by role:**

- **Support engineer:** [`05-use-cases.md`](05-use-cases.md) →
  [`04-support-playbook.md`](04-support-playbook.md) →
  [`06-test-scripts.md`](06-test-scripts.md). You need to know what the product
  is *supposed* to do (05) before you can judge a report of it not doing that (04).
- **Operations / SRE:** [`03-operations-runbook.md`](03-operations-runbook.md) →
  [`07-data-and-integrations.md`](07-data-and-integrations.md). Do a dry-run
  staging deploy before you are ever asked to do a real one.
- **Everyone, within the first week:**
  [`08-known-gaps-and-backlog.md`](08-known-gaps-and-backlog.md). Roughly a third
  of the tickets you receive in the first month will already be listed there as
  known and deliberate. Recognising them saves the escalation.

## 5. Source documents this pack summarises

This pack is a distillation. When you need the full detail, the underlying
specifications are:

- [`CLAUDE.md`](../../CLAUDE.md) — the operating manual and non-negotiable
  conventions (tenancy, audit, approvals, i18n, seams)
- [`README.md`](../../README.md) — the repository's own quick-start, which is
  accurate and worth reading alongside file 02
- [`docs/02-architecture.md`](../02-architecture.md) — the system architecture
- [`docs/10-deployment-cloudflare.md`](../10-deployment-cloudflare.md) and
  [`docs/11-deployment-onprem.md`](../11-deployment-onprem.md) — the two
  deployment homes
- [`docs/13-testing-quality.md`](../13-testing-quality.md) — the test strategy
- [`docs/25-go-live-checklist.md`](../25-go-live-checklist.md) — the go-live
  gate, including every item still open at handover. This is the single most
  useful document for understanding the system's current true state
- [`docs/decisions/`](../decisions/) — the ADRs. Any behaviour that looks wrong
  may be a recorded decision; check here before raising a defect

## 6. Keeping this pack current

The pack describes commit `c7f1f57`. It goes stale the moment the code moves.
When you change behaviour that this pack documents, update the affected file in
the same pull request — the same rule the build team followed for
[`docs/`](../) (see "Definition of done" in [`CLAUDE.md`](../../CLAUDE.md)).
Update the commit hash and date at the top of this page whenever the pack is
substantively revised, and add a dated entry to §7 saying what moved.

---

## 7. Revision history

### 2026-08-18 — commit `c7f1f57` (this revision)

Thirty-eight commits landed on `main` between `a295218` (the previous
revision) and `c7f1f57`. Nothing in the pack's environment, secret or
deployment material changed. What changed is the web surface and the ledger's
revenue lines.

**Module shells were forked (ADR-0061).** Every product module now has its own
layout route and its own session hook instead of sharing one shell:
[`north-shell.tsx`](../../apps/web/app/routes/north-shell.tsx),
[`axis-shell.tsx`](../../apps/web/app/routes/axis-shell.tsx),
[`orbit-shell.tsx`](../../apps/web/app/routes/orbit-shell.tsx),
[`signal-shell.tsx`](../../apps/web/app/routes/signal-shell.tsx),
[`scout-shell.tsx`](../../apps/web/app/routes/scout-shell.tsx). A module's
routes are children of its own shell, and each shell loads its module's data
with a per-module hook rather than the previous shared `useShellData`. When a
user reports "the whole module is blank", the shell route is now the first
file to read, and the blast radius is one module rather than all of them.

**Roughly thirty module screens were added**, completing the §4 screen lists
in the module specs: NORTH Explorer, Anomalies (with channel-level driver
decomposition), Scenarios, Board Room (plus the pack PDF download), Decisions
register, Admin and Dev; ORBIT Dev (conversation simulator), Supervisor wall,
Admin and the public Partner Portal; SIGNAL Experiments, Admin, Dev and AI
creative-image generation (ADR-0060); SCOUT Whitespace, Data-product
catalogue, Admin, Dev and the integrator bench. All screens were also unified
on the answer-bar hero pattern (`212ef48`), so the top of every screen looks
the same — that is intended, not a routing bug.

**Six revenue lines went live in the ledger** (`d30393c`, PR #23 — "Group A"),
each as a transaction type with a recipe and an income account:

| Transaction type | Financial? | Income account | Receivable | Entry point |
|---|---|---|---|---|
| `BIND-GROUP` | yes | `4000` | default | `POST /v1/axis/policies/:id/bind-group` |
| `FEE-BROK` | yes | `4020` | `1160` | `POST /v1/axis/policies/:id/broker-fee` |
| `REFERRAL-QUAL` | no | — | — | `POST /v1/dist/referrals/qualify` |
| `REFERRAL-SETL` | yes | `4030` | `1160` | `POST /v1/dist/referrals/settle` |
| `AD-PLACEMENT` | yes | `4070` | `1160` | posted by the placement path; gated by a fresh disclosure |
| `DISCLOSURE-PRESENT` | no | — | — | `POST /v1/compliance/disclosures/present` |

`AD-PLACEMENT` carries a precondition (`freshAdPlacementDisclosure` in
[`preconditions.ts`](../../packages/ledger/src/preconditions.ts)): it will not
post unless a `DISCLOSURE-PRESENT` record exists and is fresh. A refused
ad-placement posting is usually a missing disclosure, not a ledger fault.

**The partner bind chain landed** (`c7f1f57`, PR #24 — "Group B"):
[`partner-bind.ts`](../../apps/api/src/engines/partner-bind.ts),
`POST /v1/orbit/partners/:id/quotes`, and the `PARTNER-BIND` transaction type
posting commission to income account `4075`.

**Two fixes worth knowing about in support:** `/v1/search` now masks PII and
never runs a `LIKE` against a wholly-redacted column (`420b88f`), and tenants
seeded before the all-access demo login existed are topped up on the next boot
(`f4a7220`), so an old staging tenant no longer lacks the demo user.

**New engines on `main`:**
[`group-commission.ts`](../../apps/api/src/engines/group-commission.ts),
[`referral-settlement.ts`](../../apps/api/src/engines/referral-settlement.ts),
[`partner-bind.ts`](../../apps/api/src/engines/partner-bind.ts).

**ADR count moved from 59 to 61** — ADR-0060 (imagery generation) and
ADR-0061 (shell per module). See file 08 §4.2.

### Work in flight — NOT on `main`, and not in production

The pack body documents `main` at `c7f1f57`. Three further revenue lines were
built or building on branches at that point and change the ledger, the schema
and the cron chain as they merge. They are listed here so that a reader who
pulls a feature branch, or who reads this pack a week after a merge, knows what
to expect. **F2/F3 has since merged** as `8331e86`; the rest of the pack does
not yet describe it.

| Line | Branch / PR | State | What it adds |
|---|---|---|---|
| **F2/F3** — whitelabel billing + data products | PR #25, `worktree-revenue-lines-group-c` | **Merged 2026-08-18 as `8331e86`** (all 10 checks green; `mutation` took 4h14m — see file 08 §2.4) | Revenue-schedule and usage-meter tables (migrations `0025_lonely_hedge_knight`, `0026_concerned_winter_soldier`), `recordUsage` and `sweepBilling` engines (invoicing, overages, revenue recognition), data-product subscribe/deliver, a k-anonymity precondition, and ADRs 0062–0064 |
| **F4** — premium financing | `group-d-premium-financing` | Built, in final review, not pushed | A new non-financial `PLAN-CREATE` transaction type chaining a financial `FIN-CMSN` (income `4080`, receivable `1150`) by `parentTxnId`; `PREM-INSTALMENT` collection off the plan's instalment schedule; a `DUNNING` escalation that cascades into the existing policy-lapse path after three refused attempts; a `sweepPremiumFinancing` cron sweep; a plan-cancel route; migration `0027_empty_garia`; and ADR-0066 |
| **F5** — telematics / usage-based insurance | not started | ADR-0065 is reserved for it and is not yet written | — |

**Migration numbering hazard — resolved.** Groups C and D were both cut from
the same commit and both claimed `0025` and `0026`. C merged first and kept its
numbers; D dropped its three files, took `main`'s journal and snapshots, and
re-ran `pnpm db:generate`, which emitted all three of its changes as the single
`0027_empty_garia`. Migrations are forward-only and never edited after they are
applied — this renumber happened *before* either branch's migrations had run
anywhere, which is the only window in which it is legal. **F5 must do the same
check before it generates anything.**

### 2026-08-13 — commit `a295218` (first edition)

Initial transition-to-support pack.
