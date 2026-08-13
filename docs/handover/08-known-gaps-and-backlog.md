# 08 — Known Gaps and Backlog

**Audience:** everyone, within the first week. Roughly a third of the tickets
support receives in the first month are already listed here as known and
deliberate. Recognising one saves an escalation.

This is the honest state-of-the-build. It has four parts:

1. **§2** — outstanding entries from the feature-gap register ([`docs/27`](../27-feature-gap-register.md))
2. **§3** — go-live checklist items still open ([`docs/25`](../25-go-live-checklist.md))
3. **§4** — **every** architectural decision that defers work (all 59 ADRs catalogued in §4.2)
4. **§5** — **owner action required**: things nobody on the support or
   engineering team can do, because they need the account owner

**No credential values appear in this file.** Where an item needs a secret, the
secret's *name* is given and nothing more.

---

## 1. The headline, before the detail

Two documents in [`docs/`](../) tell a different story about completeness, and
you should know why before reading either.

- [`docs/25-go-live-checklist.md`](../25-go-live-checklist.md) §1–§2 read as
  essentially complete: every milestone box is ticked, CI is green, all four
  jobs blocking.
- [`docs/27-feature-gap-register.md`](../27-feature-gap-register.md), written
  **later** and re-verified against the code on 2026-08-12, found 13 P0-severity
  gaps *after* every one of those boxes had been ticked. Of its 52 findings,
  **32 are not fully closed**.

Neither document is lying. The milestones were closed against acceptance tests
that passed; the gap register was a fresh adversarial read of the code against
the specs, and it found the places where a passing test did not mean a working
feature. **When the two disagree, docs/27 is the more recent and the more
pessimistic — trust it.**

The system is live and it works for the journeys it was demonstrated on. What
follows is the map of where it is thinner than the specification implies.

---

## 2. Feature-gap register — what is still open

Source: [`docs/27-feature-gap-register.md`](../27-feature-gap-register.md).
Findings are numbered `F1`–`F52`. That document is prose with no owner column;
this section is the extract that matters for support.

**Score: 52 findings, 20 closed, 32 not fully closed.**

### 2.1 Partly closed — the feature exists but not to spec

| ID | Gap | Why it matters to support |
|---|---|---|
| **F23** | Claims still carry two money fields where the design called for a different shape; the schema was not changed | Claim maths is correct (`incurred` is computed, not stored) but the model is not the one the spec describes. Reports written against the spec's field names will not find them |
| **F25** | Premium tax/fee split is absent | A premium is a single number. Anyone asking "how much of this is tax?" cannot be answered from the data |
| **F31** | 6 of 8 ORBIT agent tools implemented | Two capabilities the AI is documented as having, it does not have. Expect "the assistant said it couldn't do that" tickets |
| **F39** | Three different autonomy enum vocabularies coexist, and `AutonomyEnvelope` is documented but unimplemented | See ADR-0049, which named the two *real* ladders. The third vocabulary is residue. Autonomy behaves as coded, not as any single document describes |

### 2.2 Re-verified as open on 2026-08-12

These were checked against the code on the register's last pass and confirmed
still missing.

| ID | Gap | Practical effect |
|---|---|---|
| **F14** | Premium accounting is cash-basis only | No earned/unearned premium split. Any accrual-basis question is unanswerable |
| **F16** | No bank-statement import (CAMT / MT940 / OFX) | Reconciliation exists but has nothing automated to reconcile *against*. Statements must be keyed |
| **F18** | No FX revaluation | Multi-currency balances do not move with rates |
| **F19** | `decideMatch` books nothing | A reconciliation decision updates the match record but posts no journal |
| **F22** | `fast-check` is not a dependency | The property tests the ledger invariants are supposed to have are not running as property tests |
| **F30** | Journey execution never advances past the trigger | ORBIT journeys start and then stop. `orbit_journey_runs` will show runs pinned at their first node. **This is the single most likely "why is nothing happening?" ticket.** See ADR-0014 |
| **F41** | Six guardrail regexes are English-only | Arabic content bypasses those six guardrails. Relevant for any Arabic-speaking tenant |
| **F43** | Zero regional payment rails | Confirms §5 of file 07: no PSP of any kind |
| **F49** | NORTH sums `axis_policies` and never reads the ledger | Executive revenue figures are derived from policy rows, not from the books. **NORTH and LEDGER can legitimately disagree** — this is why |
| **F50** | NORTH has no forecast endpoint | All eight screens and the driver decomposition now exist; a forecast series is the one documented capability still missing, so "what does next quarter look like" has no answer |
| **F52** | `VEC_MARKET` is written but never queried | SCOUT stores vectors it never searches |

