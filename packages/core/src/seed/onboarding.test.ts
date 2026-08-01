import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { schema } from "@lyra/db";
import { seed } from "../seed.js";
import { seedOnboarding } from "./onboarding.js";
import { hashObject } from "../crypto.js";
import { DAY, HOUR, type SeedContext } from "./context.js";
import type { CoreDb } from "../context.js";

// One level deeper than seed.test.ts (src/seed/ vs src/), hence the extra "..".
const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "db", "migrations");

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

const NOW = 1_700_000_000_000;
const WENT_LIVE = NOW - 380 * DAY;

let client: Client;
let db: CoreDb;
let tenantId: string;
let users: Record<string, string>;
let dana: string; // user:<orbit.partners>
let khalid: string; // user:<tenant.compliance>
let amina: string; // <tenant.admin>, unprefixed
let faisal: string; // user:<finance.controller>
let raed: string; // user:<dev.admin>
let alphaId: string;
let telcoId: string;
let careemId: string;

async function partnerId(name: string): Promise<string> {
  const [row] = await db
    .select({ id: schema.orbitPartners.id })
    .from(schema.orbitPartners)
    .where(and(eq(schema.orbitPartners.tenantId, tenantId), eq(schema.orbitPartners.name, name)));
  return row!.id;
}

async function stepsFor(subjectRef: string) {
  return db
    .select()
    .from(schema.onboardingSteps)
    .where(and(eq(schema.onboardingSteps.tenantId, tenantId), eq(schema.onboardingSteps.subjectRef, subjectRef)))
    .orderBy(schema.onboardingSteps.seq);
}

beforeAll(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  db = drizzle(client) as unknown as CoreDb;
  const result = await seed(db, { password: "onboarding-test-password", now: NOW });
  tenantId = result.tenantId;
  users = result.users;
  dana = `user:${users["orbit.partners"]}`;
  khalid = `user:${users["tenant.compliance"]}`;
  amina = users["tenant.admin"]!;
  faisal = `user:${users["finance.controller"]}`;
  raed = `user:${users["dev.admin"]}`;
  alphaId = await partnerId("Alpha Brokers");
  telcoId = await partnerId("Etisalat Mobility");
  careemId = await partnerId("Careem Everything");
});

describe("seedOnboarding — screenings", () => {
  it("clears Alpha 398 days back, with a disposition", async () => {
    const [row] = await db
      .select()
      .from(schema.screenings)
      .where(and(eq(schema.screenings.tenantId, tenantId), eq(schema.screenings.subjectRef, alphaId)));
    expect(row!.kind).toBe("sanctions");
    expect(row!.provider).toBe("dow_jones");
    expect(row!.queryHash).toBe(await hashObject({ name: "Alpha Brokers Insurance Services LLC", country: "AE" }));
    expect(row!.result).toBe("clear");
    expect(row!.blocked).toBe(false);
    expect(row!.dispositionedBy).toBe(khalid);
    expect(row!.disposition).toBe("No matches above threshold.");
    expect(row!.hitsJson).toBeNull();
    expect(row!.ts).toBe(NOW - 398 * DAY);
  });

  it("leaves Etisalat inconclusive, undispositioned, with one PEP hit", async () => {
    const [row] = await db
      .select()
      .from(schema.screenings)
      .where(and(eq(schema.screenings.tenantId, tenantId), eq(schema.screenings.subjectRef, telcoId)));
    expect(row!.kind).toBe("pep");
    expect(row!.queryHash).toBe(await hashObject({ name: "Etisalat Mobility Services FZ-LLC", country: "AE" }));
    expect(row!.result).toBe("inconclusive");
    expect(JSON.parse(row!.hitsJson!)).toEqual([
      { name: "H. Al Zaabi", list: "pep_gcc", score: 71, note: "Common name; board membership unconfirmed." }
    ]);
    expect(row!.blocked).toBe(false);
    expect(row!.dispositionedBy).toBeNull();
    expect(row!.disposition).toBeNull();
    expect(row!.ts).toBe(NOW - 18 * DAY);
  });
});

