import { id, schema } from "@lyra/db";
import { and, eq } from "drizzle-orm";
import { canonicalJson, sha256Hex } from "../crypto.js";
import { DAY, HOUR, type SeedContext } from "./context.js";

// The counterparty side of the demo, told through the checklist that produced
// it: Alpha Brokers is live because eleven steps were closed and one was waived
// by name; Etisalat is not live because a sanctions screening came back
// inconclusive and the gate did its job; Careem's b2b channel is half-built.
//
// Three approvals, one waiver, one open screening and two agreement versions —
// the point is that "live" is a thing that was earned, not a status somebody
// typed.
//
// ponytail: the step definitions are duplicated from `TEMPLATES` in
// apps/api/src/engines/onboarding.ts because packages/core cannot import app
// code. Move TEMPLATES into packages/core if a second consumer appears.

type Def = {
  key: string;
  en: string;
  ar: string;
  seq: number;
  gates: string;
  evidence: string;
  required?: boolean;
};

const PARTNER_TEMPLATE: readonly Def[] = [
  { key: "legal_identity", en: "Legal identity verified", ar: "التحقق من الهوية القانونية", seq: 1, gates: "applied", evidence: "verification" },
  { key: "sanctions_pep_screening", en: "Sanctions and PEP screening clear", ar: "خلو فحص العقوبات والأشخاص المعرضين سياسياً", seq: 2, gates: "screening", evidence: "screening" },
  { key: "ubo_disclosure", en: "Ultimate beneficial owners disclosed", ar: "الإفصاح عن المالك المستفيد النهائي", seq: 3, gates: "diligence", evidence: "file" },
  { key: "licence_check", en: "Regulatory licence checked", ar: "التحقق من الترخيص التنظيمي", seq: 4, gates: "diligence", evidence: "verification" },
  { key: "agreement_drafted", en: "Agreement drafted", ar: "صياغة الاتفاقية", seq: 5, gates: "agreement", evidence: "agreement" },
  { key: "agreement_countersigned", en: "Agreement countersigned", ar: "توقيع الاتفاقية من الطرفين", seq: 6, gates: "agreement", evidence: "agreement" },
  { key: "rate_card_agreed", en: "Commission rate card agreed", ar: "الاتفاق على جدول العمولات", seq: 7, gates: "agreement", evidence: "attestation" },
  { key: "payout_method", en: "Payout method verified", ar: "التحقق من وسيلة صرف المستحقات", seq: 8, gates: "integration", evidence: "verification" },
  { key: "api_credentials", en: "API credentials issued", ar: "إصدار بيانات اعتماد الواجهة البرمجية", seq: 9, gates: "integration", evidence: "attestation" },
  { key: "sandbox_transactions", en: "Sandbox transactions passed", ar: "اجتياز معاملات البيئة التجريبية", seq: 10, gates: "sandbox", evidence: "attestation" },
  { key: "go_live_signoff", en: "Go-live sign-off", ar: "اعتماد الإطلاق", seq: 11, gates: "live", evidence: "attestation" }
];

const CHANNEL_TEMPLATE: readonly Def[] = [
  { key: "channel_owner_assigned", en: "Channel owner assigned", ar: "تعيين مسؤول القناة", seq: 1, gates: "applied", evidence: "attestation" },
  { key: "partner_agreement_linked", en: "Partner agreement in force", ar: "اتفاقية الشريك سارية", seq: 2, gates: "agreement", evidence: "agreement" },
  { key: "rate_card_agreed", en: "Commission rate card agreed", ar: "الاتفاق على جدول العمولات", seq: 3, gates: "agreement", evidence: "attestation" },
  { key: "settlement_terms", en: "Settlement terms agreed", ar: "الاتفاق على شروط التسوية", seq: 4, gates: "agreement", evidence: "attestation" },
  { key: "disclosure_copy_approved", en: "Disclosure wording approved", ar: "اعتماد نص الإفصاح", seq: 5, gates: "integration", evidence: "file" },
  { key: "api_credentials", en: "API credentials issued", ar: "إصدار بيانات اعتماد الواجهة البرمجية", seq: 6, gates: "integration", evidence: "attestation" },
  { key: "branding_assets", en: "Branding assets received", ar: "استلام أصول العلامة التجارية", seq: 7, gates: "integration", evidence: "file", required: false },
  { key: "uat_transactions", en: "UAT transactions passed", ar: "اجتياز معاملات الاختبار", seq: 8, gates: "sandbox", evidence: "attestation" },
  { key: "go_live_signoff", en: "Go-live sign-off", ar: "اعتماد الإطلاق", seq: 9, gates: "live", evidence: "attestation" }
];