### 2.3 Open, not re-checked on the last pass

Still recorded as open; the register did not re-verify them. Treat as probably
still true.

| ID | Gap |
|---|---|
| F15 | Premium accounting depth beyond F14 |
| F17 | Ledger/period-close edge behaviour |
| F21 | Transaction-engine coverage |
| F32 | Agent-tool surface |
| **F34** | `core_memories` is never read and never written. Agent memory (seam H11) is schema-only |
| F35 | No response streaming from the model gateway — every AI response arrives whole, after the full latency |
| F36 | No cross-provider fallback. If the routed provider fails, the call fails |
| F38 | Autonomy/approval surface detail |
| F40 | Reporting depth (see also ADR-0040) |
| F42 | Payment/settlement surface detail |
| F44 | Compliance surface detail |
| F45 | Localisation depth |
| **F46** | Zero Arabic eval cases for the `north`, `compliance`, `injection`, `signal` and `axis-copilot` suites. Arabic AI quality is unmeasured, not merely unproven |
| F47 | Observability detail |
| F51 | SCOUT surface detail |

`F48` was reclassified rather than closed — it is now governed by ADR-0024.

### 2.4 Unnumbered P2 findings in the register's prose

Worth knowing because they surprise people:

- Commission is **flat-rate only** — no tiered or sliding scales.
- There are **no producer statements** (a partner cannot be sent a statement of
  what they earned).
- The chart of accounts is **hard-coded**, not tenant-configurable.
- **Bordereaux exist in the schema** (`axis_bordereaux`, `axis_bordereau_lines`)
  **but the generation/reconciliation code is not built out.**
- Dead code still present: `closeRun`, the `CREATOR-SPEND` path,
  `packages/model-gateway/src/cx-judge.ts`.
- **`packages/agents/` and `apps/agents/` do not exist.** The agent runtime that
  `CLAUDE.md` places there actually lives in
  [`apps/api/src/engines/`](../../apps/api/src/engines). Do not go looking for
  the directories in the repository layout diagram.
- Several module screens are thinner than their specifications.
- **The SIGNAL post card is web-only.** `packages/ui/src/post-card.ts` renders a
  cleared creative as a branded SVG in the web studio and the `/design`
  playground. Mobile has no creative-variant surface at all
  (`apps/mobile/app/j/campaigns.tsx` lists campaigns, not variants) and no SVG
  renderer on its dependency list, so parity here is a new mobile journey plus
  `react-native-svg`, not a port. Deliberately not built.

---

## 3. Go-live checklist — still outstanding

Source: [`docs/25-go-live-checklist.md`](../25-go-live-checklist.md), which uses
`[x]` done, `[ ]` open, `[~]` partial. Production has been live since
2026-08-07 on commit `17ce9b9`.

### 3.1 Open (`[ ]`)

