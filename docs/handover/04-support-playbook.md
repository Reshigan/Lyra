# 04 — Support Playbook

**Audience:** first-line support. You have a ticket, a confused user, and no
idea yet whether this is a bug, a permission, a policy working exactly as
designed, or a real outage. This document gets you from the ticket to an answer
or to a correct escalation.

**Read first:** [`01-system-overview.md`](01-system-overview.md) for the mental
model and [`05-use-cases.md`](05-use-cases.md) for what the product is
*supposed* to do. You cannot judge "it's broken" without knowing what "working"
looks like.

**The single most useful thing to know before you start:** LYRA refuses things
on purpose, constantly. Approvals, closed accounting periods, spend ceilings,
kill switches, consent, entitlements, MFA — all of these produce errors that
look like faults and are not. Roughly a third of tickets in the first month will
be one of these. Every entry in §4 tells you which is which.

---

## Contents

1. [How to read an error](#1-how-to-read-an-error)
2. [Reproducing a user's problem](#2-reproducing-a-users-problem)
3. [The triage decision tree](#3-the-triage-decision-tree)
4. [Symptom catalogue](#4-symptom-catalogue) — 16 entries
5. [Escalation ladder](#5-escalation-ladder)
6. [What to attach to an escalation](#6-what-to-attach-to-an-escalation)

---

## 1. How to read an error

Every error the API returns is RFC 9457 problem+json
([`packages/core/src/errors.ts`](../../packages/core/src/errors.ts)):

```json
{
  "type": "https://lyra.app/problems/approval_required",
  "title": "Approval required",
  "status": 403,
  "code": "approval_required",
  "detail": "ledger.refund",
  "policy_key": "ledger.refund",
  "approval_id": "apr_01K..."
}
```

**`code` is the stable field.** Titles are human text and may change; `code`
never does without a version bump. Triage on `code` and on the extension fields
next to it, never on the wording.

The complete set of codes and what each one actually means:

| `code` | HTTP | What it really means |
|---|---|---|
| `bad_request` | 400 | The request was malformed. `detail` names the problem; `errors` may map fields. |
| `unauthorized` | 401 | Not signed in, session expired, or bad credentials. |
| `forbidden` | 403 | Signed in, not allowed. The `permission` field names the exact permission that was missing. |
| `not_found` | 404 | The resource — or the *route* — does not exist for this actor. Note: demo routes return this in production mode. |
| `conflict` | 409 | The system state says no. Closed period, duplicate idempotency key, already-ended session. |
| `gone` | 410 | It existed and no longer does. |
| `unprocessable` | 422 | Valid shape, invalid content. |
| `rate_limited` | 429 | Throttled. `retry_after` is in **seconds**. Used both for login throttling and for the AI budget ceiling. |
| `internal` | 500 | A genuine fault. This is the only code that always means "we broke something". |
| `approval_required` | 403 | The action is gated. `policy_key`, and `approval_id` when a request already exists. **Not a bug.** |
| `mfa_required` | 403 | Second factor needed. `step` is `"enrol"` or `"verify"`. |
| `consent_required` | 403 | The customer has not consented to this purpose. `purpose` names it. |
| `ai_paused` | 503 | A kill switch is engaged. `tier` is `global`, `tenant` or `module`. |
| `not_entitled` | 402 | The tenant's plan does not include the feature. **Note:** this code exists but nothing in production currently throws it — entitlement enforcement works by *subtracting permissions* instead (see entry S-01). If you ever see a live 402, that is itself worth reporting. |

Every response also carries an **`x-request-id`** header. Get it into the ticket
— it is how anyone else finds the request in the logs.

Only `status >= 500 && status !== 503` is written to the Worker log. A user
being told "no" leaves no log line, by design. So for anything in the 4xx range,
the database is your evidence, not the logs.

---

## 2. Reproducing a user's problem

### 2.1 The three things you must establish before anything else

Almost every "it doesn't work" ticket resolves once you know:

1. **Which tenant.** LYRA is multi-tenant. Data, branding, feature entitlements,
   approval policy, retention, AI budget and even the vocabulary on screen are
   all per tenant. "It works for me" usually means "it works in my tenant".
2. **Which role.** Permissions are fine-grained
   (`module:resource:action`). Two users looking at the same screen legitimately
   see different buttons.
3. **Exactly what they clicked, and when.** With the timestamp you can find the
   audit row; without it you are guessing.

### 2.2 The one endpoint that answers most of §2.1

```
GET /v1/me
```

Have the user's session, or reproduce with their role, and call it. It returns
([`apps/api/src/routes/me.ts`](../../apps/api/src/routes/me.ts)):

- `actor` — including `impersonating: true/false`
- `profile` — id, name, email, locale, status
- `tenant` — id, slug, name, plan, region, status, **`brand`**
- `roles` and the **fully expanded `permissions` list**
- `entitlements` — which modules the tenant has bought
- `policy` — including `aiPaused`, `aiPausedModules`, `autoApprove`,
  `dataResidency`, retention
- `nav` — the navigation the user should see, derived from permissions
- `overrides` — the tenant's i18n string customisations

If the user says "the menu item is missing", `nav` in this response is the
authoritative answer to whether it *should* be there. Nav is derived from
permissions on every request, not stored — so a role change takes effect on the
user's next request, not on the next deploy.

### 2.3 Reproducing on staging with the demo tenant

Staging (`https://staging.lyra.vantax.co.za`, API
`https://api-staging.lyra.vantax.co.za`) runs a seeded demo tenant with slug
**`gonxt`** and one persona per role. These are fixtures, defined in
[`e2e/env.ts`](../../e2e/env.ts):

| Persona email | Role |
|---|---|
| `amina.saleh@gonxt.ae` | tenant admin |
| `layla.hassan@gonxt.ae` | AXIS agent |
| `omar.farouk@gonxt.ae` | AXIS lead |
| `nadia.rahman@gonxt.ae` | finance controller |
| `faisal.omar@gonxt.ae` | finance controller (second, for dual control) |
| `hala.zayed@gonxt.ae` | NORTH executive |
| `khalid.rashed@gonxt.ae` | compliance officer |
| `noor.jamal@gonxt.ae` | SIGNAL lead |
| `tariq.mansour@gonxt.ae` | SCOUT lead |
| `sara.nasser@gonxt.ae` | ORBIT agent |
| `yusuf.karim@gonxt.ae` | ORBIT retention |

**Two finance controllers exist on purpose.** Several money policies require
*dual control* — a second, different human. You cannot reproduce a dual-control
approval with one account.

There is a demo shortcut that skips passwords entirely:

```bash
curl -s -X POST https://api-staging.lyra.vantax.co.za/v1/auth/demo/login \
  -H 'content-type: application/json' \
  -d '{"email":"layla.hassan@gonxt.ae"}' -i
```

It issues a real session with `mfaAsserted: true` and `via: "demo"`. There is
also `GET /v1/auth/demo/personas` to list them, and `POST /v1/auth/demo/clock`
to move the simulated clock (useful for reproducing renewals and expiries).

> **Two warnings.** First, these routes are gated by `demoOnly(env)`, which
> throws `not_found` when `ENVIRONMENT` is `"production"` — but the production
> API worker currently runs with `ENVIRONMENT: "demo"`, so **they are live on
> `api.lyra.vantax.co.za` too**. Never use them there; that is not a support
> tool, it is an open door awaiting a config fix (see the operations runbook
> §7.7). Second, `POST /v1/auth/demo/seed` **writes tenant data**. Do not call
> it to "reset" anything without asking.

### 2.4 Impersonation (production)

To see production exactly as a user sees it:

```
GET  /v1/platform/impersonation                 # list sessions
POST /v1/platform/impersonation/start           # { "targetUserId": "...", "reason": "..." }
POST /v1/platform/impersonation/:id/end
```

Facts you need to know before you try:

- It requires the `core:impersonate:use` permission — held by the
  `platform.support` role.
- It is gated by the `core.impersonate` approval policy, which is
  **`neverAutoApprove`**. A *second* platform actor must approve it. There is no
  way to self-approve, and that is deliberate.
- Sessions last **30 minutes** and are audited as
  `platform.impersonation.started`.
- `reason` is mandatory and ends up in the audit log. Write the ticket number.
- Ending someone else's session fails with `not your impersonation session`; a
  double-end fails with `already ended`.

If your ticket does not justify a permanent audit record naming you and the
customer, do not impersonate — reproduce on staging instead.

### 2.5 Reproducing locally

```bash
pnpm i
pnpm seed          # creates the gonxt tenant and every persona
pnpm dev           # web + api on wrangler dev with a local D1
```

The seed password used by the e2e fixtures is in
[`e2e/env.ts`](../../e2e/env.ts). It is a **fixture value for the local and
staging demo tenant only** — it is not, and must never become, a live
credential. The go-live checklist already treats it as burned and asks the owner
to change it.

One local trap that will waste an afternoon: `e2e/global-setup.ts` skips wiping
the database when the file already exists, so a second local `pnpm e2e` run
inherits the first run's writes and some journeys fail spuriously. Run
`rm -rf $TMPDIR/lyra-e2e` before re-running.

---

## 3. The triage decision tree

Work down. Stop at the first branch that matches.

```
1. Is anyone else affected?
   ├─ Everyone, every tenant  → check /health on api + web, then the operations
   │                            runbook §8.2. This is an incident, not a ticket.
   ├─ Everyone in ONE tenant  → tenant-level cause: entitlement, policy, kill
   │                            switch, budget, closed period, seat limit.
   └─ One user               → user-level cause: permission, role scope, MFA,
                                session, locale.

2. What did the API actually return? (get the `code`, not the screenshot)
   ├─ 401 unauthorized      → §4 S-12
   ├─ 403 forbidden         → §4 S-01  (permission or entitlement)
   ├─ 403 approval_required → §4 S-02  (working as designed)
   ├─ 403 mfa_required      → §4 S-13
   ├─ 403 consent_required  → §4 S-14
   ├─ 409 conflict          → §4 S-03, S-04, S-10 (period, client money, idempotency)
   ├─ 429 rate_limited      → §4 S-06 (AI budget) or S-12 (login throttle)
   ├─ 503 ai_paused         → §4 S-05
   ├─ 500 internal          → real fault. Straight to §5, tier 2.
   └─ 200 but "nothing happened" → §4 S-08, S-09, S-15 (async work: events,
                                    webhooks, cron)

3. Did it ever work?
   ├─ Broke after a specific date/time → correlate with the last deploy
   │    (`cd apps/api && pnpm exec wrangler deployments list`)
   └─ Never worked for this user/tenant → configuration, not regression.
        Start at GET /v1/me.

4. Is it in the known-gaps list?
   → docs/handover/08-known-gaps-and-backlog.md and
     docs/27-feature-gap-register.md. Check BEFORE escalating. A large share of
     "missing feature" tickets are recorded, deliberate deferrals with an ADR
     behind them.
```

---

## 4. Symptom catalogue

Each entry: **symptom → likely cause → how to confirm → fix or escalate.**

---

### S-01 — "The menu item isn't there" / 403 `forbidden` on a page

**Likely cause.** One of two things, and they look identical to the user:

1. The user's role does not carry the permission.
2. The **tenant** is not entitled to the module — entitlements are enforced by
   *subtraction*: permissions belonging to an unlicensed module are stripped out
   of the user's grants before any check runs
   ([`packages/core/src/entitlements.ts`](../../packages/core/src/entitlements.ts)).
   The gated modules are exactly `axis`, `orbit`, `signal`, `scout`, `north`.
   Core, distribution, ledger, AI, analytics and compliance are the platform
   itself and are never gated.

A third, rarer cause: the grant is **scoped**. A grant can be limited by
`teamIds`, `productLines` or `modules`, and `scopeAllows`
([`packages/core/src/rbac.ts`](../../packages/core/src/rbac.ts)) denies the
whole grant when the subject does not supply a matching value. This is fail-safe
in the wrong direction: a team-scoped grant on a resource that has no team
column locks the user out of everything in that grant.

**How to confirm.**

- `GET /v1/me`. Compare `nav` against what the user sees, then look at
  `permissions` for the specific string, and at `entitlements.modules` for the
  module.
- The 403 body's `permission` field names exactly what was missing — for example
  `{"code":"forbidden","permission":"ledger:journals:post"}`.
- If `permissions` looks right but the action still 403s, suspect scope: query
  `core_user_roles` for that user and look at `scope_json`.

**Fix or escalate.**

- Missing permission → a tenant admin grants the role at `/admin/permissions`.
  No engineering needed.
- Missing entitlement → commercial question; route to the account owner, not to
  engineering.
- Unexpected `scope_json` → **escalate to tier 2.** There is precedent: on
  2026-08-10 a stray `{"teamIds":[...]}` overlay on a live staging row locked
  `axis.agent` out of every case list, and it was live-data drift from a manual
  edit rather than a code defect. Never edit `scope_json` yourself.

**Known trap.** `finance.analyst` deliberately has `ledger:journals:draft` and
**not** `ledger:journals:post`. `axis.lead` has `axis:claims:pay` and **not**
`axis:claims:pay_approve`. These are separation-of-duties designs, not gaps. Do
not raise them as bugs.

---

### S-02 — "I clicked the button and it says Approval required"

**Likely cause.** Working exactly as designed. Consequential actions — anything
touching money, contractual state, regulated advice, outbound send, autonomy or
data export — pass through `gate()`
([`packages/core/src/approvals.ts`](../../packages/core/src/approvals.ts)).

**How to confirm.** The 403 body tells you everything:

```json
{ "code": "approval_required", "policy_key": "ledger.refund", "approval_id": "apr_01K..." }
```

- `approval_id` **present** → a request already exists and is `pending`. Someone
  has to decide it. Point the user at `/approvals`.
- `approval_id` **absent** → the request was just created by this very attempt.
  The user should retry after it is approved.

Then check the `approvals` table (or `/approvals`) for that policy key and
subject.

**Fix or escalate.** Four things to check, in this order, before escalating:

1. **Is anyone able to approve?** The policy's `decide` permission names it. If
   the only holder is on leave, the answer is a delegation
   (`/admin/staff`), not an engineering ticket. Note that `expireDelegations`
   runs on the cron — an expired delegation looks exactly like a missing one.
2. **Does it need two people?** `dualControl` is `never`, `above_threshold` or
   `always`. Money policies above their threshold need a *second, different*
   approver. `core.impersonate`, `ai.autonomy_raise`, `core.unmasked_export` and
   `compliance.erasure` are `always`. Critically: when `dualControl` is
   `above_threshold` and **no amount is supplied**, the code fails closed and
   requires dual control anyway.
3. **Has it expired?** `APPROVAL_TTL_MS` is **24 hours**. An approval granted
   yesterday no longer covers today's attempt — the user sees the same message
   again and assumes nothing happened.
4. **Was it rejected?** A `rejected` row within the TTL also produces
   `approval_required`, not a distinct message. Check the `decision` column
   before telling the user to wait.

**Never** ask for a policy to be added to a tenant's `auto_approve` allowlist to
close a ticket. Policies flagged `neverAutoApprove` — impersonation, autonomy
raises, prompt publishing — cannot be auto-approved at all, and the rest is a
governance decision for the tenant, not a support workaround.

---

### S-03 — "Finance can't post anything — it says the period is closed"

**Likely cause.** The accounting period is `soft_closed` or `hard_closed`.
Periods are UTC months and move `open → soft_closed → hard_closed`
([`packages/ledger/src/periods.ts`](../../packages/ledger/src/periods.ts)).

**How to confirm.** The exact message tells you which state:

```
period 2026-07 is hard closed; post a contra batch instead
period 2026-07 is soft closed; an adjustment reason is required
```

Or query directly: `GET /v1/ledger/period/2026-07`, or
`select code, state from ledger_periods order by code desc limit 6`.

Note the period is chosen by the transaction's **UTC** date. A user in Dubai
posting late on the 31st is posting into the *next* month as far as LYRA is
concerned. That surprises people every month end.

**Fix or escalate.**

- `soft_closed` → the user supplies an adjustment reason. That is the whole fix;
  it is a UI field, not a permission.
- `hard_closed` → a contra (reversal) batch is the only accepted posting. An
  audit correction must never be blocked by the calendar, which is why contra
  works and a fresh posting does not.
- Genuinely needs reopening → `POST /v1/ledger/periods/:code/reopen`, which
  requires `ledger:periods:reopen` **and** the `ledger.period_reopen` approval,
  and is audited. Finance decision, not support's.

**Related:** if the *close itself* failed with `close checks failed: ...`, see
the operations runbook §7.4 for what each of the four checks means.

---

### S-04 — "The payment was rejected with a client money shortfall"

**Likely cause.** A regulatory guardrail fired. Every ledger posting runs
`clientMoneyCheck`
([`packages/ledger/src/posting.ts`](../../packages/ledger/src/posting.ts)); if
client-money assets fall below the matching liability the posting is refused:

```
client money shortfall of 12345 AED: asset 100000 < liability 112345
```

**How to confirm.** `GET /v1/ledger/reports/client-money`, the money map at
`/ledger/money-map`, or:

```sql
select * from ledger_client_money_checks
 where tenant_id = ? and breach = 1 and resolved_at is null;
```

The evidence row is written **before** the exception is thrown, deliberately —
the breach is recorded even though the posting failed. So a matching row always
exists.

**Fix or escalate.** **Escalate immediately** — tier 3, finance and compliance,
same day. Do not treat this as a failed request and do not look for a way to
make the posting succeed. It will also block month-end close via the
`no_open_client_money_breach` check until resolved. Support's job here is to
capture the shortfall amount, the currency, the transaction reference and the
timestamp, and hand it over.

---

### S-05 — "The AI has stopped working — 'AI is paused'"

**Likely cause.** A kill switch, at one of three tiers
([`packages/model-gateway/src/kill.ts`](../../packages/model-gateway/src/kill.ts)).
The response is a **503** with `code: "ai_paused"` and a `tier` field, and the
detail names who can release it:

```
global kill switch is engaged; platform operations can release it
tenant kill switch is engaged; a tenant administrator can release it
module kill switch is engaged; a tenant administrator can release it
```

The tier is reported rather than a bare boolean on purpose: a tenant admin who
can release their own pause must not be sent chasing it when platform ops is
holding the switch.

**How to confirm.** `GET /v1/ai/kill-switches` shows the tenant and per-module
state. `GET /v1/me` shows `policy.aiPaused` and `policy.aiPausedModules`. The
global switch is the `ai.kill_switch` row in `core_feature_flags`.

A fourth, narrower case: an individual **agent** can be paused on its own row.
`POST /v1/ai/runs` against a paused agent returns a 400 reading
`agent axis-copilot is paused` (whatever the status is), not a 503.

**Fix or escalate.**

- Tenant or module tier → a tenant admin releases it: `POST /v1/ai/resume`, or
  `POST /v1/ai/agents/:key/resume` for one agent. Ask *why* it was paused first;
  someone usually pulled it for a reason.
- Global tier → platform operations only: `POST /v1/platform/ai/release`
  (requires `admin:flags:write`, gated by the `core.flag_toggle` approval,
  audited as `platform.ai.released`). **Escalate to tier 2.** Do not release a
  global kill switch on a support ticket — it was thrown because something was
  wrong everywhere.

Note that 503s are deliberately **not** written to the error log — a working
kill switch is not a fault. Do not expect to find it in `wrangler tail`.

---

### S-06 — "AI worked this morning and stopped this afternoon" (429)

**Likely cause.** The tenant hit its daily AI budget ceiling
([`packages/model-gateway/src/budget.ts`](../../packages/model-gateway/src/budget.ts)).
The response is `429 rate_limited` with `retry_after` in seconds — and the value
will be suspiciously close to "time until midnight UTC", because that is exactly
what it is.

The budget is a D1 row per tenant, per **UTC day**, per module. It warns at 80%
(`WARN_AT = 0.8`) and hard-stops at 100%. It is checked *before* a call and
charged *after*, so the overshoot is bounded at one call.

**How to confirm.** `GET /v1/ai/budget` for the current position;
`GET /v1/ai/audit/spend` for where the money went. In the database, the
`ai_audit_log` rows will show outcome `budget_exceeded` — blocked calls are
audited, because the audit id is computed before the budget check runs.

Watch for the UTC boundary: a tenant in GST (UTC+4) sees the budget reset at 4am
local, not midnight local. That confuses people annually.

**Fix or escalate.** A tenant admin raises the limit at `/admin/ai/budget` or
`POST /v1/ai/budget/limits`, which is gated by the `ai.budget_raise` approval.
Values: `0` means AI is off for that tenant; `null` means unlimited. If spend is
unexpectedly high rather than the limit being unexpectedly low, look at
`/admin/cost-explorer` for the runaway agent before raising anything — escalate
to tier 2 if one purpose is consuming everything.

---

### S-07 — "The AI just errors" / an AI run fails with no useful message

**Likely cause.** A provider failure (Anthropic, Workers AI, or the
OpenAI-compatible endpoint), a guardrail refusal, or an unregistered purpose.
The gateway pipeline is: scrub PII → input guardrails → resolve purpose →
compute the audit id → kill switch → budget → provider call with retry
([`packages/model-gateway/src/gateway.ts`](../../packages/model-gateway/src/gateway.ts)).

The `ai_audit_log` outcome tells you which stage stopped it:

| Outcome | Meaning |
|---|---|
| `ok` | succeeded |
| `refused` | a guardrail refused the input or output — **not** a fault |
| `error` | the provider failed after retries |
| `budget_exceeded` | S-06 |
| `killed` | S-05 |

**How to confirm.** `GET /v1/ai/runs/:id/detail`, or `GET /v1/ai/audit` filtered
to the window. In the UI, `/admin/ai/runs/:id`. A 400 reading
`purpose <x> is not registered for module <y>` means a caller asked for a
purpose the agent does not declare — that is a code/config bug, not a provider
problem.

**Fix or escalate.**

- `refused` → explain it to the user. Guardrails refusing is the system working.
- `error`, isolated → have them retry; the gateway already retried internally.
- `error`, repeated or across tenants → **tier 2**, likely a provider outage or
  an expired API key. Note that there is currently **no AI Gateway resource
  provisioned** (operations runbook §5.7), so there is no per-provider request
  log to consult beyond `ai_audit_log` — say so in the escalation rather than
  asking someone to "check the gateway dashboard".

---

### S-08 — "Our system never received the webhook"

**Likely cause.** One of: the hook is not `active`, its subscription does not
match the event type, the endpoint rejected or timed out, or the event never got
published in the first place (S-15).

Delivery mechanics
([`apps/api/src/dispatch.ts`](../../apps/api/src/dispatch.ts)): six attempts on
backoff `0, 30s, 5m, 30m, 2h, 6h`, 10-second timeout each, then the delivery row
is marked `dead`. Only hooks with `status = 'active'` whose subscription matches
(`*`, an exact type, or a `prefix.*`) are delivered to.

**How to confirm.**

```sql
select status, attempts, next_attempt_at, error
  from webhook_deliveries
 where tenant_id = ? order by created_at desc limit 20;
```

Statuses are `delivered`, `failed` (will retry), `dead` (gave up), `superseded`
(a manual retry replaced it). If there is **no row at all**, the event never
reached the dispatcher — go to S-15.

Then fire a test: `POST /v1/core/webhooks/:id/test`.

**Fix or escalate.** Nine times out of ten it is on the customer's side, and the
`error` column says so. Two things worth checking with them before escalating:

- **Signature verification.** We send `x-lyra-signature: v1=<hmac>`, where the
  HMAC is over the string `"<x-lyra-timestamp>.<raw body>"` keyed by the hook
  secret. Customers who hash the body alone get a mismatch and often report it
  as "your webhooks are broken".
- **Timeout.** 10 seconds, hard. A customer endpoint that does synchronous work
  will intermittently miss.

Rotate the secret with `POST /v1/core/webhooks/:id/rotate` if they have lost it
— it is never readable back, by design.

---

### S-09 — "Document extraction failed" (AXIS)

**Likely cause.** Several, and the error string identifies each precisely
([`apps/api/src/routes/axis.ts`](../../apps/api/src/routes/axis.ts)):

| Message | Meaning |
|---|---|
| `document is already extracted` (or `extracting`) | Duplicate submission. Status moves `received → extracting → extracted`; you cannot re-extract without resetting. |
| `no extraction schema for doc type <t>` | The document type has no schema defined. Configuration gap, not a failure. |
| `docType is not a known document type` | Bad input. |
| `on-prem tenants must supply rawText — vision extraction is not available` | The tenant's `dataResidency` is `on-prem`; vision extraction would send the image off-premises, so it is refused. |
| `vision extraction unavailable: no browser binding` | The `BROWSER` binding is missing in this environment. |
| `document storage is not configured` | The R2 `FILES` binding is missing. |
| `document file` (a 404) | The row exists, the object does not. |

**How to confirm.** `/axis/doc-intelligence` in the UI, or the document row's
`status`. The extraction endpoint is `POST /v1/axis/documents/:id/extract`
(requires `axis:documents:extract`, AI purpose `axis.document.extract`).

**Fix or escalate.**

- Already extracted / unknown type → user error, explain it.
- No schema for the type → product/configuration request.
- The on-prem message → **working as designed**, and a residency guarantee. Do
  not escalate it as a bug; explain that vision extraction requires text to be
  supplied by the tenant in on-prem deployments.
- Missing binding messages → **tier 2 immediately.** A missing `BROWSER` or
  `FILES` binding is a deployment defect affecting everyone in that environment.

---

### S-10 — "It says my request is a duplicate" (409)

**Likely cause.** The idempotency layer
([`packages/core/src/idempotency.ts`](../../packages/core/src/idempotency.ts)).
Two distinct messages, two distinct causes:

```
idempotency key reused with a different body
an identical request is still in flight
```

Keys live for **24 hours** (`IDEMPOTENCY_TTL_MS`).

**How to confirm.** The message alone is diagnostic. The first means a client
reused a key for genuinely different content — usually a client bug, sometimes a
user editing a form and resubmitting. The second means a concurrent duplicate,
often a double-click or an impatient retry.

**Fix or escalate.**

- *Still in flight* → wait a moment and retry. Self-resolving.
- *Reused with a different body* → the client must generate a new key. If it is
  our own web UI generating the collision, that **is** a bug — tier 2.

Useful reassurance for the user: a **failed** attempt deletes its idempotency
row, so a genuine retry after a failure always works. It is only success and
in-flight that are protected.

---

### S-11 — "The logo/colours are wrong" or "it says LYRA instead of our name"

**Likely cause.** Branding is per tenant, stored as `brand_json` on the tenant
row and served through `GET /v1/me` (`tenant.brand`) and, for the public portal,
`GET /v1/portal/:tenantSlug/site`. Either the tenant's brand config is unset, or
the surface has a hard-coded string.

**How to confirm.** `GET /v1/me` and look at `tenant.brand`. For the public
portal, `curl https://api.lyra.vantax.co.za/v1/portal/<slug>/site` and look at
`tenant.brand`. Compare against what the screen shows.

**Fix or escalate.**

- Brand empty or wrong → a tenant admin fixes it in `/settings` (the brand tab
  writes `brandJson`). Not an engineering ticket.
- Brand correct but the screen still shows the wrong thing → **this is a real
  bug and a house-rule violation.** A hard-coded "LYRA" in a user-facing surface
  is defined as a defect in [`CLAUDE.md`](../../CLAUDE.md) §5. Escalate to tier 2
  with a screenshot and the exact route path.

The same rule applies to industry vocabulary: words like "policy", "premium" and
"insurer" come from the tenant's active domain pack, never from hard-coded
strings. A wrong noun for a non-insurance tenant is the same class of bug.

---

### S-12 — "I can't log in"

**Likely cause.** Several. The error strings from
[`apps/api/src/auth.ts`](../../apps/api/src/auth.ts) separate them cleanly:

| Message | HTTP | Meaning |
|---|---|---|
| `email or password is incorrect` | 401 | Exactly that. Deliberately does not reveal whether the email exists. |
| `tenantSlug is required for this email` | 400 | The same email exists in more than one tenant. The client must send `tenantSlug`. |
| `user is suspended` / `user is invited` | 403 | Account status, not credentials. An `invited` user has never accepted. |
| `Too many requests` (429) | 429 | Login throttle: **8 attempts per 5 minutes**, keyed on the lowercased email (`LOGIN_MAX = 8`, `LOGIN_WINDOW_SEC = 300`). `retry_after` is in seconds. |
| `session expired` / `session not found` | 401 | Sessions last **12 hours** (`SESSION_TTL_MS`). |
| `no credentials` / `no session` | 401 | The cookie was not sent at all — see below. |

For **SSO/OIDC**, [`apps/api/src/routes/sso.ts`](../../apps/api/src/routes/sso.ts)
is unusually explicit, which makes triage easy:

```
sso is not available on this deployment          (no KV cache bound)
identity provider <id>                            (404 — disabled or missing)
<kind> sign-in is not enabled
provider has no clientId
id_token is malformed / has expired
id_token signature does not verify
id_token issuer does not match
id_token audience does not match
id_token nonce does not match
sign-in request expired or was already used
state belongs to another provider
identity provider rejected the authorization code
```

**How to confirm.** Ask for the exact message and the time. For SSO, the
issuer/audience/signature trio almost always means the customer changed
something at their identity provider.

**Fix or escalate.**

- Wrong password, throttled, expired session → explain and wait it out. The
  throttle window is 5 minutes; there is no unlock button and adding one would
  be a security regression.
- `tenantSlug is required for this email` → the user should sign in from their
  tenant's URL, or the client needs fixing.
- `no credentials` / `no session` on an apparently good login → suspect cookies.
  The session cookie is `HttpOnly; SameSite=Lax; Secure`. Third-party cookie
  blocking, an http (not https) origin, or a mismatched `APP_ORIGIN` will all
  produce this. CORS is locked to `APP_ORIGIN` exactly — a customer accessing
  the API from an unexpected origin gets no CORS headers at all.
- Any `id_token ...` message → work it with the customer's IdP admin first;
  escalate to tier 2 only once you have the raw message and their metadata URL.
- `sso is not available on this deployment` → **tier 2**, it is a binding
  problem, not a customer problem.

---

### S-13 — "It keeps asking me for a code" (`mfa_required`)

**Likely cause.** MFA is mandatory for internal roles. `requiresMfa()`
([`packages/core/src/rbac.ts`](../../packages/core/src/rbac.ts)) returns true
for **any user with no roles at all**, and for any user holding a role that is
not prefixed `partner.`, `provider.` or `customer`. External roles are exempt;
staff are not, and a user with zero roles is treated as staff — fail closed.

**How to confirm.** The 403 body carries `step`:

- `"enrol"` → they have never set up a second factor.
- `"verify"` → enrolled, needs the current code.

Supporting errors: `already enrolled`, `enrolment not started`, `not enrolled`,
`code is incorrect`.

**Fix or escalate.** Enrolment is self-service
(`POST /v1/auth/mfa/enrol` then `/enrol/confirm`). `code is incorrect` on a
freshly enrolled device is nearly always device clock drift — have them enable
automatic time. Disabling MFA for a staff user is **not** a support action;
`POST /v1/auth/mfa/disable` exists but removing a control to close a ticket is
exactly what the go-live checklist calls a weakening of security. If someone is
genuinely locked out, escalate to tier 2.

---

### S-14 — "The AI/message won't send — consent required"

**Likely cause.** `consent_required` (403) with a `purpose` field. The customer
has not consented to that processing purpose, or has withdrawn consent.

Withdrawal propagates through the event bus: `core.consent.updated` is consumed
internally and turned into a `signal.suppression`
([`apps/api/src/dispatch.ts`](../../apps/api/src/dispatch.ts)). The target is
propagation within 15 minutes
([`docs/12-security-compliance.md`](../12-security-compliance.md)) — and since
the drain runs on the 5-minute cron in production, that budget is only met while
the cron is healthy (S-15).

**How to confirm.** The `purpose` in the error body, then the consent records
for that customer.

**Fix or escalate.** This is a legal boundary, not a bug. The fix is that the
customer consents. **Never** advise anyone to work around it, and escalate to
compliance (tier 3) if a user is asking for a way to bypass it — that request is
itself worth recording.

---

### S-15 — "I did the thing and nothing happened" (async work stalled)

**Likely cause.** Everything asynchronous in LYRA — events, webhooks, renewals,
scheduled reports, draft generation, delegation expiry — is driven by one cron
tick: every **5 minutes** in production, every **15 minutes** on staging. If the
tick is failing for a tenant, all of it stops for that tenant while the UI keeps
working perfectly.

**How to confirm.**

1. `GET /v1/platform/ops/overview` (needs `admin:diagnostics:read`) and look at
   `outboxPending` for the tenant. A number that rises and never falls is the
   signature.
2. Confirm in the database:
   ```sql
   select count(*) from core_event_outbox where published_at is null;
   select created_at, type, attempts, last_error from core_event_outbox
    where published_at is null order by created_at limit 20;
   ```
3. Check the Worker log for `scheduled tick failed for tenant` — the cron
   catches per-tenant failures individually, so one broken tenant does not stop
   the others and does not show up anywhere else.

**Fix or escalate.** **Tier 2.** Support can identify a stall but should not try
to clear it. Include the `outboxPending` count, the tenant id, the oldest
unpublished `created_at`, and the `last_error` text.

**Related:** `lastSnapshotAt` older than about 24 hours in the same response
means the nightly jobs (backup, audit anchor, NORTH snapshot) are not running —
that is a separate and more serious escalation, because it includes backups.

---

### S-16 — Dead-lettered events, and "can you just replay it?"

**Likely cause.** An event failed its handler 5 times and was dead-lettered into
`core_event_dlq`
([`packages/core/src/events.ts`](../../packages/core/src/events.ts)). The
downstream effect never happened.

Note there are two separate limits and it is worth knowing which you are looking
at: the **queue consumer** gives up after 3 attempts and logs
`lyra-events: dropping poison message`; the **outbox publisher and the event
consumer** dead-letter into `core_event_dlq` after 5.

**How to confirm.**

```
GET /v1/core/event-dlq          # requires admin:dlq:read
```

or `dlqDepth` per tenant in `/v1/platform/ops/overview`. Rows with
`replayed_at is null` are outstanding. The `error` column holds the first 500
characters of the failure.

**Fix or escalate.** **Escalate to tier 2 — support cannot replay.** The
`replayDlq()` function exists and works, but **no API route calls it**; replay
today requires a developer. Tell the requester that honestly rather than
promising a replay you cannot perform, and read the `error` column first: a
dead-lettered event usually failed for a reason that will simply repeat.

---

### S-17 — "We can't add another user" (403 with a seat message)

**Likely cause.** The tenant's licensed seat count is full:

```
seat limit reached (25 seats)
```

from `assertSeatAvailable`
([`packages/core/src/entitlements.ts`](../../packages/core/src/entitlements.ts)).
It counts live, non-deleted users.

**How to confirm.** `GET /v1/me` → `entitlements.seats`, against the live user
count in `/admin/staff`.

**Fix or escalate.** Commercial, not technical. Either deactivate a departed
user (which frees a seat) or route to the account owner for an uplift. Do not
escalate to engineering.

---

### S-18 — "The Arabic version is broken" (i18n / RTL)

**Likely cause.** Three quite different things get reported with the same
sentence:

1. **Direction.** The page should carry `dir="rtl"` for Arabic. `RTL` is
   `new Set(["ar", "fa", "he", "ur"])` and `root.tsx` renders
   `<html lang={...} dir={dirFor(locale)}>`
   ([`apps/web/app/i18n.ts`](../../apps/web/app/i18n.ts)). If the page is
   left-to-right in Arabic, the locale did not reach the server.
2. **A layout that breaks only in RTL.** Almost always a physical CSS property
   (`margin-left`) where a logical one (`margin-inline-start`) was required.
   That is a real bug — the house rule is logical properties only.
3. **Text that looks like nonsense** — `Ŝéţţíñĝŝ`, or strings padded with
   brackets. That is the **pseudo-locale**, a translation-coverage test mode.
   `PSEUDO_LOCALE = "pseudo"` is deliberately absent from the locale list and is
   reachable only by setting the `lyra_locale` cookie. A user who has somehow
   acquired that cookie sees a mangled but functional app.

**How to confirm.** `GET /v1/me` → `locale`, and the `overrides` object (a
tenant admin can override individual strings, and a bad override looks exactly
like a bad translation). In the browser, inspect `<html dir>` and the
`lyra_locale` cookie.

**Fix or escalate.**

- Pseudo-locale → clear the `lyra_locale` cookie, or set the locale properly in
  `/settings`. Self-resolving once identified.
- A wrong string that appears in `overrides` → the tenant admin edits it.
- A wrong string that is *not* overridden, or an RTL layout break → **tier 2**,
  with a screenshot and the route path.

**Standing caveat:** a native-speaker review of the Arabic catalogue is still
outstanding. Translation-quality complaints are known, expected, and should be
collected rather than escalated one at a time.

---

## 5. Escalation ladder

| Tier | Who | Takes | Target response |
|---|---|---|---|
| **1** | Support engineer (you) | Everything, first. Anything resolvable from §4 without a code change or a live-data write. | Same business day |
| **2** | Platform engineering | Real defects, 500s, stalled crons, DLQ replay, deployment/binding faults, RBAC scope anomalies, anything requiring a database write or a deploy. | Sev-1 immediate; Sev-2 same business day; Sev-3 next working day |
| **3** | Domain owner — **finance** for ledger and client money, **compliance** for consent, retention, erasure, audit-chain integrity | Anything where the correct answer is a business or regulatory decision, not a technical one. | Same day for client money and audit-chain issues |
| **4** | Platform / account owner (currently **Reshigan**) | Production deploys, GitHub environment approvals, Cloudflare account and token changes, entitlement and commercial changes, and every item on the operations runbook's open-items list. | By arrangement |

**Escalate immediately, skipping the ladder, for any of these:**

- Data from one tenant visible in another. This is Sev-1 without qualification.
- `audit chain broken` in the logs — the audit trail is the evidence everything
  else is trustworthy.
- An unresolved client-money breach (S-04).
- Anything suggesting a credential or personal-data exposure — the 72-hour
  regulatory notification clock in
  [`docs/12-security-compliance.md`](../12-security-compliance.md) starts at
  *discovery*, not at resolution.
- `/health` failing on production.

**Do not escalate before checking:**

- [`08-known-gaps-and-backlog.md`](08-known-gaps-and-backlog.md) and
  [`docs/27-feature-gap-register.md`](../27-feature-gap-register.md) — a large
  share of "missing feature" reports are recorded, deliberate deferrals.
- [`docs/decisions/`](../decisions/) — behaviour that looks wrong is frequently a
  recorded decision with an ADR number. Cite the ADR in your reply instead of
  raising a defect.
- The operations runbook's open-items table
  ([`03-operations-runbook.md`](03-operations-runbook.md) §9) — if the ticket is
  one of those eighteen, it is already known and owned.

---

## 6. What to attach to an escalation

A tier-2 escalation without this information will come straight back to you.
Fill in every line; write "unknown" rather than leaving a blank, because
"unknown" is itself information.

**Identity and scope**

- [ ] Tenant id **and** slug
- [ ] User id and email, and the **role keys** they hold (from `GET /v1/me`)
- [ ] Environment: production / staging / local / on-prem
- [ ] How many users are affected: one / one tenant / everyone

**The failure**

- [ ] The **`x-request-id`** header from a failing response — this is the single
      most valuable field
- [ ] The full problem+json body, verbatim, including the `code` and any
      extension fields (`permission`, `policy_key`, `approval_id`, `tier`,
      `retry_after`, `purpose`, `step`)
- [ ] Exact timestamp **with timezone** (UTC preferred — periods, budgets and
      backups are all UTC-based, and an off-by-one-day report is common)
- [ ] The exact URL/route, and the HTTP method
- [ ] The precise steps to reproduce, and whether you could reproduce it

**Evidence you gathered**

- [ ] The relevant part of `GET /v1/me` — at minimum `permissions`,
      `entitlements`, `policy`
- [ ] Whichever of these is relevant: `/v1/platform/ops/overview` output,
      `ai_audit_log` outcome, `webhook_deliveries` rows, `approvals` row,
      `ledger_periods` state, `core_event_outbox` counts
- [ ] Any matching Worker log line (`wrangler tail`), quoted exactly
- [ ] For UI issues: a screenshot, plus the browser, the locale, and the text
      direction

**Judgement**

- [ ] Your proposed severity (operations runbook §8.1) and why
- [ ] Which §4 entry you worked through, and where it stopped helping
- [ ] Whether you checked the gap register and the ADRs
- [ ] Business impact in plain terms — "month-end close is blocked" gets a very
      different response from "one user sees the wrong icon", and only you know
      which this is

**Never put in a ticket:** passwords, API keys, session cookies, the contents of
any wrangler secret, or unmasked personal data. If a value is needed to
diagnose, reference the row id and let tier 2 read it from the database.
