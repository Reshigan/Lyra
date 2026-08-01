import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, ulidTime } from "@lyra/db";
import { seed } from "../seed.js";
import { DAY, HOUR, MINUTE } from "./context.js";
import type { CoreDb } from "../context.js";

// Same DB harness as ../seed.test.ts: an in-memory libSQL db with the real
// migrations replayed, one extra ".." because this file sits one directory
// deeper (packages/core/src/seed/ rather than packages/core/src/).
const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "db", "migrations");

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

// The seed clock, pinned so every relative offset in axis.ts (`now - 117 * DAY`
// etc.) resolves to an exact, assertable number instead of a moving target.
const T0 = Date.UTC(2026, 0, 6, 8, 0, 0);

let db: CoreDb;
let tenantId: string;
let agentRef: string;
let leadRef: string;
let caseId: string;
let customerId: string;

beforeEach(async () => {
  const client: Client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  db = drizzle(client) as unknown as CoreDb;

  const r = await seed(db, { password: "axis-test-password-2026", now: T0 });
  tenantId = r.tenantId;
  agentRef = `user:${r.users["axis.agent"]}`;
  leadRef = `user:${r.users["axis.lead"]}`;

  const [axisCase] = await db.select().from(schema.axisCases).where(eq(schema.axisCases.ref, "GNX-2601-0001"));
  caseId = axisCase!.id;
  customerId = axisCase!.customerId!;
});

describe("seedAxis: claims", () => {
  it("seeds exactly the six claims on last year's cover, one per status", async () => {
    const claims = await db.select().from(schema.axisClaims).where(eq(schema.axisClaims.tenantId, tenantId));
    expect(claims).toHaveLength(6);

    const policies = await db.select().from(schema.axisPolicies);
    const renewalPolicy = policies.find((p) => p.policyNo === "CDR-MOT-2501-664118")!;
    const soldPolicy = policies.find((p) => p.policyNo === "CDR-MOT-2601-778201")!;
    // Every claim sits on last year's cover, never on the policy just sold.
    for (const c of claims) {
      expect(c.policyId).toBe(renewalPolicy.id);
      expect(c.policyId).not.toBe(soldPolicy.id);
      expect(c.currency).toBe("AED");
      expect(c.customerId).toBe(customerId);
    }

    const byNo = (no: string) => claims.find((c) => c.claimNo === no)!;

    const fresh = byNo("GNX-CLM-2601-0042");
    expect(fresh.id.startsWith("clm_")).toBe(true);
    expect(ulidTime(fresh.id)).toBe(T0 - DAY);
    expect(fresh).toMatchObject({
      caseId: null,
      status: "reported",
      amountMinor: 120_000,
      settledMinor: null,
      currency: "AED",
      assessorRef: null,
      incidentAt: T0 - DAY - 4 * HOUR,
      reportedAt: T0 - DAY,
      createdAt: T0 - DAY,
      updatedAt: T0 - DAY
    });
    expect(JSON.parse(fresh.fnolJson!)).toEqual({
      lossType: "windscreen",
      location: "Sheikh Zayed Road, Dubai",
      description: "Stone chip from a passing truck, spreading crack on the driver's side.",
      thirdParty: false,
      channel: "app"
    });

    const assessing = byNo("GNX-CLM-2601-0041");
    expect(assessing.id.startsWith("clm_")).toBe(true);
    expect(ulidTime(assessing.id)).toBe(T0 - 8 * DAY);
    expect(assessing).toMatchObject({
      status: "assessing",
      amountMinor: 1_450_000,
      settledMinor: null,
      assessorRef: agentRef,
      incidentAt: T0 - 9 * DAY,
      reportedAt: T0 - 8 * DAY,
      createdAt: T0 - 8 * DAY,
      updatedAt: T0 - 3 * DAY
    });
    const assessingFnol = JSON.parse(assessing.fnolJson!);
    expect(assessingFnol).toEqual({
      lossType: "collision",
      location: "Al Khail Road, Dubai",
      description: "Rear-ended at a standstill in traffic; third party admitted fault at the scene.",
      thirdParty: true,
      policeReportNo: "DXB-2025-884120",
      channel: "app"
    });

    const approved = byNo("GNX-CLM-2512-0038");
    expect(approved.id.startsWith("clm_")).toBe(true);
    expect(ulidTime(approved.id)).toBe(T0 - 25 * DAY);
    expect(approved).toMatchObject({
      status: "approved",
      amountMinor: 680_000,
      // Waiting on the pending approval — writing this would be the docs/19 bypass.
      settledMinor: null,
      assessorRef: agentRef,
      incidentAt: T0 - 26 * DAY,
      reportedAt: T0 - 25 * DAY,
      createdAt: T0 - 25 * DAY,
      updatedAt: T0 - 3 * DAY
    });
    const approvedFnol = JSON.parse(approved.fnolJson!);
    expect(approvedFnol).toEqual({
      lossType: "collision",
      location: "Dubai Marina underground car park",
      description: "Side panel and mirror damaged by an unidentified vehicle while parked.",
      thirdParty: false,
      policeReportNo: "DXB-2025-861733",
      assessment: { garage: "Al Reem Auto Care", estimateMinor: 680_000, excessMinor: 100_000 },
      channel: "web"
    });

    const rejected = byNo("GNX-CLM-2511-0031");
    expect(rejected.id.startsWith("clm_")).toBe(true);
    expect(ulidTime(rejected.id)).toBe(T0 - 60 * DAY);
    expect(rejected).toMatchObject({
      status: "rejected",
      amountMinor: 2_310_000,
      settledMinor: null,
      assessorRef: leadRef,
      incidentAt: T0 - 62 * DAY,
      reportedAt: T0 - 60 * DAY,
      createdAt: T0 - 60 * DAY,
      updatedAt: T0 - 47 * DAY
    });
    const rejectedFnol = JSON.parse(rejected.fnolJson!);
    expect(rejectedFnol.lossType).toBe("collision");
    expect(rejectedFnol.location).toBe("Emirates Road, Sharjah");
    expect(rejectedFnol.description).toBe("Front-end damage after leaving the carriageway in heavy rain.");
    expect(rejectedFnol.thirdParty).toBe(false);
    expect(rejectedFnol.policeReportNo).toBe("SHJ-2025-330914");
    const decision = rejectedFnol.decision;
    expect(decision.outcome).toBe("repudiated");
    expect(decision.reasonKey).toBe("claim.repudiation.driver_not_named");
    expect(decision.decidedBy).toBe(leadRef);
    expect(decision.decidedAt).toBe(T0 - 47 * DAY);
    expect(decision.note).toContain("named driver on the schedule");

    const settled = byNo("GNX-CLM-2509-0019");
    expect(settled.id.startsWith("clm_")).toBe(true);
    expect(ulidTime(settled.id)).toBe(T0 - 117 * DAY);
    expect(settled).toMatchObject({
      status: "settled",
      amountMinor: 940_000,
      settledMinor: 840_000,
      assessorRef: agentRef,
      incidentAt: T0 - 118 * DAY,
      reportedAt: T0 - 117 * DAY,
      createdAt: T0 - 117 * DAY,
      updatedAt: T0 - 102 * DAY
    });
    // The AED 1,000 excess reconciles the two numbers rather than being invented.
    expect(settled.amountMinor! - settled.settledMinor!).toBe(100_000);
    const settledFnol = JSON.parse(settled.fnolJson!);
    expect(settledFnol).toEqual({
      lossType: "collision",
      location: "Al Wasl Road, Dubai",
      description: "Bumper and headlamp damage in a low-speed collision at a roundabout.",
      thirdParty: true,
      policeReportNo: "DXB-2025-712045",
      assessment: { garage: "Cedar Approved Motors", estimateMinor: 940_000, excessMinor: 100_000 },
      channel: "call_centre"
    });

    const withdrawn = byNo("GNX-CLM-2506-0007");
    expect(withdrawn.id.startsWith("clm_")).toBe(true);
    expect(ulidTime(withdrawn.id)).toBe(T0 - 209 * DAY);
    expect(withdrawn).toMatchObject({
      status: "withdrawn",
      amountMinor: 65_000,
      settledMinor: null,
      assessorRef: null,
      incidentAt: T0 - 210 * DAY,
      reportedAt: T0 - 209 * DAY,
      createdAt: T0 - 209 * DAY,
      updatedAt: T0 - 205 * DAY
    });
    const withdrawnFnol = JSON.parse(withdrawn.fnolJson!);
    expect(withdrawnFnol).toEqual({
      lossType: "dent",
      location: "Jumeirah Beach Road, Dubai",
      description: "Door dent in a car park; withdrawn once the repair quote came in below the excess.",
      thirdParty: false,
      withdrawnAt: T0 - 205 * DAY,
      channel: "app"
    });
  });
});

