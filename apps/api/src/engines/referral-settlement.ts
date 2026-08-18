import { and, eq } from "drizzle-orm";
import { schema } from "@lyra/db";
import { audit, conflict, emit, type Ctx } from "@lyra/core";
import { buildRecipe, runTxn } from "@lyra/ledger";

export interface QualifyReferralInput {
  referralRef: string;
  channelId?: string | undefined;
}

export async function qualifyReferral(ctx: Ctx, input: QualifyReferralInput) {
  const txn = await runTxn(ctx, {
    type: "REFERRAL-QUAL",
    idempotencyKey: `dist.referral.qualify:${input.referralRef}`,
    subjectRefs: { referral: input.referralRef, ...(input.channelId ? { channel: input.channelId } : {}) }
  });

  await audit(ctx, {
    action: "dist.referral.qualify",
    subjectRef: input.referralRef,
    after: { txnId: txn.id, channelId: input.channelId ?? null }
  });
  await emit(ctx, {
    module: "dist",
    type: "dist.referral.qualified",
    subject: input.referralRef,
    data: { referralRef: input.referralRef, channelId: input.channelId ?? null, txnId: txn.id }
  });
  return { txn };
}

export interface SettleReferralInput {
  referralRef: string;
  currency: string;
  grossMinor: number;
  channelMinor?: number | undefined;
}

export async function settleReferral(ctx: Ctx, input: SettleReferralInput) {
  const qualifyKey = `dist.referral.qualify:${input.referralRef}`;
  const rows = await ctx.db
    .select({ id: schema.ledgerTxns.id, state: schema.ledgerTxns.state })
    .from(schema.ledgerTxns)
    .where(and(eq(schema.ledgerTxns.tenantId, ctx.tenantId), eq(schema.ledgerTxns.idempotencyKey, qualifyKey)))
    .limit(1);
  const qualifyTxn = rows[0];
  if (!qualifyTxn || qualifyTxn.state !== "settled") {
    throw conflict(`referral ${input.referralRef} has not been qualified`);
  }

  const txn = await runTxn(
    ctx,
    {
      type: "REFERRAL-SETL",
      idempotencyKey: `dist.referral.settle:${input.referralRef}`,
      currency: input.currency,
      grossMinor: input.grossMinor,
      parentTxnId: qualifyTxn.id,
      subjectRefs: { referral: input.referralRef }
    },
    {
      recipe: {
        lines: buildRecipe("REFERRAL-SETL", { grossMinor: input.grossMinor, channelMinor: input.channelMinor ?? 0 }),
        currency: input.currency
      }
    }
  );

  await audit(ctx, {
    action: "dist.referral.settle",
    subjectRef: input.referralRef,
    after: { txnId: txn.id, grossMinor: input.grossMinor }
  });
  await emit(ctx, {
    module: "dist",
    type: "dist.referral.settled",
    subject: input.referralRef,
    data: {
      referralRef: input.referralRef,
      grossMinor: input.grossMinor,
      channelMinor: input.channelMinor ?? 0,
      currency: input.currency,
      txnId: txn.id
    }
  });
  return { txn };
}
