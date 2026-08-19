// One converter for every epoch-millisecond instant that goes into a prompt.
//
// Two reasons it exists rather than `new Date(ms).toISOString()` at each call
// site, and both have already bitten this codebase:
//
//   1. A bare epoch-ms instant is a 13-digit run, and exactly one in ten passes
//      Luhn — so scrub.ts's CARD rule replaces it with `[[CARD_n]]` before the
//      provider sees it, and the model reasons about a date it cannot read.
//      An ISO-8601 string's `:` and `.` cannot match that rule.
//   2. `new Date(ms).toISOString()` throws RangeError outside the Date range,
//      and prompt call sites sit inside blanket `catch {}` blocks — a claimant
//      filing with `incidentAt: 1e17` silently switched their own fraud
//      scoring off. Totality here is what makes that impossible.

/** ECMA-262 time-value range: ±100,000,000 days from the epoch. */
const MAX_TIME_VALUE = 8.64e15;

/**
 * ISO-8601 for a prompt payload. Never throws: a non-finite or out-of-Date-range
 * value renders as the literal `"unknown"`, which is honest to the model and
 * strictly better than a swallowed crash that disables the feature.
 */
export function promptInstant(ms: number): string {
  return Number.isFinite(ms) && Math.abs(ms) <= MAX_TIME_VALUE ? new Date(ms).toISOString() : "unknown";
}