describe("seedAxis: documents", () => {
  it("seeds the bind-case document set, including the rejected then re-verified mulkiya", async () => {
    const docs = await db.select().from(schema.axisDocuments).where(eq(schema.axisDocuments.caseId, caseId));
    expect(docs).toHaveLength(6);
    for (const d of docs) expect(d.tenantId).toBe(tenantId);

    const byCreated = (t: number) => docs.find((d) => d.createdAt === t)!;

    const eidDoc = byCreated(T0 + 5 * MINUTE);
    expect(eidDoc.id.startsWith("doc_")).toBe(true);
    expect(ulidTime(eidDoc.id)).toBe(T0 + 5 * MINUTE);
    expect(eidDoc.fileId.startsWith("fil_")).toBe(true);
    expect(ulidTime(eidDoc.fileId)).toBe(T0 + 5 * MINUTE);
    expect(eidDoc).toMatchObject({
      docType: "eid",
      extractionConfidence: 97,
      extractionModel: "workers-ai/llama-3.2-11b-vision",
      status: "verified",
      verifiedBy: agentRef,
      verifiedAt: T0 + 35 * MINUTE,
      createdAt: T0 + 5 * MINUTE
    });
    expect(JSON.parse(eidDoc.extractionJson!)).toEqual({
      name: "Rania Haddad",
      eidNumber: "784-1990-XXXXXXX-X",
      nationality: "LB",
      expiry: "2028-04-17"
    });

    const rejectedMulkiya = byCreated(T0 + 8 * MINUTE);
    expect(rejectedMulkiya.id.startsWith("doc_")).toBe(true);
    expect(ulidTime(rejectedMulkiya.id)).toBe(T0 + 8 * MINUTE);
    expect(rejectedMulkiya).toMatchObject({
      docType: "mulkiya",
      extractionConfidence: 41,
      extractionModel: "workers-ai/llama-3.2-11b-vision",
      status: "rejected",
      verifiedBy: agentRef,
      verifiedAt: T0 + 40 * MINUTE,
      createdAt: T0 + 8 * MINUTE
    });
    const rejectedJson = JSON.parse(rejectedMulkiya.extractionJson!);
    expect(rejectedJson).toEqual({
      plate: null,
      chassis: null,
      make: "Toyota",
      model: null,
      year: null,
      note: "Photograph of a screen; glare over the plate and chassis fields."
    });

    const licence = byCreated(T0 + 9 * MINUTE);
    expect(licence.id.startsWith("doc_")).toBe(true);
    expect(ulidTime(licence.id)).toBe(T0 + 9 * MINUTE);
    expect(licence).toMatchObject({
      docType: "other",
      extractionConfidence: 91,
      extractionModel: "workers-ai/llama-3.2-11b-vision",
      status: "extracted",
      verifiedBy: null,
      verifiedAt: null,
      createdAt: T0 + 9 * MINUTE
    });
    expect(JSON.parse(licence.extractionJson!)).toEqual({
      kind: "driving_licence",
      licenceNumber: "DXB-3320118",
      issuedOn: "2016-09-02",
      expiry: "2026-09-01",
      classes: ["light_vehicle"]
    });

    const cleanMulkiya = byCreated(T0 + 3 * HOUR);
    expect(cleanMulkiya.id.startsWith("doc_")).toBe(true);
    expect(ulidTime(cleanMulkiya.id)).toBe(T0 + 3 * HOUR);
    expect(cleanMulkiya).toMatchObject({
      docType: "mulkiya",
      extractionConfidence: 94,
      extractionModel: "workers-ai/llama-3.2-11b-vision",
      status: "verified",
      verifiedBy: agentRef,
      verifiedAt: T0 + 3 * HOUR + 20 * MINUTE,
      createdAt: T0 + 3 * HOUR
    });
    const cleanJson = JSON.parse(cleanMulkiya.extractionJson!);
    expect(cleanJson).toEqual({
      plate: "Dubai J 44182",
      chassis: "JTDBR32E870XXXXXX",
      make: "Toyota",
      model: "Corolla",
      year: 2021,
      insuredValueMinor: 4_800_000
    });

    // In flight: null confidence, not zero — the model has not answered yet.
    const extracting = byCreated(T0 + 20 * HOUR);
    expect(extracting.id.startsWith("doc_")).toBe(true);
    expect(ulidTime(extracting.id)).toBe(T0 + 20 * HOUR);
    expect(extracting.fileId.startsWith("fil_")).toBe(true);
    expect(ulidTime(extracting.fileId)).toBe(T0 + 20 * HOUR);
    expect(extracting).toMatchObject({
      docType: "other",
      extractionModel: "workers-ai/llama-3.2-11b-vision",
      status: "extracting",
      extractionConfidence: null,
      extractionJson: null,
      verifiedBy: null,
      verifiedAt: null,
      createdAt: T0 + 20 * HOUR
    });

    const received = byCreated(T0 + 21 * HOUR);
    expect(received.id.startsWith("doc_")).toBe(true);
    expect(ulidTime(received.id)).toBe(T0 + 21 * HOUR);
    expect(received.fileId.startsWith("fil_")).toBe(true);
    expect(ulidTime(received.fileId)).toBe(T0 + 21 * HOUR);
    expect(received).toMatchObject({
      docType: "other",
      status: "received",
      extractionModel: null,
      extractionConfidence: null,
      extractionJson: null,
      verifiedBy: null,
      verifiedAt: null,
      createdAt: T0 + 21 * HOUR
    });
  });
});