| Item | Why it matters | Who must act | What unblocks it |
|---|---|---|---|
| Rotate the exposed Cloudflare API token (§4) | A token was exposed during the build. Until it is rotated, the blast radius of that exposure is open | **Account owner** | Issue a new token in the Cloudflare dashboard, update the CI secret `CLOUDFLARE_API_TOKEN`, revoke the old one |
| Retire the seed override password on the live deployment (§4) | A build-time seed password is still accepted in production | **Account owner / ops** | Unset `SEED_PASSWORD` on the production deployment and re-seed or reset the affected accounts |
| **Flip production off `ENVIRONMENT: "demo"` (§6)** | **The single highest-impact open item.** In `demo` mode the API allows password-free persona sign-in ([`apps/api/src/auth.ts`](../../apps/api/src/auth.ts)), exposes `/demo/seed` tenant writes, and lets a KV offset (`sim:clock:offsetMs`, [`apps/api/src/clock.ts`](../../apps/api/src/clock.ts)) move the system clock | Ops, with owner sign-off | Change the `ENVIRONMENT` var in [`apps/api/wrangler.jsonc`](../../apps/api/wrangler.jsonc) to `production` and redeploy. Do this only when real users replace demo personas |
| WAF, Turnstile and Bot Fight Mode not applied | The public portal has **no bot protection**, and the Turnstile verifier fails open when unconfigured | **Account owner** | `terraform apply` in [`infra/cloudflare/`](../../infra/cloudflare), then set the `TURNSTILE_SITE_KEY` var and the `TURNSTILE_SECRET` secret |
| `pnpm deploy:prod` from CI only | Production deploys are still done from a workstation | Ops | Open only because the API token still needs rotation — resolves with the first item |
| Native-Arabic-speaker review of the `ar` catalogue | A docs/24 §10 gate. Arabic strings have never been read by a native speaker | Product owner | Book a reviewer |
| claude.ai + Higgsfield MCP OAuth | Developer convenience only | Whoever runs the dev environment | **Explicitly not a go-live blocker** |

### 3.2 Partial (`[~]`)

| Item | State | What completes it |
|---|---|---|
| Cloudflare AI Gateway | `AI_GATEWAY_URL` is read by the API but unset; there is no gateway | Create a gateway named `lyra` in the dashboard, or reissue the API token with "AI Gateway: Edit", then set the var |
| Ops dashboards and alerting | Telemetry is written to Analytics Engine; nothing reads it. No error tracker | A Sentry DSN, Logpush enabled with a destination, and a dashboard over the Analytics Engine GraphQL API |
| Cost guards | Egress is counted (`analytics_egress_days`); nothing acts on it | Logpush sampling, plus R2 lifecycle rules — the Terraform is written at [`infra/cloudflare/r2_lifecycle.tf`](../../infra/cloudflare) and has never been applied |

### 3.3 Actions hidden inside ticked boxes

These are marked `[x]` because the *work* was done, but they carry a live
follow-up. They are easy to miss.

| Item | The catch |
|---|---|
| CI deploy token scope | The CI `CLOUDFLARE_API_TOKEN` **lost its Zone → Workers Routes → Edit** scope. **Staging deploys can silently go stale** — the deploy reports success but the route is not updated. Verify staging is on the commit you think it is before testing against it |
| A pending privilege-reducing role update on `lyra-staging` | An `UPDATE core_user_roles SET scope_json = …` was written but not applied. The current value uses the key `teams` where the parser expects `teamIds`, so it parses to `{}` — which **fails open to tenant-wide `axis.agent`**. Staging role scoping is therefore broader than intended |
| R2 versioning on the `FILES` bucket | Never confirmed enabled. Assume a deleted object is gone until someone checks |
| R2 lifecycle 90-day rule on the backup bucket | Not applied. Backups accumulate without expiry |
| House-mark legal clearance | Not obtained. A branding question, not a technical one |
| Mobile Lens reset parity | The mobile app does not match web behaviour for Lens reset |
| Detox (mobile e2e) and on-prem compose | Never executed live by a human operator — ADR-0019 defers this deliberately. **Nobody has run the on-prem stack end to end** |
| DNS / TLS | Cutover is done. The certificate's `notAfter` is **2026-10-28** — put the renewal in a calendar |
| `FIELD_KEY` | Set on both environments. **Rotation was never built (ADR-0032).** Once real encrypted data exists, changing this key makes that data permanently unreadable |

