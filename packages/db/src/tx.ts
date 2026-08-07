import type { BatchItem } from "drizzle-orm/batch";

// docs/19 §5: a money write lands whole or not at all.
//
// Neither home offers an interactive transaction the money path can hold open —
// D1 speaks HTTP and has no BEGIN that survives a round trip — but both offer an
// atomic multi-statement batch: D1 wraps the batch in a transaction, and libsql's
// batch *is* a deferred one. That is the seam, and it is the only one, so the
// rule for callers is fixed: read and decide first, assemble the whole write set,
// then hand it here.

/** The one capability both homes share. Structural, so neither driver leaks out. */
export interface Atomic {
  batch(stmts: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]): Promise<unknown>;
}

/** A statement built but not awaited. Awaiting one runs it on its own. */
export type Write = BatchItem<"sqlite">;

/**
 * Runs every statement in one transaction, or none of them.
 *
 * An empty write set is a no-op rather than an error: a caller that computed no
 * work should not have to branch around this.
 */
export async function atomically(db: Atomic, writes: readonly Write[]): Promise<void> {
  if (writes.length === 0) return;
  await db.batch(writes as unknown as [Write, ...Write[]]);
}
