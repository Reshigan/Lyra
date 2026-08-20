# 28 — Demo run sheet

How to run the LYRA demo on <https://lyra.vantax.co.za> in front of an
audience. Forty minutes for the full sheet; the flagship journey alone is
twelve.

Everything below is the deployed demo tenant (**GONXT**, slug `gonxt`) reading
real API data. Nothing here is a mockup: every figure on every screen came out
of the same ledger, and every screen is a route you can deep-link to.

Screen-by-screen reference — layout, loader data, permissions, AI surfaces —
is [`ui.md`](../ui.md) at the repo root. This file is the running order.

---

## 1. Before you start

| Check | Command / URL | Expect |
| --- | --- | --- |
| API up | `curl https://api.lyra.vantax.co.za/health` | `200 {"ok":true,"environment":"demo",…}` |
| Web up | <https://lyra.vantax.co.za> | redirects to `/login?next=%2F` |
| Read-only smoke | `pnpm e2e:live` | all specs green |

Two browser things worth doing before anyone is watching:

- **Full screen, 1440×900 or wider.** The Horizon layout gives the hero wall
  its full width above 1280px; below that the module rail collapses and the
  drill-downs stack.
- **Have a second tab on `/design`.** That is the design-system doctrine page.
  It is the answer to "did you build a component library or a slide deck", and
  it takes ten seconds to show.

### Signing in

The login screen offers **one-click persona buttons** — no password, no MFA.
That is deliberate and it is gated: `apps/api` runs with `ENVIRONMENT: "demo"`,
and `demoOnly()` in [`apps/api/src/auth.ts`](../apps/api/src/auth.ts) answers
404 to the persona routes on any other environment.

Personas used in this sheet:

| Persona | Role | Used for |
| --- | --- | --- |
| **Amina Saleh** | `tenant.admin` | **the flagship journey**, permissions, approvals |
| Omar Farouk | `axis.lead` | AXIS board, claims desk |
| Hala Zayed | `north.exec` | NORTH briefing and anomalies |
| Tariq Mansour | `scout.lead` | SCOUT radar and whitespace |
| Noor Jamal | `signal.lead` | SIGNAL cockpit and studio |
| Sara Al Nasser | `orbit.agent` | ORBIT console and conversations |
| Faisal Omar | `finance.controller` | ledger, period close, settlement |
| Khalid Al Rashed | `tenant.compliance` | Arabic / RTL, compliance evidence |

Switching persona mid-demo: `/logout`, then the next button. Roughly four
seconds. The role change is real — screens the new persona cannot see are
absent from the rail, not greyed out.

**Walk the flagship journey as Amina Saleh (or the Demo Administrator).** She is
the only persona besides `demo@gonxt.ae` who can read all four modules; the
module leads each 403 on the other three, which is the permission model doing
its job and a dead stop mid-journey if you signed in as one of them.

---

## 2. The flagship journey — AXIS → NORTH → SCOUT → SIGNAL (12 min)

This is the demo. Everything else is supporting evidence.

The claim it makes: **the four modules are one system, and context sharpens at
every hop.** Each step passes what it learned to the next in the URL, and the
next step's loader actually uses it — this is four API-backed routes, not a
wizard with canned slides.

Sign in as **Amina Saleh** and go to **`/journey/axis`**.

### Step 1 — AXIS: what the business actually did

`/journey/axis`

AXIS groups the open case book by product line and ranks the lines by value.

- Say: *"This is transaction reality. Not a forecast — the cases on the desk
  right now, grouped by what they're for."*
- Point at the top line's value and count. Note that the number is the sum of
  real `axis_cases`, and the year of history behind it is a year of postings
  in the ledger, not a random fill.
- Click **Continue** — it carries `?productLine=<top line>` forward.

### Step 2 — NORTH: what it means

`/journey/north?productLine=…`

NORTH takes that product line and renders the executive briefing scoped to it,
with the trailing history under it.

- Say: *"NORTH didn't ask me what to look at. AXIS told it."*
- The briefing carries the ✦ marker and an inspectable "why" — open it. Every
  AI artifact in LYRA has one; there is no unexplained number on any screen.
- Click **Continue** — now `?productLine=…&briefingId=…`.

### Step 3 — SCOUT: where the gap is

`/journey/scout?productLine=…&briefingId=…`

SCOUT ranks whitespaces filtered by the line NORTH was looking at.

- Say: *"Same context, third module. SCOUT is answering 'where aren't we?'
  inside the line the briefing was about."*
- Show the k-anonymity floor on the panel figures — LYRA refuses to render a
  segment thinner than the floor rather than showing an unsafe count.
- Click **Continue** — `?subject=<category>&whitespaceId=…`.

### Step 4 — SIGNAL: what to do about it

`/journey/signal?subject=…&whitespaceId=…`

SIGNAL drafts the campaign against that whitespace.

- Say: *"The brief wrote itself out of the gap SCOUT found, which came out of
  the briefing NORTH wrote, about the product line AXIS is trading."*
- **Do not send.** Point at the approval gate: outbound send is
  `consequential: true`, so it needs a human approval unless the tenant has
  explicitly put that action type on its auto-approve allowlist. That is
  policy in `packages/core`, not a UI courtesy.