### 3.4 Explicitly out of scope for v1 (docs/25 §7)

Not gaps — decisions. Do not raise these as defects: voice channel, TikTok,
Helm chart, custom agent tools GA, KSA/Egypt rulepacks, FIPS images, investor
data room, tenant-branded mobile builds. Credential-gated and awaiting the
owner: WhatsApp BSP account, Google/Meta Ads accounts, AEO sampling, Apple and
Google developer accounts, **a PSP merchant account**.

---

## 4. Architecture Decision Records

### 4.1 How to use the ADRs

[`docs/decisions/`](../decisions) holds **59 ADRs**, `ADR-0001` through
`ADR-0059`. Before raising anything in this file as a defect, check here — a
surprising behaviour is frequently a recorded decision.

Format: a `Status` / `Date` header, then `## Context`, `## Decision`,
`## Consequences`. Status is one of `accepted`, `open`, `superseded by
ADR-NNNN`, or `rejected`.

**Two warnings about [`docs/decisions/README.md`](../decisions/README.md):**

1. **Its index table is stale** — it lists only ADR-0001 to ADR-0031. The
   directory listing is the authority.
2. It carries a "spec edits these ADRs imply" list of documentation that was
   never updated to match the decisions: `docs/07` §2 and §3, `CLAUDE.md:12` and
   `README.md:44` (React Router **8**, not 7 — ADR-0004), and `CLAUDE.md:23-25,40`
   (the on-prem stack is in [`ops/`](../../ops), not `infra/onprem/` — ADR-0010).

**ADR-0009 is superseded by ADR-0053.** **ADR-0037 is superseded in substance by
ADR-0038** (same name, same file, replaced interface). **ADR-0008 is the only
one still `open`** — it is a question for the product owner, not a decision.

### 4.2 The full catalogue

The **Defers** column marks an ADR that leaves work undone. **25 of the 59 do.**