/** Per-step outcome; anything not named stays `pending`. */
interface Outcome {
  state: string;
  evidenceRef?: string;
  owner?: string;
  decidedBy?: string;
  decidedAt?: number;
  notes?: Record<string, unknown>;
  waivedApprovalId?: string;
}

async function partnerByName(ctx: SeedContext, name: string): Promise<string> {
  const [row] = await ctx.db
    .select({ id: schema.orbitPartners.id })
    .from(schema.orbitPartners)
    .where(and(eq(schema.orbitPartners.tenantId, ctx.tenantId), eq(schema.orbitPartners.name, name)))
    .limit(1);
  if (!row) throw new Error(`seed: no partner named ${name}`);
  return row.id;
}

export async function seedOnboarding(ctx: SeedContext): Promise<void> {
  const { db, tenantId, now } = ctx;
  const dana = `user:${ctx.users["orbit.partners"]!}`; // partner desk — runs the checklist
  const khalid = `user:${ctx.users["tenant.compliance"]!}`; // decides waivers
  const amina = ctx.users["tenant.admin"]!; // holds dist:agreements:sign
  const faisal = `user:${ctx.users["finance.controller"]!}`;
  const raed = `user:${ctx.users["dev.admin"]!}`;

  const alpha = await partnerByName(ctx, "Alpha Brokers");
  const telco = await partnerByName(ctx, "Etisalat Mobility");
  const careem = await partnerByName(ctx, "Careem Everything");

  const wentLive = now - 380 * DAY;
  const hash = async (value: unknown): Promise<string> => sha256Hex(canonicalJson(value));

  /* ---- diligence evidence -------------------------------------------------
   * Two screenings, two outcomes. Alpha's cleared 400 days ago; Etisalat's came
   * back inconclusive on a name match against a PEP list and nobody has
   * dispositioned it, which is precisely why they are still at `applied`. */
  const scr = { alpha: id("scr", now + 1), telco: id("scr", now + 2) };
  await db.insert(schema.screenings).values([
    {
      id: scr.alpha,
      tenantId,
      subjectRef: alpha,
      kind: "sanctions",
      provider: "dow_jones",
      queryHash: await hash({ name: "Alpha Brokers Insurance Services LLC", country: "AE" }),
      result: "clear",
      blocked: false,
      dispositionedBy: khalid,
      disposition: "No matches above threshold.",
      ts: now - 398 * DAY
    },
    {
      id: scr.telco,
      tenantId,
      subjectRef: telco,
      kind: "pep",
      provider: "dow_jones",
      queryHash: await hash({ name: "Etisalat Mobility Services FZ-LLC", country: "AE" }),
      result: "inconclusive",
      hitsJson: JSON.stringify([
        { name: "H. Al Zaabi", list: "pep_gcc", score: 71, note: "Common name; board membership unconfirmed." }
      ]),
      blocked: false,
      ts: now - 18 * DAY
    }
  ]);

  /* ---- approvals ----------------------------------------------------------
   * The three consequential moves in this file, each with the shape
   * packages/core/src/approvals.ts would have written. */
  const apr = { waive: id("apr", now + 80), sign: id("apr", now + 81), activate: id("apr", now + 82) };
  const alphaSteps = stepIds(now, 0, PARTNER_TEMPLATE);
  const agreement = { v1: id("pag", now + 1), v2: id("pag", now + 2) };

  await db.insert(schema.approvals).values([
    {
      id: apr.waive,
      tenantId,
      subjectRef: alphaSteps["ubo_disclosure"]!,
      policyKey: "core.onboarding_waive",
      module: "core",
      requestedBy: dana,
      requestedAt: wentLive - 12 * DAY,
      decidedBy: khalid,
      decision: "approved",
      reason: "Listed entity — beneficial ownership is public on the DFSA register; documented reliance.",
      contextJson: JSON.stringify({
        subjectKind: "partner",
        subjectRef: alpha,
        key: "ubo_disclosure",
        dualControl: true
      }),
      decidedAt: wentLive - 11 * DAY
    },
    {
      id: apr.sign,
      tenantId,
      subjectRef: agreement.v1,
      policyKey: "dist.agreement_sign",
      module: "core",
      requestedBy: dana,
      requestedAt: wentLive - 6 * DAY,
      // Dual control: the desk that drafted it is not the signature on it.
      decidedBy: `user:${amina}`,
      decision: "approved",
      reason: "Terms match the approved distribution template; 30-day termination notice retained.",
      contextJson: JSON.stringify({ partnerId: alpha, version: 1, kind: "distribution", dualControl: true }),
      decidedAt: wentLive - 5 * DAY
    },
    {
      id: apr.activate,
      tenantId,
      subjectRef: alpha,
      policyKey: "dist.partner_activate",
      module: "core",
      requestedBy: dana,
      requestedAt: wentLive - HOUR,
      decidedBy: dana,
      decision: "approved",
      reason: "Sandbox pack passed on 42 of 42 transactions.",
      contextJson: JSON.stringify({ stage: "live", sandbox: false }),
      decidedAt: wentLive
    }
  ]);

  /* ---- Alpha Brokers: live, and it shows its working --------------------- */
  await db.insert(schema.onboardingSteps).values(
    rows(ctx, alphaSteps, "partner", alpha, "partner.distribution", PARTNER_TEMPLATE, wentLive - 30 * DAY, {
      legal_identity: { state: "done", evidenceRef: "doc:alpha/trade-licence-DED-611904.pdf", decidedBy: dana, decidedAt: wentLive - 28 * DAY },
      sanctions_pep_screening: { state: "done", evidenceRef: scr.alpha, owner: khalid, decidedBy: khalid, decidedAt: wentLive - 27 * DAY },
      ubo_disclosure: {
        state: "waived",
        owner: khalid,
        decidedBy: khalid,
        decidedAt: wentLive - 11 * DAY,
        waivedApprovalId: apr.waive,
        notes: { reason: "Listed entity — beneficial ownership is public on the DFSA register." }
      },
      licence_check: { state: "done", evidenceRef: "doc:alpha/ia-broker-registration-2024.pdf", owner: khalid, decidedBy: khalid, decidedAt: wentLive - 20 * DAY },
      agreement_drafted: { state: "done", evidenceRef: agreement.v1, decidedBy: dana, decidedAt: wentLive - 7 * DAY },
      agreement_countersigned: { state: "done", evidenceRef: agreement.v1, decidedBy: `user:${amina}`, decidedAt: wentLive - 5 * DAY },
      rate_card_agreed: { state: "done", evidenceRef: dana, decidedBy: dana, decidedAt: wentLive - 5 * DAY },
      payout_method: { state: "done", evidenceRef: "payout:mandate:alpha-enbd-9931", owner: faisal, decidedBy: faisal, decidedAt: wentLive - 3 * DAY },
      api_credentials: { state: "done", evidenceRef: "alpha-brokers-live", owner: raed, decidedBy: raed, decidedAt: wentLive - 2 * DAY },
      sandbox_transactions: { state: "done", evidenceRef: raed, owner: raed, decidedBy: raed, decidedAt: wentLive - DAY },
      go_live_signoff: { state: "done", evidenceRef: dana, decidedBy: dana, decidedAt: wentLive }
    })
  );

  /* ---- Etisalat Mobility: held at the screening gate --------------------- */
  const telcoSteps = stepIds(now, 20, PARTNER_TEMPLATE);
  await db.insert(schema.onboardingSteps).values(
    rows(ctx, telcoSteps, "partner", telco, "partner.distribution", PARTNER_TEMPLATE, now - 21 * DAY, {
      legal_identity: { state: "done", evidenceRef: "doc:etisalat/fz-llc-certificate.pdf", decidedBy: dana, decidedAt: now - 19 * DAY },
      // Open, not failed: an inconclusive hit is work, not a decision. Nothing
      // moves past `applied` until compliance dispositions it.
      sanctions_pep_screening: { state: "in_progress", evidenceRef: scr.telco, owner: khalid },
      ubo_disclosure: { state: "in_progress", owner: khalid },
      licence_check: { state: "pending", owner: khalid }
    })
  );

  /* ---- Careem: the channel, half-built ----------------------------------
   * The channel row exists but is paused — a b2b channel is created when the
   * integration starts, not when it goes live, or there is nothing to hang the
   * credentials and the rate card on. */
  const careemChannel = id("ch", now + 80);
  await db.insert(schema.distChannels).values({
    id: careemChannel,
    tenantId,
    key: "careem-superapp",
    kind: "b2b",
    nameJson: JSON.stringify({ en: "Careem Everything", ar: "كريم إيفريثنغ" }),
    partnerId: careem,
    medium: "app",
    collectsPayment: "partner",
    settlementTermsJson: JSON.stringify({ frequency: "monthly", dayOfMonth: 5, netDays: 30, minPayoutMinor: 75_000 }),
    defaultCommissionPpm: 275_000,
    currency: "AED",
    status: "paused",
    createdAt: now - 55 * DAY,
    updatedAt: now - 5 * DAY
  });

  const channelSteps = stepIds(now, 40, CHANNEL_TEMPLATE);
  await db.insert(schema.onboardingSteps).values(
    rows(ctx, channelSteps, "channel", careemChannel, "channel.b2b", CHANNEL_TEMPLATE, now - 50 * DAY, {
      channel_owner_assigned: { state: "done", evidenceRef: dana, decidedBy: dana, decidedAt: now - 50 * DAY },
      rate_card_agreed: { state: "done", evidenceRef: dana, decidedBy: dana, decidedAt: now - 30 * DAY },
      settlement_terms: { state: "done", evidenceRef: faisal, owner: faisal, decidedBy: faisal, decidedAt: now - 28 * DAY },
      // No agreement has been signed with Careem, so the channel cannot reach
      // `agreement` however far the integration has run ahead.
      partner_agreement_linked: { state: "pending" },
      disclosure_copy_approved: { state: "in_progress", owner: khalid },
      api_credentials: { state: "done", evidenceRef: "careem-sandbox", owner: raed, decidedBy: raed, decidedAt: now - 12 * DAY },
      branding_assets: { state: "done", evidenceRef: "doc:careem/brand-kit-v3.zip", decidedBy: dana, decidedAt: now - 10 * DAY }
    })
  );

  /* ---- agreements ---------------------------------------------------------
   * v1 governs today. v2 is the renegotiated rate card sitting with Alpha for
   * signature — drafted, not in force, and it will not supersede v1 until the
   * `dist.agreement_sign` gate clears. */
  await db.insert(schema.distPartnerAgreements).values([
    {
      id: agreement.v1,
      tenantId,
      partnerId: alpha,
      version: 1,
      kind: "distribution",
      termsJson: JSON.stringify({
        settlement: { frequency: "monthly", dayOfMonth: 10, netDays: 15, minPayoutMinor: 50_000 },
        rateCard: { defaultSharePpm: 300_000, motorSharePpm: 350_000, healthSharePpm: 250_000 },
        clawbackDays: 60,
        exclusivity: false,
        territories: ["AE"],
        terminationNoticeDays: 30
      }),
      documentFileId: "doc:alpha/distribution-agreement-v1.pdf",
      signedByUserId: amina,
      signedByPartnerName: "Layla Mansour",
      signedAt: wentLive - 5 * DAY,
      effectiveFrom: wentLive - 5 * DAY,
      state: "active",
      approvalId: apr.sign,
      createdBy: dana,
      createdAt: wentLive - 7 * DAY,
      updatedAt: wentLive - 5 * DAY
    },
    {
      id: agreement.v2,
      tenantId,
      partnerId: alpha,
      version: 2,
      kind: "distribution",
      termsJson: JSON.stringify({
        settlement: { frequency: "monthly", dayOfMonth: 10, netDays: 15, minPayoutMinor: 50_000 },
        rateCard: { defaultSharePpm: 320_000, motorSharePpm: 350_000, healthSharePpm: 275_000 },
        clawbackDays: 90,
        exclusivity: false,
        territories: ["AE", "SA"],
        terminationNoticeDays: 30
      }),
      documentFileId: "doc:alpha/distribution-agreement-v2-draft.pdf",
      state: "pending_signature",
      supersedesId: agreement.v1,
      createdBy: dana,
      createdAt: now - 9 * DAY,
      updatedAt: now - 2 * DAY
    }
  ]);

  /* ---- the partner rows the checklist earned ---------------------------- */
  await db
    .update(schema.orbitPartners)
    .set({
      stage: "live",
      ownerRef: dana,
      legalName: "Alpha Brokers Insurance Services LLC",
      registrationNo: "DED-611904",
      taxId: "100234567800003",
      country: "AE",
      screeningId: scr.alpha,
      riskRating: "low",
      agreementId: agreement.v1,
      payoutMethodRef: "payout:mandate:alpha-enbd-9931",
      goLiveAt: wentLive,
      updatedAt: wentLive
    })
    .where(and(eq(schema.orbitPartners.tenantId, tenantId), eq(schema.orbitPartners.id, alpha)));

  await db
    .update(schema.orbitPartners)
    .set({
      stage: "applied",
      ownerRef: dana,
      legalName: "Etisalat Mobility Services FZ-LLC",
      registrationNo: "FZ-LLC-88217",
      country: "AE",
      screeningId: scr.telco,
      riskRating: "medium",
      updatedAt: now - 18 * DAY
    })
    .where(and(eq(schema.orbitPartners.tenantId, tenantId), eq(schema.orbitPartners.id, telco)));

  await db
    .update(schema.orbitPartners)
    // No stage: Careem's partner-level checklist has not been started, and a
    // stage nothing gates would be exactly the typed-in status this engine
    // exists to replace. The channel above is where their work actually is.
    .set({ ownerRef: dana, legalName: "Careem Everything FZ-LLC", country: "AE", riskRating: "medium", updatedAt: now - 5 * DAY })
    .where(and(eq(schema.orbitPartners.tenantId, tenantId), eq(schema.orbitPartners.id, careem)));
}

