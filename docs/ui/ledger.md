# LEDGER — UI design brief

What is built today, screen by screen. Nothing here is aspirational: every label,
column, permission string and piece of copy below is taken from the code that
ships. Where a screen is weak, that is said plainly under **What is weak today**.

## Orientation

LEDGER is the money module. It owns transactions (a state machine with an
idempotency key), the double-entry journal behind them, the chart of accounts,
accounting periods, reconciliation runs, client money, settlements between us,
providers and channels, and six finance reports. Two people live here. A
**controller** (`finance.controller`, holds `ledger:*:*`) arrives at month-end:
run the trial balance, chase the pending transactions, check client money,
soft-close, hard-close. An **analyst** (`finance.analyst`, every `ledger:*:read`
plus `ledger:recon:run`) is here daily: read reports, export them, run a
reconciliation — but cannot open a transaction, post, close a period or confirm
a match. The three screens that matter most are **`/ledger/reports/:report`**
(where the numbers are read), **`/ledger/transactions/:id`** (the only place a
posting can be inspected line by line) and **`/ledger/period-close`** (the gate).
Everything else is a list.

The whole module is **web only**. The Expo app shows a generic read-only list of
`ledger/txns` at `/m/ledger` with no money formatting and no record screen. Treat
mobile as out of scope unless a section says otherwise.

---

## Foundations that apply to every LEDGER screen

Read this once; the per-screen sections assume it.

### Money rendering — the rules the code enforces

Money is stored and transported as **integer minor units** (`grossMinor`,
`amountMinor`, `debitMinor`). There are no decimals anywhere in the API.

- `<Money>` (`packages/ui`) always renders `tabular-nums`. Digits must not jitter
  between rows.
- A `<Table>` column marked `numeric` gets `text-end tabular-nums text-text`.
  **Every money column is `numeric`.** In the reports screen `moneyColumn()`
  hard-sets `numeric: true` so this cannot be forgotten.
- `signed` is used **only** on differences, running balances and margins — trial
  balance `Difference`, statement `Opening`/`Closing`/`Running`, recon `Delta` and
  `Variance amount`, P&L `Gross margin`. A debit column and a credit column are
  never signed: they are magnitudes, and the side is a separate column.
- `toned` (red/green) is used **only** on recon deltas and variances. Ledger
  debit/credit columns are never toned. A red number in LEDGER means "these two
  figures disagree", never "this is an expense".
- **Currency lives in the column header, not in the cell.** In exports,
  `labelCurrency()` puts the code in the column label or gives it its own column.
  On screen, the currency is a separate `Currency` column in every multi-currency
  table (aged, commission, client money, balances). A money value that arrives
  with no currency degrades to a plain tabular number rather than guessing.
- Negative numbers use the locale's own convention via `Intl.NumberFormat` —
  a leading minus in `en`. There are no parentheses and no red-for-negative
  outside the two `toned` cases above.
- Percentages are `Intl.NumberFormat(percent)` over a ppm value divided by
  1,000,000 (`marginPpm / 1_000_000`). Rates are stored as ppm integers
  (`ratePpm`, `baseCommissionPpm`, `channelSharePpm`) and displayed as raw ppm
  in the generic tables — that is a known ugliness, see the weak list.

### Tables

`<Table>` requires a `caption` (screen-reader text, visually hidden). Journal
lines, audit rows and statement lines pass `rowState={() => "sealed"}` — a
visual treatment that says *this row is a record, not an editable thing*. Sealed
rows must never look clickable in a redesign.

### Permission behaviour

Two different patterns exist and both must be preserved:

1. **Absence** — a tab, action or link the actor cannot use is not rendered at
   all (`visibleTabs` / `visibleActions` / `visibleLinks`). There are no
   disabled buttons in this module.
2. **A denied notice** — a bespoke route the actor reached anyway renders an
   `EmptyState`:
   - title: "You do not have permission to see this."
   - body: "This screen needs {permission}. Ask an administrator if you should
     have it." — with the literal permission string interpolated.
   The reports screen has its own wording: "You cannot open this report" / "It
   needs a permission your role does not hold. An administrator can grant it."

The permission is pre-checked in the loader before the API call, deliberately:
asking first means a 403 never reaches the audit log as a failed read the actor
did not intend.

### Who holds what (the full LEDGER truth table)

| Role key | LEDGER permissions |
|---|---|
| `finance.controller` | `ledger:*:*` — everything, plus `core:approvals:read`/`decide`, `dist:commissions:*`, `analytics:exports:unmasked` |
| `finance.analyst` | every `ledger:*:read` (txns, journals, accounts, periods, recon, invoices, payments, client_money) + `ledger:ai:invoke`, `ledger:recon:run`, `ledger:invoices:create`. **No** create, authorize, reverse, post, close, confirm, transfer |
| `tenant.admin` | `ledger:*:read` only |
| `tenant.compliance` | `ledger:client_money:read`, `ledger:journals:read` only |
| `north.admin` | `ledger:journals:read`, `ledger:txns:read` |
| `north.analyst` | `ledger:journals:read` |
| `north.exec` | `ledger:txns:read` |
| `axis.admin` | `ledger:txns:read`, `ledger:recon:read`, `ledger:recon:run` |
| `axis.agent`, `axis.lead`, `orbit.partners`, `signal.lead`, `signal.admin`, `partner.manager` | `ledger:txns:read` |
| `orbit.agent`, `orbit.retention`, `scout.lead`, `north.board`, `dev.admin`, `customer`, `provider.viewer` | none |
| `platform.admin` | `*:*:*` |

The permission constants, verbatim: `ledger:txns:read`, `ledger:txns:create`,
`ledger:txns:authorize`, `ledger:txns:reverse`, `ledger:journals:read`,
`ledger:journals:post`, `ledger:accounts:read`, `ledger:accounts:write`,
`ledger:periods:read`, `ledger:periods:close`, `ledger:recon:read`,
`ledger:recon:run`, `ledger:recon:confirm`, `ledger:invoices:read`,
`ledger:invoices:create`, `ledger:invoices:approve`, `ledger:payments:read`,
`ledger:payments:create`, `ledger:payments:refund`, `ledger:payouts:approve`,
`ledger:client_money:read`, `ledger:client_money:transfer`, `ledger:ai:invoke`.
Plus `core:approvals:read` and `core:audit:read`, which reveal two panels on the
transaction screen.

### RTL — the rule for a financial table in Arabic

The shell sets `dir="rtl"` for `ar` and the codebase uses logical properties
only (`ms-auto`, `me-2`, `ps-5`, `border-e`, `text-start`, `border-s-[3px]`).
For a money table specifically:

- **Column order mirrors.** In Arabic the first column (Account) sits at the
  right edge; Debit and Credit run leftward. This is automatic and correct.
- **Numbers never mirror.** `1 234 567` stays left-to-right inside its cell,
  whatever the paragraph direction. `Intl.NumberFormat` with the `ar` locale
  produces Arabic-Indic digits where the locale asks for them; the *digit order*
  is unchanged.
- **Numeric alignment follows the writing direction, not a physical edge.**
  `text-end` in LTR is right; in RTL it is left. So an Arabic trial balance has
  its debit and credit figures flush **left** within their columns, and the
  decimal positions still line up. Do not "fix" this to right-aligned.
- **Currency codes stay Latin** (`ZAR`, `AED`) in both directions; they are
  identifiers.
