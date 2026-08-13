# LYRA — Transition-to-Support Handover Pack

**Document date:** 2026-08-13
**Describes commit:** `a295218` on `main` (`feat(web): add the Horizon companion rail and its header toggle`)
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

The pack describes commit `a295218`. It goes stale the moment the code moves.
When you change behaviour that this pack documents, update the affected file in
the same pull request — the same rule the build team followed for
[`docs/`](../) (see "Definition of done" in [`CLAUDE.md`](../../CLAUDE.md)).
Update the commit hash and date at the top of this page whenever the pack is
substantively revised.