/** Ids minted up front so an approval can point at the step it waived. */
function stepIds(now: number, offset: number, defs: readonly Def[]): Record<string, string> {
  return Object.fromEntries(defs.map((d, i) => [d.key, id("obs", now + offset + i)]));
}

function rows(
  ctx: SeedContext,
  ids: Record<string, string>,
  subjectKind: string,
  subjectRef: string,
  template: string,
  defs: readonly Def[],
  startedAt: number,
  outcomes: Record<string, Outcome>
): (typeof schema.onboardingSteps.$inferInsert)[] {
  return defs.map((d) => {
    const o = outcomes[d.key];
    return {
      id: ids[d.key]!,
      tenantId: ctx.tenantId,
      subjectKind,
      subjectRef,
      template,
      key: d.key,
      labelJson: JSON.stringify({ en: d.en, ar: d.ar }),
      seq: d.seq,
      required: d.required ?? true,
      gatesStage: d.gates,
      state: o?.state ?? "pending",
      evidenceKind: d.evidence,
      evidenceRef: o?.evidenceRef ?? null,
      ownerRef: o?.owner ?? `user:${ctx.users["orbit.partners"]!}`,
      dueAt: null,
      notesJson: o?.notes ? JSON.stringify(o.notes) : null,
      waivedApprovalId: o?.waivedApprovalId ?? null,
      decidedBy: o?.decidedBy ?? null,
      decidedAt: o?.decidedAt ?? null,
      createdAt: startedAt,
      updatedAt: o?.decidedAt ?? startedAt
    };
  });
}
