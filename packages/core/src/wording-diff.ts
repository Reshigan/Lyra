// docs/modules/scout.md — the Wording Differ agent's core: a real, tested
// word-level diff between two clause/policy-wording texts, so a narrowed
// coverage term ("100000" -> "50000") shows up as a span, not a wall of text.
//
// No diff dependency exists anywhere in this repo (checked package.json /
// pnpm-lock.yaml across every workspace) - plain LCS is proportionate scope
// for word-level clause text, so this stays dependency-free.

export interface DiffSpan {
  readonly type: "equal" | "insert" | "delete";
  readonly text: string;
}

const tokenize = (s: string): string[] => s.split(/\s+/).filter(Boolean);

/**
 * Word-level LCS diff. A "changed" span (e.g. a coverage limit that moved) is
 * a `delete` immediately followed by an `insert` - callers that want a single
 * "changed" concept can merge that adjacent pair; keeping the two primitive
 * ops is what stays correct when only one side of a change is truly touched.
 *
 * ponytail: O(n*m) DP table - clause-length text (tens to low hundreds of
 * words), not whole documents. Upgrade to Myers diff if this ever runs on
 * full policy PDFs instead of individual clauses.
 */
export function diffWords(a: string, b: string): DiffSpan[] {
  const left = tokenize(a);
  const right = tokenize(b);
  const n = left.length;
  const m = right.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = left[i] === right[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  type Op = { type: DiffSpan["type"]; word: string };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      ops.push({ type: "equal", word: left[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: "delete", word: left[i]! });
      i++;
    } else {
      ops.push({ type: "insert", word: right[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ type: "delete", word: left[i++]! });
  while (j < m) ops.push({ type: "insert", word: right[j++]! });

  const spans: DiffSpan[] = [];
  for (const op of ops) {
    const last = spans[spans.length - 1];
    if (last && last.type === op.type) spans[spans.length - 1] = { type: last.type, text: `${last.text} ${op.word}` };
    else spans.push({ type: op.type, text: op.word });
  }
  return spans;
}