describe("seedOnboarding — approvals", () => {
  async function approval(policyKey: string) {
    const [row] = await db
      .select()
      .from(schema.approvals)
      .where(and(eq(schema.approvals.tenantId, tenantId), eq(schema.approvals.policyKey, policyKey)));
    return row!;
  }

  it("waives Alpha's UBO disclosure with dual control, pointing at that exact step", async () => {
    const row = await approval("core.onboarding_waive");
    expect(row.module).toBe("core");
    expect(row.requestedBy).toBe(dana);
    expect(row.requestedAt).toBe(WENT_LIVE - 12 * DAY);
    expect(row.decidedBy).toBe(khalid);
    expect(row.decision).toBe("approved");
    expect(row.decidedAt).toBe(WENT_LIVE - 11 * DAY);
    expect(JSON.parse(row.contextJson!)).toEqual({
      subjectKind: "partner",
      subjectRef: alphaId,
      key: "ubo_disclosure",
      dualControl: true
    });
    // subjectRef is the minted step id for ubo_disclosure, and the waiver
    // recorded on that step's row must point back at this same approval.
    const [uboStep] = await db
      .select()
      .from(schema.onboardingSteps)
      .where(and(eq(schema.onboardingSteps.tenantId, tenantId), eq(schema.onboardingSteps.subjectRef, alphaId), eq(schema.onboardingSteps.key, "ubo_disclosure")));
    expect(row.subjectRef).toBe(uboStep!.id);
    expect(uboStep!.waivedApprovalId).toBe(row.id);
  });

  it("signs the v1 agreement under dual control — the drafter is not the signer", async () => {
    const row = await approval("dist.agreement_sign");
    expect(row.requestedBy).toBe(dana);
    expect(row.requestedAt).toBe(WENT_LIVE - 6 * DAY);
    expect(row.decidedBy).toBe(`user:${amina}`);
    expect(row.decision).toBe("approved");
    expect(row.decidedAt).toBe(WENT_LIVE - 5 * DAY);
    expect(JSON.parse(row.contextJson!)).toEqual({ partnerId: alphaId, version: 1, kind: "distribution", dualControl: true });

    const [agreement] = await db
      .select()
      .from(schema.distPartnerAgreements)
      .where(and(eq(schema.distPartnerAgreements.tenantId, tenantId), eq(schema.distPartnerAgreements.partnerId, alphaId), eq(schema.distPartnerAgreements.version, 1)));
    expect(row.subjectRef).toBe(agreement!.id);
    expect(agreement!.approvalId).toBe(row.id);
  });

  it("activates Alpha go-live, requested and decided by the same desk (no dual control key)", async () => {
    const row = await approval("dist.partner_activate");
    expect(row.subjectRef).toBe(alphaId);
    expect(row.requestedBy).toBe(dana);
    expect(row.requestedAt).toBe(WENT_LIVE - HOUR);
    expect(row.decidedBy).toBe(dana);
    expect(row.decision).toBe("approved");
    expect(row.reason).toBe("Sandbox pack passed on 42 of 42 transactions.");
    expect(row.decidedAt).toBe(WENT_LIVE);
    // No `dualControl` key at all here, unlike the other two approvals.
    const ctx = JSON.parse(row.contextJson!);
    expect(ctx).toEqual({ stage: "live", sandbox: false });
    expect("dualControl" in ctx).toBe(false);
  });
});

