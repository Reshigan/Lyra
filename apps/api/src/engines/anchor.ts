import { canonicalJson, chainFor, sha256Hex, verifyChain, type ChainBreak, type Ctx } from "@lyra/core";

// docs/12 §1: "Audit: core_audit_log + ai_audit_log append-only; hash-chained
// daily anchors stored to R2 EXPORTS for tamper evidence." The per-row chain
// lives in the same database as the rows, so anyone able to edit a row can
// recompute every hash after it. The anchor is the copy that leaves the
// database: one small object per tenant per day, itself chained to yesterday's,
// holding the chain tip as of that day. Rewriting history now also means
// rewriting an R2 object whose hash the next day's anchor already committed to.

export interface AuditAnchor {
  tenantId: string;
  day: string;
  /** When the anchor ran, not the day it covers. */
  ts: number;
  /** Rows in the whole chain up to this point — the chain is verified end to end. */
  rows: number;
  firstId: string | null;
  lastId: string | null;
  /** chain_hash of the newest row; the single value that pins the history. */
  tipHash: string | null;
  breaks: ChainBreak[];
  prevAnchorHash: string | null;
  anchorHash: string;
}

/** Pointer to the newest anchor, so a missed day still chains to a real one. */
interface AnchorPointer {
  day: string;
  anchorHash: string;
}

function dayOf(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Anchor one tenant's audit chain for today. Returns null when EXPORTS is not
 * bound (local dev), the anchor otherwise. Verification is part of the job:
 * an anchor that quietly recorded a broken chain would be evidence of nothing.
 */
export async function anchorAudit(ctx: Ctx, bucket: R2Bucket | undefined): Promise<AuditAnchor | null> {
  if (!bucket) return null;
  const rows = await chainFor(ctx);
  // A tenant with no history has nothing to pin, and an empty anchor would
  // still consume a slot in the chain of anchors.
  if (rows.length === 0) return { ...empty(ctx), anchorHash: "" };

  const breaks = await verifyChain(rows);
  const pointer = (await bucket
    .get(`audit-anchors/${ctx.tenantId}/latest.json`)
    .then((o) => o?.json() as Promise<AnchorPointer | undefined>)) as AnchorPointer | undefined;

  const day = dayOf(ctx.now);
  const body = {
    tenantId: ctx.tenantId,
    day,
    ts: ctx.now,
    rows: rows.length,
    firstId: rows[0]?.id ?? null,
    lastId: rows[rows.length - 1]?.id ?? null,
    tipHash: rows[rows.length - 1]?.chainHash ?? null,
    breaks,
    // Anchors chain to each other: deleting yesterday's object is as visible as
    // editing a row, because today's anchor names its hash.
    prevAnchorHash: pointer?.anchorHash ?? null
  };
  const anchor: AuditAnchor = { ...body, anchorHash: await sha256Hex(canonicalJson(body)) };

  await bucket.put(`audit-anchors/${ctx.tenantId}/${day}.json`, JSON.stringify(anchor), {
    httpMetadata: { contentType: "application/json" }
  });
  await bucket.put(
    `audit-anchors/${ctx.tenantId}/latest.json`,
    JSON.stringify({ day, anchorHash: anchor.anchorHash } satisfies AnchorPointer),
    { httpMetadata: { contentType: "application/json" } }
  );
  return anchor;
}

function empty(ctx: Ctx): Omit<AuditAnchor, "anchorHash"> {
  return {
    tenantId: ctx.tenantId,
    day: dayOf(ctx.now),
    ts: ctx.now,
    rows: 0,
    firstId: null,
    lastId: null,
    tipHash: null,
    breaks: [],
    prevAnchorHash: null
  };
}
