# ADR-0066 — Premium financing collects on schedule, not on confirmed settlement

Status: accepted · 2026-08-18
Context: `.superpowers/sdd/final-review-group-d.md` (finding I8), docs/27 revenue
line F4, docs/19 §4 (transaction integrity), `apps/api/src/engines/premium-financing.ts`

## Decision

`payInstalment` posts a `PREM-INSTALMENT` client-money receipt when an
instalment falls due, on the strength of the financing agreement, and treats an
instalment as **missed** only when a `ledger_payments` row exists for it in a
closed non-payment state (`failed`, `charged_back` or `refunded`). No new table,
no new column.

## The gap this records

LYRA has no inbound settlement intake. No production code path writes
`ledger_payments` — not a PSP webhook, not a financier file import, not an
operator screen. The only writers are tests and the demo seed
(`packages/core/src/seed/ledger.ts:1339`, seven illustrative rows), and none of
the seeded rows carry a `"<planId>:<seq>"` `providerRef`, so none of them reach
premium financing. The table is defined
(`packages/db/src/schema/ledger.ts`) with the states a real intake would use
(`pending | authorized | captured | settled | failed | refunded |
charged_back`), and premium financing reads it, but nothing in production
populates it.

So the dunning path this branch ships is **dormant by construction**: with no
writer, no instalment can be marked missed, `missed_streak` never rises, the
`DUNNING` transaction is never posted, and `ledger.financing.lapse_due` never
fires. The lapse cascade is wired and tested end to end
(`apps/api/src/premium-financing.test.ts`); it simply has no real-world trigger
yet.

## What the receipt means in the interim

Plainly: **`PREM-INSTALMENT` may be posting money that has not arrived.** It is
an accrual on the instalment's due date, not settlement-confirmed cash. The
financier has contracted to debit the client on schedule, so on the due date the
receivable is real and the receipt records the amount the plan says is owed —
but nothing in LYRA has observed the cash. Consequences an operator should know:

- Client-money balances derived from these receipts are *expected* cash, not
  reconciled cash, until a settlement intake exists. Treat them as such in any
  regulatory client-money report.
- A silent real-world failure (the debit bounced, the financier never collected)
  leaves LYRA showing a paid instalment and an `active` plan. The policy keeps
  running on premium nobody received.
- Reversal is available (`reverse()` in `packages/ledger/src/txn.ts`) once the
  truth arrives, so the correction path is a compensating entry, never an edit.

## The seam that closes it

`ledger_payments.providerRef = "<planId>:<seq>"` is the join key. A settlement
intake — PSP webhook, financier settlement file, or an operator recording a
returned debit — writes one `ledger_payments` row per instalment attempt with
that `providerRef`, and premium financing starts behaving correctly with **zero
engine change**:

- `failed` / `charged_back` / `refunded` → the instalment is marked missed,
  `missed_streak` increments, a `DUNNING` transaction is posted carrying the
  payment's id, state and `failureCode`, and three consecutive misses cascade
  into policy lapse through `ledger.financing.lapse_due`.
- `authorized` / `captured` / `settled` → collected, `PREM-INSTALMENT` posted.
- no row → collected, as on a plan with no settlement signal at all.
- `pending`, or any state this engine has never heard of → left alone for the
  next tick. An in-flight debit is not cash, and a PSP state added after this
  ADR must never become a client-money receipt by default. Teaching the engine a
  new state is a one-line allowlist change.

The engine reads the latest row per `seq`, ordered by `created_at` then `id` so
a same-millisecond tie is deterministic rather than scan-ordered. A `missed` row
stays collectable: the row records the `ledger_payments` id that caused the miss
(`missedPaymentId` on the schedule row), so a re-presented debit that settles
collects the instalment and clears the miss, while the same refused attempt seen
again on later ticks counts once and only once. Only a payment row with a
*different* id moves `missed_streak`. Building the intake is the follow-up work;
it is a new writer, not a change to this engine (CLAUDE.md #15).

## Deployment note

Any environment carrying demo seed data will post a real `PREM-INSTALMENT`
receipt on the **first cron tick** after this branch ships. The seed's financed
renewal (`packages/core/src/seed/ledger.ts:1446` — Rania's renewal, `active`,
four instalments, three `paid`) leaves instalment 4 due at seed time, and the
sweep collects every due instalment on every `active` plan. Expect one
`PREM-INSTALMENT` transaction and its journal lines per seeded tenant, plus the
matching commission recognition. That is correct engine behaviour on the data it
was given, not a defect — but demo and staging balances will move on their own,
so do not read the first tick's client-money movement as production activity.

## Alternatives considered

**Block collection until a settlement signal exists.** Rejected: it makes
premium financing non-functional. Every instalment would sit `pending` forever,
no revenue would be recognised on a live revenue line, and the plan's whole
purpose — the client pays the financier, the broker is paid up front — would be
unrepresentable in the ledger. Correctness about cash is not worth a feature that
does nothing.

**Add a dedicated settlement-signal table.** Rejected: `ledger_payments` already
models exactly this (direction, method, provider ref, amount, currency, fee,
state, failure code, settlement batch). A second table would need reconciling
against the first the day a real PSP integration lands, and CLAUDE.md #12 wants
one place where money-affecting state lives. A new table is also a migration and
a schema surface to maintain for a signal nobody writes yet.

**Infer non-payment from our own posting failure** (the shape this branch
originally shipped). Rejected outright and reverted: it conflated "we could not
resolve an fx rate" with "the customer did not pay", so an operator's missing
rate produced three real misses and lapsed a paying customer's policy in three
ticks. Internal failure is now always retryable and never a miss.

## Consequences

- Premium financing is shippable and its revenue is recognised, with the cash
  assumption written down here rather than implied by the code.
- Dunning, `DUNNING` transactions and the financing lapse cascade exist, are
  tested, and stay dormant until a settlement intake ships. Their first
  production exercise will be the intake's acceptance test, not this branch's.
- Any client-money report built before the intake lands must state that
  financing receipts are unreconciled. That constraint belongs to whoever builds
  the report; it is not enforceable in this engine.