describe("seedOnboarding — Alpha Brokers steps (partner.distribution, all 11 closed)", () => {
  it("carries every template literal (key/seq/gates/evidence/required) unmodified, in seq order", async () => {
    const rows = await stepsFor(alphaId);
    expect(rows).toHaveLength(11);
    expect(rows.map((r) => r.key)).toEqual([
      "legal_identity",
      "sanctions_pep_screening",
      "ubo_disclosure",
      "licence_check",
      "agreement_drafted",
      "agreement_countersigned",
      "rate_card_agreed",
      "payout_method",
      "api_credentials",
      "sandbox_transactions",
      "go_live_signoff"
    ]);
    for (const r of rows) {
      expect(r.subjectKind).toBe("partner");
      expect(r.template).toBe("partner.distribution");
      expect(r.required).toBe(true); // none of these Defs set required: false
      expect(r.createdAt).toBe(WENT_LIVE - 30 * DAY);
    }
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey["sanctions_pep_screening"]!.gatesStage).toBe("screening");
    expect(byKey["sanctions_pep_screening"]!.evidenceKind).toBe("screening");
    expect(JSON.parse(byKey["legal_identity"]!.labelJson)).toEqual({
      en: "Legal identity verified",
      ar: "التحقق من الهوية القانونية"
    });
  });

  it("marks every step done except the waived one, each with its own decider and evidence", async () => {
    const rows = await stepsFor(alphaId);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

    expect(byKey["legal_identity"]!.state).toBe("done");
    expect(byKey["legal_identity"]!.evidenceRef).toBe("doc:alpha/trade-licence-DED-611904.pdf");
    expect(byKey["legal_identity"]!.decidedBy).toBe(dana);
    expect(byKey["legal_identity"]!.decidedAt).toBe(WENT_LIVE - 28 * DAY);
    expect(byKey["legal_identity"]!.ownerRef).toBe(dana); // ownerRef defaults to ctx.users["orbit.partners"] when no `owner` given

    expect(byKey["sanctions_pep_screening"]!.state).toBe("done");
    expect(byKey["sanctions_pep_screening"]!.ownerRef).toBe(khalid); // explicit owner
    expect(byKey["sanctions_pep_screening"]!.decidedBy).toBe(khalid);
    expect(byKey["sanctions_pep_screening"]!.decidedAt).toBe(WENT_LIVE - 27 * DAY);

    const ubo = byKey["ubo_disclosure"]!;
    expect(ubo.state).toBe("waived");
    expect(ubo.ownerRef).toBe(khalid);
    expect(ubo.decidedBy).toBe(khalid);
    expect(ubo.decidedAt).toBe(WENT_LIVE - 11 * DAY);
    expect(ubo.evidenceRef).toBeNull(); // no evidenceRef given for this outcome
    expect(JSON.parse(ubo.notesJson!)).toEqual({
      reason: "Listed entity — beneficial ownership is public on the DFSA register."
    });

    expect(byKey["licence_check"]!.decidedAt).toBe(WENT_LIVE - 20 * DAY);
    expect(byKey["licence_check"]!.ownerRef).toBe(khalid);

    expect(byKey["agreement_drafted"]!.decidedBy).toBe(dana);
    expect(byKey["agreement_countersigned"]!.decidedBy).toBe(`user:${amina}`);
    expect(byKey["agreement_countersigned"]!.decidedAt).toBe(WENT_LIVE - 5 * DAY);

    expect(byKey["rate_card_agreed"]!.evidenceRef).toBe(dana);
    expect(byKey["rate_card_agreed"]!.decidedBy).toBe(dana);

    expect(byKey["payout_method"]!.ownerRef).toBe(faisal);
    expect(byKey["payout_method"]!.decidedBy).toBe(faisal);
    expect(byKey["payout_method"]!.evidenceRef).toBe("payout:mandate:alpha-enbd-9931");
    expect(byKey["payout_method"]!.decidedAt).toBe(WENT_LIVE - 3 * DAY);

    expect(byKey["api_credentials"]!.ownerRef).toBe(raed);
    expect(byKey["api_credentials"]!.decidedBy).toBe(raed);
    expect(byKey["api_credentials"]!.evidenceRef).toBe("alpha-brokers-live");
    expect(byKey["api_credentials"]!.decidedAt).toBe(WENT_LIVE - 2 * DAY);

    expect(byKey["sandbox_transactions"]!.evidenceRef).toBe(raed);
    expect(byKey["sandbox_transactions"]!.ownerRef).toBe(raed);
    expect(byKey["sandbox_transactions"]!.decidedAt).toBe(WENT_LIVE - DAY);

    expect(byKey["go_live_signoff"]!.state).toBe("done");
    expect(byKey["go_live_signoff"]!.evidenceRef).toBe(dana);
    expect(byKey["go_live_signoff"]!.decidedBy).toBe(dana);
    expect(byKey["go_live_signoff"]!.decidedAt).toBe(WENT_LIVE);

    // Every done/waived step's updatedAt is its decidedAt, not the shared startedAt.
    for (const r of rows) expect(r.updatedAt).toBe(r.decidedAt);
    // No step here defaults to pending — all 11 outcomes were specified.
    expect(rows.every((r) => r.state !== "pending")).toBe(true);
  });
});

