# ADR-0067 — A bound policy's update is not approval-gated

Status: accepted · 2026-08-19
Context: `apps/api/src/resources.ts` (`axis/policies`), CLAUDE.md §12
(transaction integrity), docs/19 §4, `apps/api/src/engines/axis-lifecycle.ts`
(the lapse sweep)

## Decision

`axis/policies` keeps `approval: { create: "axis.bind", amountField:
"premiumMinor" }`. Creating a policy raises an approval; updating one does not.
`PATCH /v1/axis/policies/:id` with `axis:policies:update` may change
`premiumMinor` and `paymentPlanJson` on a bound policy with no second pair of
eyes.

## The gap this records

`paymentPlanJson` is what the lapse sweep reads to decide whether cover ends
unpaid. `premiumMinor` is the amount the bind was approved against. Both are
plain columns on a resource whose update permission is a routine one — the same
permission that renames a policy or corrects a reference. So a single actor
holding `axis:policies:update` can:

- push every instalment's `dueAt` into the future, and a policy that has gone
  unpaid never lapses;
- set `lapseOnMissed: false`, and lapse-on-missed is off for that policy;
- change `premiumMinor` after the bind approval was decided against the old one.

None of the three raises an approval, and CLAUDE.md §12 says anything that
changes contractual state is approval-gated. This is a known deviation, not an
oversight.

## Why it is left open in this wave

Widening the gate to `update` is one word in the resource registration, and it
is the wrong fix: `axis/policies` is a broad resource, so every routine field
edit — a corrected policy number, a note, a reference — would queue behind an
approval, and an approval queue that fills with noise is an approval queue
nobody reads. The right fix is a field-level gate: an `approval.updateFields`
declaration on `Resource` naming the fields whose change needs approval, with
`crud.ts` raising one only when a named field is in the patch. That is a change
to the generated CRUD path, with its own tests, and it belongs to the wave that
can carry it rather than being smuggled into a revenue-line branch.

## What is in place in the meantime

- Both fields are validated on write, so what lands is at least a plan the
  sweep can read: `PaymentPlanWrite` (packages/db/src/json.ts) is strict, bounds
  `dueAt` to the `Date` range and requires a non-empty schedule.
- The change is attributable. The generated CRUD path writes an audit entry with
  the actor for every update, so a plan edited to dodge a lapse is visible after
  the fact — detection, not prevention.
- `axis:policies:update` is not a default grant; it is a deliberate role
  assignment.

That is mitigation, not the control CLAUDE.md §12 asks for. A tenant handing out
`axis:policies:update` broadly is handing out the ability to un-lapse a policy.

## The seam that closes it

`approval.updateFields?: string[]` on `Resource` (apps/api/src/resources.ts),
read in `crud.ts` where the create-side approval is raised today. The two fields
that would be named on `axis/policies` are `premiumMinor` and
`paymentPlanJson`. Nothing else about this resource changes.

## Alternatives considered

**Gate all updates on `update`.** Rejected: every routine edit queues behind an
approval, so the queue stops being read and the gate stops being a control.

**Move `paymentPlanJson` off the generic CRUD path onto its own endpoint with
its own approval.** Rejected for this wave: it splits one resource's writes
across two surfaces and leaves `premiumMinor` — the other half of the gap —
still open on the generic path. The field-level gate covers both in one place.

**Make the lapse sweep ignore a plan edited after bind.** Rejected: the sweep
would need edit provenance it does not have, and a legitimate rescheduling
(a customer moving a debit date) is a normal, expected edit.

## Consequences

- A recorded, bounded deviation from CLAUDE.md §12 with a named seam, instead of
  a `ponytail:` comment in one file that no reviewer outside `resources.ts` will
  ever read.
- Until `approval.updateFields` ships, `axis:policies:update` should be granted
  as if it carried lapse-suppression rights, because it does.
- The follow-up is a `crud.ts` change, not an `axis` change.