**Land the point here:** four modules, one thread of context, no re-typing, and
a hard stop before anything irreversible.

---

## 3. Depth passes (pick two or three, ~5 min each)

Run these only if the room wants proof under a specific claim.

### 3a. "Is the money real?" — the ledger

Persona **Faisal Omar**.

1. `/ledger/money-map` — where value moved this period, drawn from journal lines.
2. `/ledger/transactions` — pick one; `/ledger/transactions/:id` shows the state
   machine and the balanced double-entry lines behind it.
3. `/ledger/period-close` — the close checklist, with what is blocking it.

Say: *"Every money-affecting write is a transaction with an idempotency key, a
state machine, an approval and balanced journal lines. The ledger invariants
are property-tested; they don't get relaxed to make a screen work."*

### 3b. "What happens when a claim comes in?" — AXIS end to end

Persona **Omar Farouk**.

1. `/axis/claims/new` — FNOL intake with document intelligence on the upload.
2. `/axis/claims/desk` — the desk, then `/axis/claims/:id/detail`.
3. `/axis/board` — the whole book, with `PostingFlow` drawn on the record.

### 3c. "Who's talking to customers?" — ORBIT

Persona **Sara Al Nasser** (`orbit.agent`).

1. `/orbit/console` — the queue, routed by skill and SLA.
2. `/orbit/conversations/:id/thread` — one thread; the Arabic one shows RTL
   working in a live surface, not a settings toggle.
3. `/orbit/supervisor` — SLA breach risk across the desks.
4. `/orbit/admin` — the desk configuration the router runs on: teams, members,
   presence, SLA policies, routing rules.

### 3d. "Does it work in Arabic?" — RTL

Persona **Khalid Al Rashed** (locale `ar`).

The whole shell mirrors: rail, chrome bands, tables, flows. Nothing is
positioned with `margin-left`; every string is an i18n key. Show the same
screen you just showed in English, side by side if you have two windows.

### 3e. "Who can do what?" — permissions and approvals

Persona **Amina Saleh** (`tenant.admin`).

1. `/admin/permissions` — the role matrix.
2. `/approvals` — the queue, with four-eyes enforced: the requester cannot
   approve their own.
3. `/admin/security` — audit chain; `/admin/ai/console` — every model call with
   tenant, module, purpose and actor.

### 3f. "Is the AI accountable?" — the ambient grammar

Any persona.

- `/admin/ai/console` then `/admin/ai/runs/:id`: prompt, model, cost, verdict.
- `/admin/ai/budget`: the spend ceiling, per module.
- Say: *"AI here is ghost text, quiet chips and background drafts. No modals,
  no auto-send outside the autonomy policy, one ✦ marker, and a 'why' you can
  open on every artifact."*

### 3g. "Can you sell this outside insurance?" — domain packs

There is no toggle screen for this, and that is the point: the pack is tenant
policy (`policyJson.domainPack`), and every industry noun on every screen —
"policy", "premium", "insurer" — is read from it rather than hard-coded. Show
it on a screen you have already opened: the labels on `/axis/board` or the
portal at `/portal/gonxt` are pack output, not literals. Change the pack and
the same code sells a different business.

### 3h. The public side — ORBIT portals

Sign out entirely. `/portal/gonxt` — the customer front door, plus
`/portal/gonxt/register`, `/portal/gonxt/quotes/:id`,
`/portal/gonxt/renewals/:id`, `/portal/gonxt/partners`. These are the surfaces
a customer sees, on the same platform, with no separate CMS.

---

## 4. Closing (2 min)

`/design` — the design-system doctrine page: every section kind, every token,
every state. Say: *"There are twenty-two section kinds. Sixty-six screens were
drawn; the rest were authored against the same twenty-two. Nobody invented a
component to get a screen out."*

Then one line on what the platform is: **the business runs inside LYRA.** No
third-party marketing suite, no separate CRM, no BI tool bolted on. Channels
are integrations; management tools are built.

---

## 5. If something is empty

The demo tenant is seeded with a year of trading history. If a screen is blank,
it is one of three things, in order of likelihood:

1. **The persona can't see it.** Check the role in §1. A missing screen is the
   permission model working.
2. **The filter is too narrow.** Most desks default to an open/active state
   filter; widen it.
3. **The table genuinely has no rows for this tenant.** `seed()` refuses to run
   twice against a tenant, so tables added after the tenant was created are
   filled by the `seed-history` workflow instead
   (`.github/workflows/seed-history.yml`, `packages/core/src/seed-history-cli.ts`).
   Re-dispatch it; all three passes are idempotent.

Never demo around an empty screen by explaining what would be there. Move to
the next item on the sheet and fix the data afterwards.

---

## 6. Recovery

| Symptom | Do this |
| --- | --- |
| Login personas missing | API is not running `ENVIRONMENT: "demo"`. Check `/health`. |
| A screen 500s | Note the route, move on. `/admin/developer` shows recent errors. |
| Slow first paint | Cloudflare cold start. Load `/` once before you present. |
| Data looks stale | Re-run the `seed-history` workflow; it writes nothing it has already written. |

Deploy and environment detail: [`docs/handover/02-environments-and-access.md`](handover/02-environments-and-access.md).
Operations: [`docs/handover/03-operations-runbook.md`](handover/03-operations-runbook.md).