describe("seedOnboarding — Etisalat Mobility steps (held at screening)", () => {
  it("only 4 of 11 steps have an outcome; the rest default to pending with no decider", async () => {
    const rows = await stepsFor(telcoId);
    expect(rows).toHaveLength(11);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    for (const r of rows) expect(r.template).toBe("partner.distribution");
    for (const r of rows) expect(r.createdAt).toBe(NOW - 21 * DAY);

    expect(byKey["legal_identity"]!.state).toBe("done");
    expect(byKey["legal_identity"]!.evidenceRef).toBe("doc:etisalat/fz-llc-certificate.pdf");
    expect(byKey["legal_identity"]!.decidedBy).toBe(dana);
    expect(byKey["legal_identity"]!.decidedAt).toBe(NOW - 19 * DAY);
    expect(byKey["legal_identity"]!.updatedAt).toBe(NOW - 19 * DAY);

    // Open, not failed — no decidedBy/decidedAt on the in_progress/pending rows.
    expect(byKey["sanctions_pep_screening"]!.state).toBe("in_progress");
    const [telcoScreening] = await db
      .select()
      .from(schema.screenings)
      .where(and(eq(schema.screenings.tenantId, tenantId), eq(schema.screenings.subjectRef, telcoId)));
    expect(byKey["sanctions_pep_screening"]!.evidenceRef).toBe(telcoScreening!.id);
    expect(byKey["sanctions_pep_screening"]!.ownerRef).toBe(khalid);
    expect(byKey["sanctions_pep_screening"]!.decidedBy).toBeNull();
    expect(byKey["sanctions_pep_screening"]!.decidedAt).toBeNull();
    expect(byKey["sanctions_pep_screening"]!.updatedAt).toBe(NOW - 21 * DAY); // falls back to startedAt

    expect(byKey["ubo_disclosure"]!.state).toBe("in_progress");
    expect(byKey["ubo_disclosure"]!.ownerRef).toBe(khalid);
    expect(byKey["ubo_disclosure"]!.evidenceRef).toBeNull();

    expect(byKey["licence_check"]!.state).toBe("pending");
    expect(byKey["licence_check"]!.ownerRef).toBe(khalid);

    // Everything past licence_check was never named — defaults all the way.
    for (const key of [
      "agreement_drafted",
      "agreement_countersigned",
      "rate_card_agreed",
      "payout_method",
      "api_credentials",
      "sandbox_transactions",
      "go_live_signoff"
    ]) {
      const r = byKey[key]!;
      expect(r.state).toBe("pending");
      expect(r.evidenceRef).toBeNull();
      expect(r.ownerRef).toBe(dana); // default owner: ctx.users["orbit.partners"]
      expect(r.decidedBy).toBeNull();
      expect(r.decidedAt).toBeNull();
      expect(r.waivedApprovalId).toBeNull();
      expect(r.notesJson).toBeNull();
      expect(r.updatedAt).toBe(r.createdAt);
    }
  });
});