| ADR | Title | Decision, in one line | Defers |
|---|---|---|:--:|
| 0001 | SAML is a seam, not an implementation | `kind: "saml"` is stored and administered; every SAML sign-in is refused at runtime | ✔ |
| 0002 | Screening, evidence export and retention are runs, not forms | Screening runs behind a `ScreeningProvider` seam with a **stub** implementation | ✔ |
| 0003 | Flat `/{module}/{resource}/{id}` URLs | No `/m/` prefix; URLs are flat | |
| 0004 | React Router 8, not 7 | `apps/web` targets React Router 8; `CLAUDE.md` and the root `README` are wrong | |
| 0005 | `/` is a dashboard, not a redirect | Every signed-in actor gets `routes/home.tsx`; no role-based landing redirect | |
| 0006 | `actorColumns` stamps creation only | Actor columns record who created a row, never who last acted on it | |
| 0007 | `ai:suggestions:read` gates the writes too | Both suggestion write endpoints are gated on the *read* permission | ✔ |
| 0008 | Finance roles can invoke LEDGER agents but cannot report on them | **Status `open`** — unresolved, a product-owner question | ✔ |
| 0009 | No charting library; SVG polyline and meter | Superseded by ADR-0053 | ✔ |
| 0010 | The on-prem stack lives in `ops/` | There is no `infra/onprem/`; wrangler config stays beside its app | |
| 0011 | The navigation rail carries text labels | Always text-labelled; no collapsed or icon-only state | |
| 0012 | SIGNAL autopilot's bound check is amount-only | `boundCheck(amountMinor, boundMinor)` compares amounts and nothing else | ✔ |
| 0013 | Six resources are delete-exempt by design | AXIS policies and claims, ORBIT partners and renewals, and two SIGNAL resources leave only via a `status`/`state` transition | ✔ |
| 0014 | ORBIT visual journey builder out of scope | The frequency-cap floor is fixed in code instead; **the graph engine and the builder are deferred** (this is why F30 exists) | ✔ |
| 0015 | SIGNAL creative generation wired; publish deferred | Variant generation works at the route level; **Meta/Google publishing is deferred** | ✔ |
| 0016 | SCOUT wording differ takes plain text | `POST /v1/scout/wording-diff` accepts text; **PDF extraction deferred** | ✔ |
| 0017 | NORTH briefing/boardpack routes wired | Generation works; **chart annotations and the boardpack approval lifecycle deferred** | ✔ |
| 0018 | SEAM-Hx: seam interfaces + `@seam:Hx` contract tests | `packages/core/src/seams.ts` is the seam layer; **asymmetric signing, `reversalFn`, H5 KYC and the H10 harness deferred** | ✔ |
| 0019 | Mobile Detox and on-prem compose: live execution deferred | Neither is executed live in this session — a human operator must | ✔ |
| 0020 | SIGNAL autopilot 14-day holdout | The live-duration claim is deferred to staging sign-off | ✔ |
| 0021 | `BudgetCounter` DO stays a reserved seam | Budget enforcement is a D1-row upsert; **the Durable Object fast path is deferred** | ✔ |
| 0022 | Domain-pack vocabulary substitutes at web label resolution | One seam in the label chain, `labelsFor(spec, locale, pack?)`; **bespoke labellers, mobile i18n and prompt vocabulary deferred** | ✔ |
| 0023 | Role-granting requires holding the bundle you grant | `assertCanGrant` boundary on user-role creation; **no seeded role can onboard into operational roles** | ✔ |
| 0024 | NORTH Snapshotter uses a typed registry | Metrics are computed by a typed registry, never by executing `definition_sql_ref`; **`claims_leakage` is unimplemented** | ✔ |
| 0025 | Scoping `provider.viewer` to its own provider org | RBAC scope resolves through provider identity for ROLE-028 | |
| 0026 | Replace "Deep Field" with the mockup visual system ("Night Sky") | Token *values* change, token *names* do not | |
| 0027 | Impersonation is a time-boxed session swap | A session swap, not a new code path through `can()` | |
| 0028 | Feature flags are the first platform-global table | `core_feature_flags` has **no `tenant_id`** — the one deliberate tenancy exception | |
| 0029 | Platform staff cross-tenant reads reuse the scheduler's loop | A loop over active tenants, one scoped context each; **no cross-tenant *write* primitive exists** | ✔ |
| 0030 | A public, unauthenticated comparison surface | A dedicated `portalRoutes` router, public by shape; **no CAPTCHA, and the currency is hard-coded AED** | ✔ |
| 0031 | Keep the nav landmark; fold "Where" into ⌘K | The persistent `<nav>` stays; the overlay is command-palette only | |
| 0032 | AES-256-GCM over WebCrypto for field encryption | Implemented in `packages/core/src/field-crypto.ts`; **key rotation is not built** | ✔ |
| 0033 | Claim recovery accounts and the two-batch receipt | Two new codes: `1155` Recovery Receivable and `5450` | |
| 0034 | AXIS metric formula judgment calls | `renewal_retention_rate` renamed to `renewal_retention`, plus related choices; **`claims_leakage` remains unimplemented** | ✔ |
| 0035 | Defer AXIS §G.6 Prioritiser/Chaser/Issuer agents | **All three agents deferred**; the SLA Sentinel stays as the load-bearing seam | ✔ |
| 0036 | AXIS vision extraction — routing and on-prem ceiling | `rawText` becomes optional; vision pins `claude-haiku-4-5`; **multi-page render and an on-prem render service + vision model deferred** | ✔ |
| 0037 | `ChannelAdapter` seam for ORBIT channels | Adds `ChannelAdapter` to `seams.ts`, distinct from the transport | |
| 0038 | Expand `ChannelAdapter` beyond ADR-0037's shape | Replaces the interface; keeps the name, file and naming convention | |
| 0039 | `eval-live` in the deploy gate needs provider secrets | **Do not weaken or bypass `eval-live`** — the missing secrets are a named go-live blocker | ✔ |
| 0040 | Defer reporting/BI catalog expansion beyond v1 | **~17 `DATASETS` entries, schedule delivery and the insight-pack UI all deferred** to post-v1 | ✔ |
| 0041 | J-C1 and J-C4 ship staff-mediated, not self-serve | Both journeys ship staff-mediated; **the self-serve steps are deferred** | ✔ |
| 0042 | J-C4 ships with a public DSAR intake | The request is recorded unverified; **verification stays staff-side** | ✔ |
| 0043 | J-C1 ships self-serve up to document handover | **Payment and issuance stay staff-side** — there is no payment step | ✔ |
| **0044** | **Dependency majors are taken before go-live; the Expo bump is not** | Majors were taken, **except Expo SDK 55→57 and TypeScript 7, both deferred** | ✔ |
| 0045 | Depth is lightness and layering, not perspective | Four depth devices, none of them perspective | |
| 0046 | The staff directory resolves names for any signed-in actor | `users` and `teams` resolve on `/v1/names` for any signed-in actor in the tenant | |
| 0047 | The assignable directory enumerates staff and teams | `GET /v1/directory` returns `{entries:[{ref,name}]}` for any signed-in actor | |
| 0048 | Catalogue names resolve for any signed-in actor | `providers`, `products`, `channels`, `offerings` join the directory resolution set | |
| 0049 | Two autonomy ladders, each named once | There are two real ladders — the agent ladder and the SIGNAL campaign ladder — each declared in exactly one place | |
| 0050 | Scheduled sweeps take a bounded bite, or say why not | A sweep takes at most `SWEEP_MAX` rows per tick; **the instalment sweep remains uncapped** | ✔ |
| 0051 | The toast host is mounted; in-place notices stay default | `ToastProvider` wraps the shell; inline notices remain the default pattern | |
| 0052 | No separate module switcher — the rail is one | The labelled sidebar *is* the module switcher | |
| 0053 | Charts are SVG in the kit, not a library | No charting dependency; `packages/ui` draws what is needed. **Zoom, brushing and rich tooltips are the acknowledged ceiling** | ✔ |
| 0054 | The retention desk binds its own renewal | `orbit.retention` gains `axis:policies:renew` | |
| 0055 | The cold open never holds the door | A `pointer-events: none`, `aria-hidden` decorative overlay | |
| 0056 | A colleague's name is the org chart, not PII | `/v1/names` does not mask the display column of a `DIRECTORY` resource | |
| 0057 | Home is composed by permission, not a role layout table | No role→layout table; **per-role panel ordering is deferred** | ✔ |
| 0058 | The draft is the lock | `sweepConversationDrafts` uses the draft itself as the concurrency lock | |
| 0059 | The companion rail is opt-in, lazy and permission-scoped | Opens closed, fetches on first open, absent without `ai:runs:read` | |

