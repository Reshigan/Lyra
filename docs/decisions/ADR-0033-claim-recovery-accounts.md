# ADR-0033 — Claim recovery accounts and the two-batch recovery receipt

- **Status:** Accepted
- **Date:** 2026-08-07
- **Context:** docs/27 F23, `docs/specs/gap-axis-design.md` §B.3/§B.4,
  docs/19-transactions-and-ledger.md §4.1b, §5.1, §5.2 B, §11

## Context

The AXIS gap design (§B.4) specified that claim recoveries need four new chart
codes — `1150`, `1170`, `4090`, `5400` — and that `RECOVERY-RECEIPT` posts one
batch splitting the handling fee straight to income:

```
1010 Dr gross · 4090 Cr fee · 2010 Cr net
```

Two things were wrong with that when it met the existing ledger.

**The codes were already taken.** `1150` is Financier Receivable and `5400` is
Partner Revenue Share; both have live consumers (`FIN-CMSN`, `RSHARE-ACCR`,
`SURPLUS-DIST`). Overloading them would put two unrelated balances in one
account and make the trial balance unreadable.

**The single batch is illegal.** docs/19 §5.2 B and test obligation 3 forbid any
journal that debits the client-money asset from crediting income or expense —
`packages/ledger/src/posting.ts:112` enforces it. Money in the client account is
not ours until it has left the client account. The design's own catalogue
already contained a separate `RECOVERY-FEE` type; §B.4 simply did not use it.

## Decision

1. **Two new codes, not four.** `1155` Recovery Receivable (asset) and `5450`
   Recovery Written Off (expense). `4090` Service Fees is reused as-is — a
   recovery handling fee is a service fee, and `FEE-SERVICE` and `SUCCESS-FEE`
   already credit it. `1170` "Claim Float" is dropped: no recipe references it,
   and `CLAIM-FUND` posts `1010`/`2010` like every other client-money receipt.

2. **A recovery is two transactions.** `RECOVERY-RECEIPT` books the gross into
   client money (`clientMoneyReceipt`: `1010` Dr / `2010` Cr).
   `RECOVERY-FEE` then draws the fee out via `clientMoneyTransfer` pointed at
   `4090` (`2010` Dr / `1010` Cr / `1000` Dr / `4090` Cr) — the same route
   commission takes. `RECOVERY-FEE` is marked `clientMoney: true` in the
   catalogue so it can never be auto-approved.

3. **`CLAIM-FUND` and `CLAIM-PAY` reuse the premium shapes** rather than clone
   identical lines: `clientMoneyReceipt` and `premiumRemittance`. Only the memo
   differs, and the memo is the caller's.

Where the design doc and docs/19 disagree, docs/19 governs — CLAUDE.md §12 makes
ledger invariants non-negotiable, and the acceptance test in
`apps/api/src/axis-claim-payment.test.ts` was amended to assert the two-batch
shape rather than the invariant relaxed to admit the one-batch shape.

## Consequences

- The recovery fee appears in `4090` alongside other service fees. A tenant that
  needs recoveries reported separately gets a dimension on the line, not a new
  account.
- Reversing a recovery reverses two transactions. Both carry the same
  `subjectRefs.recovery`, so they reverse together.
- `docs/specs/gap-axis-design.md` §B.4 is now stale on this point; docs/19 §4.1b
  is the current statement.
