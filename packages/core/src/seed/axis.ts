import { id, schema } from "@lyra/db";
import { DAY, HOUR, MINUTE, type SeedContext } from "./context.js";
import { monthKey } from "./period.js";

// AXIS is the operations floor, and the core seed has already put the one case
// that matters on it: GNX-2601-0001, Rania Haddad's motor bind, won on Cedar's
// cheapest row. Everything here hangs off that case or off the two policies it
// produced, so the demo reads as one customer's file rather than nine unrelated
// tables that happen to have rows in them.
//
// The rows are chosen so every filter option on the AXIS tabs (apps/web/app/
// modules/axis.ts) selects something. A status filter whose only option returns
// an empty table teaches a reviewer nothing about whether the filter works.

export async function seedAxis(ctx: SeedContext): Promise<void> {
  // `policyId` is deliberately absent: the core seed owns both policy rows and
  // this seeder only ever points at last year's cover, for the reason set out
  // above the claims below.
  const { db, now, tenantId, caseId, customerId, renewalPolicyId, issuedAt } = ctx;
  // Layla works the motor desk; Omar leads it. Every consequential AXIS decision
  // below is requested by one and decided by the other, because both
  // `axis.claim_settlement` and `axis.escrow_release` are dual-control always
  // (packages/core/src/approvals.ts) — one person cannot move this money alone.
  const agent = `user:${ctx.users["axis.agent"]!}`;
  const lead = `user:${ctx.users["axis.lead"]!}`;

  // Delegated underwriting authority (docs/specs/gap-axis-design.md §A.4): no
  // row means no delegated authority and everything above zero refers. The
  // demo tenant writes the row so the seed can bind without every quote
  // opening a referral — the same axis.lead limit the spec uses as its example.
  await db.insert(schema.axisOpsPolicies).values({
    id: id("opl", now - 240 * DAY),
    tenantId,
    key: "axis.authority",
    kind: "authority",
    valueJson: JSON.stringify({
      underwriting: [{ role: "axis.lead", productLine: "*", maxPremiumMinor: 25_000_000 }]
    }),
    status: "active",
    updatedBy: lead,
    createdAt: now - 240 * DAY,
    updatedAt: now - 240 * DAY
  });

  /* --------------------------------------------------------------- claims */
  // Every claim sits on last year's cover (`renewalPolicyId`), not on the policy
  // just sold: that one only incepts at `issuedAt`, two days after the seed
  // clock, so a loss reported against it would predate the cover. A year of
  // claims history therefore belongs to the policy that was actually in force.
  //
  // The provider is Cedar, so Cedar pays the claim and no GONXT money moves —
  // but the settlement figure is still written through the platform, so it still
  // passes the `axis.claim_settlement` gate. The two claims that carry a number
  // have their approval recorded at the bottom of this file; the four that do
  // not carry a number never needed one.
  const claimSettled = id("clm", now - 117 * DAY);
  const claimApproved = id("clm", now - 25 * DAY);
  await db.insert(schema.axisClaims).values([
    {
      // A fresh windscreen chip: nobody has looked at it yet, which is what the
      // `reported` state is for.
      id: id("clm", now - DAY),
      tenantId,
      policyId: renewalPolicyId,
      customerId,
      claimNo: "GNX-CLM-2601-0042",
      incidentAt: now - DAY - 4 * HOUR,
      reportedAt: now - DAY,
      amountMinor: 120_000,
      currency: "AED",
      status: "reported",
      fnolJson: JSON.stringify({
        lossType: "windscreen",
        location: "Sheikh Zayed Road, Dubai",
        description: "Stone chip from a passing truck, spreading crack on the driver's side.",
        thirdParty: false,
        channel: "app"
      }),
      createdAt: now - DAY,
      updatedAt: now - DAY
    },
    {
      id: id("clm", now - 8 * DAY),
      tenantId,
      policyId: renewalPolicyId,
      customerId,
      claimNo: "GNX-CLM-2601-0041",
      incidentAt: now - 9 * DAY,
      reportedAt: now - 8 * DAY,
      amountMinor: 1_450_000,
      currency: "AED",
      status: "assessing",
      assessorRef: agent,
      fnolJson: JSON.stringify({
        lossType: "collision",
        location: "Al Khail Road, Dubai",
        description: "Rear-ended at a standstill in traffic; third party admitted fault at the scene.",
        thirdParty: true,
        policeReportNo: "DXB-2025-884120",
        channel: "app"
      }),
      createdAt: now - 8 * DAY,
      updatedAt: now - 3 * DAY
    },
    {
      // Decided but not paid: the assessment is agreed and the settlement figure
      // is waiting on the approval seeded below. `settledMinor` stays null until
      // that approval clears — writing the number here would be exactly the
      // bypass docs/19 forbids.
      id: claimApproved,
      tenantId,
      policyId: renewalPolicyId,
      customerId,
      claimNo: "GNX-CLM-2512-0038",
      incidentAt: now - 26 * DAY,
      reportedAt: now - 25 * DAY,
      amountMinor: 680_000,
      currency: "AED",
      status: "approved",
      assessorRef: agent,
      fnolJson: JSON.stringify({
        lossType: "collision",
        location: "Dubai Marina underground car park",
        description: "Side panel and mirror damaged by an unidentified vehicle while parked.",
        thirdParty: false,
        policeReportNo: "DXB-2025-861733",
        assessment: { garage: "Al Reem Auto Care", estimateMinor: 680_000, excessMinor: 100_000 },
        channel: "web"
      }),
      createdAt: now - 25 * DAY,
      updatedAt: now - 3 * DAY
    },
    {
      // The repudiation. A denied claim is the row an operations reviewer most
      // wants to open, so the reason is on the record in full sentences rather
      // than as a bare status: who decided, on what cover term, and what the
      // customer was told they can do next.
      id: id("clm", now - 60 * DAY),
      tenantId,
      policyId: renewalPolicyId,
      customerId,
      claimNo: "GNX-CLM-2511-0031",
      incidentAt: now - 62 * DAY,
      reportedAt: now - 60 * DAY,
      amountMinor: 2_310_000,
      currency: "AED",
      status: "rejected",
      assessorRef: lead,
      fnolJson: JSON.stringify({
        lossType: "collision",
        location: "Emirates Road, Sharjah",
        description: "Front-end damage after leaving the carriageway in heavy rain.",
        thirdParty: false,
        policeReportNo: "SHJ-2025-330914",
        decision: {
          outcome: "repudiated",
          reasonKey: "claim.repudiation.driver_not_named",
          decidedBy: lead,
          decidedAt: now - 47 * DAY,
          note:
            "The vehicle was being driven by a person who is not a named driver on the schedule, " +
            "and the policy covers named drivers only. The customer was sent the decision letter " +
            "with the clause quoted and the route to a complaint if they disagree."
        }
      }),
      createdAt: now - 60 * DAY,
      updatedAt: now - 47 * DAY
    },
    {
      // Paid. `settledMinor` is the assessed loss less the AED 1,000 excess that
      // the core seed put on this cover, so the two numbers reconcile instead of
      // being two unrelated invented figures.
      id: claimSettled,
      tenantId,
      policyId: renewalPolicyId,
      customerId,
      claimNo: "GNX-CLM-2509-0019",
      incidentAt: now - 118 * DAY,
      reportedAt: now - 117 * DAY,
      amountMinor: 940_000,
      settledMinor: 840_000,
      currency: "AED",
      status: "settled",
      assessorRef: agent,
      fnolJson: JSON.stringify({
        lossType: "collision",
        location: "Al Wasl Road, Dubai",
        description: "Bumper and headlamp damage in a low-speed collision at a roundabout.",
        thirdParty: true,
        policeReportNo: "DXB-2025-712045",
        assessment: { garage: "Cedar Approved Motors", estimateMinor: 940_000, excessMinor: 100_000 },
        channel: "call_centre"
      }),
      createdAt: now - 117 * DAY,
      updatedAt: now - 102 * DAY
    },
    {
      // Withdrawn by the customer once the repair quote came in under the excess:
      // a claim that ends without money is still a claim, and the tab's
      // `withdrawn` filter has to find it.
      id: id("clm", now - 209 * DAY),
      tenantId,
      policyId: renewalPolicyId,
      customerId,
      claimNo: "GNX-CLM-2506-0007",
      incidentAt: now - 210 * DAY,
      reportedAt: now - 209 * DAY,
      amountMinor: 65_000,
      currency: "AED",
      status: "withdrawn",
      fnolJson: JSON.stringify({
        lossType: "dent",
        location: "Jumeirah Beach Road, Dubai",
        description: "Door dent in a car park; withdrawn once the repair quote came in below the excess.",
        thirdParty: false,
        withdrawnAt: now - 205 * DAY,
        channel: "app"
      }),
      createdAt: now - 209 * DAY,
      updatedAt: now - 205 * DAY
    }
  ]);

  /* ------------------------------------------------------------ documents */
  // The document set for the bind case, in the order it actually arrived. The
  // interesting row is the mulkiya that came back at 41% confidence: the model
  // read a photo of a screen, a human rejected it, and a clean re-upload was
  // verified three hours later. Without a failed extraction on the tab, nothing
  // shows what the confidence column is for.
  //
  // `fileId` points at objects that only exist once someone uploads them — the
  // seed does not fabricate R2 content, so these are placeholders that keep the
  // NOT NULL honest rather than links that resolve.
  await db.insert(schema.axisDocuments).values([
    {
      id: id("doc", now + 5 * MINUTE),
      tenantId,
      caseId,
      fileId: id("fil", now + 5 * MINUTE),
      docType: "eid",
      extractionJson: JSON.stringify({
        name: "Rania Haddad",
        eidNumber: "784-1990-XXXXXXX-X",
        nationality: "LB",
        expiry: "2028-04-17"
      }),
      extractionConfidence: 97,
      extractionModel: "workers-ai/llama-3.2-11b-vision",
      verifiedBy: agent,
      verifiedAt: now + 35 * MINUTE,
      status: "verified",
      createdAt: now + 5 * MINUTE
    },
    {
      id: id("doc", now + 8 * MINUTE),
      tenantId,
      caseId,
      fileId: id("fil", now + 8 * MINUTE),
      docType: "mulkiya",
      // What the model could and could not read. The nulls are the point: a
      // rejection is a human acting on a low-confidence extraction, so the row
      // has to carry the evidence that justified it.
      extractionJson: JSON.stringify({
        plate: null,
        chassis: null,
        make: "Toyota",
        model: null,
        year: null,
        note: "Photograph of a screen; glare over the plate and chassis fields."
      }),
      extractionConfidence: 41,
      extractionModel: "workers-ai/llama-3.2-11b-vision",
      verifiedBy: agent,
      verifiedAt: now + 40 * MINUTE,
      status: "rejected",
      createdAt: now + 8 * MINUTE
    },
    {
      id: id("doc", now + 9 * MINUTE),
      tenantId,
      caseId,
      fileId: id("fil", now + 9 * MINUTE),
      docType: "other",
      extractionJson: JSON.stringify({
        kind: "driving_licence",
        licenceNumber: "DXB-3320118",
        issuedOn: "2016-09-02",
        expiry: "2026-09-01",
        classes: ["light_vehicle"]
      }),
      extractionConfidence: 91,
      extractionModel: "workers-ai/llama-3.2-11b-vision",
      status: "extracted",
      createdAt: now + 9 * MINUTE
    },
    {
      // The clean re-upload that replaced the rejected scan.
      id: id("doc", now + 3 * HOUR),
      tenantId,
      caseId,
      fileId: id("fil", now + 3 * HOUR),
      docType: "mulkiya",
      extractionJson: JSON.stringify({
        plate: "Dubai J 44182",
        chassis: "JTDBR32E870XXXXXX",
        make: "Toyota",
        model: "Corolla",
        year: 2021,
        insuredValueMinor: 4_800_000
      }),
      extractionConfidence: 94,
      extractionModel: "workers-ai/llama-3.2-11b-vision",
      verifiedBy: agent,
      verifiedAt: now + 3 * HOUR + 20 * MINUTE,
      status: "verified",
      createdAt: now + 3 * HOUR
    },
    {
      // In flight: the model has the file and no answer yet, so confidence is
      // null rather than zero. Zero would read as "the model was certain it read
      // nothing", which is a different and untrue statement.
      id: id("doc", now + 20 * HOUR),
      tenantId,
      caseId,
      fileId: id("fil", now + 20 * HOUR),
      docType: "other",
      extractionModel: "workers-ai/llama-3.2-11b-vision",
      status: "extracting",
      createdAt: now + 20 * HOUR
    },
    {
      id: id("doc", now + 21 * HOUR),
      tenantId,
      caseId,
      fileId: id("fil", now + 21 * HOUR),
      docType: "other",
      status: "received",
      createdAt: now + 21 * HOUR
    }
  ]);

  /* ---------------------------------------------------------------- tasks */
  // `titleKey` is an i18n key, never a sentence (CLAUDE.md §7) — the same
  // convention `task.document_missing` already uses on the journey tests. One
  // task is deliberately past its due date so the tab has something to sort to
  // the top and an SLA widget has something to be unhappy about.
  await db.insert(schema.axisTasks).values([
    {
      id: id("tsk", now + 10 * MINUTE),
      tenantId,
      caseId,
      type: "document_verify",
      titleKey: "task.verify_vehicle_registration",
      assigneeRef: agent,
      state: "done",
      dueAt: now + 6 * HOUR,
      checklistJson: JSON.stringify([
        { key: "task.check.plate_matches_quote", done: true },
        { key: "task.check.chassis_legible", done: true },
        { key: "task.check.value_within_band", done: true }
      ]),
      createdBy: "agent:copilot",
      completedAt: now + 3 * HOUR + 20 * MINUTE,
      createdAt: now + 10 * MINUTE,
      updatedAt: now + 3 * HOUR + 20 * MINUTE
    },
    {
      id: id("tsk", now + 20 * HOUR),
      tenantId,
      caseId,
      type: "document_chase",
      titleKey: "task.chase_no_claims_certificate",
      assigneeRef: agent,
      state: "in_progress",
      dueAt: now + DAY,
      createdBy: "agent:copilot",
      createdAt: now + 20 * HOUR,
      updatedAt: now + 21 * HOUR
    },
    {
      id: id("tsk", now + 12 * HOUR),
      tenantId,
      caseId,
      type: "underwriting_check",
      titleKey: "task.confirm_declared_vehicle_value",
      assigneeRef: lead,
      state: "open",
      dueAt: now + 18 * HOUR,
      checklistJson: JSON.stringify([
        { key: "task.check.valuation_source", done: false },
        { key: "task.check.no_undeclared_modifications", done: false }
      ]),
      createdBy: agent,
      createdAt: now + 12 * HOUR,
      updatedAt: now + 12 * HOUR
    },
    {
      // Overdue. The Falcon December batch is short and nobody has chased the
      // credit note, which is why the escrow tab below shows a variance.
      id: id("tsk", now - 5 * DAY),
      tenantId,
      type: "escrow_reconcile",
      titleKey: "task.resolve_escrow_variance",
      assigneeRef: lead,
      state: "open",
      dueAt: now - 2 * DAY,
      createdBy: "agent:copilot",
      createdAt: now - 5 * DAY,
      updatedAt: now - 5 * DAY
    },
    {
      // Blocked on a third party rather than late: the garage has not sent the
      // estimate, so the assessor cannot move and the state says so instead of
      // the task quietly ageing in `open`.
      id: id("tsk", now - 7 * DAY),
      tenantId,
      type: "claim_assess",
      titleKey: "task.assess_collision_claim",
      assigneeRef: agent,
      state: "blocked",
      dueAt: now + 2 * DAY,
      checklistJson: JSON.stringify([
        { key: "task.check.police_report_received", done: true },
        { key: "task.check.garage_estimate_received", done: false },
        { key: "task.check.third_party_insurer_notified", done: true }
      ]),
      createdBy: agent,
      createdAt: now - 7 * DAY,
      updatedAt: now - 4 * DAY
    },
    {
      id: id("tsk", now - 2 * DAY),
      tenantId,
      type: "renewal_prepare",
      titleKey: "task.prepare_renewal_terms",
      assigneeRef: agent,
      state: "open",
      dueAt: now + 5 * DAY,
      createdBy: "agent:renewal",
      createdAt: now - 2 * DAY,
      updatedAt: now - 2 * DAY
    },
    {
      // Cancelled rather than deleted: the claim was repudiated, so gathering
      // more evidence for it stopped being useful. The row is the audit trail of
      // why the work stopped.
      id: id("tsk", now - 58 * DAY),
      tenantId,
      type: "claim_evidence",
      titleKey: "task.collect_claim_evidence",
      assigneeRef: lead,
      state: "cancelled",
      dueAt: now - 55 * DAY,
      createdBy: agent,
      createdAt: now - 58 * DAY,
      updatedAt: now - 47 * DAY
    },
    {
      id: id("tsk", issuedAt),
      tenantId,
      caseId,
      type: "document_file",
      titleKey: "task.file_policy_documents",
      assigneeRef: agent,
      state: "done",
      dueAt: issuedAt + 4 * HOUR,
      createdBy: "agent:copilot",
      completedAt: issuedAt + 15 * MINUTE,
      createdAt: issuedAt,
      updatedAt: issuedAt + 15 * MINUTE
    }
  ]);

  /* -------------------------------------------------------- escrow batches */
  // Client money held per underwriter per month, one batch per (period,
  // provider) — the table's unique key. Two months back plus the month in
  // flight, which is enough for the tab's five states to all be occupied and
  // for the December Cedar batch to sit visibly unreleased.
  const escrowNovCedar = id("esc", now - 62 * DAY);
  const escrowDecCedar = id("esc", now - 32 * DAY);
  await db.insert(schema.axisEscrowBatches).values([
    {
      // Released and closed. It got there through `axis.escrow_release`, and the
      // approval that authorised it is seeded at the bottom of this file —
      // `closedBy` on its own would be a claim with no evidence behind it.
      id: escrowNovCedar,
      tenantId,
      period: monthKey(now, -2),
      providerId: ctx.providers.cedar,
      expectedMinor: 3_482_500,
      receivedMinor: 3_482_500,
      currency: "AED",
      status: "closed",
      evidenceFileId: id("fil", now - 32 * DAY),
      closedBy: lead,
      closedAt: now - 32 * DAY,
      createdAt: now - 62 * DAY,
      updatedAt: now - 32 * DAY
    },
    {
      // Matched to the penny and still waiting: the release approval is pending,
      // so the money is reconciled but has not moved. This is the row the brief
      // calls "awaiting release", and any attempt to reconcile it further will
      // hit the pending approval rather than write through it.
      id: escrowDecCedar,
      tenantId,
      period: monthKey(now, -1),
      providerId: ctx.providers.cedar,
      expectedMinor: 4_115_000,
      receivedMinor: 4_115_000,
      currency: "AED",
      status: "matched",
      createdAt: now - 32 * DAY,
      updatedAt: now - 2 * DAY
    },
    {
      id: id("esc", now - 32 * DAY + 1),
      tenantId,
      period: monthKey(now, -1),
      providerId: ctx.providers.falcon,
      expectedMinor: 2_248_000,
      receivedMinor: 2_229_500,
      currency: "AED",
      status: "variance",
      varianceReason:
        "Falcon remitted AED 185.00 short: a mid-month cancellation was refunded to the customer " +
        "from the batch but the credit note has not come back from the underwriter yet.",
      evidenceFileId: id("fil", now - 6 * DAY),
      createdAt: now - 32 * DAY,
      updatedAt: now - 6 * DAY
    },
    {
      id: id("esc", now - 32 * DAY + 2),
      tenantId,
      period: monthKey(now, -1),
      providerId: ctx.providers.gulfHealth,
      expectedMinor: 5_640_000,
      receivedMinor: 3_120_000,
      currency: "AED",
      status: "reconciling",
      createdAt: now - 32 * DAY,
      updatedAt: now - 4 * DAY
    },
    {
      // The month in flight: premiums are accruing, nothing has been remitted.
      id: id("esc", now - 5 * DAY),
      tenantId,
      period: monthKey(now),
      providerId: ctx.providers.cedar,
      expectedMinor: 1_236_500,
      currency: "AED",
      status: "open",
      createdAt: now - 5 * DAY,
      updatedAt: now - 5 * DAY
    },
    {
      id: id("esc", now - 5 * DAY + 1),
      tenantId,
      period: monthKey(now),
      providerId: ctx.providers.falcon,
      expectedMinor: 892_000,
      currency: "AED",
      status: "open",
      createdAt: now - 5 * DAY,
      updatedAt: now - 5 * DAY
    }
  ]);

  /* ----------------------------------------------------------------- sops */
  // Procedures are versioned, and the version is the point: `motor.bind` v1 is
  // retired next to the v2 that replaced it, so the tab shows what supersession
  // looks like rather than one row per key. Names and step labels are bilingual
  // because a procedure is read by the person doing the work, in their language.
  await db.insert(schema.axisSops).values([
    {
      id: id("sop", now - 240 * DAY),
      tenantId,
      key: "motor.bind",
      version: 1,
      nameJson: JSON.stringify({ en: "Motor bind", ar: "إصدار وثيقة مركبات" }),
      stepsJson: JSON.stringify([
        { key: "collect_documents", en: "Collect Emirates ID and mulkiya", ar: "جمع الهوية والملكية", role: "axis.agent", slaHours: 4 },
        { key: "verify_documents", en: "Verify the extraction by hand", ar: "التحقق من الاستخراج يدويًا", role: "axis.agent", slaHours: 4 },
        { key: "bind", en: "Bind with the underwriter", ar: "الإصدار مع شركة التأمين", role: "axis.lead", slaHours: 8 }
      ]),
      appliesTo: "bind",
      status: "retired",
      createdBy: lead,
      createdAt: now - 240 * DAY
    },
    {
      // v2 adds the value check that the v1 procedure left implicit, which is
      // why an undeclared-modification repudiation was possible under v1.
      id: id("sop", now - 90 * DAY),
      tenantId,
      key: "motor.bind",
      version: 2,
      nameJson: JSON.stringify({ en: "Motor bind", ar: "إصدار وثيقة مركبات" }),
      stepsJson: JSON.stringify([
        { key: "collect_documents", en: "Collect Emirates ID and mulkiya", ar: "جمع الهوية والملكية", role: "axis.agent", slaHours: 4 },
        { key: "verify_documents", en: "Verify the extraction by hand", ar: "التحقق من الاستخراج يدويًا", role: "axis.agent", slaHours: 4 },
        { key: "confirm_value", en: "Confirm the declared value and named drivers", ar: "تأكيد القيمة والسائقين المسمّين", role: "axis.lead", slaHours: 4 },
        { key: "bind", en: "Bind with the underwriter", ar: "الإصدار مع شركة التأمين", role: "axis.lead", slaHours: 8 },
        { key: "deliver_documents", en: "Send the schedule and certificate", ar: "إرسال الجدول والشهادة", role: "axis.agent", slaHours: 2 }
      ]),
      appliesTo: "bind",
      status: "active",
      createdBy: lead,
      createdAt: now - 90 * DAY
    },
    {
      id: id("sop", now - 200 * DAY),
      tenantId,
      key: "motor.claim.fnol",
      version: 1,
      nameJson: JSON.stringify({ en: "Motor first notice of loss", ar: "الإخطار الأول عن الخسارة" }),
      stepsJson: JSON.stringify([
        { key: "record_fnol", en: "Record the loss and the police report", ar: "تسجيل الخسارة وتقرير الشرطة", role: "axis.agent", slaHours: 2 },
        { key: "appoint_assessor", en: "Appoint an assessor", ar: "تعيين مقيّم", role: "axis.agent", slaHours: 24 },
        { key: "decide", en: "Decide the claim and write the reason", ar: "البتّ في المطالبة وتوثيق السبب", role: "axis.lead", slaHours: 72 },
        { key: "settle", en: "Send the settlement for approval", ar: "إرسال التسوية للاعتماد", role: "axis.lead", slaHours: 24 }
      ]),
      appliesTo: "claim",
      status: "active",
      createdBy: lead,
      createdAt: now - 200 * DAY
    },
    {
      id: id("sop", now - 180 * DAY),
      tenantId,
      key: "kyc.individual",
      version: 1,
      nameJson: JSON.stringify({ en: "Individual KYC", ar: "اعرف عميلك — أفراد" }),
      stepsJson: JSON.stringify([
        { key: "identify", en: "Match the Emirates ID to the applicant", ar: "مطابقة الهوية بمقدم الطلب", role: "axis.agent", slaHours: 2 },
        { key: "screen", en: "Screen against the sanctions list", ar: "الفحص مقابل قوائم العقوبات", role: "axis.agent", slaHours: 2 },
        { key: "escalate", en: "Escalate any hit to compliance", ar: "تصعيد أي تطابق إلى الالتزام", role: "axis.lead", slaHours: 4 }
      ]),
      appliesTo: "kyc",
      status: "active",
      createdBy: lead,
      createdAt: now - 180 * DAY
    },
    {
      // Draft, because the retention script it depends on is still with
      // compliance. A procedure nobody has approved must not read as active.
      id: id("sop", now - 12 * DAY),
      tenantId,
      key: "renewal.outbound",
      version: 1,
      nameJson: JSON.stringify({ en: "Renewal outreach", ar: "التواصل بشأن التجديد" }),
      stepsJson: JSON.stringify([
        { key: "review_book", en: "Review the expiring book", ar: "مراجعة الوثائق المنتهية", role: "axis.agent", slaHours: 8 },
        { key: "prepare_terms", en: "Prepare renewal terms", ar: "إعداد شروط التجديد", role: "axis.agent", slaHours: 8 },
        { key: "contact", en: "Contact the customer", ar: "التواصل مع العميل", role: "axis.agent", slaHours: 24 }
      ]),
      appliesTo: "renewal_ops",
      status: "draft",
      createdBy: agent,
      createdAt: now - 12 * DAY
    },
    {
      id: id("sop", now - 9 * DAY),
      tenantId,
      key: "group.medical.census",
      version: 1,
      nameJson: JSON.stringify({ en: "Group medical census intake", ar: "استلام كشف الأعضاء للتأمين الطبي" }),
      stepsJson: JSON.stringify([
        { key: "receive_census", en: "Receive the census file", ar: "استلام ملف الأعضاء", role: "axis.agent", slaHours: 4 },
        { key: "validate_rows", en: "Validate member rows and dependants", ar: "التحقق من الأعضاء والمعالين", role: "axis.agent", slaHours: 24 },
        { key: "request_terms", en: "Request terms from the underwriters", ar: "طلب الشروط من شركات التأمين", role: "axis.lead", slaHours: 48 }
      ]),
      appliesTo: "group_medical",
      status: "draft",
      createdBy: agent,
      createdAt: now - 9 * DAY
    }
  ]);

  /* -------------------------------------------------------- process events */
  // The bind case step by step, which is what process mining reads (docs/05).
  // Two steps appear twice on purpose: an extraction that came back under the
  // confidence floor and was retried, and a provider bind call that timed out
  // and succeeded on the second attempt. A trace where everything works first
  // time cannot show anyone where the time goes.
  await db.insert(schema.axisProcessEvents).values([
    {
      id: id("pev", now),
      tenantId,
      caseId,
      step: "case_opened",
      actorRef: `customer:${customerId}`,
      outcome: "ok",
      ts: now
    },
    {
      id: id("pev", now + 40_000),
      tenantId,
      caseId,
      step: "quote_fanout",
      actorRef: "agent:quoting",
      durationMs: 1_950,
      outcome: "ok",
      ts: now + 40_000
    },
    {
      id: id("pev", now + 5 * MINUTE),
      tenantId,
      caseId,
      step: "quotes_compared",
      actorRef: agent,
      durationMs: 4 * MINUTE,
      outcome: "ok",
      ts: now + 5 * MINUTE
    },
    {
      id: id("pev", now + 8 * MINUTE),
      tenantId,
      caseId,
      step: "documents_requested",
      actorRef: agent,
      durationMs: 45_000,
      outcome: "ok",
      ts: now + 8 * MINUTE
    },
    {
      // The retry: the mulkiya scan came back at 41%, under the floor, so the
      // step ended without a usable answer and the customer was asked again.
      id: id("pev", now + 12 * MINUTE),
      tenantId,
      caseId,
      step: "document_extracted",
      actorRef: "agent:copilot",
      durationMs: 3_400,
      outcome: "retry",
      ts: now + 12 * MINUTE
    },
    {
      id: id("pev", now + 3 * HOUR),
      tenantId,
      caseId,
      step: "document_extracted",
      actorRef: "agent:copilot",
      durationMs: 3_100,
      outcome: "ok",
      ts: now + 3 * HOUR
    },
    {
      id: id("pev", now + 3 * HOUR + 20 * MINUTE),
      tenantId,
      caseId,
      step: "documents_verified",
      actorRef: agent,
      durationMs: 18 * MINUTE,
      outcome: "ok",
      ts: now + 3 * HOUR + 20 * MINUTE
    },
    {
      id: id("pev", now + DAY),
      tenantId,
      caseId,
      step: "underwriting_check",
      actorRef: lead,
      durationMs: 26 * MINUTE,
      outcome: "ok",
      ts: now + DAY
    },
    {
      // The second retry, and the one that matters commercially: the bind sat
      // for five minutes because the underwriter's API did not answer.
      id: id("pev", now + DAY + 2 * HOUR),
      tenantId,
      caseId,
      step: "provider_bind_call",
      actorRef: "system:cedar_api",
      durationMs: 30_000,
      outcome: "timeout",
      ts: now + DAY + 2 * HOUR
    },
    {
      id: id("pev", now + DAY + 2 * HOUR + 5 * MINUTE),
      tenantId,
      caseId,
      step: "provider_bind_call",
      actorRef: "system:cedar_api",
      durationMs: 4_200,
      outcome: "ok",
      ts: now + DAY + 2 * HOUR + 5 * MINUTE
    },
    {
      id: id("pev", issuedAt),
      tenantId,
      caseId,
      step: "policy_issued",
      actorRef: agent,
      durationMs: 90_000,
      outcome: "ok",
      ts: issuedAt
    },
    {
      id: id("pev", issuedAt + 15 * MINUTE),
      tenantId,
      caseId,
      step: "documents_delivered",
      actorRef: "agent:copilot",
      durationMs: 12_000,
      outcome: "ok",
      ts: issuedAt + 15 * MINUTE
    }
  ]);

  /* ------------------------------------------------------------ approvals */
  // The four rows above that touch money each need the approval that authorised
  // them, or the seed would be shipping exactly the bypass CLAUDE.md §12
  // forbids: a settled claim and a closed escrow batch with no record of who
  // agreed to move the money. `subjectRef` is built the way apps/api/src/crud.ts
  // builds it (`<resource path>:<row id>`) so a real update to any of these rows
  // finds its approval instead of opening a second one.
  //
  // Both policies are dual-control always, so the requester and the decider are
  // different people on every row. The decided ones are dated well outside the
  // 24-hour approval TTL, so nothing here can be reused to wave through a fresh
  // change to the same row.
  const approvals: (typeof schema.approvals.$inferInsert)[] = [
    {
      id: id("apr", now - 33 * DAY),
      tenantId,
      subjectRef: `escrow-batches:${escrowNovCedar}`,
      policyKey: "axis.escrow_release",
      module: "axis",
      requestedBy: agent,
      requestedAt: now - 33 * DAY,
      decidedBy: lead,
      decision: "approved",
      reason: "Bank statement matches the batch to the fils; released to Cedar.",
      contextJson: JSON.stringify({ amountMinor: 3_482_500, currency: "AED", dualControl: true }),
      decidedAt: now - 32 * DAY
    },
    {
      // Still open. This is what keeps the December Cedar batch at `matched`
      // rather than `closed`.
      id: id("apr", now - 2 * DAY),
      tenantId,
      subjectRef: `escrow-batches:${escrowDecCedar}`,
      policyKey: "axis.escrow_release",
      module: "axis",
      requestedBy: agent,
      requestedAt: now - 2 * DAY,
      decision: "pending",
      contextJson: JSON.stringify({ amountMinor: 4_115_000, currency: "AED", dualControl: true })
    },
    {
      id: id("apr", now - 104 * DAY),
      tenantId,
      subjectRef: `claims:${claimSettled}`,
      policyKey: "axis.claim_settlement",
      module: "axis",
      requestedBy: agent,
      requestedAt: now - 104 * DAY,
      decidedBy: lead,
      decision: "approved",
      reason: "Assessor's report agrees the estimate; settled net of the AED 1,000 excess.",
      contextJson: JSON.stringify({ amountMinor: 840_000, currency: "AED", dualControl: true }),
      decidedAt: now - 102 * DAY
    },
    {
      // Still open, which is why claim GNX-CLM-2512-0038 is `approved` and its
      // `settledMinor` is empty.
      id: id("apr", now - 3 * DAY),
      tenantId,
      subjectRef: `claims:${claimApproved}`,
      policyKey: "axis.claim_settlement",
      module: "axis",
      requestedBy: agent,
      requestedAt: now - 3 * DAY,
      decision: "pending",
      contextJson: JSON.stringify({ amountMinor: 580_000, currency: "AED", dualControl: true })
    }
  ];
  await db.insert(schema.approvals).values(approvals);

  // axis_approvals is the case-scoped mirror of the rows above — the same four
  // decisions, indexed by case so the case screen can list what it is waiting on
  // without scanning every approval the tenant has ever opened. It is a mirror
  // and never a second source of truth: `approvalId` points back at the row that
  // actually governs, and `decision` is copied from it.
  await db.insert(schema.axisApprovals).values(
    approvals.map((a, i) => ({
      id: id("cap", now + i),
      tenantId,
      approvalId: a.id,
      caseId,
      subjectRef: a.subjectRef,
      policyKey: a.policyKey,
      decision: a.decision,
      ts: a.decidedAt ?? a.requestedAt
    }))
  );
}
