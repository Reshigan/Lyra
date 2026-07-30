# ORBIT — UI design brief

Describes what is built today (branch `main`, 2026-07). Every label, permission
string, column and piece of copy below was read out of the source. Nothing here
is aspirational; where a screen is thin, the "What is weak today" section says so
rather than inventing the fix.

---

## Orientation

1. ORBIT is the customer side of LYRA: every conversation the tenant has with a
   customer, and everything a relationship needs between conversations.
2. Nine resources: conversations, messages, renewals, journeys, journey runs,
   partners, partner transactions, handover notes, quality scores.
3. The nav label is **"Conversations"** (`nav.orbit`), not "ORBIT" — the module
   name never appears in the UI.
4. Who lives in it all day: `orbit.agent` (Sara Al Nasser, customer desk),
   `orbit.retention` (Yusuf Karim, renewal book), `orbit.partners` (Dana Aziz,
   partner desk), `orbit.lead` (queue + quality). They differ only in *write*
   affordances — all four read all nine tabs.
5. Who visits: `tenant.admin` (reads everything, writes nothing),
   `north.exec` / `north.analyst` (Renewals tab only), `partner.developer` /
   `partner.manager` (Partners + Partner transactions only).
6. Screen that matters most: **the conversation thread**
   (`/orbit/conversations/:id/thread`) — the only bespoke screen in the module,
   where an AI draft is approved or discarded and a reply leaves the tenant.
7. Second: **the conversations list** (`/orbit/conversations`) — the queue an
   agent starts their day in.
8. Third: **renewals** (`/orbit/renewals`) — the retention book; empty on a fresh
   demo because a scheduled sweep fills it, not the seed.
9. Everything except the thread is generated CRUD: one list route and one record
   route render all nine resources from a declarative spec.
10. Design constraint that shapes everything: messages are immutable, withheld
    affordances are absent rather than disabled, and AI is ghost text and quiet
    chips — never a modal.

---

## Chrome every ORBIT screen sits inside

`apps/web/app/components/shell.tsx`.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [tenant logo or name]                  Signed in as {name}  Settings  Sign out │  h-14, sticky,
├────────────┬─────────────────────────────────────────────────────────────┤  border-b
│ ● Home     │                                                             │
│ ● Operations│  <main id="workspace" max-w-[100rem] p-4 sm:p-6>            │
│ ● Conversations ←active: bg-surface-2, dot opacity 100                    │
│ ● Marketing│                                                             │
│ ● Market   │                                                             │
│ ● Insight  │                                                             │
│ ● Distribution                                                            │
│ ● Ledger   │                                                             │
│  md:w-60   │                                                             │
└────────────┴─────────────────────────────────────────────────────────────┘
```

- Sidebar is **text-labelled always**. An icon-only rail was explicitly rejected
  in code comments (costs a hover to read, costs a screen-reader user the label).
  `item.icon` rides through as a `data-icon` attribute for a later decorative pass.
- Below `md`, the sidebar becomes a horizontally scrollable strip under the
  header. No drawer, no state.
- The dot before "Conversations" is `var(--module-orbit)` = **`#37d3b2`** (ion
  teal). Module accents are product identity and are **not** tenant-overridable.
  Opacity 30% idle, 60% hover, 100% active. `aria-hidden`; decoration only.
- Tenant may override exactly five custom properties: `--accent`,
  `--accent-hover`, `--accent-contrast`, `--font-display`, `--font-ui`. Font is
  chosen from a 3-entry allowlist (`space-grotesk`, `inter`,
  `ibm-plex-sans-arabic`), never interpolated.
- Skip link `app.skipToContent` = "Skip to content". `<main tabIndex={-1}>`.
- The nav only lists items whose href has a route; an actor with no `orbit:*`
  permission never receives the item from `/v1/me` at all.

### Tokens available

Dark-first. `--bg`, `--surface-1/2/3`, `--border` (`#1f2a44`-ish),
`--border-strong #2a3a5e`, `--text`, `--text-muted`, `--text-subtle`, `--accent`
(vega `#ffb020` dark / `#d98e0b` light), `--success` (ion `#37d3b2`), `--danger`
(flare `#ff5d5d`), `--warning` (vega), `--info` (photon `#6e9bff`).
Type scale: 12 / 13 / 14 (body) / 16 / 18 / 22 / 28 / 36 / 48.
Radii: sm 6, md 10, lg 16, `--radius-orbit: 999px`.
Density: default row 44px; `[data-density="compact"]` row 34px — every generated
table renders `density="compact"`.
Motion: `--duration-fast 150ms`, `--duration-slow 250ms`; reduced-motion honoured
globally.

### Components available (`@lyra/ui`)

`Button` (variants primary / secondary / ghost / danger, default secondary; sizes
sm `h-8 px-3 text-13`, md `h-10 px-4 text-14`, lg `h-11 px-5 text-16`; `loading`
sets `aria-busy` and disables), `Badge`/`Tag` (tones neutral / accent / success /
danger / warning / info; `dot` renders a 1.5 pill), `Card`, `Tabs`, `Table`,
`EmptyState`, `Field`, `Input`, `Textarea`, `Select`, `Checkbox`, `DatePicker`
(native `<input type="date">`, supports `calendar="islamic-umalqura"`),
`ProgressBar`, `DateTime`, `Money`, `Popover`.
AI grammar: `AGENT_MARK = "✦"`, `AgentBadge`, `GhostText`, `ConfidenceMeter`,
`EvidenceLink`, `GuardrailNotice`. (`BudgetMeter` and `ApprovalStrip` exist but
ORBIT does not use them.)

---

## Routes belonging to ORBIT

`apps/web/app/routes.ts`:

| Path | File | Kind |
|---|---|---|
| `/orbit/conversations/:id/thread` | `routes/conversation.tsx` | **bespoke**, ranked above `:module` |
| `/orbit` | `routes/module.tsx` | generic list, falls to first readable tab |
| `/orbit/:resource` | `routes/module.tsx` | generic list |
| `/orbit/:resource/:id` | `routes/record.tsx` | generic record |

There is **one** hand-written ORBIT screen. Everything else is the generic pair
driven by `apps/web/app/modules/orbit.ts` (the workspace spec) and
`apps/api/src/resources.ts` (the API registry). The ORBIT workspace declares **no
`links`**, so there is no "Reports and tools" strip under the tabs.

---

# 1. Conversation thread — the screen that matters

## Route + title

- Path: `/orbit/conversations/:id/thread`
- File: `apps/web/app/routes/conversation.tsx` (993 lines)
- `h1` = the customer's name (`nameJson.en`), falling back to the literal
  **"Conversation"** (local key `conversation`).
- This screen has **its own label table**, not `i18n/en.ts`. `LABELS.en` and
  `LABELS.ar` are declared in the route file with a `ponytail:` note to fold them
  into the shared catalogue "once that file has an owner again". Generic words
  (`common.back`) still come from `translator(locale)`.
- Reached from: the **"Open thread"** button on the conversation record screen
  (`recordLink`, `labelKey: "thread"`), or a direct URL. It is **not** a tab and
  **not** linked from the list.

## Who sees it

The loader calls `GET /v1/orbit/conversations/:id` unguarded — reaching this
screen needs `orbit:conversations:read`.

| Role key | Reaches the screen | Sees messages | Reply composer | Assign/Close | Handover panel | QA panel |
|---|---|---|---|---|---|---|
| `orbit.agent` | yes | yes | yes | **no** (lacks `orbit:conversations:assign`) | read + write | read |
| `orbit.lead` | yes | yes | yes | yes | read + write | read |
| `orbit.retention` | yes | yes | yes | no | read only | read |
| `orbit.partners` | yes | yes | **no** | no | read only | read |
| `orbit.admin` | yes (`orbit:*:*`) | yes | yes | yes | read + write | read |
| `tenant.admin` | yes (`orbit:*:read`) | yes | no | no | read only | read |
| `north.exec`, `north.analyst` | **no** — they hold only `orbit:renewals:read` | — | — | — | — | — |
| `tenant.compliance`, all `axis.*`, `finance.*`, `scout.*`, `signal.*`, `dev.*`, `provider.viewer`, `customer` | **no** | — | — | — | — | — |
| `platform.admin` | yes (`*:*:*`) | yes | yes | yes | yes | yes |

Exact permission strings this screen reads (`CAN` in the route file):

```
reply:         orbit:messages:send
assign:        orbit:conversations:assign
handover:      orbit:handover:read
handoverWrite: orbit:handover:write
qa:            orbit:qa:read
customer:      core:customers:read
audit:         ai:audit:read
```

**What a denied user sees**: the nav item is absent entirely (the API never sends
it). A direct URL renders the route error boundary — `error.title` "This did not
load" with `error.forbidden` **"Your roles do not include access to this area."**

## Purpose

Read one conversation end to end, decide what an AI has drafted, and reply — with
the delivery status stated honestly at every step.

## Layout skeleton

Single column, `flex flex-col gap-6`, inside `main` (max 100rem, p-4/p-6). No
split pane, no sticky composer.