- The balance sheet uses `grid lg:grid-cols-2` rather than any physical
  positioning, because CSS grid flow is writing-mode aware: Assets sits on the
  right in Arabic without a single direction check in the code.

### The AI boundary — state this in every design

**AI is never in the money path.** There is exactly one AI surface in LEDGER:
pass 3 of a reconciliation run, opt-in per run via a checkbox that defaults
**off**. It produces `recon_matches` rows with `method: "ai_proposed"` and
`state: "proposed"` — a suggestion about which statement line probably pairs with
which transaction. It posts nothing. It never writes a journal line, never
authorises a transaction, never closes a period, never decides an approval. A
proposal only becomes a decision when a person submits Confirm or Reject **with a
reason code**, and their name goes on the row.

Where the boundary is visible to the user today:

- The recon screen's intro: "Match a counterparty statement against what we
  settled. Nothing posts here — a match is a judgement, and it is recorded as
  one."
- The propose checkbox's hint: "Proposals are never posted. Each one still needs
  a person to confirm it."
- The `How` column shows an **info-toned** badge reading "Assistant" for
  `ai_proposed`, versus a neutral badge for "Exact" / "Within tolerance" — so a
  machine-suggested pairing is visually distinct in the row it appears in.
- `Decided by` shows the human's name and their reason code beneath it.

The ✦ marker (docs/15) does **not** currently appear anywhere in LEDGER. The
"Assistant" badge is doing that job. A redesign should put the ✦ on that badge
and on nothing else in this module. Do not invent a "✦ suggest a journal entry"
affordance; there is none, and there must not be.

---

## 1. `/ledger/reports/:report` — Finance reports

**Route + title.** `apps/web/app/routes/ledger-reports.tsx`, registered as
`route("ledger/reports/:report", …)`. Page title (h1): "Finance reports".
Six values of `:report`: `trial-balance`, `pnl`, `balance-sheet`, `aged`,
`commission`, `client-money`. Labels come from the ledger workspace catalogue
under `report.*`.

**Who sees it.** Per-report permission:

| Report | Permission | Who holds it |
|---|---|---|
| trial-balance, pnl, balance-sheet, aged, commission | `ledger:journals:read` | finance.controller, finance.analyst, tenant.admin, tenant.compliance, north.admin, north.analyst |
| client-money | `ledger:client_money:read` | finance.controller, finance.analyst, tenant.admin, tenant.compliance |

A denied user still gets the h1 and the six-tab strip (the tabs themselves are
filtered by permission), and in the body an `EmptyState`: "You cannot open this
report" / "It needs a permission your role does not hold. An administrator can
grant it." No numbers leak.

**Purpose.** Read the six statutory-shaped views of the journal, filter them by
period/date/currency, and export any of them.

**Layout skeleton.**

```
┌──────────────────────────────────────────────────────────────┐
│ Finance reports                                       (h1 24)│
│ ┌ nav aria-label="Sections" ───────────────────────────────┐ │
│ │ [Trial balance] Profit and loss  Balance sheet  Aged …  │ │  ~48px
│ └──────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ ┌ GET form, inline ────────────────────────────────────────┐ │
│ │ Period [2026-07 ▾]  As at [ 📅 ]  Currency [ZAR]        │ │  ~72px
│ │                                  [Apply]  Clear         │ │
│ └──────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ ┌ KPIWall ─────────────────────────────────────────────────┐ │
│ │  Total debits      Total credits      Difference        │ │  ~110px
│ │  12 480 300        12 480 300         0                 │ │
│ └──────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ [ Discrepancy card — only when the report does not balance ] │
├──────────────────────────────────────────────────────────────┤
│ ┌ Table ───────────────────────────────────────────────────┐ │
│ │ Account │ Name │ Type │ Normal side │ Debit │ Credit │ Bal│ │  fills
│ │ 1000    │ Bank │ asset│ debit       │ 384120│      0 │ …  │ │
│ └──────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ Export:  xlsx · pdf · csv · json          (plain <a download>)│
└──────────────────────────────────────────────────────────────┘
```

**The tab strip.** `<nav aria-label={t("common.tabs")}>` — "Sections". Six links,
current one marked. Links to reports the actor cannot read are absent.

**Parameters per report** (a GET `<Form>`; changing a parameter is a navigation,
so every view is a shareable URL):

| Report | Parameters |
|---|---|
| trial-balance | `period` (month), `asOf` (date), `currency` (text, 3) |
| pnl | `period` (month) |
| balance-sheet | `asOf` (date) |
| aged | `accounts` (text), `asOf` (date) |
| commission | `by` (text — the dimension), `period` (month) |
| client-money | `currency` (text, 3) |

Input types: months use native `<input type="month">`; dates use the `DatePicker`
primitive; currency is `<Input maxLength={3}>`. Buttons: **Apply** (`common.apply`)
and a **Clear** link (`common.clear`) that navigates to the bare report path.
A date-only `asOf` is widened by `epochOf()` to `T23:59:59.999Z` — "as at the
30th" means the end of the 30th, not its first millisecond. Say so in a hint if
you redesign this; today it is silent.

**The six views.**

*Trial balance.* KPIWall: Total debits, Total credits, Difference (`signed`).
When not balanced, a `Discrepancy` alert renders above the table. Columns:
Account (mono, links to the account record when the code resolves), Name, Type,
Normal side, Debit (numeric money), Credit (numeric money), Balance (numeric
money).

*Profit and loss.* KPIs: Revenue, Cost of revenue and operating, Gross margin
(`signed`), Margin (percent from `marginPpm`). Two section tables, each with a
footer total row.

*Balance sheet.* KPIs: Assets, Liabilities, Equity. `Discrepancy` when
A ≠ L + E. Body is `grid lg:grid-cols-2`.

*Aged.* Columns: Counterparty, Currency, 0–30, 31–60, 61–90, 91–120, Over 120,
Total. All six money columns numeric. No links.

*Commission.* Columns: Value, Currency, Gross, Channel share, Net. Above the
table, a line reading "Dimension: {dimension}" naming what `by` grouped on.

*Client money.* Columns: Currency, Client bank, Owed to clients, Surplus or
shortfall, Status (Badge, dot — danger "Short" / success "Whole"). One
`Discrepancy` card per breached currency, titled "Client money is short —
{currency}", body: "The client bank position is below what is owed to clients.
This is a reportable breach: escalate it today, before the next remittance run."

**Account links.** Only `trial-balance`, `pnl` and `balance-sheet` carry account
links. They resolve through an index built from
`/v1/ledger/accounts?limit=200&sort=code&order=asc`. On 403 the index is `{}` and
the codes render as plain text — "the numbers without the links, not an error".
Accounts past the 200th lose their link (a marked shortcut in the code).

**Export.** Four plain `<a download>` links to
`${API_ORIGIN}/v1/ledger/reports/:key/export?…&format=xlsx|pdf|csv|json`. They
carry the current parameters. No progress state, no job queue — the browser
downloads. Money cells in the export are `kind: "money"`; the currency goes into
the column label or its own column, never inside the number. **PDF is offered for
every report and the API returns 400 on non-Latin text** — an Arabic tenant
clicking `pdf` gets a failed download with no explanation. Design a fix.

**States.**
- *Loading*: React Router navigation state; the Apply button shows `loading`.
- *Empty*: an empty result renders the table with zero rows and the KPIs at zero.
  There is no dedicated empty message on this screen.
- *Error*: the route error boundary — "This did not load" / "The page could not
  be built. Nothing was saved, and you can try again." with a `Reference {id}`.
- *Denied*: as above.