---

## 5. Known defects and behaviours to recognise on a ticket

Not a full defect list — the ones most likely to reach first-line support.

| Symptom a user reports | Actual cause | Status |
|---|---|---|
| "The journey isn't doing anything after the first step" | Journey execution never advances past the trigger (F30) | Known, ADR-0014 defers the engine |
| "The assistant never sends the WhatsApp / email" | No channel connector is configured; the adapters are complete but dormant | Known, needs a BSP account (§6) |
| "The AI is dead / silent" | Check `ai_audit_log` first. If AXIS vision, `ANTHROPIC_API_KEY` is unset and that path is inert (ADR-0036) | Known |
| "Revenue in NORTH doesn't match the ledger" | NORTH sums `axis_policies` and never reads the ledger (F49) | Known and expected |
| "The dashboard number is a day old" | NORTH reads nightly snapshots, refreshed 02:00 UTC | By design |
| "Anyone can sign in as anyone on the demo" | Production still runs `ENVIRONMENT: "demo"`, which permits password-free persona sign-in | **Open — §3.1** |
| "The public quote page is being scraped/spammed" | Turnstile is unconfigured and **fails open**; the WAF Terraform has never been applied | **Open — §3.1** |
| "Staging doesn't have my fix" | The CI token lost Workers Routes → Edit; staging deploys can silently no-op | **Open — §3.3** |
| "SAML login fails" | SAML is a seam and refuses at runtime (ADR-0001). OIDC works but has no IdP registered | By design |
| "It says a policy can't be deleted" | Six resources are delete-exempt; they transition state instead (ADR-0013) | By design |
| Arabic content passes a guardrail it should not | Six guardrail regexes are English-only (F41), and there are no Arabic eval cases for five suites (F46) | Known, unmeasured |