describe("seedAxis: tasks", () => {
  it("seeds every task state the AXIS tabs filter on", async () => {
    const wanted = [
      "task.verify_vehicle_registration",
      "task.chase_no_claims_certificate",
      "task.confirm_declared_vehicle_value",
      "task.resolve_escrow_variance",
      "task.assess_collision_claim",
      "task.prepare_renewal_terms",
      "task.collect_claim_evidence",
      "task.file_policy_documents"
    ];
    const all = await db.select().from(schema.axisTasks).where(eq(schema.axisTasks.tenantId, tenantId));
    const tasks = all.filter((t) => wanted.includes(t.titleKey));
    expect(tasks).toHaveLength(8);

    const byKey = (k: string) => tasks.find((t) => t.titleKey === k)!;

    const verify = byKey("task.verify_vehicle_registration");
    expect(verify.id.startsWith("tsk_")).toBe(true);
    expect(ulidTime(verify.id)).toBe(T0 + 10 * MINUTE);
    expect(verify.caseId).toBe(caseId);
    expect(verify).toMatchObject({
      type: "document_verify",
      state: "done",
      assigneeRef: agentRef,
      dueAt: T0 + 6 * HOUR,
      createdBy: "agent:copilot",
      completedAt: T0 + 3 * HOUR + 20 * MINUTE,
      createdAt: T0 + 10 * MINUTE,
      updatedAt: T0 + 3 * HOUR + 20 * MINUTE
    });
    expect(JSON.parse(verify.checklistJson!)).toEqual([
      { key: "task.check.plate_matches_quote", done: true },
      { key: "task.check.chassis_legible", done: true },
      { key: "task.check.value_within_band", done: true }
    ]);

    const chase = byKey("task.chase_no_claims_certificate");
    expect(chase.id.startsWith("tsk_")).toBe(true);
    expect(ulidTime(chase.id)).toBe(T0 + 20 * HOUR);
    expect(chase.caseId).toBe(caseId);
    expect(chase).toMatchObject({
      type: "document_chase",
      state: "in_progress",
      assigneeRef: agentRef,
      dueAt: T0 + DAY,
      checklistJson: null,
      createdBy: "agent:copilot",
      completedAt: null,
      createdAt: T0 + 20 * HOUR,
      updatedAt: T0 + 21 * HOUR
    });

    const underwriting = byKey("task.confirm_declared_vehicle_value");
    expect(underwriting.id.startsWith("tsk_")).toBe(true);
    expect(ulidTime(underwriting.id)).toBe(T0 + 12 * HOUR);
    expect(underwriting.caseId).toBe(caseId);
    expect(underwriting).toMatchObject({
      type: "underwriting_check",
      state: "open",
      assigneeRef: leadRef,
      createdBy: agentRef,
      dueAt: T0 + 18 * HOUR,
      completedAt: null,
      createdAt: T0 + 12 * HOUR,
      updatedAt: T0 + 12 * HOUR
    });
    expect(JSON.parse(underwriting.checklistJson!)).toEqual([
      { key: "task.check.valuation_source", done: false },
      { key: "task.check.no_undeclared_modifications", done: false }
    ]);

    // Overdue: due date is in the past relative to the seed clock.
    const escrowTask = byKey("task.resolve_escrow_variance");
    expect(escrowTask.id.startsWith("tsk_")).toBe(true);
    expect(ulidTime(escrowTask.id)).toBe(T0 - 5 * DAY);
    expect(escrowTask).toMatchObject({
      type: "escrow_reconcile",
      state: "open",
      assigneeRef: leadRef,
      createdBy: "agent:copilot",
      dueAt: T0 - 2 * DAY,
      createdAt: T0 - 5 * DAY,
      updatedAt: T0 - 5 * DAY
    });
    expect(escrowTask.dueAt!).toBeLessThan(T0);
    expect(escrowTask.caseId).toBeNull();

    const claimAssess = byKey("task.assess_collision_claim");
    expect(claimAssess.id.startsWith("tsk_")).toBe(true);
    expect(ulidTime(claimAssess.id)).toBe(T0 - 7 * DAY);
    expect(claimAssess).toMatchObject({
      type: "claim_assess",
      state: "blocked",
      assigneeRef: agentRef,
      createdBy: agentRef,
      dueAt: T0 + 2 * DAY,
      caseId: null,
      createdAt: T0 - 7 * DAY,
      updatedAt: T0 - 4 * DAY
    });
    const checklist = JSON.parse(claimAssess.checklistJson!);
    expect(checklist).toEqual([
      { key: "task.check.police_report_received", done: true },
      { key: "task.check.garage_estimate_received", done: false },
      { key: "task.check.third_party_insurer_notified", done: true }
    ]);

    const renewalPrep = byKey("task.prepare_renewal_terms");
    expect(renewalPrep.id.startsWith("tsk_")).toBe(true);
    expect(ulidTime(renewalPrep.id)).toBe(T0 - 2 * DAY);
    expect(renewalPrep).toMatchObject({
      type: "renewal_prepare",
      state: "open",
      assigneeRef: agentRef,
      createdBy: "agent:renewal",
      dueAt: T0 + 5 * DAY,
      caseId: null,
      createdAt: T0 - 2 * DAY,
      updatedAt: T0 - 2 * DAY
    });

    const evidence = byKey("task.collect_claim_evidence");
    expect(evidence.id.startsWith("tsk_")).toBe(true);
    expect(ulidTime(evidence.id)).toBe(T0 - 58 * DAY);
    expect(evidence).toMatchObject({
      type: "claim_evidence",
      state: "cancelled",
      assigneeRef: leadRef,
      createdBy: agentRef,
      dueAt: T0 - 55 * DAY,
      caseId: null,
      createdAt: T0 - 58 * DAY,
      updatedAt: T0 - 47 * DAY
    });

    const fileDocs = byKey("task.file_policy_documents");
    expect(fileDocs.id.startsWith("tsk_")).toBe(true);
    expect(ulidTime(fileDocs.id)).toBe(T0 + 2 * DAY);
    expect(fileDocs.caseId).toBe(caseId);
    expect(fileDocs).toMatchObject({
      type: "document_file",
      state: "done",
      assigneeRef: agentRef,
      createdBy: "agent:copilot",
      dueAt: T0 + 2 * DAY + 4 * HOUR,
      completedAt: T0 + 2 * DAY + 15 * MINUTE,
      createdAt: T0 + 2 * DAY,
      updatedAt: T0 + 2 * DAY + 15 * MINUTE
    });
  });
});