**AI surfaces.** None. Nothing on this screen is model-generated.

**Actions and consequences.** Read-only. Nothing here posts, nothing needs an
idempotency key, nothing passes an approval gate. The file's own header states
the rule: nothing on the screen computes money — the API sums the journal and the
screen renders what it sends, because a screen that re-derives a total is a
second source of truth and the first thing to disagree with the ledger. **A
redesign must not add client-side arithmetic, not even a subtotal.**

**Mobile.** Web only.

**RTL.** As in Foundations. The balance sheet's two-column grid reorders itself.

**What is weak today.**
1. **No drill-through.** A trial-balance row links to the *account record* (its
   code, type, normal side) — not to the journal lines that produced the figure.
   You cannot click 12 480 300 and see what makes it up. This is the single
   biggest gap in the module. The data exists (`/ledger/journal-lines` filters by
   account) and the account statement screen exists at `/ledger/statement`, but
   nothing connects the report row to either.
2. PDF export is offered where it cannot succeed.
3. The Discrepancy card tells you the totals disagree and gives you nowhere to go.
4. Six parameters across six reports, each with a different set — the form
   changes shape per tab with no indication of why.

---

## 2. `/ledger/transactions` — Open a transaction

**Route + title.** `apps/web/app/routes/ledger-open-txn.tsx`. Title:
"Open a transaction" (`open.title`). Intro (`open.intro`): "Money moves by running
a transaction type. Pick the type, give it its arguments, and the ledger posts the
recipe."

**Who sees it.** `ledger:txns:create` — **`finance.controller` only**, plus
`platform.admin`. `finance.analyst` does not hold it and gets the denied
EmptyState naming `ledger:txns:create`. The link to this screen is also withheld
from the workspace link strip for everyone else, so a denied user normally never
arrives.

**Purpose.** Run one transaction type by hand, with an idempotency key, and see
the catalogue of every type this tenant can run.

**Layout skeleton.**