---

## 6. Flaky tests

**There is no quarantine list and no known flaky test.** Confirmed on
2026-08-01 by a full 16-spec Playwright batch run; the one historical flake
(MFA credential reuse in `e2e/login.spec.ts`, reproducible only on local rerun)
was root-caused and fixed.

The standing policy from [`CLAUDE.md`](../../CLAUDE.md) §7 and
[`docs/13-testing-quality.md`](../13-testing-quality.md) applies going forward:
**a flaky test is Sev-2 — quarantine it and fix it within 48 hours.**

Do not mistake these conditional skips for quarantine; all are deliberate:

| Spec | Skip condition |
|---|---|
| [`e2e/polish-tour.spec.ts`](../../e2e/polish-tour.spec.ts) | Opt-in visual tour, runs only with `POLISH_OUT` set |
| [`e2e/sim/daily.spec.ts`](../../e2e/sim/daily.spec.ts) | Four skips that model a compressed business calendar — weekends, Tue/Thu for SIGNAL and SCOUT, Fridays for compliance sweeps, and one month-end snapshot |

CI runs four blocking jobs — `check` (lint, typecheck, unit), `eval`, `e2e`
(accessibility checks ride inside it via `@axe-core/playwright`), and `mutation`
— with **no** `continue-on-error`.

The one real testing gap is coverage, not stability: **mobile Detox and the
on-prem docker-compose stack have never been run live by a human** (ADR-0019).

---

## 7. Owner action required

Nothing in this section can be done by support or by an engineer with
repository access. Each needs the **account owner** — someone who can sign in to
Cloudflare as the account holder, open a commercial account, or accept terms.

**Do not put credential values in a ticket, a chat message, or this document.**
Set secrets with `wrangler secret put` (cloud) or Docker env (on-prem), and
reference them by name only.

