// docs/05 §7 + docs/06 §4. The onboarding checklists, in one place: partners,
// channels and staff. They live in core rather than next to the engine that
// writes them because the seeders need the same catalogue and packages/core
// cannot import app code — three hand-kept copies of "what must be proved
// before this goes live" is how a step quietly disappears.

/** A step as a template declares it. Rows are written from this shape verbatim. */
export interface StepDef {
  key: string;
  /**
   * `{en, ar}` where the label is counterparty-facing copy that already exists
   * in both languages, `{key}` where it is an i18n key (CLAUDE.md §7).
   */
  labelJson: { en: string; ar: string } | { key: string };
  seq: number;
  required: boolean;
  /** The stage this step must clear before the subject may enter it. */
  gatesStage: string;
  /** `null` where clearing the step leaves no artefact. */
  evidenceKind: string | null;
  /** Role key that owns the step; resolved to a user id by the caller's map. */
  ownerRole?: string;
}

/**
 * What a real aggregator actually has to prove before a counterparty may trade,
 * and what the back office has to prove before a person is live or gone.
 *
 * The order is the order the work happens in; `gatesStage` is where it becomes
 * blocking, which is not always the same thing — a rate card is negotiated long
 * before the integration but nothing may reach `agreement` without it.
 */
export const ONBOARDING_TEMPLATES: Record<string, readonly StepDef[]> = {
  "partner.distribution": [
    {
      key: "legal_identity",
      labelJson: { en: "Legal identity verified", ar: "التحقق من الهوية القانونية" },
      seq: 1,
      required: true,
      gatesStage: "applied",
      evidenceKind: "verification",
      ownerRole: "orbit.partners"
    },
    {
      key: "sanctions_pep_screening",
      labelJson: { en: "Sanctions and PEP screening clear", ar: "خلو فحص العقوبات والأشخاص المعرضين سياسياً" },
      seq: 2,
      required: true,
      gatesStage: "screening",
      evidenceKind: "screening",
      ownerRole: "tenant.compliance"
    },
    {
      key: "ubo_disclosure",
      labelJson: { en: "Ultimate beneficial owners disclosed", ar: "الإفصاح عن المالك المستفيد النهائي" },
      seq: 3,
      required: true,
      gatesStage: "diligence",
      evidenceKind: "file",
      ownerRole: "tenant.compliance"
    },
    {
      key: "licence_check",
      labelJson: { en: "Regulatory licence checked", ar: "التحقق من الترخيص التنظيمي" },
      seq: 4,
      required: true,
      gatesStage: "diligence",
      evidenceKind: "verification",
      ownerRole: "tenant.compliance"
    },
    {
      key: "agreement_drafted",
      labelJson: { en: "Agreement drafted", ar: "صياغة الاتفاقية" },
      seq: 5,
      required: true,
      gatesStage: "agreement",
      evidenceKind: "agreement",
      ownerRole: "orbit.partners"
    },
    {
      key: "agreement_countersigned",
      labelJson: { en: "Agreement countersigned", ar: "توقيع الاتفاقية من الطرفين" },
      seq: 6,
      required: true,
      gatesStage: "agreement",
      evidenceKind: "agreement",
      ownerRole: "tenant.admin"
    },
    {
      key: "rate_card_agreed",
      labelJson: { en: "Commission rate card agreed", ar: "الاتفاق على جدول العمولات" },
      seq: 7,
      required: true,
      gatesStage: "agreement",
      evidenceKind: "attestation",
      ownerRole: "orbit.partners"
    },
    {
      key: "payout_method",
      labelJson: { en: "Payout method verified", ar: "التحقق من وسيلة صرف المستحقات" },
      seq: 8,
      required: true,
      gatesStage: "integration",
      evidenceKind: "verification",
      ownerRole: "finance.controller"
    },
    {
      key: "api_credentials",
      labelJson: { en: "API credentials issued", ar: "إصدار بيانات اعتماد الواجهة البرمجية" },
      seq: 9,
      required: true,
      gatesStage: "integration",
      evidenceKind: "attestation",
      ownerRole: "dev.admin"
    },
    {
      key: "sandbox_transactions",
      labelJson: { en: "Sandbox transactions passed", ar: "اجتياز معاملات البيئة التجريبية" },
      seq: 10,
      required: true,
      gatesStage: "sandbox",
      evidenceKind: "attestation",
      ownerRole: "dev.admin"
    },
    {
      key: "go_live_signoff",
      labelJson: { en: "Go-live sign-off", ar: "اعتماد الإطلاق" },
      seq: 11,
      required: true,
      gatesStage: "live",
      evidenceKind: "attestation",
      ownerRole: "orbit.partners"
    }
  ],
  "channel.b2b": [
    {
      key: "channel_owner_assigned",
      labelJson: { en: "Channel owner assigned", ar: "تعيين مسؤول القناة" },
      seq: 1,
      required: true,
      gatesStage: "applied",
      evidenceKind: "attestation",
      ownerRole: "orbit.partners"
    },
    {
      key: "partner_agreement_linked",
      labelJson: { en: "Partner agreement in force", ar: "اتفاقية الشريك سارية" },
      seq: 2,
      required: true,
      gatesStage: "agreement",
      evidenceKind: "agreement",
      ownerRole: "orbit.partners"
    },
    {
      key: "rate_card_agreed",
      labelJson: { en: "Commission rate card agreed", ar: "الاتفاق على جدول العمولات" },
      seq: 3,
      required: true,
      gatesStage: "agreement",
      evidenceKind: "attestation",
      ownerRole: "orbit.partners"
    },
    {
      key: "settlement_terms",
      labelJson: { en: "Settlement terms agreed", ar: "الاتفاق على شروط التسوية" },
      seq: 4,
      required: true,
      gatesStage: "agreement",
      evidenceKind: "attestation",
      ownerRole: "finance.controller"
    },
    {
      key: "disclosure_copy_approved",
      labelJson: { en: "Disclosure wording approved", ar: "اعتماد نص الإفصاح" },
      seq: 5,
      required: true,
      gatesStage: "integration",
      evidenceKind: "file",
      ownerRole: "tenant.compliance"
    },
    {
      key: "api_credentials",
      labelJson: { en: "API credentials issued", ar: "إصدار بيانات اعتماد الواجهة البرمجية" },
      seq: 6,
      required: true,
      gatesStage: "integration",
      evidenceKind: "attestation",
      ownerRole: "dev.admin"
    },
    {
      key: "branding_assets",
      labelJson: { en: "Branding assets received", ar: "استلام أصول العلامة التجارية" },
      seq: 7,
      required: false,
      gatesStage: "integration",
      evidenceKind: "file",
      ownerRole: "orbit.partners"
    },
    {
      key: "uat_transactions",
      labelJson: { en: "UAT transactions passed", ar: "اجتياز معاملات الاختبار" },
      seq: 8,
      required: true,
      gatesStage: "sandbox",
      evidenceKind: "attestation",
      ownerRole: "dev.admin"
    },
    {
      key: "go_live_signoff",
      labelJson: { en: "Go-live sign-off", ar: "اعتماد الإطلاق" },
      seq: 9,
      required: true,
      gatesStage: "live",
      evidenceKind: "attestation",
      ownerRole: "orbit.partners"
    }
  ],
  // Staff stages are the employment ladder (`hired`, `active`, `offboarded`),
  // not the counterparty one, and the labels are i18n keys because these are
  // internal screens.
  "staff.onboard": [
    { key: "contract_signed", labelJson: { key: "onboarding.staff.contract_signed" }, seq: 1, required: true, gatesStage: "hired", evidenceKind: "agreement" },
    { key: "right_to_work", labelJson: { key: "onboarding.staff.right_to_work" }, seq: 2, required: true, gatesStage: "hired", evidenceKind: "verification" },
    { key: "background_check", labelJson: { key: "onboarding.staff.background_check" }, seq: 3, required: true, gatesStage: "hired", evidenceKind: "screening" },
    { key: "policy_attestations", labelJson: { key: "onboarding.staff.policy_attestations" }, seq: 4, required: true, gatesStage: "active", evidenceKind: "attestation" },
    { key: "security_training", labelJson: { key: "onboarding.staff.security_training" }, seq: 5, required: true, gatesStage: "active", evidenceKind: "attestation" },
    { key: "systems_access", labelJson: { key: "onboarding.staff.systems_access" }, seq: 6, required: true, gatesStage: "active", evidenceKind: null },
    { key: "manager_signoff", labelJson: { key: "onboarding.staff.manager_signoff" }, seq: 7, required: true, gatesStage: "active", evidenceKind: "attestation" }
  ],
  "staff.offboard": [
    { key: "access_revoked", labelJson: { key: "offboarding.staff.access_revoked" }, seq: 1, required: true, gatesStage: "offboarded", evidenceKind: null },
    { key: "work_reassigned", labelJson: { key: "offboarding.staff.work_reassigned" }, seq: 2, required: true, gatesStage: "offboarded", evidenceKind: null },
    { key: "assets_returned", labelJson: { key: "offboarding.staff.assets_returned" }, seq: 3, required: true, gatesStage: "offboarded", evidenceKind: null },
    { key: "final_pay", labelJson: { key: "offboarding.staff.final_pay" }, seq: 4, required: true, gatesStage: "offboarded", evidenceKind: "attestation" },
    { key: "exit_interview", labelJson: { key: "offboarding.staff.exit_interview" }, seq: 5, required: false, gatesStage: "offboarded", evidenceKind: null }
  ]
};