```
┌──────────────────────────────────────────────────────────────┐
│ Open a transaction                                     (h1)  │
│ Money moves by running a transaction type. …          (intro)│
├──────────────────────────────────────────────────────────────┤
│ ┌ POST form ───────────────────────────────────────────────┐ │
│ │ Transaction type [BIND            ▾ 16rem]              │ │
│ │ Currency [ZAR 7rem]   Gross amount, in minor units [11r] │ │
│ │ Transaction key [────────────────────────────── req'd]  │ │
│ │ Arguments                                                │ │
│ │ ┌──────────────────────────────────────────────────────┐ │ │
│ │ │ {}                                    mono, 6 rows   │ │ │
│ │ └──────────────────────────────────────────────────────┘ │ │
│ │ JSON the recipe expects. …                        (hint) │ │
│ │ Reason [──────────────────────────────────────────]     │ │
│ │ [Open transaction]   This form carries a one-time key…  │ │
│ └──────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ ┌ Type catalogue ──────────────────────────────────────────┐ │
│ │ Code       │ Details                       │ Approvals   │ │
│ │ BIND       │ [Posts a journal]             │ —           │ │
│ │ PREM-REMIT │ [Posts a journal][Needs appr…]│ ledger.remit│ │
│ │            │ [Money out][Client money]     │             │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**The form, field by field.**

| Field | Label (key) | Type | Required | Default | Notes |
|---|---|---|---|---|---|
| `type` | Transaction type (`open.type`) | Select, `w-64` | yes | first option | Options are **bare codes** — `BIND`, `PREM-REMIT`, `CM-TRANSFER`. No human names. |
| `currency` | Currency | Input, `w-28`, `maxLength=3` | yes | `me.policy.currency` | Free text; no validation against a currency list on the client |
| `grossMinor` | Gross amount, in minor units (`open.gross`) | Input `type=number step=1 inputMode=numeric`, `w-44` | yes | empty | Minor units. 416 000 means R4 160,00 |
| `naturalKey` | Transaction key (`open.key`) | Input, `maxLength=200` | **yes** | a server-minted `web:<uuid>` | Hint: "The natural key for this transaction. Reusing it returns the same transaction." |
| `args` | Arguments (`open.args`) | Textarea, `rows=6`, `font-mono text-12` | yes | `"{}"` | Hint: "JSON the recipe expects. The ledger validates it and names the fields it wanted if any are missing." |
| `reason` | Reason | Input, `maxLength=500` | no | empty | |
| `headerKey` | — | hidden | — | `web.open:<uuid>` | Sent as the `idempotency-key` HTTP header |

Submit: **Open transaction** (`open.submit`), preceded by
`confirm("Open this transaction? It posts to the ledger.")`. Beneath the button,
always: "This form carries a one-time key, so pressing twice posts once."

**Both keys are minted server-side, once per form render.** This is load-bearing:
a key the browser generates at submit time is a new key on every press, which is
exactly the double-post the header exists to stop. A redesign must not move key
generation into the client.

**The `args` problem, and the form this actually needs.** `GET /v1/ledger/txn-types`
publishes the catalogue — code, `financial`, approval policy key, `payout`,
`clientMoney` — but **not each recipe's argument schema**, which is private to
`packages/ledger`. So the screen falls back to a raw JSON textarea and renders
the API's field-error map beside it. The real schemas exist and are small. The
recipes and what they take:

- **Commission accrual** (`BIND`, `BIND-GROUP`, `RENEW`, `ENDORSE`, `REINSTATE`,
  `PARTNER-BIND`, `AGENT-BIND`, `CMSN-ACCR`, `FEE-BROK`, `FEE-SERVICE`,
  `REFERRAL-SETL`, `FIN-CMSN`, `AD-PLACEMENT`, `EXT-RSHARE`): either an explicit
  split — `grossMinor`, `channelMinor`, `taxMinor` — **or** the inputs to compute
  one: `premiumMinor`, `baseCommissionPpm`, `channelSharePpm`, `taxPpm`,
  `flatFeeMinor`. Plus `incomeAccount` (default varies by code: 4000 new, 4010
  renewal, 4020 brokerage, 4030 referral, 4070 ads, 4075 marketplace),
  `receivableAccount` (default 1100, or 1150 financier / 1160 trade),
  `memo`, `dims`.
- **Settlement** (`CMSN-SETL`, `PSP-SETTLE`): `amountMinor`, `receivableAccount`,
  `cashAccount` (1000), `feeMinor`.
- **Clawback** (`CANCEL`, `CMSN-CLAWBACK`): `amountMinor`, `receivableAccount`,
  `channelMinor`.
- **Client money** (`PREM-COLLECT`, `PREM-INSTALMENT`, `CM-RECEIPT`,
  `PREM-REMIT`): just `amountMinor`, `memo`, `dims`.
- **Client-money transfer** (`CM-TRANSFER`): the commission args **plus**
  `amountMinor`, which must equal the commission earned or the API rejects it
  with "transfer amount X does not equal commission earned Y".
- **Expense accrual** (`RSHARE-ACCR`, `RSHARE-ADJUST`, `SURPLUS-DIST`,
  `MEDIA-SPEND`, `BOOST`, `CREATOR-SPEND`): `amountMinor`, `expenseAccount`,
  `payableAccount`.
- **Payout** (`PAYOUT-INSTRUCT`, `RSHARE-SETL`, `CREATOR-PAYOUT`,
  `SUPPLIER-PAY`): `amountMinor`, `payableAccount`, `cashAccount`,
  `withholdingMinor`.
- **Invoice** (`SUB-INVOICE`, `SUB-CHANGE`, `OVERAGE`, `SUCCESS-FEE`):
  `netMinor`, `taxMinor`, `creditAccount` (2300 deferred), `receivableAccount`.
- **Recognition** (`SUB-RECOG`): `amountMinor`, `incomeAccount` (4040),
  `deferredAccount` (2300).
- **Credit note** (`SUB-CANCEL`, `CREDIT-NOTE`): `netMinor`, `taxMinor`,
  `debitAccount`, `receivableAccount`.
- **Deposit / refund / chargeback** (`DEPOSIT-TAKE`, `REFUND-ISSUE`,
  `CHARGEBACK`, `CHARGEBACK-WIN`): `amountMinor`, plus `feeMinor` for
  chargebacks.

**Design the form this needs:** selecting a type should swap the JSON textarea
for the named inputs of that recipe — amounts as minor-unit number fields,
account codes as pickers pre-filled with the recipe's defaults and clearly marked
"defaulted, change only if you know why", `memo` as text, `dims` as the only
remaining JSON. Keep a "raw JSON" escape hatch for a type the UI does not yet
know. Note the mutually-exclusive branch in the commission recipe: an explicit
split **or** premium + rates, never a mix — that is a radio, not two sets of
optional fields. This requires an additive `args` field list on the `/txn-types`
endpoint; the design should assume it and say so.

**The catalogue table** (`open.catalogue` "Type catalogue", caption "Transaction
types this tenant can run"):

| Column | Content |
|---|---|
| Code (`open.code`) | mono, the raw code |
| Details | Badges: accent "Posts a journal" or neutral "No journal"; warning "Needs approval"; warning "Money out"; info "Client money" |
| Approvals | The policy key in mono (`ledger.remit`, `ledger.payout`, `dist.settlement_run`, `ledger.client_money_transfer`, `ledger.credit_note`, `ledger.refund`) or "—" |

Around 70 codes. There is no search and no grouping — see the weak list.

**States.**
- *Loading*: submit button `loading`.
- *Success*: a card, "Transaction opened" / "Opened as {id}." with an "Open it"
  link to `/ledger/transactions/:id`.
- *Approval required*: the API returns **403 with `code: "approval_required"`**
  and a `policy_key`. The screen renders a warning card: "Approval requested" /
  "Nothing has happened yet. The request is waiting in the approvals queue for
  someone who may decide it." plus a link to `/approvals`. **The "nothing has
  happened yet" sentence is the most important copy on the screen** — the actor
  must not press again.
- *Field errors*: a `role="alert"` list, one row per bad field:
  `<span class="font-mono text-12 text-muted">{path}</span> — {message}`, e.g.
  `premiumMinor — Required`.
- *Bad JSON*: "Arguments must be a JSON object." (`open.argsInvalid`), client-side.
- *Denied*: EmptyState naming `ledger:txns:create`.

**Actions and consequences.**

| Action | Posts? | Idempotency | Approval | Reversible? |
|---|---|---|---|---|
| Open transaction | Yes, if the type is `financial` — the recipe posts a balanced batch inside the same transaction that creates the row | Yes: the `idempotency-key` header **and** the natural key on a unique index `(tenant, type, idempotencyKey)`. Reusing a key returns the same transaction, it does not post twice | Only if the type carries a policy key. `autoApprovable() = !payout && !clientMoney` — anything moving money out or touching client money always needs a person | Never by deletion. Reversal is a separate transaction from `/ledger/transactions/:id`, legal only once the original is `settled`, and posts a contra batch carrying `reversalOfBatchId` |

**Mobile.** Web only. Do not design a mobile version of this.

**RTL.** The Arabic labels exist for every field. The `args` textarea content is
JSON and stays LTR (`dir="ltr"` is the correct treatment; today it inherits, which
is a small bug). Currency and code inputs likewise.

**What is weak today.**
1. The JSON textarea. A controller must know each recipe's private schema by
   heart, and finds out what was wrong only after submitting.
2. The type select shows bare codes with no descriptions, no grouping and no
   search across ~70 options — and the badges explaining what each code does are
   in a *different table further down the page*, not in the select.
3. `grossMinor` on the form and the amount inside `args` are two separate figures
   with no cross-check on screen.
4. Minor units are unforgiving: nothing on screen shows "416 000 = R4 160,00".
5. The catalogue table is long and unfiltered.

---

## 3. `/ledger/transactions/:id` — One transaction

**Route + title.** `apps/web/app/routes/ledger-transaction.tsx`. Title:
"Transaction" (`txn.title`). Intro: "One transaction, its journal, and everything
done to it."

**Who sees it.** `ledger:txns:read` — a wide list: both finance roles,
tenant.admin, tenant.compliance (via journals), north.exec/admin, axis.agent,
axis.lead, axis.admin, orbit.partners, signal.lead/admin, partner.manager.
Four panels are separately gated and simply **absent** without the permission:

| Panel | Permission |
|---|---|
| Journal lines + the balance check | `ledger:journals:read` |
| Move state | `ledger:txns:authorize` |
| Reverse | `ledger:txns:reverse` |
| Approvals | `core:approvals:read` |
| Audit trail | `core:audit:read` |

So an `axis.agent` sees the details and the history and nothing else. A denied
user (no `ledger:txns:read`) sees the standard EmptyState. Panels that error for
any reason other than 401 are swallowed and rendered as absent, not fatal — an
unreadable audit log must not take down the money screen.

**Purpose.** The one place a posting can be inspected: its journal lines, whether
they balance, what happened to it, and what may happen next.

**Layout skeleton.**

```
┌──────────────────────────────────────────────────────────────┐
│ Transaction                            [ settled ]     (h1)  │
│ One transaction, its journal, and everything done to it.     │
├──────────────────────────────────────────────────────────────┤
│ ┌ dl grid auto-fit minmax(11rem,1fr) ──────────────────────┐ │
│ │ Identifier   Gross        Idempotency key   Created      │ │
│ │ txn_01H…     4 160,00 ZAR web:9f2…          12 Jul 14:02 │ │
│ │ Settled      Actor        Correlation       Opened by    │ │
│ │ Reverses     Reversed by  Journal batch     Failure      │ │
│ └──────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ Journal lines                                                │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ # │ Account │ Side   │    Debit │   Credit │ Memo        │ │
│ │ 1 │ 1100    │[Debit] │ 416 000  │          │ commission… │ │
│ │ 2 │ 4000    │[Credit]│          │  291 200 │ our share   │ │
│ │ 3 │ 2100    │[Credit]│          │  124 800 │ channel …   │ │
│ └──────────────────────────────────────────────────────────┘ │
│ Total debits 416 000 · Total credits 416 000                 │
│ Debits equal credits.                            (in success)│
├──────────────────────────────────────────────────────────────┤
│ ┌ Move state ────────┐  ┌ Reverse ─────────────────────────┐ │
│ │ Move to [ ▾ ]      │  │ A reversal does not delete …     │ │
│ │ Reason [        ]  │  │ Reason [required, ≥3 chars]      │ │
│ │ Failure code [   ] │  │ [Reverse this transaction]danger │ │
│ │ [Move]             │  └──────────────────────────────────┘ │
│ └────────────────────┘                                       │
├──────────────────────────────────────────────────────────────┤
│ History (Timeline)  ·  Approvals  ·  Audit trail             │
└──────────────────────────────────────────────────────────────┘
```

**Details grid** (`<dl>`, `grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]`):
Identifier, Gross (a `<Money>` also showing `baseMinor`/`baseCurrency` when they
differ), Idempotency key (mono), Created, Settled, Actor, Correlation, Opened by
(the parent transaction), Reverses, Reversed by, Journal batch, Failure. Empty
fields render as "—".

**Journal-lines table** (caption "Journal lines posted by this transaction",
`rowState={() => "sealed"}`):

| Column | Type | Alignment | Notes |
|---|---|---|---|
| `#` | seq, mono | start | |
| Account | code, mono | start | Not a link today — see weak list |
| Side | Badge | start | "Debit" / "Credit" |
| Debit | money | **numeric/end** | Renders `<Money>` only when `side === "debit"`; otherwise the cell is blank, not zero |
| Credit | money | **numeric/end** | Mirror of the above |
| Memo | text | start | |

