import { desc, eq } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { canonicalJson, sha256Hex } from "./crypto.js";
import { actorRef, type Ctx } from "./context.js";

// docs/12 §1. Append-only, hash-chained per tenant: a row cannot be edited or
// removed without breaking every chain_hash after it.

export interface AuditRow {
  id: string;
  tenantId: string;
  actorRef: string;
  action: string;
  subjectRef: string | null;
  beforeHash: string | null;
  afterHash: string | null;
  prevHash: string | null;
  chainHash: string;
  ip: string | null;
  ua: string | null;
  ts: number;
}

/** Pure, so the writer and the verifier cannot drift. */
export async function computeChainHash(row: Omit<AuditRow, "chainHash">): Promise<string> {
  return sha256Hex(
    canonicalJson({
      id: row.id,
      tenant: row.tenantId,
      actor: row.actorRef,
      action: row.action,
      subject: row.subjectRef,
      before: row.beforeHash,
      after: row.afterHash,
      prev: row.prevHash,
      ts: row.ts
    })
  );
}

export interface AuditEntry {
  /** `module.resource.verb`, e.g. `axis.case.approve`. */
  action: string;
  subjectRef?: string;
  before?: unknown;
  after?: unknown;
}

async function hashOrNull(value: unknown): Promise<string | null> {
  return value === undefined ? null : sha256Hex(canonicalJson(value));
}

/**
 * Write one audit row, chained to the tenant's previous row.
 *
 * ponytail: reads the tip then inserts, so two concurrent writers can share a
 * prev_hash. Detectable (verifyChain reports the fork) and rare. Upgrade path:
 * a per-tenant Durable Object sequencer if audit write volume ever contends.
 */
export async function audit(ctx: Ctx, entry: AuditEntry): Promise<AuditRow> {
  const tip = await ctx.db
    .select({ chainHash: schema.auditLog.chainHash })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.tenantId, ctx.tenantId))
    .orderBy(desc(schema.auditLog.ts), desc(schema.auditLog.id))
    .limit(1);

  const base: Omit<AuditRow, "chainHash"> = {
    id: newId("aud", ctx.now),
    tenantId: ctx.tenantId,
    actorRef: actorRef(ctx),
    action: entry.action,
    subjectRef: entry.subjectRef ?? null,
    beforeHash: await hashOrNull(entry.before),
    afterHash: await hashOrNull(entry.after),
    prevHash: tip[0]?.chainHash ?? null,
    ip: ctx.ip ?? null,
    ua: ctx.ua ?? null,
    ts: ctx.now
  };

  const row: AuditRow = { ...base, chainHash: await computeChainHash(base) };
  await ctx.db.insert(schema.auditLog).values(row);
  return row;
}

export interface ChainBreak {
  id: string;
  reason: "prev_mismatch" | "hash_mismatch";
}

/** Verify a tenant's chain in ts order. Empty result = intact. */
export async function verifyChain(rows: readonly AuditRow[]): Promise<ChainBreak[]> {
  const breaks: ChainBreak[] = [];
  let expectedPrev: string | null = null;
  for (const row of rows) {
    if (row.prevHash !== expectedPrev) breaks.push({ id: row.id, reason: "prev_mismatch" });
    const { chainHash, ...rest } = row;
    if ((await computeChainHash(rest)) !== chainHash) {
      breaks.push({ id: row.id, reason: "hash_mismatch" });
    }
    expectedPrev = chainHash;
  }
  return breaks;
}

/** Load a tenant's chain for verification or the daily R2 anchor (docs/12 §1). */
export async function chainFor(ctx: Ctx, fromTs = 0, limit = 10_000): Promise<AuditRow[]> {
  return ctx.db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.tenantId, ctx.tenantId))
    .orderBy(schema.auditLog.ts, schema.auditLog.id)
    .limit(limit)
    .then((rows: AuditRow[]) => rows.filter((r) => r.ts >= fromTs));
}
