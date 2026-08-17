import { audit, conflict, emit, type Ctx } from "@lyra/core";
import { id as newId, schema } from "@lyra/db";
import { buildRecipe, runTxn } from "@lyra/ledger";
import { must } from "../rows.js";

export interface PartnerBindResult {
  id: string;
  partnerId: string;
  quoteId: string;
  bindTxnId: string;
  shareTxnId: string | null;
  grossMinor: number;
  shareMinor: number;
  currency: string;
}

export async function bindPartner(ctx: Ctx, partnerId: string, quoteId: string): Promise<PartnerBindResult> {
  const partner = await must(ctx, schema.orbitPartners, partnerId, "partner");
  if (partner.status === "terminated" || partner.status === "suspended") {
    throw conflict(`partner is ${partner.status}`);
  }

  const quote = await must(ctx, schema.orbitPartnerTxns, quoteId, "quote");
  if (quote.partnerId !== partnerId) throw conflict("quote does not belong to this partner");
  if (quote.kind !== "quote") throw conflict(`txn ${quoteId} is not a quote`);

  const grossMinor = quote.amountMinor;
  const shareMinor = quote.revshareCalcMinor ?? 0;

  const bindTxn = await runTxn(
    ctx,
    {
      type: "PARTNER-BIND",
      idempotencyKey: `orbit.partner_bind:${quoteId}`,
      currency: quote.currency,
      grossMinor,
      subjectRefs: { partner: partnerId }
    },
    { recipe: { lines: buildRecipe("PARTNER-BIND", { grossMinor }), currency: quote.currency } }
  );

  let shareTxn = null;
  if (shareMinor > 0) {
    shareTxn = await runTxn(
      ctx,
      {
        type: "RSHARE-ACCR",
        idempotencyKey: `orbit.partner_bind.rshare:${quoteId}`,
        currency: quote.currency,
        grossMinor: shareMinor,
        parentTxnId: bindTxn.id,
        subjectRefs: { partner: partnerId }
      },
      { recipe: { lines: buildRecipe("RSHARE-ACCR", { amountMinor: shareMinor }), currency: quote.currency } }
    );
  }

  const id = newId("otx", ctx.now);
  await ctx.db.insert(schema.orbitPartnerTxns).values({
    id,
    tenantId: ctx.tenantId,
    partnerId,
    kind: "bind",
    payloadHash: quote.payloadHash,
    amountMinor: grossMinor,
    currency: quote.currency,
    revshareCalcMinor: shareMinor,
    settlementBatch: null,
    txnRef: bindTxn.id,
    ts: ctx.now
  });

  await audit(ctx, {
    action: "orbit.partner.bind",
    subjectRef: partnerId,
    after: { id, quoteId, bindTxnId: bindTxn.id, shareTxnId: shareTxn?.id ?? null, grossMinor, shareMinor }
  });
  await emit(ctx, {
    module: "orbit",
    type: "orbit.partner.bound",
    subject: partnerId,
    data: { partnerId, quoteId, bindTxnId: bindTxn.id, shareTxnId: shareTxn?.id ?? null, grossMinor, currency: quote.currency }
  });

  return {
    id,
    partnerId,
    quoteId,
    bindTxnId: bindTxn.id,
    shareTxnId: shareTxn?.id ?? null,
    grossMinor,
    shareMinor,
    currency: quote.currency
  };
}