A blank rather than a zero is deliberate: a debit-and-credit table with zeros in
half the cells is unreadable. Preserve it.

Beneath: when balanced, one line — Total debits, Total credits, and
"Debits equal credits." in `text-success`. When not, a `role="alert"` danger card
titled "This batch does not balance", the delta in
`font-display text-28 font-bold text-danger` with `signed`, and the body:
"Debits and credits differ by the amount above. Double entry says they cannot. Do
not act on this transaction — send the batch id to finance engineering." This is
the loudest thing in the module and should stay that way.

A non-financial transaction shows "No journal lines" / "A non-financial
transaction settles without a batch. Nothing was posted."

**The state machine.** Thirteen states with tone:

| State | Tone |
|---|---|
| initiated, validated | neutral |
| authorized, executing, adjusted | info |
| pending_external ("Waiting on a third party"), reversing, adjusting | warning |
| settled | success |
| reversed, failed, rejected, expired | danger |

Legal moves: initiated → validated / rejected / failed; validated → authorized /
rejected / failed; authorized → executing / failed / rejected; executing →
settled / pending_external / failed; pending_external → executing / failed /
expired; **settled → reversing / adjusting**; reversing → reversed / failed;
adjusting → adjusted / failed; adjusted → reversing; reversed, failed, rejected,
expired → nothing.

**Move state form** (only with `ledger:txns:authorize`): a Select "Move to"
containing **only the legal next states** — an illegal move is not offered, not
rejected after the fact. Input "Reason" (500), Input "Failure code" (64), button
"Move". When there is nowhere to go: "No move is legal from this state."
Success: "Moved to {state}."

**Reverse card** (only with `ledger:txns:reverse` **and** `state === "settled"`):
body copy, verbatim — "A reversal does not delete anything. It opens a second
transaction that posts the opposite journal and leaves both on the record."
A required Textarea "Reason" (min 3, max 500, 3 rows), a hidden minted
idempotency key, and a danger button "Reverse this transaction". Confirm:
"Reverse this transaction? A counter-entry will be posted and both remain on the
record." Success: "Reversal posted as {id}." — and the details grid's
"Reversed by" then carries the forward link.

**History.** A `Timeline` of transitions rendered `from → to` with actor, reason
and timestamp.

**Approvals section.** Policy key, decision badge, actor, when, reason. Empty:
"Nothing about this transaction has needed an approval." Always a link: "Open the
approvals queue".

**Audit table.** `rowState="sealed"`, columns When / Actor / Action.

**States.** Loading — buttons show `loading`. Error — panels absent rather than
fatal, except the transaction itself, which throws to the boundary. Denied — the
standard EmptyState.

**AI surfaces.** None. No panel on this screen is model-generated, and there is
no "explain this transaction" affordance. **Do not add one that could be mistaken
for an authority on the numbers.** If a redesign wants a plain-language summary
of a batch, it belongs beside the lines, marked ✦, and must never sit between the
actor and the figures.

**Actions and consequences.**

| Action | Posts? | Idempotency | Approval | Reversible |
|---|---|---|---|---|
| Move state | No journal of its own; moving into `executing`/`settled` is what lets the batch land | No key on the form — the state machine is the guard | The transition endpoint re-checks the type's policy | Only by another legal transition |
| Reverse | **Yes** — a contra batch carrying `reversalOfBatchId` | Yes, a minted key in a hidden field | Passes the same policy gate as the original type; a payout reversal needs approval | The reversal is itself a transaction; it can be inspected but there is no "un-reverse". `adjusted → reversing` is the only second bite |

Nothing on this screen deletes anything. There is no delete affordance and there
must never be one.

**Mobile.** Web only. `/m/ledger` lists txn rows and stops there — tapping one
goes nowhere.

**RTL.** Debit and Credit columns swap to the reading order automatically; the
figures stay LTR and align to `text-end` (left in Arabic). The mono identifier,
account codes and idempotency key must be forced LTR — today they inherit.

**What is weak today.**
1. Account codes in the journal-lines table are not links. From a journal line
   you cannot reach the account statement, though `/ledger/statement?account=1100`
   exists and would answer the next question every reader has.
2. The transaction's *type* has no explanation on screen — `PREM-REMIT` is shown
   raw with no hint that it moves client money out.
3. "Move to" is a bare select of state names. Nothing says what `executing` will
   do or that `settled` is where a journal lands.
4. Approvals show as a flat list with no "why is this waiting on someone".
5. The unbalanced-batch alert tells the reader to email finance engineering — an
   honest but blunt dead end.

---

## 4. `/ledger/period-close` — Period close

**Route + title.** `apps/web/app/routes/ledger-periods.tsx`. Title: "Period close"
(`period.title`). Intro: "A period closes when its checks pass. Soft close first:
it stops ordinary posting and still allows an adjustment with a reason."

**Who sees it.** `ledger:periods:read` — finance.controller, finance.analyst,
tenant.admin. The close buttons need `ledger:periods:close`
(**finance.controller only**); the balance-rebuild card needs
`ledger:journals:post` (**finance.controller only**). Denied: the standard
EmptyState naming `ledger:periods:read`. `finance.analyst` sees the whole screen
read-only, with no close buttons and no rebuild card.

**Purpose.** See whether a month may close, close it, and check the balance cache
against the journal.

**Layout skeleton.**