describe("seedAxis: escrow batches", () => {
  it("seeds one batch per (period, provider), matching the table's unique key", async () => {
    const batches = await db.select().from(schema.axisEscrowBatches).where(eq(schema.axisEscrowBatches.tenantId, tenantId));
    expect(batches).toHaveLength(6);

    const providers = await db.select().from(schema.providers).where(eq(schema.providers.tenantId, tenantId));
    const cedarId = providers.find((p) => p.name === "Cedar General Insurance")!.id;
    const falconId = providers.find((p) => p.name === "Falcon Insurance")!.id;
    const gulfHealthId = providers.find((p) => p.name === "Gulf Health Assurance")!.id;

    const byPeriodProvider = (period: string, providerId: string) =>
      batches.find((b) => b.period === period && b.providerId === providerId)!;

    const novCedar = byPeriodProvider("2025-11", cedarId);
    expect(novCedar.id.startsWith("esc_")).toBe(true);
    expect(ulidTime(novCedar.id)).toBe(T0 - 62 * DAY);
    expect(novCedar).toMatchObject({
      currency: "AED",
      status: "closed",
      expectedMinor: 3_482_500,
      receivedMinor: 3_482_500,
      closedBy: leadRef,
      closedAt: T0 - 32 * DAY,
      varianceReason: null,
      createdAt: T0 - 62 * DAY,
      updatedAt: T0 - 32 * DAY
    });
    expect(novCedar.evidenceFileId!.startsWith("fil_")).toBe(true);
    expect(ulidTime(novCedar.evidenceFileId!)).toBe(T0 - 32 * DAY);

    const decCedar = byPeriodProvider("2025-12", cedarId);
    expect(decCedar.id.startsWith("esc_")).toBe(true);
    expect(ulidTime(decCedar.id)).toBe(T0 - 32 * DAY);
    expect(decCedar).toMatchObject({
      currency: "AED",
      status: "matched",
      expectedMinor: 4_115_000,
      receivedMinor: 4_115_000,
      closedBy: null,
      closedAt: null,
      varianceReason: null,
      evidenceFileId: null,
      createdAt: T0 - 32 * DAY,
      updatedAt: T0 - 2 * DAY
    });

    const decFalcon = byPeriodProvider("2025-12", falconId);
    expect(decFalcon.id.startsWith("esc_")).toBe(true);
    expect(ulidTime(decFalcon.id)).toBe(T0 - 32 * DAY + 1);
    expect(decFalcon).toMatchObject({
      currency: "AED",
      status: "variance",
      expectedMinor: 2_248_000,
      receivedMinor: 2_229_500,
      closedBy: null,
      closedAt: null,
      createdAt: T0 - 32 * DAY,
      updatedAt: T0 - 6 * DAY
    });
    // The remittance is short by exactly what the variance narrative claims.
    expect(decFalcon.expectedMinor - decFalcon.receivedMinor).toBe(18_500);
    expect(decFalcon.varianceReason).toBe(
      "Falcon remitted AED 185.00 short: a mid-month cancellation was refunded to the customer " +
        "from the batch but the credit note has not come back from the underwriter yet."
    );
    expect(decFalcon.evidenceFileId!.startsWith("fil_")).toBe(true);
    expect(ulidTime(decFalcon.evidenceFileId!)).toBe(T0 - 6 * DAY);

    const decGulf = byPeriodProvider("2025-12", gulfHealthId);
    expect(decGulf.id.startsWith("esc_")).toBe(true);
    expect(ulidTime(decGulf.id)).toBe(T0 - 32 * DAY + 2);
    expect(decGulf).toMatchObject({
      currency: "AED",
      status: "reconciling",
      expectedMinor: 5_640_000,
      receivedMinor: 3_120_000,
      evidenceFileId: null,
      closedBy: null,
      createdAt: T0 - 32 * DAY,
      updatedAt: T0 - 4 * DAY
    });

    const janCedar = byPeriodProvider("2026-01", cedarId);
    expect(janCedar.id.startsWith("esc_")).toBe(true);
    expect(ulidTime(janCedar.id)).toBe(T0 - 5 * DAY);
    expect(janCedar).toMatchObject({
      currency: "AED",
      status: "open",
      expectedMinor: 1_236_500,
      receivedMinor: 0,
      evidenceFileId: null,
      createdAt: T0 - 5 * DAY,
      updatedAt: T0 - 5 * DAY
    });

    const janFalcon = byPeriodProvider("2026-01", falconId);
    expect(janFalcon.id.startsWith("esc_")).toBe(true);
    expect(ulidTime(janFalcon.id)).toBe(T0 - 5 * DAY + 1);
    expect(janFalcon).toMatchObject({
      currency: "AED",
      status: "open",
      expectedMinor: 892_000,
      receivedMinor: 0,
      evidenceFileId: null,
      createdAt: T0 - 5 * DAY,
      updatedAt: T0 - 5 * DAY
    });
  });
});