describe("seedOnboarding — Careem channel (channel.b2b, 9 steps)", () => {
  it("carries the channel template, including the one optional step", async () => {
    const [channel] = await db
      .select()
      .from(schema.distChannels)
      .where(and(eq(schema.distChannels.tenantId, tenantId), eq(schema.distChannels.key, "careem-superapp")));
    const rows = await stepsFor(channel!.id);
    expect(rows).toHaveLength(9);
    expect(rows.map((r) => r.key)).toEqual([
      "channel_owner_assigned",
      "partner_agreement_linked",
      "rate_card_agreed",
      "settlement_terms",
      "disclosure_copy_approved",
      "api_credentials",
      "branding_assets",
      "uat_transactions",
      "go_live_signoff"
    ]);
    for (const r of rows) {
      expect(r.subjectKind).toBe("channel");
      expect(r.template).toBe("channel.b2b");
      expect(r.createdAt).toBe(NOW - 50 * DAY);
    }
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

    // The only Def with required: false in either template.
    expect(byKey["branding_assets"]!.required).toBe(false);
    // Every other step in this template defaults required to true.
    for (const key of rows.map((r) => r.key)) {
      if (key !== "branding_assets") expect(byKey[key]!.required).toBe(true);
    }

    expect(byKey["channel_owner_assigned"]!.state).toBe("done");
    expect(byKey["channel_owner_assigned"]!.decidedBy).toBe(dana);
    expect(byKey["channel_owner_assigned"]!.decidedAt).toBe(NOW - 50 * DAY);

    expect(byKey["rate_card_agreed"]!.decidedAt).toBe(NOW - 30 * DAY);

    expect(byKey["settlement_terms"]!.ownerRef).toBe(faisal);
    expect(byKey["settlement_terms"]!.decidedBy).toBe(faisal);
    expect(byKey["settlement_terms"]!.decidedAt).toBe(NOW - 28 * DAY);

    // No Careem agreement exists yet — this step cannot be past pending.
    expect(byKey["partner_agreement_linked"]!.state).toBe("pending");
    expect(byKey["partner_agreement_linked"]!.evidenceRef).toBeNull();
    expect(byKey["partner_agreement_linked"]!.decidedBy).toBeNull();
    expect(byKey["partner_agreement_linked"]!.ownerRef).toBe(dana); // default owner, no `owner` given

    expect(byKey["disclosure_copy_approved"]!.state).toBe("in_progress");
    expect(byKey["disclosure_copy_approved"]!.ownerRef).toBe(khalid);
    expect(byKey["disclosure_copy_approved"]!.decidedBy).toBeNull();

    expect(byKey["api_credentials"]!.evidenceRef).toBe("careem-sandbox");
    expect(byKey["api_credentials"]!.ownerRef).toBe(raed);
    expect(byKey["api_credentials"]!.decidedBy).toBe(raed);
    expect(byKey["api_credentials"]!.decidedAt).toBe(NOW - 12 * DAY);

    expect(byKey["branding_assets"]!.state).toBe("done");
    expect(byKey["branding_assets"]!.evidenceRef).toBe("doc:careem/brand-kit-v3.zip");
    expect(byKey["branding_assets"]!.decidedBy).toBe(dana);
    expect(byKey["branding_assets"]!.decidedAt).toBe(NOW - 10 * DAY);
    expect(byKey["branding_assets"]!.ownerRef).toBe(dana); // default owner, no `owner` given here either

    // Never named — both default all the way to pending.
    for (const key of ["uat_transactions", "go_live_signoff"]) {
      const r = byKey[key]!;
      expect(r.state).toBe("pending");
      expect(r.decidedBy).toBeNull();
      expect(r.decidedAt).toBeNull();
      expect(r.updatedAt).toBe(r.createdAt);
    }
  });
});

describe("seedOnboarding — Careem distribution channel row", () => {
  it("is created paused, mid-integration, with the exact commission and settlement terms", async () => {
    const [ch] = await db
      .select()
      .from(schema.distChannels)
      .where(and(eq(schema.distChannels.tenantId, tenantId), eq(schema.distChannels.key, "careem-superapp")));
    expect(ch!.kind).toBe("b2b");
    expect(JSON.parse(ch!.nameJson)).toEqual({ en: "Careem Everything", ar: "كريم إيفريثنغ" });
    expect(ch!.partnerId).toBe(careemId);
    expect(ch!.medium).toBe("app");
    expect(ch!.collectsPayment).toBe("partner");
    expect(JSON.parse(ch!.settlementTermsJson!)).toEqual({
      frequency: "monthly",
      dayOfMonth: 5,
      netDays: 30,
      minPayoutMinor: 75_000
    });
    expect(ch!.defaultCommissionPpm).toBe(275_000);
    expect(ch!.currency).toBe("AED");
    expect(ch!.status).toBe("paused");
    expect(ch!.createdAt).toBe(NOW - 55 * DAY);
    expect(ch!.updatedAt).toBe(NOW - 5 * DAY);
  });
});