```
┌──────────────────────────────────────────────────────────────┐
│ Period close                                           (h1)  │
│ A period closes when its checks pass. Soft close first: …    │
├──────────────────────────────────────────────────────────────┤
│ Look up a period   Period [2026-07]  [Apply]  Clear          │
├──────────────────────────────────────────────────────────────┤
│ [ This period cannot close yet ─ danger, only when blocked ] │
│   trial_balance_zero@2026-07 — debits and credits differ …   │
├──────────────────────────────────────────────────────────────┤
│ ┌ Card "2026-07"                              [ Open ] ────┐ │
│ │ From 1 Jul 2026   To 31 Jul 2026   Closed by —           │ │
│ │ ┌ Checks ──────────────────────────────────────────────┐ │ │
│ │ │ Check                       │ State  │ Detail        │ │ │
│ │ │ trial_balance_zero@2026-07  │ [Pass] │ 0             │ │ │
│ │ │ no_pending_external@2026-07 │ [Fail] │ 2 waiting     │ │ │
│ │ │ no_open_client_money_breach…│ [Pass] │ none open     │ │ │
│ │ └──────────────────────────────────────────────────────┘ │ │
│ │ [Soft close]                                             │ │
│ └──────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ ┌ Periods ─────────────────────────────────────────────────┐ │
│ │ 2026-07 [Open]  · 2026-06 [Soft closed] · 2026-05 [Hard…]│ │
│ └──────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ ┌ Check balances against the journal ──────────────────────┐ │
│ │ The journal is the truth and the balances table is a …   │ │
│ │ [Run the check]                                          │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**Period selector.** A GET `<Form>`: Input `period`, `w-40`, `pattern="\d{4}-\d{2}"`,
hint "2026-07". Defaults to the current month. **Apply** and a **Clear** link.
Opening a month that has no row creates it (open, with its checks evaluated) —
worth knowing before designing an "add a period" button; there is none, and none
is needed.

**Period card.** Titled with the code, `actions` slot holding a Badge whose tone
is: open → success, soft_closed → warning, hard_closed → neutral. A `<dl>` of
From / To / Closed by (with `closedAt`).

**Checks.** Three named checks, evaluated server-side:
`trial_balance_zero@<code>`, `no_pending_external@<code>`,
`no_open_client_money_breach@<code>`. Failures render **first**, above the card,
as a `role="alert"` danger block: "This period cannot close yet" / "The checks
below have not passed. Fix what they name, then close." — listing each failed
check's name (mono) and detail. Then the full table: Check (mono), State (Badge —
success "Pass" / danger "Fail"), Detail.

**Close actions** (only with `ledger:periods:close`), one button, whichever fits
the current state:

| State | Button | Variant | Confirm copy |
|---|---|---|---|
| open | Soft close | secondary | "Soft close this period? Ordinary posting stops; adjustments with a reason still post." |
| soft_closed | Hard close | danger | "Hard close this period? Only contra entries post afterwards." |
| soft_closed / hard_closed | Reopen | ghost | "Reopen this period? Posting resumes and the close is undone." |

Success: "Period {code} is now {state}." / "Period {code} is open again."

**`force` is deliberately not exposed.** The API supports it; the UI does not
offer it, because the checks are the gate and a screen that hands out an override
turns them into a formality. **Do not add an override in a redesign.**

**Recent periods table.** Twelve rows, newest first: code (accent, mono, a link
back to `?period=`), state Badge, Closed by, Closed at.

**Rebuild card** (only with `ledger:journals:post`). Title: "Check balances
against the journal". Body: "The journal is the truth and the balances table is a
cache derived from it. This re-reads every line and reports where the two
disagree. It writes nothing and moves no money…". Button "Run the check", with a
confirm. Success: "Checked {count} balances. Every one agrees with the journal."
Drift: a danger alert, "{count} of {total} balances disagree with the journal",
then a table — Account (mono), Currency, `Stored · Debit`, `From the journal ·
Debit`, `Stored · Credit`, `From the journal · Credit`, all numeric `<Money>` —
with the footnote "Only the accounts that disagree are listed."

**States.** Loading — buttons `loading`. Empty — a month with no activity still
renders its card and its checks. Error — the boundary. Denied — as above.

**AI surfaces.** None. A close is never machine-initiated and nothing suggests
when to close.

**Actions and consequences.**

| Action | Posts? | Idempotency | Approval | Reversible |
|---|---|---|---|---|
| Soft close | No journal lines; stops ordinary posting | No key on the form | Routed through the `ledger.period_close` policy in `resources.ts` | Yes — Reopen |
| Hard close | No lines; only contra entries post afterwards | No key | Same policy | Yes — Reopen, and reopening is audited |
| Reopen | No lines | No key | Same policy | Closing again |
| Run the check | **Writes nothing.** Read-only comparison, reported and discarded | n/a | n/a | n/a — nothing to reverse |

The rebuild's read-only nature is the most important thing to communicate. It
sits under `ledger:journals:post` because it *could* have been a write, and the
copy carries the whole burden of saying it is not. A redesign should make that
structural — put it in a "Diagnostics" region, not next to the close buttons.

**Mobile.** Web only.

**RTL.** The period code `2026-07` stays LTR. The drift table's four money
columns pair up as Stored/Journal — in Arabic they mirror as a block, which is
correct; do not un-pair them.

**What is weak today.**
1. A failed check names itself in `snake_case@2026-07` and gives a one-line
   detail. There is no link from `no_pending_external@2026-07` to the list of
   pending transactions blocking it — the controller has to go find them.
2. Soft, hard and reopen are three words for a state machine nobody explains on
   the screen; only the confirm dialogue says what each does.
3. The rebuild card sits beside the close buttons and looks equally consequential.
4. Twelve periods, no pagination, no year view.

---

## 5. `/ledger/statement` — Account statement

**Route + title.** `apps/web/app/routes/ledger-account.tsx`. Title: "Account
statement" (`account.title`). Intro: "Every line posted to this account, with the
balance it left behind."

**Who sees it.** `ledger:journals:read` — finance.controller, finance.analyst,
tenant.admin, tenant.compliance, north.admin, north.analyst. Denied: the standard
EmptyState naming `ledger:journals:read`.

**Purpose.** Read one account's lines over a date window, with a running balance,
and see whether the cached balance still agrees with the journal.

**Layout skeleton.**

```
┌──────────────────────────────────────────────────────────────┐
│ Account statement                                      (h1)  │
│ Every line posted to this account, with the balance it left. │
├──────────────────────────────────────────────────────────────┤
│ Look up an account                                           │
│ Account [1000]  Currency [ZAR]  From [📅]  To [📅]           │
│ Account code from the chart of accounts, e.g. 1000    (hint) │
│ [Apply]   Pick an account →                                  │
├──────────────────────────────────────────────────────────────┤
│ ┌ dl ──────────────────────────────────────────────────────┐ │
│ │ Opening    Closing    Total debits  Total credits  Cached│ │
│ │ 120 000    384 120    512 400       248 280       384 120│ │
│ └──────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ [ The cached balance disagrees with the journal — danger ]   │
├──────────────────────────────────────────────────────────────┤
│ ┌ Statement (compact, sealed rows) ────────────────────────┐ │
│ │ When   │ Side    │  Amount │ Running │ Transaction │ Memo│ │
│ │ 3 Jul  │[Debit]  │ 384 120 │ 504 120 │ txn_01H…    │ …   │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**The lookup form** (GET): Input `account` (**required**, hint "Account code from
the chart of accounts, e.g. 1000"), Input `currency` (`maxLength=3`, defaults to
`me.policy.currency`), From and To as `<input type="date">`. **Apply**, and a
ghost link "Pick an account" to `/ledger/accounts`.

**KPI block** (`<dl>`): Opening (`signed`, `font-display text-20`), Closing
(`signed`, same), Total debits, Total credits, Cached balance.

**Drift alert.** When `statement.closingMinor !== balance.balanceMinor`, a
`role="alert"` block (`border-danger/40 bg-danger/10 p-5`): "The cached balance
disagrees with the journal" / "The statement closes on one figure and the balance
cache holds another. The journal is the truth. Rebuild the cache from the period
close screen." — with a link to `/ledger/period-close`. This is the one place in
LEDGER where an alert hands the reader the next screen. Copy that pattern
elsewhere.

**Lines table** (`density="compact"`, `rowState={() => "sealed"}`, row key
`` `${batchId}|${seq}` ``):

| Column | Type | Alignment | Notes |
|---|---|---|---|
| When | datetime | start | |
| Side | Badge | start | info "Debit" / neutral "Credit" |
| Amount | money | numeric/end | Never signed — the side column carries the sign |
| Running | money `signed` | numeric/end | The only signed column |
| Transaction | mono, accent | start | Links to `/ledger/transactions/:id` |
| Memo | text | start | |