describe("seedAxis: SOPs", () => {
  it("versions motor.bind and seeds procedures for claim, kyc, renewal and group medical", async () => {
    const sops = await db.select().from(schema.axisSops).where(eq(schema.axisSops.tenantId, tenantId));
    expect(sops).toHaveLength(6);

    const byKeyVersion = (key: string, version: number) => sops.find((s) => s.key === key && s.version === version)!;

    const bindV1 = byKeyVersion("motor.bind", 1);
    expect(bindV1.id.startsWith("sop_")).toBe(true);
    expect(ulidTime(bindV1.id)).toBe(T0 - 240 * DAY);
    expect(bindV1).toMatchObject({
      status: "retired",
      appliesTo: "bind",
      createdBy: leadRef,
      createdAt: T0 - 240 * DAY
    });
    expect(JSON.parse(bindV1.nameJson)).toEqual({ en: "Motor bind", ar: "إصدار وثيقة مركبات" });
    const stepsV1 = JSON.parse(bindV1.stepsJson);
    expect(stepsV1).toHaveLength(3);
    expect(stepsV1.map((s: { key: string }) => s.key)).toEqual(["collect_documents", "verify_documents", "bind"]);
    expect(stepsV1[2]).toEqual({ key: "bind", en: "Bind with the underwriter", ar: "الإصدار مع شركة التأمين", role: "axis.lead", slaHours: 8 });

    const bindV2 = byKeyVersion("motor.bind", 2);
    expect(bindV2.id.startsWith("sop_")).toBe(true);
    expect(ulidTime(bindV2.id)).toBe(T0 - 90 * DAY);
    expect(bindV2).toMatchObject({
      status: "active",
      appliesTo: "bind",
      createdBy: leadRef,
      createdAt: T0 - 90 * DAY
    });
    // v2 adds the value check the v1 procedure left implicit.
    const stepsV2 = JSON.parse(bindV2.stepsJson);
    expect(stepsV2).toHaveLength(5);
    expect(stepsV2.map((s: { key: string }) => s.key)).toEqual([
      "collect_documents",
      "verify_documents",
      "confirm_value",
      "bind",
      "deliver_documents"
    ]);
    expect(stepsV2[2]).toEqual({
      key: "confirm_value",
      en: "Confirm the declared value and named drivers",
      ar: "تأكيد القيمة والسائقين المسمّين",
      role: "axis.lead",
      slaHours: 4
    });

    const fnol = byKeyVersion("motor.claim.fnol", 1);
    expect(fnol.id.startsWith("sop_")).toBe(true);
    expect(ulidTime(fnol.id)).toBe(T0 - 200 * DAY);
    expect(fnol).toMatchObject({
      status: "active",
      appliesTo: "claim",
      createdBy: leadRef,
      createdAt: T0 - 200 * DAY
    });
    const fnolSteps = JSON.parse(fnol.stepsJson);
    expect(fnolSteps).toHaveLength(4);
    expect(fnolSteps.map((s: { key: string }) => s.key)).toEqual(["record_fnol", "appoint_assessor", "decide", "settle"]);

    const kyc = byKeyVersion("kyc.individual", 1);
    expect(kyc.id.startsWith("sop_")).toBe(true);
    expect(ulidTime(kyc.id)).toBe(T0 - 180 * DAY);
    expect(kyc).toMatchObject({
      status: "active",
      appliesTo: "kyc",
      createdBy: leadRef,
      createdAt: T0 - 180 * DAY
    });
    expect(JSON.parse(kyc.stepsJson)).toHaveLength(3);

    // Draft: the procedures nobody has approved yet.
    const renewalOutbound = byKeyVersion("renewal.outbound", 1);
    expect(renewalOutbound.id.startsWith("sop_")).toBe(true);
    expect(ulidTime(renewalOutbound.id)).toBe(T0 - 12 * DAY);
    expect(renewalOutbound).toMatchObject({
      status: "draft",
      appliesTo: "renewal_ops",
      createdBy: agentRef,
      createdAt: T0 - 12 * DAY
    });
    expect(JSON.parse(renewalOutbound.stepsJson)).toHaveLength(3);

    const groupMedical = byKeyVersion("group.medical.census", 1);
    expect(groupMedical.id.startsWith("sop_")).toBe(true);
    expect(ulidTime(groupMedical.id)).toBe(T0 - 9 * DAY);
    expect(groupMedical).toMatchObject({
      status: "draft",
      appliesTo: "group_medical",
      createdBy: agentRef,
      createdAt: T0 - 9 * DAY
    });
    expect(JSON.parse(groupMedical.stepsJson)).toHaveLength(3);
  });
});