describe("seedOnboarding — Alpha's two agreement versions", () => {
  it("v1 is active, signed, and governs today", async () => {
    const [v1] = await db
      .select()
      .from(schema.distPartnerAgreements)
      .where(and(eq(schema.distPartnerAgreements.tenantId, tenantId), eq(schema.distPartnerAgreements.partnerId, alphaId), eq(schema.distPartnerAgreements.version, 1)));
    expect(v1!.kind).toBe("distribution");
    expect(JSON.parse(v1!.termsJson)).toEqual({
      settlement: { frequency: "monthly", dayOfMonth: 10, netDays: 15, minPayoutMinor: 50_000 },
      rateCard: { defaultSharePpm: 300_000, motorSharePpm: 350_000, healthSharePpm: 250_000 },
      clawbackDays: 60,
      exclusivity: false,
      territories: ["AE"],
      terminationNoticeDays: 30
    });
    expect(v1!.documentFileId).toBe("doc:alpha/distribution-agreement-v1.pdf");
    expect(v1!.signedByUserId).toBe(amina); // unprefixed here, unlike decidedBy elsewhere
    expect(v1!.signedByPartnerName).toBe("Layla Mansour");
    expect(v1!.signedAt).toBe(WENT_LIVE - 5 * DAY);
    expect(v1!.effectiveFrom).toBe(WENT_LIVE - 5 * DAY);
    expect(v1!.effectiveTo).toBeNull();
    expect(v1!.state).toBe("active");
    expect(v1!.supersedesId).toBeNull();
    expect(v1!.createdBy).toBe(dana);
    expect(v1!.createdAt).toBe(WENT_LIVE - 7 * DAY);
    expect(v1!.updatedAt).toBe(WENT_LIVE - 5 * DAY);
  });

  it("v2 is drafted and unsigned, supersedes v1, and renegotiates every rate", async () => {
    const [v1] = await db
      .select()
      .from(schema.distPartnerAgreements)
      .where(and(eq(schema.distPartnerAgreements.tenantId, tenantId), eq(schema.distPartnerAgreements.partnerId, alphaId), eq(schema.distPartnerAgreements.version, 1)));
    const [v2] = await db
      .select()
      .from(schema.distPartnerAgreements)
      .where(and(eq(schema.distPartnerAgreements.tenantId, tenantId), eq(schema.distPartnerAgreements.partnerId, alphaId), eq(schema.distPartnerAgreements.version, 2)));
    expect(JSON.parse(v2!.termsJson)).toEqual({
      settlement: { frequency: "monthly", dayOfMonth: 10, netDays: 15, minPayoutMinor: 50_000 },
      rateCard: { defaultSharePpm: 320_000, motorSharePpm: 350_000, healthSharePpm: 275_000 },
      clawbackDays: 90,
      exclusivity: false,
      territories: ["AE", "SA"],
      terminationNoticeDays: 30
    });
    expect(v2!.documentFileId).toBe("doc:alpha/distribution-agreement-v2-draft.pdf");
    expect(v2!.state).toBe("pending_signature");
    expect(v2!.supersedesId).toBe(v1!.id);
    expect(v2!.signedByUserId).toBeNull();
    expect(v2!.signedByPartnerName).toBeNull();
    expect(v2!.signedAt).toBeNull();
    expect(v2!.effectiveFrom).toBeNull();
    expect(v2!.approvalId).toBeNull();
    expect(v2!.createdBy).toBe(dana);
    expect(v2!.createdAt).toBe(NOW - 9 * DAY);
    expect(v2!.updatedAt).toBe(NOW - 2 * DAY);
  });
});