**States.**
- *No account entered*: EmptyState "Pick an account" / "Enter an account code
  above to read its statement."
- *No lines in the window*: "No lines in this window" / "Nothing posted to this
  account between these dates."
- *Loading / Error / Denied*: as everywhere else.

**AI surfaces.** None.

**Actions and consequences.** Read-only. No posting, no key, no approval.

**Mobile.** Web only.

**RTL.** The running balance is the one signed column; its minus sign belongs on
the numeric side of the figure and `Intl` places it. Do not hand-position it.

**What is weak today.**
1. The account is typed as a code with no autocomplete. "Pick an account" leaves
   the screen and comes back with nothing filled in.
2. Nothing anywhere links *into* this screen with the account pre-filled — not
   the trial balance, not the journal-lines table on a transaction. The most
   useful screen in the module is the hardest one to reach.
3. Opening/closing are shown but the date window that produced them is only
   visible in the form above.
4. There is no pagination indicator; a busy account is a long scroll.

---

## 6. `/ledger/recon` — Reconciliation

**Route + title.** `apps/web/app/routes/ledger-recon.tsx`. Title:
"Reconciliation" (`recon.title`). Intro: "Match a counterparty statement against
what we settled. Nothing posts here — a match is a judgement, and it is recorded
as one."

**Who sees it.** `ledger:recon:read` **or** `ledger:recon:run` — finance.controller,
finance.analyst, tenant.admin, axis.admin. Starting a run needs
`ledger:recon:run` (controller, analyst, axis.admin); deciding a match needs
`ledger:recon:confirm` (**controller only**). So the analyst runs the
reconciliation and the controller signs off on it — that separation is the point
of the screen.

**Purpose.** Load a counterparty statement, see what matched, and decide the ones
that did not.

**Layout skeleton.**

```
┌──────────────────────────────────────────────────────────────┐
│ Reconciliation                                         (h1)  │
│ Match a counterparty statement against what we settled. …    │
├──────────────────────────────────────────────────────────────┤
│ Open a run   Run id [ ]  [Apply]                             │
├──────────────────────────────────────────────────────────────┤
│ ┌ Summary KPIs ────────────────────────────────────────────┐ │
│ │ Matched 42 │ Variance 3 │ Variance amount −1 240 │ Open 3│ │
│ └──────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ ┌ Matches ─────────────────────────────────────────────────┐ │
│ │ Stmt line │ Transaction │ Amount │ Delta │ How │ State │ …│ │
│ │ ST-0091   │ txn_01H…    │ 384120 │     0 │[Exact]│[Conf]│ │
│ │ ST-0104   │ txn_01H…    │ 120000 │ −1240 │[Assist│[Prop]│ │
│ │           │             │        │  75%  │ ant]  │      │ │
│ │           │  Why [        ] [Confirm] [Reject]         │ │
│ └──────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ ┌ Start run ───────────────────────────────────────────────┐ │
│ │ Process [Insurer ▾] Period [2026-07] Currency [ZAR]      │ │
│ │ Counterparty [ ]  Tolerance, in minor units [ ]          │ │
│ │ Statement lines                                          │ │
│ │ ┌────────────────────────────────── 8 rows, mono ──────┐ │ │
│ │ │ []                                                    │ │ │
│ │ └───────────────────────────────────────────────────────┘ │ │
│ │ One JSON array: ref, amountMinor, currency, and …  (hint)│ │
│ │ ☐ Let the assistant propose matches for the leftovers    │ │
│ │   Proposals are never posted. Each one still needs a …   │ │
│ │ [Start run]                                              │ │
│ └──────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ Runs — ten most recent                                       │
└──────────────────────────────────────────────────────────────┘
```

**Summary KPIs**: Matched, Variance, Variance amount (money, `signed`, `toned`),
Awaiting a decision.

**Matches table** (caption "Proposed and decided matches in this run"):

| Column | Content |
|---|---|
| Statement line | `statementLineRef`, mono |
| Transaction | mono, accent, links to `/ledger/transactions/:id` |
| Amount | numeric money |
| Delta | numeric money, `signed`, `toned` only when non-zero |
| How | Badge — **info** "Assistant" for `ai_proposed`, neutral "Exact" / "Within tolerance"; the confidence `{n}%` sits beneath |
| State | Badge — success "Confirmed", danger "Rejected", warning otherwise |
| Decided by | Name, with the reason code beneath |
| Decide | Inline form, only when the actor holds `ledger:recon:confirm` **and** `row.state === "proposed"` |