```
┌───────────────────────────────────────────────────────────────┐
│ Back to list                                     text-12 subtle│
│ Rania Haddad                                    font-display 24│
│ [WhatsApp] [Human]  cnv_01h...                  badges + mono  │
│ Renewal outreach on CDR-MOT-2501-664118 — already replaced…    │  summary, text-13 muted, max-w-prose
├───────────────────────────────────────────────────────────────┤
│ [Assign to me]  [Close conversation]        only if :assign    │
├───────────────────────────────────────────────────────────────┤
│ role=status line: "Reply queued for delivery. It has not left yet." │
├───────────────────────────────────────────────────────────────┤
│ ╭ Customer context ───────────────────────────── Card, padded ╮│
│ │ Customer      Assigned to    │ 2-col dl from sm            ││
│ │ Channel       Team           │ each Fact: border-s ps-3    ││
│ │ Intent        Language       │ dt 12 subtle / dd 13 text   ││
│ │ Sentiment     Satisfaction   │ empty renders "—"           ││
│ │ Started       Last message   │                             ││
│ │ Closed                       │                             ││
│ ╰──────────────────────────────────────────────────────────── ╯│
├───────────────────────────────────────────────────────────────┤
│ Load older messages   ← link, or "This is the start of the…"   │
│ ┌ inbound ───────────────┐                       me-auto      │
│ │ From customer [Customer] 09:41                 max-w-prose  │
│ │ I already bought a new policy…                              │
│ └────────────────────────┘                                    │
│                       ┌──────────── outbound ┐  ms-auto       │
│                       │ To customer [AI agent] 09:05 [Read] ✦ │
│                       │ Hello Rania — your motor cover…       │
│                       └───────────────────────┘               │
├───────────────────────────────────────────────────────────────┤
│ ┏ dashed border ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ Suggested reply ┓│
│ ┃ [✦ Drafted by renewal ▾]  What it was based on  Audit record┃│
│ ┃ Model confidence  ▓▓▓▓▓▓▓░░░  78%                          ┃│
│ ┃ Thank you, Rania — I've closed the renewal on…   ghost text ┃│
│ ┃ Accept [Tab]   Discard [Esc]                                ┃│
│ ┃ [Approve and queue]                                         ┃│
│ ┃ Approving queues these exact words as an AI turn…           ┃│
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛│
├───────────────────────────────────────────────────────────────┤
│ Reply                                                          │
│ ┌───────────────────────────────────────────────┐ Textarea rows=4│
│ └───────────────────────────────────────────────┘              │
│ Sending a reply leaves the tenant and is recorded in the audit log. │
│ [Send reply]  ← primary, disabled while the box is empty       │
├───────────────────────────────────────────────────────────────┤
│ ╭ Handover notes ──────────────────────────────── Card ───────╮│
│ │ │ Rania re-bought on the web on 8 January…                  ││
│ │ │ Written by: Human agent · Accepted by: user:… · 09:44     ││
│ │ ── form (only with orbit:handover:write) ──                 ││
│ │ Hand to          [                    ]                     ││
│ │ What the next person needs to know [textarea rows=3, required]││
│ │ [Save handover note]                                        ││
│ ╰─────────────────────────────────────────────────────────────╯│
│ ╭ Quality scores ─────────────────────────────── Card ────────╮│
│ │ Rubric: orbit.escalation  [Score: 52]  [Disputed]  09:26    ││
│ ╰─────────────────────────────────────────────────────────────╯│
└───────────────────────────────────────────────────────────────┘
```

## Every element

**Header**

| Element | Label / source | Behaviour |
|---|---|---|
| Back link | `common.back` = "Back to list", `text-12 text-subtle`, underline on hover | to `/orbit/conversations` |
| Title | customer name from `GET /v1/core/customers/:id` (`nameJson.en`, or the first value of the object, or the raw string when masked); else `"Conversation"` | none |
| Channel badge | `channel.whatsapp` "WhatsApp" / `channel.web` "Web" / `channel.voice` "Voice" / `channel.email` "Email" / `channel.agent` "Agent" | tone `neutral`, static |
| State badge | `state.bot` "Bot" / `state.human` "Human" / `state.closed` "Closed" | tone `accent` unless closed, then `neutral` |
| Id | `conversation.id`, `font-mono`, e.g. `cnv_01JX…` | selectable text, not a link |
| Summary | `conversation.summary`, `text-13 text-muted max-w-prose` | rendered only when non-null |

**Action row** (only when the actor holds `orbit:conversations:assign`)

| Button | Label | Variant | Intent | Effect |
|---|---|---|---|---|
| Assign to me | `assign` "Assign to me" | secondary sm, `disabled` when state is closed | `assign` | Server resolves the actor via `/v1/me`, then `PATCH /v1/orbit/conversations/:id { assigneeRef: me.actor.id, state: "human" }`. Taking a conversation also takes it off the bot. |
| Close / Reopen | `close` "Close conversation" / `reopen` "Reopen conversation" | ghost sm | `close` / `reopen` | `PATCH { state: "closed", closedAt: Date.now() }` or `{ state: "human", closedAt: null }` |

**Status lines** (`role="status"`, `text-13 text-muted`, appear after an action)

- After a send: the *delivery status the row came back with*, mapped via
  `deliveryLabel()` — "Queued for delivery" / "Sent" / "Delivered" / "Read" /
  "Delivery failed" / "Not dispatched". A status this build has never heard of is
  echoed raw. The code comment is explicit: reporting "sent" for a row that only
  reached the queue is *the one lie this screen must not tell*.
- `done.assign` "This conversation is now assigned to you and taken off the bot."
- `done.close` "Conversation closed."
- `done.reopen` "Conversation reopened and returned to a human."
- `done.handover` "Handover note saved."
- `done.approve` "Draft approved and queued as an AI turn. It has not left yet."

**Customer context card** (`Card title={l("context")}` = "Customer context",
padded; `dl` 2 columns from `sm`; each `Fact` is `border-s border-border ps-3`,
`dt` 12 subtle, `dd` 13; a missing value renders `—` in subtle)

| Term | Key | Value |
|---|---|---|
| Customer | `customer` | Name; a **link** to `/admin/customers/:id` only when the actor holds `core:customers:read`, otherwise plain text. Link `title` = "Open the customer record". |
| Assigned to | `assignee` | `assigneeRef` (a raw `user:…` ref) or "Nobody" (`unassigned`) |
| Channel | `channel` | translated channel |
| Team | `team` | raw `teamId` |
| Intent | `intent` | raw string, e.g. `renewal.offer`, `claim.first_notice` |
| Language | `lang` | raw `en` / `ar` |
| Sentiment | `sentiment` | integer −100…100, `tabular-nums`. **Not** a word, not a colour. |
| Customer satisfaction | `csat` | integer 1–5, `tabular-nums`, shown only when the customer has given one |
| Started | `started` | `DateTime precision="minute"` |
| Last message | `lastMessage` | `DateTime precision="minute"` |
| Closed | `closedAt` | `DateTime precision="minute"` |

**Thread**

- Paging line above the list: either the link **"Load older messages"**
  (`?pages=N+1`, `preventScrollReset`) or the sentence **"This is the start of
  the conversation."** Paging is a link, not a button, so the URL is shareable
  and reload-stable.
- Loader walks the keyset cursor backwards: `PAGE = 50`, `MAX_PAGES = 10`, i.e.
  at most 500 turns. The list API caps at 200 rows per request regardless.
- `<ol aria-label="Messages" aria-live="polite" aria-relevant="additions">` —
  only additions are announced, so a screen reader is not read the archive.
