# ADR-0063 — Income-account inference from `accountCode` is a stopgap, not a schema

Status: open — question for the product owner · 2026-08-17
Context: .superpowers/sdd/final-review-3.md (finding I5), apps/api/src/engines/billing.ts:503

## Context

`postRecognitions()` (`apps/api/src/engines/billing.ts:503`) maps a
`ledgerRevenueSchedules` row to the income account its recognition credits:

```
const incomeAccount = row.accountCode === "2300" ? "4040" : row.accountCode;
```

`accountCode` on a schedule row is overloaded: for a plain subscription it
holds `2300` (the deferred-revenue liability the row is *sitting in*, written
by `invoiceSubscription`, billing.ts:315), and the ternary translates that to
`4040` (subscription revenue) at recognition time. But `deliverDataProduct`
(billing.ts:639, 662) writes the row's `accountCode` as the destination
income account directly — `4060` — so the ternary passes it through
unchanged. Two different rows use the same column to mean two different
things (a liability code that needs translating, or an income code that
doesn't), and only one of the two cases the ternary recognises today: 2300
means 4040. Any plan whose subscription should recognize into an income
account other than 4040 has no way to say so.

No current product needs that third case — `postRecognitions` already
honors an explicit non-2300 `accountCode`, and `deliverDataProduct` already
supplies its own. This is why final-review-3 (round 3) judged it non-blocking
for merge, unlike C3/I6/I7 in the same review.

## Decision

Not made. Options, for the product owner:

1. **Leave the ternary.** Cheapest; breaks the day a subscription plan needs
   to recognize outside 4040 (a fourth revenue line, e.g. a subscription-like
   product with its own income account).
2. **Add an explicit `incomeAccountCode` column to `ledgerRevenueSchedules`,**
   populated at schedule-creation time by every writer (`invoiceSubscription`,
   `deliverDataProduct`, any future writer), and have `postRecognitions` read
   it directly with no inference. Removes the overload; requires a migration
   and touching every schedule-row writer.

## Consequences

Whichever option is picked, this ADR should be updated to `accepted` and the
options above trimmed to the one taken. Left `open`, a fourth revenue line
must not be built on top of the ternary without revisiting this file first —
doing so would either extend the special-casing (option 1's cost compounding)
or silently pick option 2 without a migration plan.