| Item | Why it matters | Who must act | What unblocks it |
|---|---|---|---|
| **Rotate the exposed Cloudflare API token** | A token was exposed during the build and is still valid. It also blocks moving production deploys into CI | Account owner | Create a replacement token in the Cloudflare dashboard, update the CI secret named `CLOUDFLARE_API_TOKEN`, revoke the old token |
| **Restore the CI token's Zone → Workers Routes → Edit scope** | Without it, **staging deploys silently succeed without updating the route** — you test against stale code | Account owner | Add the scope when issuing the replacement token above |
| **Cloudflare Turnstile** | The public comparison portal has no bot protection, and the verifier fails open when unconfigured | Account owner | Create the Turnstile widget, set the `TURNSTILE_SECRET` secret on the API, add `TURNSTILE_SITE_KEY` as a var in [`apps/web/wrangler.jsonc`](../../apps/web/wrangler.jsonc) — it is read by the web app but never declared, so it is undefined today |
| **`terraform apply` for `infra/cloudflare/`** | WAF rules, Bot Fight Mode, the Turnstile widget and R2 lifecycle rules are all written and **have never been applied** | Account owner | Run `terraform apply` with owner-level credentials |
| **Cloudflare AI Gateway** | No provider-call caching, no gateway analytics, no independent spend view of AI cost | Account owner | Create a gateway named `lyra` in the dashboard **or** reissue the API token with "AI Gateway: Edit", then set `AI_GATEWAY_URL` |
| **Sentry DSN (or another error tracker)** | Today every production error is a `console.error` in Workers logs. There is no alerting, no grouping, no history | Account owner | Open the account, then set the DSN as a secret and wire the SDK |
| **Logpush destination** | Required for log retention, cost-guard sampling, and any post-incident forensics beyond the Workers log window | Account owner | Enable Logpush to the already-bound R2 `LOGS` bucket, which currently has no reader or writer |
| **R2 versioning on `FILES` and a 90-day lifecycle on backups** | Object deletion is currently unrecoverable, and backups accumulate without expiry | Account owner | Confirm/enable versioning; apply the lifecycle rule (the Terraform exists at `infra/cloudflare/r2_lifecycle.tf`) |
| **Anthropic API account** | AXIS document vision extraction pins `claude-haiku-4-5` and is inert without it (ADR-0036) | Account owner | Open the account, set the secret named `ANTHROPIC_API_KEY` |
| **Provider secrets for the `eval-live` deploy gate** | ADR-0039 names this a go-live blocker and **forbids weakening or bypassing the gate** to work around it | Account owner | Provide the eval credentials so the gate can run for real |
| **PSP merchant account** | There is **no payment integration at all**. Until a merchant account exists, money moves outside LYRA and is only recorded in `ledger_payments` / `ledger_settlements` | Account owner | Open a merchant account with a regional PSP; an adapter then has to be built |
| **WhatsApp Business Solution Provider account** | The WhatsApp adapter is complete and dormant. No connector rows can exist without it | Account owner | Open the BSP account; then create an `orbit_channel_connectors` row and set the credentials |
| **Email sending account (Mailgun or equivalent)** | Same as WhatsApp — complete adapter, no account | Account owner | Open the account, configure the connector |
| **Google Ads / Meta Ads accounts** | SIGNAL plans and budgets but publishes nothing (ADR-0015) | Account owner | Open the ad accounts; publishing then has to be built |
| **Apple and Google developer accounts** | The mobile app cannot be distributed without them | Account owner | Open both developer programmes |
| **Retire the seed override password in production** | A build-time seed password is still accepted | Account owner / ops | Unset `SEED_PASSWORD` on the production deployment and reset affected accounts |
| **Decide the `ENVIRONMENT: "demo"` flip date** | Demo mode permits password-free persona sign-in and clock manipulation in production | Account owner decides; ops executes | Agree the cutover from demo personas to real users, then change the var and redeploy |
| **TLS certificate renewal** | The live certificate's `notAfter` is **2026-10-28** | Account owner / ops | Confirm auto-renewal, or diarise the manual renewal |
| **Native-Arabic-speaker review** | No native speaker has ever read the `ar` catalogue; a docs/24 §10 gate | Product owner | Book a reviewer |
| **House-mark legal clearance** | Brand mark has not been legally cleared | Account owner | Instruct counsel |
| **`FIELD_KEY` rotation policy** | **Rotation is not implemented (ADR-0032).** Changing the key after real encrypted data exists makes that data permanently unreadable | Account owner must be told, not asked | Accept the constraint, or fund building key rotation before real encrypted data accumulates |

---

## 8. If you are triaging a ticket right now

1. Search this file for the symptom. A third of first-month tickets are here.
2. If it is not here, search [`docs/decisions/`](../decisions) — 59 ADRs, and
   surprising behaviour is often a recorded decision rather than a defect.
3. If it is neither, check [`docs/27-feature-gap-register.md`](../27-feature-gap-register.md)
   for the numbered finding.
4. Only then is it a new defect. Per [`CLAUDE.md`](../../CLAUDE.md) §5, **the fix
   starts with a failing regression test named after the issue** — not with a
   patch.
