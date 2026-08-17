import { audit, conflict, emit, scoped, type Ctx } from "@lyra/core";
import { id as newId, schema } from "@lyra/db";
import { buildRecipe, runTxn } from "@lyra/ledger";
import { and, eq } from "drizzle-orm";
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

  // ponytail: quote.amountMinor is premium, not commission — PARTNER-BIND
  // (docs/19 §5.2 C) expects gross commission here; orbit_partners has no
  // commission-rate column yet to derive it. Also check receivableAccount:
  // sibling EXT-RSHARE pairs 4075 with 1160, this recipe still defaults to
  // 1100. Resolve before bindPartner() gets a route.
  const grossMinor = quote.amountMinor;
  const shareMinor = quote.revshareCalcMinor;

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

  let shareTxn: Awaited<ReturnType<typeof runTxn>> | null = null;
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

  // Retry after a dropped response replays the same idempotencyKey, so
  // runTxn above returns the same bindTxn — but the row/audit/emit below are
  // not naturally idempotent, so guard them explicitly on that existing row.
  const existing = await ctx.db
    .select()
    .from(schema.orbitPartnerTxns)
    .where(
      scoped(
        ctx,
        schema.orbitPartnerTxns,
        and(
          eq(schema.orbitPartnerTxns.partnerId, partnerId),
          eq(schema.orbitPartnerTxns.kind, "bind"),
          eq(schema.orbitPartnerTxns.txnRef, bindTxn.id)
        )
      )
    );
  const bindRow = existing[0];

  if (bindRow) {
    return {
      id: bindRow.id,
      partnerId: bindRow.partnerId,
      quoteId,
      bindTxnId: bindTxn.id,
      shareTxnId: shareTxn?.id ?? null,
      grossMinor: bindRow.amountMinor,
      shareMinor: bindRow.revshareCalcMinor ?? 0,
      currency: bindRow.currency
    };
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
