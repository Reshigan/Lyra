# ADR-0066 — Premium financing collects on schedule, not on confirmed settlement

Status: accepted · 2026-08-18
Context: `.superpowers/sdd/final-review-group-d.md` (finding I8), docs/27 revenue
line F4, docs/19 §4 (transaction integrity), `apps/api/src/engines/premium-financing.ts`

## Decision

`payInstalment` posts a `PREM-INSTALMENT` client-money receipt when an
instalment falls due, on the strength of the financing agreement, and treats an
instalment as **missed** only when a `ledger_payments` row exists for it in
state `failed` or `charged_back`. No new table, no new column, no new migration.

## The gap this records

LYRA has no inbound settlement intake. Nothing in the codebase writes
`ledger_payments` — not a PSP webhook, not a financier file import, not an
operator screen. The table is defined (`packages/db/src/schema/ledger.ts`) with
the states a real intake would use (`pending | authorized | captured | settled |
failed | refunded | charged_back`), and premium financing reads it, but today it
is only ever populated by tests.

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

- `failed` / `charged_back` → the instalment is marked missed, `missed_streak`
  increments, a `DUNNING` transaction is posted carrying the payment's id,
  state and `failureCode`, and three consecutive misses cascade into policy
  lapse through `ledger.financing.lapse_due`.
- anything else (or no row) → collected as today.

The engine reads the latest row per `seq` by `created_at`, so a retry that
succeeds supersedes an earlier failure without special handling. Building the
intake is the follow-up work; it is a new writer, not a change to this engine
(CLAUDE.md #15).

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
