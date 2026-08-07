// docs/27 F23 / docs/specs/gap-axis-design.md §C.4. The reserve history is
// append-only, so `axis_claims.reserveMinor` is a denormalization of it and the
// two can drift. SQLite cannot express "the head is the sum of the latest row
// per head" or "movement n opens where n-1 closed", so the invariants live here
// as one pure checker the claim endpoints and their tests both call. Same shape
// as `policy-versions.ts`: every violation, not just the first.

export type ClaimReserveRow = {
  head: string; // indemnity|expense|recovery
  seq: number;
  amountMinor: number; // the reserve AFTER this movement
  previousMinor: number;
  deltaMinor: number;
  setAt: number;
};

export type ClaimReserveHead = { reserveMinor: number };

function byHead(rows: readonly ClaimReserveRow[]): Map<string, ClaimReserveRow[]> {
  const out = new Map<string, ClaimReserveRow[]>();
  for (const r of rows) {
    const list = out.get(r.head);
    if (list) list.push(r);
    else out.set(r.head, [r]);
  }
  for (const list of out.values()) list.sort((a, b) => a.seq - b.seq);
  return out;
}

/**
 * The reserve as at an instant, summed over heads — the number a triangle or a
 * reserve-adequacy metric needs. Reads the history because the head only knows
 * about today (§C.4: "that is the whole reason the history exists").
 */
export function reserveAsAt(rows: readonly ClaimReserveRow[], asOf: number): number {
  let total = 0;
  for (const list of byHead(rows).values()) {
    // Latest by seq among the movements already set at `asOf`. Seq, not setAt:
    // a backdated estimate must not overrule a later movement it preceded.
    const latest = list.filter((r) => r.setAt <= asOf).at(-1);
    if (latest) total += latest.amountMinor;
  }
  return total;
}

/** Empty array = the claim's reserve history and its denormalized head agree. */
export function claimReserveViolations(
  head: ClaimReserveHead,
  rows: readonly ClaimReserveRow[]
): string[] {
  const out: string[] = [];
  let sum = 0;

  for (const [name, list] of byHead(rows)) {
    for (let i = 0; i < list.length; i++) {
      const row = list[i]!;
      if (row.seq !== i + 1) {
        out.push(`${name} seq is not dense from 1: ${list.map((r) => r.seq).join(",")}`);
        break;
      }
    }
    for (let i = 0; i < list.length; i++) {
      const row = list[i]!;
      const opensAt = i === 0 ? 0 : list[i - 1]!.amountMinor;
      if (row.previousMinor !== opensAt) {
        out.push(
          `${name} seq ${row.seq} opens at ${row.previousMinor} but ` +
            (i === 0 ? "the head starts at 0" : `seq ${list[i - 1]!.seq} closed at ${opensAt}`)
        );
      }
      if (row.deltaMinor !== row.amountMinor - row.previousMinor) {
        out.push(
          `${name} seq ${row.seq} delta ${row.deltaMinor} != ${row.amountMinor} - ${row.previousMinor}`
        );
      }
    }
    sum += list.at(-1)?.amountMinor ?? 0;
  }

  if (head.reserveMinor !== sum) {
    out.push(`head.reserveMinor ${head.reserveMinor} != ${sum} (sum of the latest row per head)`);
  }
  return out;
}