**The decide form** is per-row: a required Input `reasonCode` (`maxLength=64`,
label "Why", visually hidden, hint "Recorded against your name on the match. Say
what convinced you.") and two submit buttons, **Confirm** and **Reject**, each
with its own confirm: "Confirm this match? Your name and reason go on the record."
/ "Reject this match? Your name and reason go on the record." Result:
"Match recorded as {decision}."

**Start-run form** (only with `ledger:recon:run`):

| Field | Label | Type | Default |
|---|---|---|---|
| `process` | Process | Select | `insurer` — options Insurer, Payment provider, Client money, Partner, Media |
| `period` | Period | Input | current `YYYY-MM` |
| `currency` | Currency | Input, 3 | `me.policy.currency` |
| `counterpartyRef` | Counterparty | Input | empty |
| `toleranceMinor` | Tolerance, in minor units | Input `type=number min=0` | empty |
| `lines` | Statement lines | Textarea, **required**, 8 rows | `"[]"` — hint: "One JSON array: ref, amountMinor, currency, and optionally ourRef, postedAt, description." |
| `propose` | "Let the assistant propose matches for the leftovers" | **Checkbox, unchecked** | off |

Submit "Start run", confirm "Start this reconciliation run?" Result:
"Run {id} started: {matched} matched, {variances} with a variance."
Invalid JSON: "Statement lines must be a JSON array."

**Three passes.** Pass 1 exact, pass 2 within tolerance, pass 3 the assistant —
and pass 3 only runs when `propose` is ticked. Everything pass 3 produces lands
in `proposed` and waits for a person.

**Runs list.** Ten most recent: Period, Process, Counterparty, Matched count,
Variance count, Variance amount, State badge, Created.

**States.**
- *No run selected*: EmptyState "Pick a run" / "Start a run above, or open one by
  its id."
- *Run with nothing to decide*: "No matches yet" / "This run produced nothing to
  decide."
- *Loading / Error / Denied*: as everywhere else.

**AI surfaces.** The only ones in LEDGER, described in full under Foundations.
Three visible markers today: the intro sentence, the checkbox hint, and the
info-toned "Assistant" badge with its confidence percentage. **Put the ✦ on that
badge in a redesign, and nowhere else in this module.** Never let a proposal
pre-select Confirm, never let it auto-decide at high confidence, never post from
this screen.

**Actions and consequences.**

| Action | Posts? | Idempotency | Approval | Reversible |
|---|---|---|---|---|
| Start run | **No.** A run reads and compares; it writes `recon_runs` and `recon_matches` rows only | No key — a duplicate run is a new run, harmless because nothing posts | None | Start another run |
| Confirm / Reject a match | **No journal line.** It records a human judgement with a name and a reason code | No key | None; the permission `ledger:recon:confirm` is the gate | The match's state can be set again through the generic record screen, and every change is audited |

Nothing on this screen touches the ledger. That is worth stating in the design,
because it is the screen users most often assume does.

**Mobile.** Web only.

**RTL.** The `lines` textarea holds JSON and must be forced LTR. The Delta column
is the only toned column in the module — red/green must survive both directions
and must not be the only signal (the sign carries it too).

**What is weak today.**
1. Statement lines are pasted as raw JSON. Every real counterparty sends a CSV or
   an XLSX. There is no upload, no column mapping, no preview — although
   `recon_runs` already carries a `statementFileId` column that nothing populates.
2. There is no unmatched view on this screen even though the API returns
   `unmatchedRefs` and `unmatchedTxns` and the labels exist ("Statement lines with
   no transaction", "Transactions with no statement line").
3. `reasonCode` is free text up to 64 characters, per row, with no vocabulary —
   so the audit trail fills with whatever people type.
4. A run with 500 matches is one flat table with no filter by state or method.
5. Confidence renders as a bare percentage under a badge with no explanation of
   what it measures.

---

## 7. The generic workspace — `/ledger` and `/ledger/:resource[/:id]`

Everything not listed above is rendered by two generic routes (`module.tsx`,
`record.tsx`) from a declarative spec. The list screen is: h1, a link strip
("Reports and tools"), a tab strip ("Sections"), a filter/search bar, a table, a
create panel where permitted. The record screen is: a back link ("Back to list"),
the first column's value as the h1, `{tab label} · {id}` beneath, an optional
"Journal, approvals and next steps" button, a `<dl>` grid of every column plus
Created/Updated, an actions section, an edit form, and a delete form guarded by
"Delete this record? It is retained for audit and can be restored by an
administrator."

**The link strip** (withheld links are absent): Trial balance, Profit and loss,
Balance sheet, Aged, Commission (all `ledger:journals:read`), Client money
(`ledger:client_money:read`), Chart of accounts (`ledger:accounts:read`), Open a
transaction (`ledger:txns:create`), Period close (`ledger:periods:read`), Account
statement (`ledger:journals:read`), Reconciliation (`ledger:recon:read`).

**The twenty tabs, in order:**

| Tab | Label | Read permission | Money columns | Writes |
|---|---|---|---|---|
| `txns` | Transactions | `ledger:txns:read` | Gross | **No create form** — a transaction is opened by `POST /v1/ledger/txn/:type`, never typed into a row. Carries the "Journal, approvals and next steps" link |
| `txn-transitions` | Transitions | `ledger:txns:read` | — | read-only |
| `saga-steps` | Saga steps | `ledger:txns:read` | — | read-only |
| `accounts` | Chart of accounts | `ledger:accounts:read` | — | create/edit/delete with `ledger:accounts:write`. **Only name, parent, clientMoney and currency are editable** — code, type and normal side are what every posted line was written against |
| `journal-batches` | Journal batches | `ledger:journals:read` | Total debits, Total credits | read-only |
| `journal-lines` | Journal lines | `ledger:journals:read` | Amount, Base amount | read-only, filterable by side |
| `account-balances` | Balances | `ledger:accounts:read` | Debit, Credit | read-only — a derived cache, never hand-written |
| `periods` | Periods | `ledger:periods:read` | — | state editable with `ledger:periods:close`, routed through the `ledger.period_close` policy |
| `recon-runs` | Reconciliations | `ledger:recon:read` | Variance amount | create with `ledger:recon:run` |
| `recon-matches` | Matches | `ledger:recon:read` | Amount, Delta | state + reasonCode editable with `ledger:recon:confirm` |
| `client-money-checks` | Client money checks | `ledger:client_money:read` | Asset, Liability, Shortfall | read-only |
| `subscriptions` | Subscriptions | `admin:billing:read` | Price | full CRUD with `admin:billing:write` |
| `invoices` | Invoices | `ledger:invoices:read` | Subtotal, Tax, Total | create with `ledger:invoices:create`, state change with `ledger:invoices:approve` — a draft invoice is a document, issuing it is what raises the transaction |
| `revenue-schedules` | Revenue schedules | `ledger:journals:read` | Planned, Recognized | read-only |
| `usage-meters` | Usage meters | `admin:billing:read` | — | read-only |
| `payments` | Payments | `ledger:payments:read` | Amount, Fee | no create form — a payment is captured by its transaction type |
| `payment-plans` | Payment plans | `ledger:payments:read` | Total | only the plan's own state is editable |
| `fx-rates` | FX rates | `ledger:accounts:read` | — | create only, **immutable** — a corrected rate is a new row for a new `asOf` |
| `tax-rules` | Tax rules | `ledger:accounts:read` | — | CRUD with `ledger:accounts:write` |
| `settlements` | Settlements | `dist:commissions:read` | Gross, Adjustments, Net | no create or edit form — a settlement run is raised by DIST with an approval on the net amount (`dist.settlement_run`), and paying one is a transaction |

**Column labels worth knowing** (these are the strings on screen, not the field
names): `idempotencyKey` → "Reference", `grossMinor` → "Gross", `actorKind` →
"Actor", `correlationId` → "Correlation", `settledAt` → "Settled".

**Enum values** resolve through `optionLabel()`: `<owner>.<value>` first
(`state.pending_external` → "Waiting on a third party"), then the bare value, then
`humanise()` (`pending_settlement` → "Pending settlement"). A raw i18n key must
never reach a person.

**States.** Empty: "Nothing here yet" / "No records match this view. Clear the
filters, or create the first one." Filtered-empty: "No records match these
filters." Row count: "{count} shown". Denied at workspace level:
"Your roles do not include access to this area."

**What is weak today.**
1. Twenty tabs in one strip, with no grouping. Journal batches, invoices, FX
   rates and usage meters are four different jobs sharing one row of tabs.
2. `ratePpm`, `unitPriceMicro` and `fxRatePpm` render as raw integers — `150000`
   where a person expects 15%.
3. Money columns in these tables have their currency in a sibling column that is
   often not shown, so a figure can appear currency-less.
4. The record screen's `<dl>` shows every column at equal weight; on a journal
   batch, the two totals are lost among the identifiers.
5. Settlements is the one tab whose permission belongs to another module
   (`dist:commissions:read`), so it appears and disappears for reasons nothing on
   the screen explains.

---

## Cross-cutting notes for a redesign

**The one thing to fix first.** Build the drill-through. A trial-balance row →
the journal lines behind it → the transaction that posted them → the account
statement. Every piece already exists as a separate screen; nothing links them.
Today a controller who wants to know what makes up a number opens a second tab
and retypes an account code.

**The second.** Replace the two raw-JSON textareas (`args` on the open form,
`lines` on the recon form) with real inputs. Both are the same failure: an
internal schema that never reached the client.

**Do not build.** The unmasked-export UI does not exist —
`analytics:exports:unmasked` is held by `finance.controller` and nothing renders
it. If a design adds it, it needs its own approval story, and that is an ADR, not
a screen.

**A seed-data trap.** The demo tenant's December client-money check
(asset 498 300, liability 512 400, shortfall 14 100, breach, resolved) **predates
the seeded postings and does not tie to the trial balance.** It is there to show
the breach state, not to reconcile. A design review that walks the demo data will
find this and should not treat it as a bug in the screens.

**Invariants that may never be relaxed.** Every batch balances in both the
transaction currency and the base currency. Money-affecting state is never
written directly — always through a transaction with an idempotency key, a state
machine and, where the type demands it, an approval. Reversal is a contra batch
carrying `reversalOfBatchId`; nothing in this module deletes anything. These are
property-tested. No design may introduce a screen that implies otherwise — no
"edit this posting", no "delete this line", no "adjust the balance".