describe("seedAxis: process events", () => {
  it("traces the bind case step by step, including both retries", async () => {
    const events = await db.select().from(schema.axisProcessEvents).where(eq(schema.axisProcessEvents.caseId, caseId));
    expect(events).toHaveLength(12);

    const byStepOutcome = (step: string, outcome: string) => events.find((e) => e.step === step && e.outcome === outcome)!;

    const opened = byStepOutcome("case_opened", "ok");
    expect(opened.id.startsWith("pev_")).toBe(true);
    expect(ulidTime(opened.id)).toBe(T0);
    expect(opened.actorRef).toBe(`customer:${customerId}`);
    expect(opened.ts).toBe(T0);
    expect(opened.durationMs).toBeNull();

    const fanout = byStepOutcome("quote_fanout", "ok");
    expect(ulidTime(fanout.id)).toBe(T0 + 40_000);
    expect(fanout.actorRef).toBe("agent:quoting");
    expect(fanout.durationMs).toBe(1_950);
    expect(fanout.ts).toBe(T0 + 40_000);

    const compared = byStepOutcome("quotes_compared", "ok");
    expect(ulidTime(compared.id)).toBe(T0 + 5 * MINUTE);
    expect(compared.actorRef).toBe(agentRef);
    expect(compared.durationMs).toBe(4 * MINUTE);
    expect(compared.ts).toBe(T0 + 5 * MINUTE);

    const requested = byStepOutcome("documents_requested", "ok");
    expect(ulidTime(requested.id)).toBe(T0 + 8 * MINUTE);
    expect(requested.actorRef).toBe(agentRef);
    expect(requested.durationMs).toBe(45_000);
    expect(requested.ts).toBe(T0 + 8 * MINUTE);

    // The retry: 41% was under the confidence floor.
    const extractRetry = byStepOutcome("document_extracted", "retry");
    expect(ulidTime(extractRetry.id)).toBe(T0 + 12 * MINUTE);
    expect(extractRetry.actorRef).toBe("agent:copilot");
    expect(extractRetry.durationMs).toBe(3_400);
    expect(extractRetry.ts).toBe(T0 + 12 * MINUTE);

    const extractOk = byStepOutcome("document_extracted", "ok");
    expect(ulidTime(extractOk.id)).toBe(T0 + 3 * HOUR);
    expect(extractOk.actorRef).toBe("agent:copilot");
    expect(extractOk.durationMs).toBe(3_100);
    expect(extractOk.ts).toBe(T0 + 3 * HOUR);

    const verified = byStepOutcome("documents_verified", "ok");
    expect(ulidTime(verified.id)).toBe(T0 + 3 * HOUR + 20 * MINUTE);
    expect(verified.actorRef).toBe(agentRef);
    expect(verified.durationMs).toBe(18 * MINUTE);
    expect(verified.ts).toBe(T0 + 3 * HOUR + 20 * MINUTE);

    const underwriting = byStepOutcome("underwriting_check", "ok");
    expect(ulidTime(underwriting.id)).toBe(T0 + DAY);
    expect(underwriting.actorRef).toBe(leadRef);
    expect(underwriting.durationMs).toBe(26 * MINUTE);
    expect(underwriting.ts).toBe(T0 + DAY);

    // The provider bind call timed out once and succeeded on retry.
    const bindTimeout = byStepOutcome("provider_bind_call", "timeout");
    expect(ulidTime(bindTimeout.id)).toBe(T0 + DAY + 2 * HOUR);
    expect(bindTimeout.actorRef).toBe("system:cedar_api");
    expect(bindTimeout.durationMs).toBe(30_000);
    expect(bindTimeout.ts).toBe(T0 + DAY + 2 * HOUR);

    const bindOk = byStepOutcome("provider_bind_call", "ok");
    expect(ulidTime(bindOk.id)).toBe(T0 + DAY + 2 * HOUR + 5 * MINUTE);
    expect(bindOk.actorRef).toBe("system:cedar_api");
    expect(bindOk.durationMs).toBe(4_200);
    expect(bindOk.ts).toBe(T0 + DAY + 2 * HOUR + 5 * MINUTE);

    const issued = byStepOutcome("policy_issued", "ok");
    expect(ulidTime(issued.id)).toBe(T0 + 2 * DAY);
    expect(issued.actorRef).toBe(agentRef);
    expect(issued.durationMs).toBe(90_000);
    expect(issued.ts).toBe(T0 + 2 * DAY);

    const delivered = byStepOutcome("documents_delivered", "ok");
    expect(ulidTime(delivered.id)).toBe(T0 + 2 * DAY + 15 * MINUTE);
    expect(delivered.actorRef).toBe("agent:copilot");
    expect(delivered.durationMs).toBe(12_000);
    expect(delivered.ts).toBe(T0 + 2 * DAY + 15 * MINUTE);
  });
});