describe("seedOnboarding — partner rows the checklist earned", () => {
  it("promotes Alpha to stage live with the full identity/risk/agreement/payout set", async () => {
    const [row] = await db
      .select()
      .from(schema.orbitPartners)
      .where(and(eq(schema.orbitPartners.tenantId, tenantId), eq(schema.orbitPartners.id, alphaId)));
    const [screening] = await db
      .select()
      .from(schema.screenings)
      .where(and(eq(schema.screenings.tenantId, tenantId), eq(schema.screenings.subjectRef, alphaId)));
    const [agreement] = await db
      .select()
      .from(schema.distPartnerAgreements)
      .where(and(eq(schema.distPartnerAgreements.tenantId, tenantId), eq(schema.distPartnerAgreements.partnerId, alphaId), eq(schema.distPartnerAgreements.version, 1)));
    expect(row!.stage).toBe("live");
    expect(row!.ownerRef).toBe(dana);
    expect(row!.legalName).toBe("Alpha Brokers Insurance Services LLC");
    expect(row!.registrationNo).toBe("DED-611904");
    expect(row!.taxId).toBe("100234567800003");
    expect(row!.country).toBe("AE");
    expect(row!.screeningId).toBe(screening!.id);
    expect(row!.riskRating).toBe("low");
    expect(row!.agreementId).toBe(agreement!.id);
    expect(row!.payoutMethodRef).toBe("payout:mandate:alpha-enbd-9931");
    expect(row!.goLiveAt).toBe(WENT_LIVE);
    expect(row!.updatedAt).toBe(WENT_LIVE);
  });

  it("leaves Etisalat at applied, with no taxId set at all", async () => {
    const [row] = await db
      .select()
      .from(schema.orbitPartners)
      .where(and(eq(schema.orbitPartners.tenantId, tenantId), eq(schema.orbitPartners.id, telcoId)));
    const [screening] = await db
      .select()
      .from(schema.screenings)
      .where(and(eq(schema.screenings.tenantId, tenantId), eq(schema.screenings.subjectRef, telcoId)));
    expect(row!.stage).toBe("applied");
    expect(row!.ownerRef).toBe(dana);
    expect(row!.legalName).toBe("Etisalat Mobility Services FZ-LLC");
    expect(row!.registrationNo).toBe("FZ-LLC-88217");
    expect(row!.taxId).toBeNull(); // never set for telco, unlike Alpha
    expect(row!.country).toBe("AE");
    expect(row!.screeningId).toBe(screening!.id);
    expect(row!.riskRating).toBe("medium");
    expect(row!.agreementId).toBeNull();
    expect(row!.goLiveAt).toBeNull();
    expect(row!.updatedAt).toBe(NOW - 18 * DAY);
  });

  it("touches Careem's identity fields but never assigns a stage", async () => {
    const [row] = await db
      .select()
      .from(schema.orbitPartners)
      .where(and(eq(schema.orbitPartners.tenantId, tenantId), eq(schema.orbitPartners.id, careemId)));
    // orbit.ts never sets `stage` on insert either, so the schema default
    // ("prospect") is the only way this value could be anything but live/applied.
    expect(row!.stage).toBe("prospect");
    expect(row!.ownerRef).toBe(dana);
    expect(row!.legalName).toBe("Careem Everything FZ-LLC");
    expect(row!.country).toBe("AE");
    expect(row!.riskRating).toBe("medium");
    expect(row!.screeningId).toBeNull();
    expect(row!.agreementId).toBeNull();
    expect(row!.goLiveAt).toBeNull();
    expect(row!.updatedAt).toBe(NOW - 5 * DAY);
  });
});

describe("seedOnboarding — partnerByName", () => {
  it("throws when the tenant has no partner by that name", async () => {
    // Reuses the already-migrated shared `db` with a second, partner-less
    // tenant row — no need for a fresh client since tenants are isolated by id.
    await db.insert(schema.tenants).values({
      id: "tn_no_partners",
      slug: "no-partners",
      name: "No Partners Co",
      policyJson: "{}",
      createdAt: NOW,
      updatedAt: NOW
    });
    // Fields never read before the throw (teams/providers/products/offerings/
    // channels/customerId/...) are omitted; partnerByName fails on the very
    // first lookup, before any of them would be touched.
    const ctx = {
      db,
      now: NOW,
      tenantId: "tn_no_partners",
      users: { "orbit.partners": "u_x", "tenant.compliance": "u_y", "tenant.admin": "u_z", "finance.controller": "u_w", "dev.admin": "u_v" }
    } as unknown as SeedContext;
    await expect(seedOnboarding(ctx)).rejects.toThrow("seed: no partner named Alpha Brokers");
  });
});