- Each `<li>` (`MessageRow`):
  - **Direction is derived from `role`, not stored.** `customer` = inbound,
    `system` = internal, everything else = outbound.
  - Inbound: `me-auto max-w-prose rounded-lg border border-border bg-surface-1
    p-3 text-start`. Outbound: `ms-auto … border-accent/40 bg-surface-2`.
  - Meta line (`text-11 text-subtle`, wraps): direction word ("From customer" /
    "To customer" / "Internal") · role Badge ("Customer" / "AI agent" / "Agent" /
    "System"; an unknown role echoes itself) · `DateTime` minute precision ·
    **delivery Badge on outbound only** (queued=warning, sent=info,
    delivered=success, read=success, failed=danger, null=neutral "Not
    dispatched") · `AgentBadge` (✦) when `aiAuditId` is set, whose popover says
    "An agent wrote this turn. The audit record holds the prompt and the
    evidence." · an "Audit record" link to `/admin/ai-audit-log/:aiAuditId` only
    with `ai:audit:read`.
  - Body: `whitespace-pre-wrap font-ui text-13 text-text`.
  - Attachments and redactions are **not rendered** — a `ponytail:` comment says
    to render them when a channel actually sends one.

**Draft block** — see AI surfaces below.

**Composer** (only with `orbit:messages:send`)

| Input | Type | Required | Default | Notes |
|---|---|---|---|---|
| `content` | `Textarea rows={4}`, controlled React state | effectively yes — Send is `disabled` while `content.trim()` is empty | `""`, or the draft text after "Accept" | Label "Reply", hint **"Sending a reply leaves the tenant and is recorded in the audit log."** |
| `nonce` | hidden | — | `${useId()}:${attempt}` | Sent as the `idempotency-key` header. A new value after every successful send, so a retry or a double click is free but a genuine second reply is not deduplicated. |

Submit: `POST /v1/orbit/messages` with
`{ conversationId, role: "agent_human", content, ts: Date.now(), deliveryStatus: "queued" }`.
`ts` is `notNull` with no default, so the client must supply it.

Without the permission the whole form is replaced by one line:
**"You do not hold the permission to reply in this conversation."**

**Handover notes card** (only with `orbit:handover:read` *and* a successful
sub-fetch)

- Title "Handover notes". Sorted `ts desc`.
- Each note: summary (13 text) then a meta line (11 subtle) —
  `Written by: {AI agent|Human agent} [· Accepted by: {ref}] · {DateTime}`.
  Note the label lookup is `role.agent_${generatedBy}`, so `ai` → "AI agent" and
  `human` → "Human agent".
- Empty: **"None recorded."**
- Form (only with `orbit:handover:write`): "Hand to" (`toRef`, `Input`, optional)
  + "What the next person needs to know" (`summary`, `Textarea rows=3`,
  `required`) + secondary sm button "Save handover note".
  `fromRef` is filled server-side from `/v1/me`; `generatedBy` is hard-coded
  `"human"`.

**Quality scores card** (only with `orbit:qa:read`)

- Title "Quality scores". Sorted `ts desc`.
- Row: `Rubric: {rubricKey}` · Badge `Score: {n}` (**tone success when ≥ 70, else
  warning** — 70 is the bar, hard-coded on this screen) · Badge "Disputed"
  (danger) when `disputedBy` is set · `DateTime`.
- Empty: **"None recorded."**
- No scoring form here. `orbit:qa:score` is only exercised from the generated
  Quality scores list.

## Table columns

None. This screen has no table.

## Forms

Four `<Form method="post">` elements, discriminated by a hidden `intent`:

| Intent | Fields | Validation | Endpoint |
|---|---|---|---|
| `reply` | `content`, `nonce` | empty content returns a no-op (`{problem:null,sent:null,done:null}`) — silently nothing happens | `POST /v1/orbit/messages` |
| `approve` | hidden `content` (the draft verbatim), hidden `aiAuditId`, `nonce = ${id}:draft:${draftId}` | same empty guard | `POST /v1/orbit/messages` with `role: "agent_ai"` |
| `assign` / `close` / `reopen` | none | none | `PATCH /v1/orbit/conversations/:id` |
| `handover` | `toRef` (optional), `summary` (required, HTML `required`; empty is also a server-side no-op) | | `POST /v1/orbit/handover-notes` |

Server-side errors are never thrown away: an `ApiError` becomes
`{ problem }` and re-renders the page with the actor's input intact.

## States

| State | What is shown |
|---|---|
| Loading | React Router navigation; every button gets `loading` (`aria-busy`, disabled). No skeleton, no spinner elsewhere. |
| Conversation not found | Route error boundary: "This did not load" / `error.notFound` "There is nothing at this address." |
| No `orbit:conversations:read` | Route error boundary with `error.forbidden` "Your roles do not include access to this area." |
| **Can read the conversation but not its messages** | `GuardrailNotice` tone warning, title "Messages", reason **"You can see this conversation but not its messages."** The header and context card still render. This is a real, reachable state — reading a conversation and reading its messages are separate grants. |
| Empty thread | `EmptyState title="No messages yet."` — 5 of the 8 seeded conversations land here. |
| Side panel 403/404 | The panel is simply absent. `optional()` swallows 403 and 404 for customer, handovers and QA. |
| Write rejected | `Problem` — `role="alert"`, `border-danger/40 bg-danger/10`, shows `problem.detail ?? problem.title`. |
| Write rejected **because approval is required** | `GuardrailNotice` tone warning, title **"This reply needs approval before it can be sent"**, reason = the problem detail. Triggered when `problem.type` ends with `approval_required`. The API does not gate message creation today, so this is a prepared, currently-unreachable path. |

## AI surfaces

This is the module's densest AI surface. Everything obeys docs/15: ✦ once, ghost
text, quiet chips, inspectable "why", no modal, no auto-send.

**Draft detection** (loader): a message is a live suggestion only if it is the
**last** row, `role === "agent_ai"`, has **no `deliveryStatus`**, and its
`aiAuditId` (or its exact content) has not already been dispatched by some other
row. An undispatched AI row with human turns after it is history, not an offer.
The draft is removed from `messages` and rendered separately.

**The block** — `<section aria-label="Suggested reply">`,
`rounded-lg border border-dashed border-border p-4`. Dashed, because it is not
yet part of the record.

| Element | Copy | Source |
|---|---|---|
| `AgentBadge` | `✦ Drafted by {agentKey}` — agentKey is `renewal` in the seed; falls back to the local word "Assistant" | `AGENT_MARK` + accent Badge |
| its popover ("Why this was drafted") | **"Drafted, not sent. Approve it as it stands, move it into the composer to edit, or discard it."** then `{run.purpose} · Autonomy: {run.autonomyLevel}` — seeded as `orbit.renewal.draft_reply · Autonomy: suggest_only` | `ai_runs` row matched by `outputRef === draft.aiAuditId` |
| `EvidenceLink` | trigger and popover label both "What it was based on"; body is the raw `evidenceJson` pretty-printed in `font-mono text-11` | seeded: three items — the expiring policy, the in-force policy, and `motor → home, score 72` |
| Audit link | "Audit record" → `/admin/ai-audit-log/:id`, only with `ai:audit:read` | |
| `ConfidenceMeter` | label "Model confidence", value `run.confidence / 100` (seed: 78 → 78%), floor 0.7 → **success tone**; `max-w-xs` | |
| `GhostText` | the draft body, `aria-live="polite"`, `text-subtle` | |
| Ghost actions | **"Accept ⌨Tab"** and **"Discard ⌨Esc"** — these two labels are hard-coded English inside `@lyra/ui` and do **not** translate | `packages/ui/src/ai.tsx` |
| Approve button | "Approve and queue", secondary sm, disabled when the conversation is closed | only with `orbit:messages:send` |
| Approve hint | **"Approving queues these exact words as an AI turn and keeps the audit trail with them."** | |

**Behaviour, precisely**

- **Accept** copies the draft text into the composer's React state. It sends
  nothing. The human still has to press "Send reply".
- **Approve and queue** posts the draft **verbatim** as a *new* message with
  `role: "agent_ai"` and the same `aiAuditId` — who wrote the words does not
  change because a human let them through. Delivery status comes back `queued`,
  and the confirmation says so: "It has not left yet."
- **Discard** sets local React state `dismissed = true`. **That is all it does.**
  `orbit_messages` is registered `immutable: true`, so the draft row is never
  deleted or updated — reload the page and the suggestion is back. This is the
  single most important behavioural detail on the screen for a designer to know.
  The loader's only defence is that once *anything* has been dispatched with the
  same audit id or the same words, the draft stops being treated as live.
- Inbound history rows that carry an `aiAuditId` also show a bare ✦
  `AgentBadge`, so a past AI turn is marked without repeating the whole draft
  apparatus.

## Actions and consequences

| Action | Approval gate | Ledger | Reversible |
|---|---|---|---|
| Send reply | Not gated by the API today. The screen is built to render an approval notice verbatim the moment the API starts answering `approval_required`. CLAUDE.md §4 says an outbound send is consequential; the honest current state is "queued, not gated". | no | **No.** Append-only; a sent turn cannot be edited or withdrawn. |
| Approve draft | same | no | **No.** Creates a second permanent row. |
| Discard draft | none | no | Yes, trivially — it is local state and survives nothing. |
| Assign to me | none | no | Yes — assign to someone else, or reopen. Sets `state: "human"` as a side effect. |
| Close / Reopen | none | no | Yes, symmetric pair. |
| Save handover note | none | no | Not from this screen. (The generated Handover notes record screen can edit and soft-delete with `orbit:handover:write`.) |

## Mobile

**Web only.** `apps/mobile/src/nav.ts` maps `/orbit` to exactly one collection,
`orbit/conversations`, and there is no thread screen in the Expo app. Tapping a
conversation on mobile opens the generic record view — a flat list of raw
camelCase field names and values.

## RTL notes

- Bubble sides mirror correctly and by construction: inbound uses `me-auto`,
  outbound `ms-auto`; padding uses `ps-3`; the `Fact` rule is `border-s`. There
  are no physical-direction utilities anywhere in this route (the design system
  test enforces the same rule inside `@lyra/ui`).
- The direction **word** carries the meaning, not the side: "From customer" /
  "To customer" / "Internal" is written on every bubble, so the thread survives
  monochrome, mirroring and a screen reader (WCAG 2.2 AA: colour is never the
  only carrier).
- Arabic content in an English UI, and vice versa, is normal here — 3 of the 8
  seeded conversations are Arabic. Message bodies inherit the page direction;
  they carry no per-message `dir`, so an Arabic body inside an English page
  renders LTR-first. **This is a live bug for a designer to solve.**
- `AgentBadge` "Drafted by" and `GhostText` "Accept"/"Discard" stay English in
  Arabic. Known, commented, unfixed.
- The ✦ mark is direction-neutral; do not mirror it.
- `font-mono` ids and `tabular-nums` numbers must not be mirrored.

## What is weak today

1. **Discard is a lie of omission.** It hides a row that is still there. Either
   the UI must say "hidden for you, still on the record", or the platform needs a
   dismissal row. Today a reload undoes the user's decision.
2. **No per-message `dir`.** Arabic bodies in an LTR page and vice versa.
3. **Untranslated AI chrome.** "Drafted by", "Accept", "Discard", "Evidence",
   "Model confidence" ship English from `@lyra/ui`.
4. **Raw refs everywhere.** "Assigned to" shows `user:usr_01J…`; handover "Hand
   to" is a free-text field where you must type an actor ref. There is no person
   picker and no name resolution for anyone but the customer.
5. **Sentiment is a bare signed integer** (−58, 42, 64) with no scale, no
   anchor, no legend. CSAT is a bare 1–5 with no label.
6. **The composer does not stick.** On a long thread you scroll past the whole
   archive to reach the reply box, and the draft block sits between the thread
   and the composer.
7. **No attachment rendering**, though `attachmentsJson` exists and is a column
   on the Messages list.
8. **Paging is one-way and coarse.** "Load older messages" re-fetches 50 more
   from the top each time, capped at 10 pages; there is no jump-to-date.
9. **QA's 70 threshold is invisible.** A 52 and a 66 both render "warning"; the
   bar is never drawn or named.
10. **Closed conversations still show a live composer.** Only Assign and Approve
    are disabled when `state === "closed"`; "Send reply" is not.

---

# 2. The generated pattern (read once, applies to §3–§11)

Every remaining ORBIT screen is produced by two files:
`apps/web/app/routes/module.tsx` (list) and `apps/web/app/routes/record.tsx`
(record), driven by the declarative spec in `apps/web/app/modules/orbit.ts`.
There is no per-resource UI code. A designer changing one of these screens is
changing all of them, in every module, unless they propose a bespoke route.

## List screen anatomy

```
┌──────────────────────────────────────────────────────────────────────┐
│ Conversations                                    font-display 24     │  ← always the WORKSPACE
│ [Conversations][Messages][Renewals][Journeys][Journey runs]…         │     name (nav.orbit),
│  ↑ h-8 rounded-md px-3 text-13; active = bg-surface-2 font-medium    │     never the tab name
├──────────────────────────────────────────────────────────────────────┤
│ [search?] [Select filter] [Select filter] [Live records ▾] [Apply] [Clear] │
├──────────────────────────────────────────────────────────────────────┤
│ ▸ +  New — Conversations            <details>, closed by default     │
├──────────────────────────────────────────────────────────────────────┤
│ Col1 (link) │ Col2 │ Col3 │ … sticky header, density="compact"       │
│ …rows…                                                               │
│ ────────────────────────────────────────────────────────────────────│
│ 12 shown                                        [Previous] [Next]    │
└──────────────────────────────────────────────────────────────────────┘
```

- **`h1` is `nav.orbit` = "Conversations" on all nine tabs.** The tab name only
  appears in the tab strip and the table `caption`. Being on
  `/orbit/qa-scores` still says "Conversations" at the top.
- Tab strip renders only when the actor can read more than one tab; it lists only
  readable tabs. All four `orbit.*` roles and `tenant.admin` see all nine.
  `north.*` and `partner.*` see one or two — and with one, the strip disappears.
- Filter bar renders only if the tab declares `search`, `filters`, or the actor
  can restore. Filters are `Select`s whose first option is `common.all` = "All";
  placeholder is the filter's own label. Submits as `method="get"`, so filters
  live in the URL.
- "Clear" (`common.clear`, ghost) appears only when a filter or `q` is set.
- Deleted view: `?deleted=1` only, deliberately — the API coerces with
  `Boolean(value)` so `?deleted=false` would switch it on. Banded warning strip:
  **"You are looking at deleted records. They stay out of the live list until you
  restore them."** + "Back to live records".
- Create panel: a `<details>` disclosure labelled `+ New — {tab}`, **not a
  modal**, closed by default, forced open when the last create was rejected.
  Renders only when the tab declares `fields` *and* the actor holds `create`.
- Table: `density="compact"` (34px rows), `stickyHeader`, caption
  `Conversations — {tab}`. Numeric and money columns right-align (`numeric`).
  Only columns marked `sortable` have a sort control; clicking sets `?sort=&order=`
  and drops the cursor.
- **The first column is the only link into the record.** A whole-row click was
  rejected as unreachable from a keyboard. In the deleted view even that is plain
  text.
- Cell rendering (`components/fields.tsx`): null/undefined/`""` → `—` in subtle;
  `money` → `Money` if a currency sibling exists, else a bare `tabular-nums`
  number; `date` → day precision, `datetime` → minute precision; `boolean` →
  "Yes"/"No"; `json` → `font-mono text-11` truncated at **60 chars**; `text` with
  `badge: true` → `Badge size="sm" dot` toned by a shared status table; other
  text truncated at **80 chars**.
- Shared status tones: `active`/`done`/`issued`/`settled`/`posted` = success,
  `running`/`review`/`in_progress` = info, `pending`/`blocked`/`approval` =
  warning, `failed`/`rejected`/`cancelled`/`lapsed` = danger,
  `draft`/`open`/`closed`/`intake` = neutral. **Anything not in that table is
  neutral** — which is why most ORBIT badges (`bot`, `human`, `whatsapp`,
  `queued`, `offered`, `scheduled`, `lost`, `halted`, `waiting`) render grey.
- Footer: `common.rows` = **"{count} shown"** — the count of rows on *this page*,
  never a total. Keyset paging: "Next" follows the returned cursor; "Previous"
  returns to the **first** page, keeping filters. A `ponytail:` comment says a
  cursor stack can come later.
- Empty states: `common.empty.title` "Nothing here yet" +
  `common.empty.body` "No records match this view. Clear the filters, or create
  the first one."; with filters applied, the body becomes
  `common.empty.filtered` "No records match these filters."; in the deleted view,
  "Deleted records" + "Nothing has been deleted here."

## Record screen anatomy

```
┌──────────────────────────────────────────────────────────────────────┐
│ Back to list                                                          │
│ {first column's value}                            font-display 24     │
│ Conversations · cnv_01JX…                         12 subtle + mono    │
│ [Open thread]   ← only if the tab declares recordLink                 │
├──────────────────────────────────────────────────────────────────────┤
│ ╭ dl, 1/2/3 columns, rounded-lg border p-4 ─────────────────────────╮ │
│ │ External reference   Customer      Channel                        │ │
│ │ CDR-…                cus_…         WhatsApp                       │ │
│ │ …every declared column, then Created and Updated…                 │ │
│ ╰───────────────────────────────────────────────────────────────────╯ │
├──────────────────────────────────────────────────────────────────────┤
│ ╭ Edit ─────────────────── only with the update permission ─────────╮ │
│ │ [field] [field]                                    2-col from sm  │ │
│ │ [Save changes]                                                    │ │
│ ╰───────────────────────────────────────────────────────────────────╯ │
│ ─────────────────────────────────────────────────────────────────────│
│ [Delete]  ← danger sm, only with the remove permission, window.confirm│
└──────────────────────────────────────────────────────────────────────┘
```

- Heading = the value of the tab's **first declared column**, stringified. When
  that column is empty the heading is an empty `h1`.
- Subtitle: `{tab label} · {id in font-mono}`.
- The detail list shows every declared column plus `Created` / `Updated`
  (minute precision) when present. It uses the same `Cell` renderer as the table,
  so a `json` column is still truncated at 60 characters here — the record screen
  is **not** a fuller view of a JSON column than the list is.
- The form *is* the record; there is no separate edit mode. `editable` defaults
  to `fields` when not declared. An empty string means "not supplied", not
  "clear" — only the JSON editor can express null.
- Delete is soft: `common.deleteConfirm` = **"Delete this record? It is retained
  for audit and can be restored by an administrator."** via `window.confirm`.
- No ORBIT resource declares `actions`, so the "Actions" section never renders in
  this module.

---

# 3. Conversations

## Route + title

`/orbit/conversations` (list) and `/orbit/conversations/:id` (record).
API `/v1/orbit/conversations`. Id prefix `cnv`. Tab label `conversations` =
**"Conversations"** / "المحادثات". Page `h1` is "Conversations" either way.

## Who sees it

Read `orbit:conversations:read` · create `orbit:conversations:reply` · update
`orbit:conversations:assign` · no remove.

- `orbit.agent`: reads, and holds `reply` so **sees the create panel**, but lacks
  `assign` → **no Edit form on the record**.
- `orbit.lead`, `orbit.admin`, `platform.admin`: create + edit.
- `orbit.retention`: reads + create panel (holds `reply`), no edit.
- `orbit.partners`: read only — no create panel, no edit.
- `tenant.admin`: read only.
- Everyone else: tab absent. Direct URL → "Your roles do not include access to
  this area."

## Purpose

The queue: every conversation the tenant is having, newest activity first.

## Table columns

Default sort `lastMessageAt desc` (the index is `(tenant, state, lastMessageAt)`).

| # | Header (en / ar) | Field | Type | Align | Sortable | Notes |
|---|---|---|---|---|---|---|
| 1 | External reference / المرجع الخارجي | `externalRef` | text | start | no | **The link into the record.** Seed values are channel handles: `wa:971501234567`, `web:sess-2601-0417`, `email:thread-9f21`, `portal:alpha-brokers`, `cc:call-77120` |
| 2 | Customer / العميل | `customerId` | text | start | no | raw `cus_…` id |
| 3 | Channel / القناة | `channel` | badge | start | no | WhatsApp / Web / Voice / Email / Agent — all neutral |
| 4 | State / الوضع | `state` | badge | start | no | Bot / Human / **Closed (neutral)** |
| 5 | Assignee / المكلف | `assigneeRef` | text | start | no | raw `user:…` |
| 6 | Intent / القصد | `intent` | text | start | no | raw dotted key: `renewal.offer`, `claim.first_notice`, `quote.compare`, `policy.document`, `partner.settlement`, `renewal.callback`, `coverage.question`, `policy.certificate` |
| 7 | Sentiment / المشاعر | `sentiment` | number | **end** | no | −100…100 |
| 8 | Satisfaction / رضا العميل | `csat` | number | **end** | no | 1–5, mostly `—` |
| 9 | First response / زمن أول رد | `firstResponseMs` | number | **end** | no | **raw milliseconds** |
| 10 | Closed / تاريخ الإغلاق | `closedAt` | datetime | start | no | |
| 11 | Last message / آخر رسالة | `lastMessageAt` | datetime | start | **yes** | |

Filters: **State** (Bot / Human / Closed) and **Channel** (WhatsApp / Web /
Voice / Email / Agent). No search — the API does not register conversations as
searchable.

## Forms

**Create** (`+ New — Conversations`, needs `orbit:conversations:reply`):

| Field | Label | Type | Required | Options / default |
|---|---|---|---|---|
| `channel` | Channel | Select | **yes** | whatsapp / web / voice / email / agent; placeholder `…` |
| `customerId` | Customer | text | no | — |
| `externalRef` | External reference | text | no | — |
| `lang` | Language | text | no | free text, no validation |

**Edit** (record, needs `orbit:conversations:assign` — "routing and closing, not
rewriting history"):

| Field | Label | Type | Options |
|---|---|---|---|
| `state` | State | Select | Bot / Human / Closed |
| `assigneeRef` | Assignee | text | — |
| `teamId` | Team | text | — |
| `summary` | Summary | Textarea | — |

Error copy is whatever the API's problem document says, rendered in the red
`Problem` block. There is no client-side validation beyond HTML `required`.

## States

Standard list/record states from §2. On seeded data the list shows **8 rows**,
5 of which have no messages at all and only a summary — including the two
Arabic-only threads and the "Alpha Brokers asking why a bind reversed" partner
thread.

## AI surfaces

None on the list or record. The ✦ only appears once you open the thread.

## Actions and consequences

- Editing `state` here is a plain PATCH — it does **not** set `closedAt` the way
  the thread's Close button does. Two paths to the same column, one of which
  leaves the timestamp behind.
- No approval gate, no ledger. No delete (soft or otherwise) is offered.

## Mobile

`/orbit` resolves to `orbit/conversations`, so this is the **only** ORBIT
resource on mobile. Generic list: `FlatList`, "Back" button, title
"Conversations", `list.count`, tap to push `/m/orbit/{id}`. **No filters, no
search, no paging, no create.** Rows title from the first match of
`name|title|reference|subject|code|email|key|id` — a conversation has none of
them, so **every mobile row is titled with its raw `cnv_…` id**, subtitled with
the untranslated `state` string.

## RTL notes

The tab strip, table and filter bar mirror wholesale. `tabular-nums` columns keep
LTR digits. The `externalRef` values (`wa:971501234567`) are LTR strings inside an
RTL row and will need `dir="ltr"` on the cell to stop the colon jumping.

## What is weak today

- "First response" prints raw milliseconds (`184000`), not "3m 4s".
- Sentiment, satisfaction and first response are three unlabelled numbers in a
  row — no thresholds, no colour, no units.
- Customer and Assignee are opaque ids; the queue cannot be read as "who is
  waiting on whom".
- 11 columns at compact density on a table that also has to hold a summary
  nowhere — the summary is the most useful field on the record and is not a
  column at all.
- No way to reach the thread from the list: you must open the record first, then
  press "Open thread".

---

# 4. Messages

## Route + title

`/orbit/messages`, `/orbit/messages/:id`. API `/v1/orbit/messages`. Id prefix
`msg`. Tab label **"Messages"** / "الرسائل".

## Who sees it

Read `orbit:messages:read` · create `orbit:messages:send` · **no update, no
remove — the resource is registered `immutable: true`**.

All four `orbit.*` roles plus `tenant.admin` read it. `orbit.agent`,
`orbit.lead`, `orbit.retention`, `orbit.admin` also get the create panel;
`orbit.partners` and `tenant.admin` do not. Nobody gets an Edit form, ever.

The API registers `pii: { content: "text" }` on this resource. A code comment
records that the column used to be named `body` in the masking rule, so *"every
message body was readable without `core:pii:view` — a masking rule that masked no
column."* The naming is fixed; masking now applies to `content`.

## Purpose

Every turn in the tenant, across every conversation, as one flat searchable-by-
filter list. Used for spot checks and delivery-failure sweeps, not for reading a
conversation.

## Table columns

Default sort `ts desc`.

| # | Header | Field | Type | Align | Sortable |
|---|---|---|---|---|---|
| 1 | Message / الرسالة | `content` | text | start | no |
| 2 | Conversation / المحادثة | `conversationId` | text | start | no |
| 3 | Sender / المرسل | `role` | badge | start | no |
| 4 | Modality / الوسيط | `modality` | text | start | no |
| 5 | Delivery / التسليم | `deliveryStatus` | badge | start | no |
| 6 | External reference | `externalRef` | text | start | no |
| 7 | When / الوقت | `ts` | datetime | start | **yes** |
| 8 | Attachments / المرفقات | `attachmentsJson` | json | start | no |

Column 1 is the link into the record — **and it is truncated at 80 characters**,
so the clickable target is a sentence fragment ending mid-word. Attachments is
deliberately last: "a turn with five files should not push the turn itself off
the side of the table."

Badge labels: Customer / AI agent / Human agent / System; Queued / Sent /
Delivered / Read / Failed. **All render neutral grey** — none of these values are
in the shared tone table, so `failed` is not red here even though it is red in
the thread.

Filters: **Sender** (Customer / AI agent / Human agent / System) and **Delivery**
(Queued / Sent / Delivered / Read / Failed).

## Forms

**Create** — a raw message injector:

| Field | Label | Type | Required |
|---|---|---|---|
| `conversationId` | Conversation | text | **yes** |
| `role` | Sender | Select (customer / agent_ai / agent_human / system) | **yes** |
| `content` | Message | Textarea | **yes** |

No `ts` field, no `deliveryStatus` field — unlike the thread composer, which
supplies both. No edit form. No delete.

## States

Standard. Seeded: **12 rows** across 3 conversations (8 on the renewal thread
including the unapproved draft, 2 on the quote comparison, 2 on the Arabic
accident misfire).

## AI surfaces

**None.** `aiAuditId` is not a column, so an AI-written turn is
indistinguishable from a human one in this list — the ✦ that marks it in the
thread is absent here. That is a documented gap, not a design choice.

## Actions and consequences

Creating a message here is the same consequential outbound write the thread
performs, with **less ceremony**: no idempotency key from the UI, no hint text,
no delivery-status honesty line. Irreversible — no edit, no delete, ever.

## Mobile

Web only.

## RTL notes

Arabic message bodies sit in the same cell as English ones with no per-row `dir`.
`externalRef` values (`wamid.HBgMOTcxNTAxMjM0NTY3AA01`) are LTR tokens.

## What is weak today

- The truncated-at-80 first column is both the content preview and the only link.
- No ✦ on AI turns.
- Delivery `failed` renders grey.
- The create form can inject a `customer` turn — a message purporting to be from
  the customer, with no marker distinguishing it from a real inbound one.
- Attachments render as truncated JSON.

---

# 5. Renewals

## Route + title

`/orbit/renewals`, `/orbit/renewals/:id`. API `/v1/orbit/renewals`. Id prefix
`rnw`. Tab label **"Renewals"** / "التجديدات".

## Who sees it

Read `orbit:renewals:read` · update `orbit:renewals:update` · **no create, no
remove** — "a renewal is created by the expiry sweep, never by hand — so no
`fields`."

| Role | Sees tab | Can edit |
|---|---|---|
| `orbit.retention` | yes | **yes** — this is their book |
| `orbit.lead`, `orbit.admin` | yes | yes |
| `orbit.agent`, `orbit.partners` | yes | no |
| `tenant.admin` | yes | no |
| **`north.exec`, `north.analyst`** | yes — and **this is the only ORBIT tab they see**, so the tab strip does not render for them at all | no |

## Purpose

The retention book: every policy inside its expiry window, with a churn score and
a chosen strategy.

## Layout note

Default sort is `expiryAt` **ascending** — the soonest expiry is at the top. It
is the only ORBIT tab that sorts ascending.

## Table columns

| # | Header | Field | Type | Align | Sortable |
|---|---|---|---|---|---|
| 1 | Policy reference / مرجع الوثيقة | `policyRef` | text | start | no |
| 2 | Customer | `customerId` | text | start | no |
| 3 | Expires / تاريخ الانتهاء | `expiryAt` | **date** (day precision) | start | **yes** |
| 4 | Churn risk / احتمال الفقد | `churnScore` | number | end | no |
| 5 | Strategy / الاستراتيجية | `strategy` | badge | start | no |
| 6 | State / الوضع | `state` | badge | start | no |
| 7 | Offered / تاريخ العرض | `offeredAt` | datetime | start | no |
| 8 | Decided / تاريخ القرار | `decidedAt` | datetime | start | no |
| 9 | Owner / المسؤول | `ownerRef` | text | start | no |
| 10 | Re-quotes / عروض إعادة التسعير | `requotesJson` | json | start | no |

Badge labels: Auto re-quote / Human / Do not contact; Scheduled / Offered /
Accepted / Lost. All neutral except **Lost**, which is also neutral (`lost` is
not in the tone table — only `lapsed` is). So a lost renewal looks identical to a
scheduled one.

Filters: **State** (Scheduled / Offered / Accepted / Lost) and **Strategy**
(Auto re-quote / Human / Do not contact).

## Forms

No create. **Edit** (`orbit:renewals:update`):

| Field | Label | Type | Options |
|---|---|---|---|
| `strategy` | Strategy | Select | auto_requote / human / do_not_contact |
| `state` | State | Select | scheduled / offered / accepted / lost |
| `ownerRef` | Owner | text | — |
| `outcomeReason` | Outcome reason | text | — |

`outcomeReason` is edit-only: it is not a column, so once written it is visible
only in the form field on the record screen.

## States

**On a fresh demo this list is empty.** `packages/core/src/seed/orbit.ts` states
it outright: *"`orbit_renewals` is deliberately absent: the scheduled sweep
raises those rows from the policy book (`apps/api/src/engines/renewals.ts`) and
seeding them by hand would collide with its per-policy unique index."* So the
screen a demo opens shows **"Nothing here yet" / "No records match this view.
Clear the filters, or create the first one."** — and the second half of that
sentence is wrong here, because creating one is impossible by design.

## AI surfaces

None on this screen. Churn scoring and offer drafting happen in the journey
(`renewal_45d` v2 has a `score_churn` agent node and a `draft_offer` node gated
on the `orbit.outbound_send` approval), and the draft surfaces in the thread, not
here.

## Actions and consequences

Editing `state` to `accepted` or `lost` is a bare column write with no side
effects, no approval and no ledger entry. The re-quotes the sweep gathered sit in
`requotesJson` as truncated JSON and cannot be acted on from this screen.

## Mobile

Web only.

## RTL notes

Dates mirror; the `DateTime` component takes the locale, and `DatePicker`
supports `calendar="islamic-umalqura"` where a form uses one (this tab's edit
form has no date field).

## What is weak today

1. **The empty state tells the user to create a record they cannot create.**
2. Churn risk is an unlabelled 0–100 integer with no threshold and no colour.
3. "Lost" and "Scheduled" render identical grey badges.
4. Re-quotes — the actual retention decision — are 60 characters of truncated
   JSON.
5. `outcomeReason` is write-only from the operator's point of view.
6. `north.exec` lands on a single-tab workspace whose `h1` says "Conversations".

---

# 6. Journeys

## Route + title

`/orbit/journeys`, `/orbit/journeys/:id`. API `/v1/orbit/journeys`. Id prefix
`jrn`. Tab label **"Journeys"** / "الرحلات".

## Who sees it

`rw("orbit:journeys")` — read `orbit:journeys:read`, and create/update/**remove**
all on `orbit:journeys:write`. This is the only ORBIT resource where the actor
can soft-delete, so it is also the only ORBIT tab with the **deleted-records
Select** in the filter bar.

`orbit.lead`, `orbit.admin`, `platform.admin` write. `orbit.agent`,
`orbit.retention`, `orbit.partners`, `tenant.admin` read only.
`orbit:journeys:publish` exists in the permission catalogue but **no UI uses it**
— publishing is done by editing `status` to `active`.

## Purpose

The automation graphs: what happens to a customer without anyone typing.

## Table columns

Default sort `createdAt desc` (the API default; the tab declares no `sort`).

| # | Header | Field | Type | Align | Sortable |
|---|---|---|---|---|---|
| 1 | Key / المفتاح | `key` | text | start | no |
| 2 | Version / الإصدار | `version` | number | end | no |
| 3 | Status / الحالة | `status` | badge | start | no |
| 4 | Created by / أنشأه | `createdBy` | text | start | no |
| 5 | Created / تاريخ الإنشاء | `createdAt` | datetime | start | **yes** |

Badges: **Draft (neutral) / Active (success) / Paused (warning*) / Retired
(neutral)** — `active` is in the shared tone table so it really is green;
`paused` is **not**, so it renders neutral despite the tone table having a
`warning` slot that would fit.

Filter: **Status** (Draft / Active / Paused / Retired).

**The graph is not a column.** Neither is the name. A designer looking at this
list sees five columns of metadata about a thing whose entire substance
(`graphJson`) is invisible until the record screen, where it is truncated to 60
characters.

## Forms

**Create** (`orbit:journeys:write`):

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `key` | Key | text | **yes** | e.g. `renewal_45d` |
| `version` | Version | number | **yes** | integer |
| `nameJson` | Name | **json** | **yes** | the operator types `{"en":"…","ar":"…"}` by hand |
| `graphJson` | Graph | **json** | **yes** | the whole automation graph, typed as raw JSON into a `Textarea` |

**Edit**: `status` (Select) and `graphJson` (json). Key and version are
immutable in practice — a new version is a new row.

JSON fields render as a `Textarea` pre-filled with 2-space-pretty JSON. Invalid
JSON throws inside `bodyFrom` before the request is made; there is no field-level
error message for it.

## States

Seeded: **6 journeys** — `renewal_45d` v1 (retired) and v2 (active),
`onboarding_new_policy` (active), `document_chase` (paused),
`winback_lapsed`, `broker_activation` (active). Node types in the seeded graphs:
`trigger`, `message`, `wait`, `task`, `agent`, `survey`, `wait_for`, `end`. Two
agent nodes carry `approval: "orbit.outbound_send"`.

## AI surfaces

None in the UI. The AI is *inside* the data — `{ key: "draft_offer", type:
"agent", agent: "renewal", approval: "orbit.outbound_send" }` is a string in a
truncated JSON cell. There is no ✦ anywhere on this screen and no indication
which journeys invoke an agent.

## Actions and consequences

- Editing `status` to `active` publishes a journey to every matching customer.
  **No confirm, no approval gate, no ✦, no preview.** It is a `Select` and a
  "Save changes" button.
- Delete is soft, guarded only by `common.deleteConfirm`.
- No ledger.

## Mobile

Web only.

## RTL notes

`nameJson` holds `{en, ar}` but the list never renders it, so there is nothing
bilingual to mirror. JSON textareas are LTR content in an RTL page.

## What is weak today

1. **A journey builder rendered as a JSON textarea.** This is the single biggest
   design gap in ORBIT after the thread.
2. The journey's own name is never displayed anywhere.
3. Activating a journey — a mass outbound action — has less friction than
   deleting one record.
4. Versioning is manual and unenforced: nothing stops two rows at v2.
5. `orbit:journeys:publish` is a permission with no affordance.

---

# 7. Journey runs

## Route + title

`/orbit/journey-runs`, `/orbit/journey-runs/:id`. API `/v1/orbit/journey-runs`.
Id prefix `jrr`. Tab label **"Journey runs"** / "مسارات الرحلة".

## Who sees it

Read-only for everyone: `ro("orbit:journeys:read")`. No create, no update, no
delete, no Edit form for anybody including `platform.admin` — *"the scheduler
owns every column."*

## Purpose

Where each customer currently stands inside a graph.

## Table columns

Default sort `nextAt` **ascending** — what the scheduler will touch next, first.

| # | Header | Field | Type | Align | Sortable |
|---|---|---|---|---|---|
| 1 | Journey / الرحلة | `journeyId` | text | start | no |
| 2 | Customer | `customerId` | text | start | no |
| 3 | Node / العقدة | `node` | text | start | no |
| 4 | State / الوضع | `state` | badge | start | no |
| 5 | Next step / الخطوة التالية | `nextAt` | datetime | start | **yes** |
| 6 | Updated / تاريخ التحديث | `updatedAt` | datetime | start | **yes** |

Badges: Running (**info**, blue — `running` is in the shared table) / Waiting
(neutral) / Done (**success**) / Halted (neutral).

Filter: **State** (Running / Waiting / Done / Halted).

`contextJson` — which holds the actual reason a run is where it is — is **not a
column and not on the record screen** (the record renders declared columns only).

## Forms

None.

## States

Seeded: **5 runs**, all belonging to Rania (a run is unique per journey+customer
and she is the only seeded customer). One is `halted` at `remind_2` with
`contextJson` recording `error: { code: "channel.template_rejected" }` and
`resumeRequires: "approved WhatsApp template or a manual call"` — none of which
is visible in the UI.

## AI surfaces

None.

## Actions and consequences

None available. A halted run cannot be resumed, retried or cancelled from this
screen. There is no affordance at all.

## Mobile

Web only.

## RTL notes

Nothing special; all columns are ids, enums or dates.

## What is weak today

1. A halted run is a dead end — the diagnosis exists in `contextJson` and is
   never shown.
2. No resume/retry/cancel action of any kind.
3. Journey shows as `jrn_01J…`, not `renewal_45d v2`.
4. "Node" is a bare graph key (`wait_5d`, `remind_2`) with no sense of position
   or progress.

---

# 8. Partners

## Route + title

`/orbit/partners`, `/orbit/partners/:id`. API `/v1/orbit/partners`. Id prefix
`ptn`. Tab label **"Partners"** / "الشركاء".

## Who sees it

Read `orbit:partners:read` · create `orbit:partners:create` · update
`orbit:partners:update` · no remove.

- `orbit.partners`: full read/create/update, plus `orbit:partners:certify` and
  `orbit:partner_keys:issue_test` — **neither of which has any UI**.
- `orbit.lead`, `orbit.admin`: full.
- `orbit.agent`, `orbit.retention`, `tenant.admin`: read only.
- **`partner.developer`** (`dev:sandbox:use`, `dev:keys_test:issue`,
  `orbit:partners:read`) and **`partner.manager`**: see only Partners and Partner
  transactions. Two tabs, so the strip renders with two entries.

## Purpose

The counterparties writing business on the tenant's behalf.

## Table columns

Default sort `createdAt desc`. **This is the only ORBIT tab with a search box**
(`searchable: ["name"]` in the API registry, `search: true` in the spec).

| # | Header | Field | Type | Align | Sortable |
|---|---|---|---|---|---|
| 1 | Name / الاسم | `name` | text | start | no |
| 2 | Kind / النوع | `kind` | text (**not** badge) | start | no |
| 3 | Status / الحالة | `status` | badge | start | no |
| 4 | Sandbox / بيئة اختبار | `sandboxFlag` | boolean → "Yes"/"No" | start | no |
| 5 | Created | `createdAt` | datetime | start | **yes** |

Kind labels: Telco / **Motor** (the raw value is `auto` — the domain pack renames
it, because `kind` has no broker slot yet and a motor broker files under `auto`
rather than inventing a value the API would reject) / Super app / Bank.

Status is free text in the data, not an enum: seeded values are `active`
(**success**), `pending` (**warning**), `suspended` (**neutral** — not in the
tone table).

Filter: **Kind** (Telco / Motor / Super app / Bank). Search box placeholder and
aria-label are both `common.search` = "Search".

## Forms

**Create** — and this is the one ORBIT create that is gated:
`approval: { create: "dist.partner_activate" }` in the API registry.

| Field | Label | Type | Required |
|---|---|---|---|
| `name` | Name | text | **yes** |
| `kind` | Kind | Select (telco / auto / superapp / bank) | **yes** |
| `sandboxFlag` | Sandbox | Checkbox | no (unchecked = false) |
| `revshareJson` | Revenue share | json | no |
| `contactJson` | Contact | json | no |

**Edit**: `status` (**plain text input**, not a Select — so an operator can type
any string into the column the badge reads), `sandboxFlag`, `revshareJson`,
`contactJson`.

## States

Seeded: **5 partners** — Alpha Brokers (`auto`, active, live key), Meridian Bank
(`bank`, active), Etisalat Mobility (`telco`, **pending**, sandbox — explicitly
waiting on the `dist.partner_activate` approval), Careem Everything (`superapp`,
active, sandbox), Gulf Auto Mall (`auto`, **suspended**, kept because historic
transactions still have to settle).

A create that trips the approval gate returns a problem document; the UI shows it
in the red `Problem` block above the (re-opened) create panel. There is **no
approval-specific treatment** here — no `GuardrailNotice`, no "awaiting approval"
chip, unlike the thread.

## AI surfaces

None.

## Actions and consequences

- **Create goes through the `dist.partner_activate` approval gate** — the only
  approval-gated write in the whole ORBIT workspace.
- Editing `status` is not gated at all, so the column the approval protects can
  be typed into freely afterwards.
- `revshareJson` carries `defaultSharePpm`, per-line `overrides` and a
  `settlement` block (`{frequency, dayOfMonth, netDays, minPayoutMinor}`) — money
  terms, edited as raw JSON with no validation and no ledger linkage.
- No delete: a partner is suspended, never removed.

## Mobile

Web only.

## RTL notes

Partner names are Latin script in the seed; contact emails and phone numbers are
LTR tokens inside potentially RTL cells.

## What is weak today

1. **Revenue share — real money terms — is a JSON textarea**, truncated to 60
   characters in the list and on the record.
2. Status is an unconstrained text input feeding a badge.
3. The approval gate on create is invisible in the UI until it fires, and then it
   looks like an error.
4. `orbit:partners:certify` and `orbit:partner_keys:issue_test` /
   `issue_live` have no affordance anywhere. The seeded `apiKeyRef` values
   (`alpha-brokers-live`, `careem-sandbox`) are not even columns.
5. Sandbox is a "Yes"/"No" text cell for something that should be unmistakable.

---

# 9. Partner transactions

## Route + title

`/orbit/partner-txns`, `/orbit/partner-txns/:id`. API `/v1/orbit/partner-txns`.
Id prefix `ptx`. Tab label **"Partner transactions"** / "معاملات الشركاء".

## Who sees it

`ro("orbit:partners:read")` — **read-only for every role including
`platform.admin`**. No create, no edit, no delete.

Same audience as Partners, plus `partner.manager` who also holds
`ledger:txns:read`.

## Purpose

What each partner wrote and what they are owed for it.

## Table columns

Default sort `ts desc`.

| # | Header | Field | Type | Align | Sortable |
|---|---|---|---|---|---|
| 1 | Transaction reference / مرجع المعاملة | `txnRef` | text | start | no |
| 2 | Partner / الشريك | `partnerId` | text | start | no |
| 3 | Kind / النوع | `kind` | text | start | no |
| 4 | Amount / المبلغ | `amountMinor` | **money**, currency from `currency` | **end** | no |
| 5 | Partner share / حصة الشريك | `revshareCalcMinor` | **money**, currency from `currency` | **end** | no |
| 6 | Settlement batch / دفعة التسوية | `settlementBatch` | text | start | no |
| 7 | When / الوقت | `ts` | datetime | start | **yes** |

Kind labels: Quote / Bind / Refund. Filter: **Kind** (Quote / Bind / Refund).

Money renders through `Money` with minor units and the row's own currency. A
money value with **no** currency beside it deliberately renders as a bare number
— "a number with no currency beside it is not money".

**Column 1 is `txnRef`, and the seed sets it to `null` on every row** — it points
at a ledger transaction and no journal has been posted for these. So the list's
first column, the only link into each record, is `—` on all 8 seeded rows. The
link still works (the `—` is wrapped in the link), but it is an em dash.

## Forms

None.

## States

Seeded: **8 transactions** across the partners, revshare computed with the same
`splitCommission` the settlement engine uses, so the demo numbers survive
recalculation. Refunds carry negative amounts.

## AI surfaces

None.

## Actions and consequences

Nothing writable. This screen is a mirror of engine output. It does **not** write
to the ledger; it is downstream of it (and currently disconnected — `txnRef` is
null).

## Mobile

Web only.

## RTL notes

`Money` handles locale formatting. In Arabic the currency symbol and digit
grouping follow the locale; the numeric column keeps `tabular-nums` so figures
stay aligned in both directions.

## What is weak today

1. **The first column is empty on every row** and it is the only link target.
2. Partner shows as `ptn_01J…`, not "Alpha Brokers", on a screen whose entire
   purpose is per-partner money.
3. No total, no per-partner subtotal, no per-batch grouping — settlement is
   inherently a grouped question and this is a flat list.
4. Negative amounts (refunds/clawbacks) get no visual treatment.
5. No link to the ledger transaction even once `txnRef` is populated.

---

# 10. Handover notes

## Route + title

`/orbit/handover-notes`, `/orbit/handover-notes/:id`. API
`/v1/orbit/handover-notes`. Id prefix `hnd`. Tab label **"Handover notes"** /
"ملاحظات التسليم".

## Who sees it

`rw("orbit:handover")` — read `orbit:handover:read`, create/update/remove all on
`orbit:handover:write`.

`orbit.agent`, `orbit.lead`, `orbit.admin` write (so they also get the
deleted-records Select). `orbit.retention`, `orbit.partners`, `tenant.admin` read
only.

## Purpose

What one person needs the next person to know when a conversation changes hands —
written by a human or by an agent.

## Table columns

Default sort `ts desc`.

| # | Header | Field | Type | Align | Sortable |
|---|---|---|---|---|---|
| 1 | Summary / الملخص | `summary` | text (truncated at 80) | start | no |
| 2 | Conversation / المحادثة | `conversationId` | text | start | no |
| 3 | From / من | `fromRef` | text | start | no |
| 4 | To / إلى | `toRef` | text | start | no |
| 5 | Written by / مصدر الكتابة | `generatedBy` | badge | start | no |
| 6 | Accepted by / قبِلها | `acceptedBy` | text | start | no |
| 7 | When / الوقت | `ts` | datetime | start | **yes** |

Filter: **Written by** (`ai` → "AI" / `human` → "Human"). Note the list uses the
workspace labels `ai` = "AI" and `human` = "Human", whereas the *thread* renders
the same field via `role.agent_ai` = "AI agent" / `role.agent_human` = "Human
agent". Two vocabularies for one column.

## Forms

**Create**:

| Field | Label | Type | Required |
|---|---|---|---|
| `conversationId` | Conversation | text | **yes** |
| `fromRef` | From | text | **yes** |
| `toRef` | To | text | no |
| `summary` | Summary | Textarea | **yes** |
| `factsJson` | Facts | json | no |

**Edit**: `toRef`, `summary`, `acceptedBy`, `factsJson`.

Contrast with the thread's handover form, which asks for two fields and fills
`fromRef` and `generatedBy` server-side. Here the operator types `fromRef`
manually and `generatedBy` cannot be set at all on create — so a note created
from this screen has a **null** "Written by".

## States

Seeded: **5 notes**. Three `ai`, two `human`. One is deliberately left
unaccepted (the Alpha Brokers clawback note) "or 'accepted by' reads as a column
that is always filled". Longest summary: *"Collision reported in Arabic on Sheikh
Zayed Road this morning. Number is not on file and the caller says the policy is
in her husband's name. Needs FNOL, not renewal."* — 168 characters, truncated to
80 in the list.

## AI surfaces

`generatedBy = "ai"` renders as a plain neutral **Badge reading "AI"** — **not**
the ✦ `AgentBadge`, and with no "why", no confidence, no evidence, even though
`factsJson` is exactly the evidence an AI-written note extracted. This is the
one place in ORBIT where AI provenance is shown without the ambient AI grammar.

## Actions and consequences

- Editing `acceptedBy` is how a note is accepted; it is a free-text field, so
  anyone with the permission can accept a note on behalf of anyone.
- Soft delete available. No approval, no ledger.

## Mobile

Web only.

## RTL notes

Summaries are mixed-language across rows (the seed has both). No per-row `dir`.

## What is weak today

1. **An AI-written note carries no ✦** — a plain grey "AI" chip instead, breaking
   the docs/15 grammar the thread follows carefully.
2. `factsJson` — the structured handover content (language, MSISDN, matched
   customer, location, injuries) — is 60 characters of truncated JSON.
3. "Accepted by" is a text box, not an action.
4. `fromRef` / `toRef` are typed actor refs, including team refs (`team:tm_…`).
5. Two different labels for `generatedBy` between this screen and the thread.

---

# 11. Quality scores

## Route + title

`/orbit/qa-scores`, `/orbit/qa-scores/:id`. API `/v1/orbit/qa-scores`. Id prefix
`qas`. Tab label **"Quality scores"** / "درجات الجودة".

## Who sees it

Read `orbit:qa:read` · create `orbit:qa:score` · **no update, no remove** —
*"`orbit:qa:score` is a reviewer scoring a conversation against a rubric; the AI
scorer writes the same shape. Neither may amend a score after."*

Only `orbit.lead`, `orbit.admin` and `platform.admin` hold `orbit:qa:score`.
`orbit.agent`, `orbit.retention`, `orbit.partners`, `tenant.admin` read only.
`scoredBy` is an `actorColumns` field — the API stamps the actor, the client
never sends it.

## Purpose

How well a conversation was handled, against a named rubric.

## Table columns

Default sort `ts desc`. **No filters on this tab** — the only ORBIT list with
none, so the filter bar does not render at all.

| # | Header | Field | Type | Align | Sortable |
|---|---|---|---|---|---|
| 1 | Rubric / معيار التقييم | `rubricKey` | text | start | no |
| 2 | Conversation / المحادثة | `conversationId` | text | start | no |
| 3 | Score / الدرجة | `score` | number | **end** | no |
| 4 | Scored by / قام بالتقييم | `scoredBy` | text | start | no |
| 5 | Disputed by / اعترض عليها | `disputedBy` | text | start | no |
| 6 | When / الوقت | `ts` | datetime | start | **yes** |

Score is a bare right-aligned integer. **The 70 threshold that colours the badge
in the thread does not exist here** — no badge, no colour, no bar.

`breakdownJson` and `flagsJson` are create fields but **not columns**, so they
are invisible after they are written.

## Forms

**Create** (`orbit:qa:score`):

| Field | Label | Type | Required |
|---|---|---|---|
| `conversationId` | Conversation | text | **yes** |
| `rubricKey` | Rubric | text | **yes** — free text, no list of rubrics |
| `score` | Score | number | **yes** — no min, no max, no step |
| `breakdownJson` | Breakdown | json | no |
| `flagsJson` | Flags | json | no |

No edit form, no delete. A score is final.

## States

Seeded: **6 scores** across the rubrics `orbit.escalation` (52 and 61 — the same
conversation scored twice: the agent flagged itself, Sara disputed the number, a
human lead re-scored, which is the whole dispute loop visible on one
conversation), `orbit.retention_call` (88), `orbit.sales_conduct` (92),
`orbit.bot_containment` (76), `orbit.partner_support` (66). Two sit under the 70
bar.

## AI surfaces

None visible. The AI scorer writes the same rows as a human reviewer, and
`scoredBy` is the only distinction — a raw ref like `agent:qa` versus `user:…`.
There is no ✦ and no way to filter human scores from machine scores.

## Actions and consequences

- Creating a score is irreversible: no update, no delete, by design.
- **Disputing has no affordance.** `disputedBy` is a read-only column with no
  form field on create and no edit form at all — yet the seed exercises the
  dispute loop and the thread renders a red "Disputed" badge. The dispute must
  be written by something other than this UI.
- No approval, no ledger.

## Mobile

Web only.

## RTL notes

`rubricKey` values are LTR dotted keys. Score column keeps `tabular-nums`.

## What is weak today

1. **The dispute loop has no UI** despite being modelled, seeded and rendered.
2. Score is an unbounded free number with no rubric max and no visible bar.
3. `breakdownJson` and `flagsJson` — the actual reasoning behind a score — are
   write-once and never displayed anywhere.
4. Rubric is free text, so the rubric set is unenumerable from the UI.
5. No filters, so you cannot pull "everything under 70" — the exact question this
   screen exists to answer.
6. Threshold treatment differs between this screen (none) and the thread (70).

---

# Cross-cutting notes for the redesign

## Permission summary, whole module

`readsOf("orbit")` expands to seven read permissions — `conversations:read`,
`messages:read`, `renewals:read`, `journeys:read`, `partners:read`, `qa:read`,
`handover:read` — and every `orbit.*` role starts from that set. **The four ORBIT
roles therefore see identical navigation and identical tabs.** They differ only
in which buttons and forms exist:

| Affordance | agent | lead | retention | partners | admin |
|---|---|---|---|---|---|
| Reply / send message | ✓ | ✓ | ✓ | — | ✓ |
| Assign / close conversation | — | ✓ | — | — | ✓ |
| Edit conversation | — | ✓ | — | — | ✓ |
| Edit renewal | — | ✓ | ✓ | — | ✓ |
| Write journey | — | ✓ | — | — | ✓ |
| Create/edit partner | — | ✓ | — | ✓ | ✓ |
| Write handover note | ✓ | ✓ | — | — | ✓ |
| Score QA | — | ✓ | — | — | ✓ |

Withheld affordances are **absent**, never disabled. The API re-checks every one
of them; `can()` in `packages/core/src/rbac.ts` is the only authorization path,
and it fails closed on a tenant mismatch before it looks at permissions at all.

## AI grammar compliance

| Surface | ✦ | "Why" | Compliant |
|---|---|---|---|
| Thread draft block | yes | popover + evidence + confidence + audit link | yes |
| Thread historic AI turn | yes | popover | yes |
| Messages list AI turn | **no** | none | no |
| Handover note written by AI | **no** (plain "AI" chip) | none | no |
| QA score written by AI | **no** | none | no |
| Journey agent node | **no** | truncated JSON | no |

Anything new must map to a pattern in docs/15 §4 or add one via ADR. No modals,
no auto-send outside autonomy policy — the seeded `renewal` agent runs
`suggest_only`, which is why its draft sits waiting for a human.

## RTL rules that apply everywhere

- Logical properties only: `ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`,
  `border-s`/`border-e`, `text-start`. No `left`/`right` utilities exist in
  `@lyra/ui` — a test enforces it.
- Mirror: layout, tab order, table column order, bubble sides, borders,
  chevrons, the back link.
- Do **not** mirror: the ✦ mark, `font-mono` identifiers, `tabular-nums`
  figures, LTR technical strings (`wa:971501234567`, `wamid.…`, `orbit.escalation`).
- Arabic type uses IBM Plex Sans Arabic, scoped to the Arabic unicode range;
  every tenant font stack keeps it as a fallback.

## The five things a redesign should fix first

1. A journey builder that is not a JSON textarea.
2. Draft discard that means something (§1 weakness 1).
3. Names instead of ids — customer, assignee, partner, journey — everywhere.
4. JSON columns that carry real content (`requotesJson`, `revshareJson`,
   `factsJson`, `breakdownJson`, `graphJson`, `contextJson`) need a rendering
   pattern; 60 truncated characters of `{"channelId":"chn_01J…` is the module's
   most common failure mode.
5. One vocabulary for AI provenance across the thread, the message list, handover
   notes and QA scores.