describe("seedAxis: approvals and their case-scoped mirror", () => {
  it("gives the two money-moving decisions per row (escrow release, claim settlement), decided and pending", async () => {
    const claims = await db.select().from(schema.axisClaims).where(eq(schema.axisClaims.tenantId, tenantId));
    const claimSettledId = claims.find((c) => c.claimNo === "GNX-CLM-2509-0019")!.id;
    const claimApprovedId = claims.find((c) => c.claimNo === "GNX-CLM-2512-0038")!.id;

    const providers = await db.select().from(schema.providers).where(eq(schema.providers.tenantId, tenantId));
    const cedarId = providers.find((p) => p.name === "Cedar General Insurance")!.id;
    const escrows = await db.select().from(schema.axisEscrowBatches).where(eq(schema.axisEscrowBatches.tenantId, tenantId));
    const escrowNovCedarId = escrows.find((b) => b.period === "2025-11" && b.providerId === cedarId)!.id;
    const escrowDecCedarId = escrows.find((b) => b.period === "2025-12" && b.providerId === cedarId)!.id;

    const allApprovals = await db.select().from(schema.approvals).where(eq(schema.approvals.tenantId, tenantId));
    const approvals = allApprovals.filter(
      (a) => a.policyKey === "axis.escrow_release" || a.policyKey === "axis.claim_settlement"
    );
    expect(approvals).toHaveLength(4);
    for (const a of approvals) expect(a.module).toBe("axis");

    const bySubject = (subjectRef: string) => approvals.find((a) => a.subjectRef === subjectRef)!;

    const novRelease = bySubject(`escrow-batches:${escrowNovCedarId}`);
    expect(novRelease.id.startsWith("apr_")).toBe(true);
    expect(ulidTime(novRelease.id)).toBe(T0 - 33 * DAY);
    expect(novRelease.policyKey).toBe("axis.escrow_release");
    expect(novRelease.module).toBe("axis");
    expect(novRelease.requestedBy).toBe(agentRef);
    expect(novRelease.decidedBy).toBe(leadRef);
    expect(novRelease.decision).toBe("approved");
    expect(novRelease.requestedAt).toBe(T0 - 33 * DAY);
    expect(novRelease.decidedAt).toBe(T0 - 32 * DAY);
    expect(novRelease.reason).toBe("Bank statement matches the batch to the fils; released to Cedar.");
    expect(JSON.parse(novRelease.contextJson!)).toEqual({ amountMinor: 3_482_500, currency: "AED", dualControl: true });

    const decRelease = bySubject(`escrow-batches:${escrowDecCedarId}`);
    expect(ulidTime(decRelease.id)).toBe(T0 - 2 * DAY);
    expect(decRelease.policyKey).toBe("axis.escrow_release");
    expect(decRelease.decision).toBe("pending");
    expect(decRelease.decidedBy).toBeNull();
    expect(decRelease.decidedAt).toBeNull();
    expect(decRelease.reason).toBeNull();
    expect(decRelease.requestedAt).toBe(T0 - 2 * DAY);
    expect(JSON.parse(decRelease.contextJson!)).toEqual({ amountMinor: 4_115_000, currency: "AED", dualControl: true });

    const settlementApproved = bySubject(`claims:${claimSettledId}`);
    expect(ulidTime(settlementApproved.id)).toBe(T0 - 104 * DAY);
    expect(settlementApproved.policyKey).toBe("axis.claim_settlement");
    expect(settlementApproved.decision).toBe("approved");
    expect(settlementApproved.decidedBy).toBe(leadRef);
    expect(settlementApproved.requestedAt).toBe(T0 - 104 * DAY);
    expect(settlementApproved.decidedAt).toBe(T0 - 102 * DAY);
    expect(settlementApproved.reason).toBe(
      "Assessor's report agrees the estimate; settled net of the AED 1,000 excess."
    );
    expect(JSON.parse(settlementApproved.contextJson!)).toEqual({ amountMinor: 840_000, currency: "AED", dualControl: true });

    const settlementPending = bySubject(`claims:${claimApprovedId}`);
    expect(ulidTime(settlementPending.id)).toBe(T0 - 3 * DAY);
    expect(settlementPending.policyKey).toBe("axis.claim_settlement");
    expect(settlementPending.decision).toBe("pending");
    expect(settlementPending.decidedBy).toBeNull();
    expect(settlementPending.decidedAt).toBeNull();
    expect(settlementPending.reason).toBeNull();
    expect(settlementPending.requestedAt).toBe(T0 - 3 * DAY);
    expect(JSON.parse(settlementPending.contextJson!)).toEqual({ amountMinor: 580_000, currency: "AED", dualControl: true });

    // axis_approvals mirrors each row above by id, never opens a second source
    // of truth: same subject, same policy key, same decision, and `ts` takes
    // the decided timestamp when one exists and falls back to `requestedAt`
    // otherwise (exercising both sides of the `??`).
    const mirrors = await db.select().from(schema.axisApprovals).where(eq(schema.axisApprovals.tenantId, tenantId));
    expect(mirrors).toHaveLength(4);
    for (const approval of approvals) {
      const mirror = mirrors.find((m) => m.approvalId === approval.id)!;
      expect(mirror).toBeDefined();
      expect(mirror.id.startsWith("cap_")).toBe(true);
      expect(mirror.caseId).toBe(caseId);
      expect(mirror.subjectRef).toBe(approval.subjectRef);
      expect(mirror.policyKey).toBe(approval.policyKey);
      expect(mirror.decision).toBe(approval.decision);
      expect(mirror.ts).toBe(approval.decidedAt ?? approval.requestedAt);
    }
    // The mirror rows are built with `id("cap", now + i)` over the four
    // approvals in the source array's literal order (nov, dec, settled-claim,
    // approved-claim) — not the order a tenant-scoped select happens to
    // return them in, which sorts by the (unrelated) ulid-encoded id.
    expect(ulidTime(mirrors.find((m) => m.approvalId === novRelease.id)!.id)).toBe(T0);
    expect(ulidTime(mirrors.find((m) => m.approvalId === decRelease.id)!.id)).toBe(T0 + 1);
    expect(ulidTime(mirrors.find((m) => m.approvalId === settlementApproved.id)!.id)).toBe(T0 + 2);
    expect(ulidTime(mirrors.find((m) => m.approvalId === settlementPending.id)!.id)).toBe(T0 + 3);
    // Concretely: one mirror ts came from decidedAt, one from requestedAt.
    const novMirror = mirrors.find((m) => m.approvalId === novRelease.id)!;
    expect(novMirror.ts).toBe(T0 - 32 * DAY);
    const decMirror = mirrors.find((m) => m.approvalId === decRelease.id)!;
    expect(decMirror.ts).toBe(T0 - 2 * DAY);
  });
});
