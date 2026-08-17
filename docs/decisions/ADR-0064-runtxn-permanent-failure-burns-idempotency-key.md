# ADR-0064 — `runTxn` permanently burns an idempotency key on failure

Status: open — question for the product owner · 2026-08-17
Context: .superpowers/sdd/final-review-3.md (finding I1's wedge half, and C3's root cause), packages/ledger/src/txn.ts:255-256, 341

## Context

`runTxn` (`packages/ledger/src/txn.ts`) opens a transaction under its caller's
idempotency key, and on any throw other than `approval_required` calls
`failTxn` (`txn.ts:341`), setting the row's state to `failed`. The next call
with the same key hits:

```
if (txn.state === "failed" || txn.state === "rejected" || txn.state === "expired") {
  throw conflict(`transaction ${txn.id} already ${txn.state}: ${txn.failureDetail ?? ""}`.trim());
}
```

(`txn.ts:255-256`) — permanently. There is no path back to `initiated` for a
`failed` row, so whatever caused the first failure need not still be true;
the key is unretryable forever regardless.

This is a property of the shared transaction state machine, not specific to
Group C, but Group C gives it a live money-losing door: `applyOverages`
(billing.ts) claims `overageInvoicedQuantity` — which satisfies the row's own
selection predicate — before calling `runTxn`. If `runTxn` fails and burns
the key, the units are claimed but never billed, and the now-disqualified row
never resurfaces to retry. C3 (round-3 review) fixed the *specific* trigger
(a missing FX rate) by checking before claiming, so this door is closed for
that one cause — but any other `runTxn` failure after a claim-style write,
here or in a future engine, reopens it. `recordUsage`'s `USAGE-METER` txn
(billing.ts:82-89) has the same shape in miniature: a failed tick's key can
never post that tick's usage-recording transaction again. It does not lose
data the way `applyOverages` does — the quantity increment (billing.ts:91-96)
sits after the `runTxn` call and is simply never reached on a throw — but the
usage that arrived in that tick has no other way back in: the caller's next
tick computes a new idempotency key from a larger cumulative count, so the
failed tick's slice of usage is not retried under its own key, only folded
into whatever key the next successful tick happens to compute.

## Decision

Not made. This needs a design change to `runTxn`/`failTxn` (e.g., an explicit
retryable-failure state distinct from a terminal one, or a compensating
reopen path) that is out of scope for a Group-C review pass — it touches
every caller of `runTxn` across the codebase, not just billing.ts.

## Consequences

Left open, every caller that writes a claim-like state change before an
operation `runTxn` can fail must keep doing what C3 did: resolve everything
that can fail *before* the claim, so the claim itself never precedes a
throwing call. That is a per-caller discipline, not a guarantee — a future
engine that gets this ordering wrong reintroduces C3's bug class through a
different door. File a follow-up ticket against `packages/ledger/src/txn.ts`
to track the real fix; this ADR is the record that the gap is known and
deliberately not closed here.
