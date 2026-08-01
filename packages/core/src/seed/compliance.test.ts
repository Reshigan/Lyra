import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@lyra/db";
import { canonicalJson, sha256Hex } from "../crypto.js";
import type { CoreDb } from "../context.js";
import { seedCompliance } from "./compliance.js";
import { DAY, HOUR, MINUTE, type SeedContext } from "./context.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "db", "migrations");

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

const NOW = Date.UTC(2026, 0, 6, 8, 0, 0);

/** A minimal, fully-known SeedContext — compliance.ts writes text/JSON columns
 * with no FK enforcement, so synthetic ids let every expectation below be an
 * exact literal instead of a round-tripped lookup. */
function buildCtx(db: CoreDb, tenantId: string, overrides: Partial<SeedContext["users"]> = {}): SeedContext {
  return {
    db,
    now: NOW,
    tenantId,
    users: {
      "tenant.compliance": "us_compliance1",
      "tenant.admin": "us_admin1",
      "finance.controller": "us_controller1",
      "axis.lead": "us_opslead1",
      "dev.admin": "us_devadmin1",
      ...overrides
    },
    teams: { motor: "tm_motor1", health: "tm_health1", retention: "tm_retention1" },
    providers: {
      gonxt: "pv_gonxt1",
      falcon: "pv_falcon1",
      cedar: "pv_cedar1",
      oryx: "pv_oryx1",
      gulfHealth: "pv_gulfhealth1",
      meridian: "pv_meridian1"
    },
    products: { motor: "pr_motor1", health: "pr_health1", travel: "pr_travel1", home: "pr_home1", life: "pr_life1" },
    offerings: {
      gonxtMotor: "of_1",
      falconMotor: "of_2",
      cedarMotor: "of_3",
      oryxMotor: "of_4",
      cedarMotorPlus: "of_5",
      gulfHealth: "of_6",
      gonxtTravel: "of_7",
      cedarHome: "of_8",
      oryxLife: "of_9"
    },
    channels: { web: "ch_web1", app: "ch_app1", callCentre: "ch_call1", brokerAlpha: "ch_brokeralpha1", bankEmbed: "ch_bank1" },
    customerId: "cu_test1",
    consentId: "cn_test1",
    quoteRequestId: "qr_test1",
    caseId: "cs_test1",
    policyId: "pol_test1",
    renewalPolicyId: "pol_renewal1",
    issuedAt: NOW + 2 * DAY
  };
}

const customerRef = "customer:cu_test1";
const compliance = "user:us_compliance1";
const admin = "user:us_admin1";
const controller = "user:us_controller1";
const opsLead = "user:us_opslead1";
const devAdmin = "user:us_devadmin1";

let db: CoreDb;

beforeAll(async () => {
  const client: Client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  db = drizzle(client) as unknown as CoreDb;
}, 30_000);

describe("seedCompliance", () => {
  const tenantId = "tn_main1";

  beforeAll(async () => {
    // Three rulepack versions, out of chronological insertion order, so a
    // mutation that swaps desc(effectiveAt) for asc (or drops the orderBy)
    // would pick a different id than the one this suite expects.
    await db.insert(schema.rulepacks).values([
      { id: "rpk_old", tenantId, market: "AE", version: "2025.1", rulesJson: "{}", effectiveAt: NOW - 400 * DAY, createdAt: NOW - 400 * DAY },
      { id: "rpk_mid", tenantId, market: "AE", version: "2025.2", rulesJson: "{}", effectiveAt: NOW - 6 * DAY, createdAt: NOW - 6 * DAY },
      { id: "rpk_new", tenantId, market: "AE", version: "2026.1", rulesJson: "{}", effectiveAt: NOW + 60 * DAY, createdAt: NOW }
    ]);
    await seedCompliance(buildCtx(db, tenantId));
  });

  it("writes one disclosure per consequential moment, hashing the wording actually shown", async () => {
    const rows = await db.select().from(schema.disclosures).where(eq(schema.disclosures.tenantId, tenantId));
    expect(rows).toHaveLength(7);
    for (const r of rows) expect(r.id).toMatch(/^dsc_/);

    const find = (key: string, locale: string) => rows.find((r) => r.key === key && r.locale === locale)!;

    const panel = find("panel.data_sharing", "en");
    expect(panel.subjectRef).toBe("quote_request:qr_test1");
    expect(panel.customerId).toBe("cu_test1");
    expect(panel.channel).toBe("web");
    expect(panel.wordingRef).toBe("wording/panel-data-sharing@2026-01-02");
    expect(panel.criteriaJson).toBeNull();
    expect(panel.acknowledgedAt).toBe(NOW + 5_000);
    expect(panel.ts).toBe(NOW + 2_000);
    expect(panel.wordingHash).toBe(
      await sha256Hex(
        "Your details are sent to the underwriters on the panel so that each of them can price your cover. You can withdraw this at any time and we will stop sharing."
      )
    );

    const rankingEn = find("quote.ranking_criteria", "en");
    expect(rankingEn.subjectRef).toBe("quote_request:qr_test1");
    expect(rankingEn.acknowledgedAt).toBe(NOW + 45_000);
    expect(rankingEn.ts).toBe(NOW + 40_000);
    expect(JSON.parse(rankingEn.criteriaJson!)).toEqual({
      primary: "price",
      order: "lowest annual premium first",
      shown: ["premium", "excess", "agencyRepair", "roadside", "valueScore"],
      panelSize: 4,
      ownPaperInPanel: true
    });

    const commission = find("commission.disclosure", "en");
    expect(commission.wordingRef).toBe("wording/commission-disclosure@2025-11-14");
    expect(commission.criteriaJson).toBeNull();
    expect(commission.acknowledgedAt).toBe(NOW + 45_000);
    expect(commission.ts).toBe(NOW + 40_000);

    const rankingAr = find("quote.ranking_criteria", "ar");
    expect(rankingAr.subjectRef).toBe("policy:pol_renewal1");
    expect(rankingAr.channel).toBe("app");
    // Opened and shown but not acted on: the honest state is null, not a guess.
    expect(rankingAr.acknowledgedAt).toBeNull();
    expect(rankingAr.ts).toBe(NOW - 3 * DAY);
    expect(JSON.parse(rankingAr.criteriaJson!)).toEqual({
      primary: "price",
      order: "lowest annual premium first",
      shown: ["premium", "excess", "agencyRepair"],
      panelSize: 3,
      ownPaperInPanel: true
    });

    const aiIdentity = find("ai.assistant_identity", "en");
    expect(aiIdentity.subjectRef).toBe(customerRef);
    expect(aiIdentity.channel).toBe("whatsapp");
    expect(aiIdentity.acknowledgedAt).toBeNull();
    expect(aiIdentity.ts).toBe(NOW - 6 * DAY);

    const claims = find("claims.guidance_informational", "en");
    expect(claims.subjectRef).toBe("case:cs_test1");
    expect(claims.channel).toBe("app");
    expect(claims.acknowledgedAt).toBe(NOW + 3 * DAY);
    expect(claims.ts).toBe(NOW + 3 * DAY - 2 * MINUTE);

    const optout = find("telemarketing.optout", "ar");
    expect(optout.subjectRef).toBe(customerRef);
    expect(optout.channel).toBe("voice");
    expect(optout.acknowledgedAt).toBe(NOW - 9 * DAY + 4 * MINUTE);
    expect(optout.ts).toBe(NOW - 9 * DAY);
  });

  it("tracks every subject request through its own state, not a shared default", async () => {
    const rows = await db.select().from(schema.dsarRequests).where(eq(schema.dsarRequests.tenantId, tenantId));
    expect(rows).toHaveLength(8);
    for (const r of rows) expect(r.id).toMatch(/^dsr_/);
    for (const r of rows) expect(r.bundleFileId).toBeNull();

    const find = (subjectIdentifier: string, type: string) =>
      rows.find((r) => r.subjectIdentifier === subjectIdentifier && r.type === type)!;

    const access = find("rania.haddad@example.ae", "access");
    expect(access.customerId).toBe("cu_test1");
    expect(access.channel).toBe("portal");
    expect(access.verificationRef).toBe("portal_session_mfa");
    expect(access.state).toBe("fulfilled");
    expect(access.dueAt).toBe(NOW + 6 * DAY);
    expect(access.fulfilledAt).toBe(NOW - 17 * DAY);
    expect(access.refusalReason).toBeNull();
    expect(access.handledBy).toBe(compliance);
    expect(access.createdAt).toBe(NOW - 24 * DAY);
    expect(access.updatedAt).toBe(NOW - 17 * DAY);
    expect(JSON.parse(access.completenessProofJson!)).toEqual({
      checkedAt: NOW - 17 * DAY,
      tables: [
        "core_customers",
        "core_consents",
        "dist_quote_requests",
        "axis_policies",
        "orbit_conversations",
        "orbit_messages",
        "ledger_journal_lines"
      ],
      rowsFound: 213,
      piiFieldsRedacted: 4
    });

    const erasureHeld = find("rania.haddad@example.ae", "erasure");
    expect(erasureHeld.customerId).toBe("cu_test1");
    expect(erasureHeld.channel).toBe("email");
    // Paused for a legal hold, not refused: the clock keeps running.
    expect(erasureHeld.state).toBe("awaiting_legal");
    expect(erasureHeld.dueAt).toBe(NOW + 9 * DAY);
    expect(erasureHeld.fulfilledAt).toBeNull();
    expect(erasureHeld.completenessProofJson).toBeNull();
    expect(erasureHeld.handledBy).toBe(compliance);
    expect(erasureHeld.createdAt).toBe(NOW - 21 * DAY);
    expect(erasureHeld.updatedAt).toBe(NOW - 2 * DAY);

    const erasureDone = find("hana.abbas@example.ae", "erasure");
    expect(erasureDone.customerId).toBeNull();
    expect(erasureDone.channel).toBe("portal");
    expect(erasureDone.state).toBe("fulfilled");
    expect(erasureDone.dueAt).toBe(NOW - 4 * DAY);
    expect(erasureDone.fulfilledAt).toBe(NOW - 11 * DAY);
    expect(erasureDone.handledBy).toBe(compliance);
    expect(erasureDone.createdAt).toBe(NOW - 34 * DAY);
    expect(erasureDone.updatedAt).toBe(NOW - 11 * DAY);
    expect(JSON.parse(erasureDone.completenessProofJson!)).toEqual({
      checkedAt: NOW - 11 * DAY,
      tablesErased: 4,
      tablesRetained: 2,
      downstream: ["vector index", "audience cache", "export bucket"],
      verifiedBy: "erasure-completeness job"
    });

    const portability = find("rania.haddad@example.ae", "portability");
    expect(portability.customerId).toBe("cu_test1");
    expect(portability.state).toBe("in_progress");
    expect(portability.dueAt).toBe(NOW + 18 * DAY);
    expect(portability.handledBy).toBe(compliance);

    const rectification = find("+971501234567", "rectification");
    expect(rectification.channel).toBe("whatsapp");
    expect(rectification.verificationRef).toBe("known_number_and_otp");
    expect(rectification.state).toBe("fulfilled");
    expect(rectification.dueAt).toBe(NOW + 24 * DAY);
    expect(rectification.fulfilledAt).toBe(NOW - 6 * DAY + 3 * HOUR);
    expect(JSON.parse(rectification.completenessProofJson!)).toEqual({
      checkedAt: NOW - 6 * DAY + 3 * HOUR,
      field: "core_customers.name_json.ar",
      rowsUpdated: 1,
      downstream: ["policy documents reissued"]
    });

    const objection = find("+971502223344", "objection");
    expect(objection.customerId).toBeNull();
    expect(objection.channel).toBe("regulator");
    expect(objection.verificationRef).toBeNull();
    expect(objection.state).toBe("refused");
    expect(objection.dueAt).toBe(NOW - 8 * DAY);
    expect(objection.fulfilledAt).toBeNull();
    expect(objection.refusalReason).toMatch(/could not be verified/);
    expect(objection.handledBy).toBe(compliance);

    const restriction = find("omar.khalil@example.ae", "restriction");
    expect(restriction.customerId).toBeNull();
    expect(restriction.channel).toBe("email");
    expect(restriction.verificationRef).toBeNull();
    expect(restriction.state).toBe("verifying");
    expect(restriction.dueAt).toBe(NOW + 27 * DAY);

    const fresh = find("lina.saeed@example.ae", "access");
    expect(fresh.customerId).toBeNull();
    expect(fresh.channel).toBe("portal");
    expect(fresh.state).toBe("received");
    expect(fresh.dueAt).toBe(NOW + 30 * DAY);
    // Nobody has picked it up yet — a queue only means something if this stays null.
    expect(fresh.handledBy).toBeNull();
    expect(fresh.createdAt).toBe(NOW - 2 * HOUR);
    expect(fresh.updatedAt).toBe(NOW - 2 * HOUR);
  });

  it("logs the one completed erasure table by table, retaining only what the floor requires", async () => {
    const dsar = (
      await db.select().from(schema.dsarRequests).where(eq(schema.dsarRequests.tenantId, tenantId))
    ).find((r) => r.subjectIdentifier === "hana.abbas@example.ae" && r.type === "erasure")!;
    const rows = await db.select().from(schema.erasureLog).where(eq(schema.erasureLog.tenantId, tenantId));
    expect(rows).toHaveLength(7);
    for (const r of rows) {
      expect(r.id).toMatch(/^ers_/);
      expect(r.dsarId).toBe(dsar.id);
    }
    const erasureAt = NOW - 11 * DAY;
    const find = (tableName: string) => rows.find((r) => r.tableName === tableName)!;

    const messages = find("orbit_messages");
    expect(messages.rowsErased).toBe(46);
    expect(messages.rowsTombstoned).toBe(0);
    expect(messages.retainedReason).toBeNull();
    expect(messages.ts).toBe(erasureAt);

    const conversations = find("orbit_conversations");
    expect(conversations.rowsErased).toBe(0);
    // The thread survives as a tombstone so the handover history still makes sense.
    expect(conversations.rowsTombstoned).toBe(3);
    expect(conversations.ts).toBe(erasureAt);

    const attribution = find("signal_attribution_events");
    expect(attribution.rowsErased).toBe(18);
    expect(attribution.rowsTombstoned).toBe(0);

    const customers = find("core_customers");
    expect(customers.rowsErased).toBe(1);
    expect(customers.rowsTombstoned).toBe(0);

    const consents = find("core_consents");
    expect(consents.rowsErased).toBe(0);
    expect(consents.rowsTombstoned).toBe(1);
    expect(consents.retainedReason).toMatch(/consent ledger is kept/);
    expect(consents.ts).toBe(erasureAt);

    const ledger = find("ledger_journal_lines");
    expect(ledger.rowsErased).toBe(0);
    expect(ledger.rowsTombstoned).toBe(0);
    expect(ledger.retainedReason).toMatch(/seven years/);
    expect(ledger.ts).toBe(erasureAt);

    const files = find("core_files");
    expect(files.rowsErased).toBe(2);
    expect(files.rowsTombstoned).toBe(1);
    expect(files.retainedReason).toBeNull();
    // The one row on a different clock offset from the rest of the batch.
    expect(files.ts).toBe(erasureAt + 4 * MINUTE);
  });

  it("screens every subject with the stub provider and hashes the query actually asked", async () => {
    const rows = await db.select().from(schema.screenings).where(eq(schema.screenings.tenantId, tenantId));
    expect(rows).toHaveLength(7);
    for (const r of rows) {
      expect(r.id).toMatch(/^scr_/);
      expect(r.provider).toBe("stub");
    }
    const find = (subjectRef: string, kind: string) => rows.find((r) => r.subjectRef === subjectRef && r.kind === kind)!;

    const sanctionsClear = find(customerRef, "sanctions");
    expect(sanctionsClear.result).toBe("clear");
    expect(sanctionsClear.hitsJson).toBeNull();
    expect(sanctionsClear.disposition).toBeNull();
    expect(sanctionsClear.blocked).toBe(false);
    expect(sanctionsClear.caseRef).toBe("case:cs_test1");
    expect(sanctionsClear.ts).toBe(NOW + 2 * DAY - 20 * MINUTE);
    expect(sanctionsClear.queryHash).toBe(
      await sha256Hex(
        canonicalJson({ kind: "sanctions", name: "rania haddad", identifiers: { dob: "1992-04-11", nationality: "LB" } })
      )
    );

    const pep = find(customerRef, "pep");
    expect(pep.result).toBe("clear");
    expect(pep.blocked).toBe(false);
    expect(pep.ts).toBe(NOW + 2 * DAY - 19 * MINUTE);

    const mansour = find("name:mansour auto workshop", "sanctions");
    expect(mansour.result).toBe("hit");
    expect(JSON.parse(mansour.hitsJson!)).toEqual([
      {
        listRef: "stub:lyra-test-hit",
        matchedName: "mansour auto workshop",
        matchPct: 78,
        note: "Produced locally by the built-in stub. No watchlist was consulted.",
        stub: true
      }
    ]);
    expect(mansour.disposition).toBe("false_positive");
    expect(mansour.dispositionedBy).toBe(compliance);
    expect(mansour.blocked).toBe(false);
    expect(mansour.caseRef).toBe("case:cs_test1");

    const northline = find("name:northline recovery services", "sanctions");
    expect(northline.result).toBe("hit");
    expect(northline.disposition).toBeNull();
    expect(northline.dispositionedBy).toBeNull();
    // Nobody has dispositioned it, so the block stands.
    expect(northline.blocked).toBe(true);
    expect(northline.caseRef).toBeNull();
    expect(northline.ts).toBe(NOW - 16 * HOUR);

    const adverse = find("name:tarek bin sulayem", "adverse_media");
    expect(adverse.result).toBe("inconclusive");
    expect(adverse.disposition).toBe("escalated");
    expect(adverse.dispositionedBy).toBe(compliance);
    expect(adverse.blocked).toBe(false);
    expect(adverse.caseRef).toBeNull();

    const fraud = find("name:sami rahal", "fraud");
    expect(fraud.result).toBe("hit");
    expect(fraud.disposition).toBe("confirmed");
    expect(fraud.dispositionedBy).toBe(compliance);
    expect(fraud.blocked).toBe(true);
    expect(fraud.caseRef).toBe("case:cs_test1");
    expect(fraud.ts).toBe(NOW - 27 * DAY);

    const counterparty = find("provider:pv_oryx1", "sanctions");
    expect(counterparty.result).toBe("clear");
    expect(counterparty.hitsJson).toBeNull();
    expect(counterparty.blocked).toBe(false);
    expect(counterparty.caseRef).toBeNull();
    expect(counterparty.ts).toBe(NOW - 45 * DAY);
    expect(counterparty.queryHash).toBe(
      await sha256Hex(
        canonicalJson({ kind: "sanctions", name: "oryx insurance", identifiers: { counterparty: "underwriter" } })
      )
    );
  });

  it("runs the retention purge in batches, one cutoff shared across a retry", async () => {
    const rows = await db.select().from(schema.retentionRuns).where(eq(schema.retentionRuns.tenantId, tenantId));
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.id).toMatch(/^ret_/);
      expect(r.policyKey).toBe("messages");
      expect(r.tableName).toBe("orbit_messages");
    }
    const find = (startedAt: number) => rows.find((r) => r.startedAt === startedAt)!;
    const cutoff730 = (startedAt: number) => startedAt - 730 * DAY;

    const first = find(NOW - 62 * DAY);
    expect(first.cutoffAt).toBe(cutoff730(NOW - 62 * DAY));
    expect(first.rowsAffected).toBe(500);
    expect(first.rowsHeld).toBe(14);
    expect(first.state).toBe("done");
    expect(first.error).toBeNull();
    expect(first.endedAt).toBe(NOW - 62 * DAY + 41_000);

    const second = find(NOW - 62 * DAY + 2 * MINUTE);
    // Same cutoff as the run above: this is the continuation call, not a new window.
    expect(second.cutoffAt).toBe(first.cutoffAt);
    expect(second.rowsAffected).toBe(137);
    expect(second.state).toBe("done");
    expect(second.endedAt).toBe(second.startedAt + 12_000);

    const failed = find(NOW - 31 * DAY);
    expect(failed.cutoffAt).toBe(cutoff730(NOW - 31 * DAY));
    expect(failed.rowsAffected).toBe(0);
    expect(failed.state).toBe("failed");
    expect(failed.error).toMatch(/exceeded the request budget/);
    expect(failed.endedAt).toBe(failed.startedAt + 30_000);

    const done = find(NOW - 30 * DAY);
    expect(done.cutoffAt).toBe(cutoff730(NOW - 30 * DAY));
    expect(done.rowsAffected).toBe(88);
    expect(done.state).toBe("done");
    expect(done.endedAt).toBe(done.startedAt + 9_000);

    const running = find(NOW - 20 * MINUTE);
    expect(running.cutoffAt).toBe(cutoff730(NOW - 20 * MINUTE));
    expect(running.rowsAffected).toBe(0);
    expect(running.rowsHeld).toBe(16);
    expect(running.state).toBe("running");
    expect(running.error).toBeNull();
    // Still in flight: the only way to tell it apart from one that died silently.
    expect(running.endedAt).toBeNull();
  });

  it("places legal holds naming an authority only when one truly stands behind it", async () => {
    const rows = await db.select().from(schema.legalHolds).where(eq(schema.legalHolds.tenantId, tenantId));
    expect(rows).toHaveLength(5);
    for (const r of rows) expect(r.id).toMatch(/^lgh_/);
    const find = (subjectRef: string) => rows.find((r) => r.subjectRef === subjectRef)!;

    const customerHold = find(customerRef);
    expect(customerHold.authority).toBe("External counsel");
    expect(customerHold.placedBy).toBe(compliance);
    expect(customerHold.releasedBy).toBeNull();
    expect(customerHold.releasedAt).toBeNull();
    expect(customerHold.createdAt).toBe(NOW - 20 * DAY);
    expect(customerHold.reason).toMatch(/motor claim/);

    const caseHold = find("case:cs_test1");
    expect(caseHold.authority).toBe("External counsel");
    expect(caseHold.placedBy).toBe(compliance);
    expect(caseHold.releasedBy).toBeNull();
    expect(caseHold.createdAt).toBe(NOW - 20 * DAY);

    const providerHold = find("provider:pv_oryx1");
    // A commercial dispute, not an outside authority: naming one would be unsupported.
    expect(providerHold.authority).toBeNull();
    expect(providerHold.placedBy).toBe(admin);
    expect(providerHold.releasedBy).toBeNull();
    expect(providerHold.releasedAt).toBeNull();
    expect(providerHold.createdAt).toBe(NOW - 7 * DAY);

    const channelHold = find("channel:ch_brokeralpha1");
    expect(channelHold.authority).toBe("Internal audit");
    expect(channelHold.placedBy).toBe(controller);
    // Released once the audit closed, and by somebody other than who placed it.
    expect(channelHold.releasedBy).toBe(compliance);
    expect(channelHold.releasedAt).toBe(NOW - 12 * DAY);
    expect(channelHold.createdAt).toBe(NOW - 96 * DAY);

    const policyHold = find("policy:pol_renewal1");
    expect(policyHold.authority).toBeNull();
    expect(policyHold.placedBy).toBe(compliance);
    expect(policyHold.releasedBy).toBe(admin);
    expect(policyHold.releasedAt).toBe(NOW - 40 * DAY);
    expect(policyHold.createdAt).toBe(NOW - 110 * DAY);
  });

  it("builds an evidence bundle manifest that hashes to the same value it stores", async () => {
    const rows = await db.select().from(schema.evidenceBundles).where(eq(schema.evidenceBundles.tenantId, tenantId));
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.id).toMatch(/^evb_/);
      expect(r.fileId).toBeNull();
    }
    const find = (purpose: string, state: string) => rows.find((r) => r.purpose === purpose && r.state === state)!;

    const regulatorFiles = [
      { path: "audit.jsonl", sizeBytes: 1_842_113 },
      { path: "ai-audit.jsonl", sizeBytes: 962_004 },
      { path: "summary.pdf", sizeBytes: 41_220 }
    ];
    const delivered = find("regulator", "delivered");
    expect(delivered.requestedBy).toBe(compliance);
    expect(delivered.approvedBy).toBe(admin);
    expect(delivered.deliveredTo).toBe("Supervisory correspondence, reference SUP-2025-1180");
    expect(delivered.createdAt).toBe(NOW - 28 * DAY);
    expect(delivered.updatedAt).toBe(NOW - 26 * DAY);
    const deliveredScope = { subjectRef: null, from: NOW - 365 * DAY, to: NOW - 30 * DAY, purpose: "regulator" };
    expect(JSON.parse(delivered.scopeJson)).toEqual(deliveredScope);
    const deliveredManifest = {
      version: 1,
      tenantId,
      generatedAt: delivered.createdAt,
      requestedBy: compliance,
      scope: deliveredScope,
      files: await Promise.all(
        regulatorFiles.map(async (f) => ({
          path: f.path,
          sizeBytes: f.sizeBytes,
          sha256: await sha256Hex(`${tenantId}:${delivered.createdAt}:${f.path}:${f.sizeBytes}`)
        }))
      ),
      truncated: false
    };
    expect(JSON.parse(delivered.manifestJson)).toEqual(deliveredManifest);
    expect(delivered.bundleHash).toBe(await sha256Hex(canonicalJson(deliveredManifest)));

    const audit = find("audit", "ready");
    expect(audit.requestedBy).toBe(compliance);
    expect(audit.approvedBy).toBeNull();
    expect(audit.deliveredTo).toBe("External auditor, quarterly walkthrough");
    expect(audit.createdAt).toBe(NOW - 5 * DAY);

    const dispute = find("dispute", "ready");
    expect(dispute.requestedBy).toBe(compliance);
    expect(dispute.deliveredTo).toBeNull();
    expect(JSON.parse(dispute.scopeJson)).toEqual({ subjectRef: customerRef, from: 0, to: NOW, purpose: "dispute" });

    const internalFiles = [
      { path: "audit.jsonl", sizeBytes: 12_004 },
      { path: "ai-audit.jsonl", sizeBytes: 4_118 },
      { path: "summary.pdf", sizeBytes: 33_902 }
    ];
    const internal = find("internal", "building");
    // Requested by the ops lead, not compliance — the only bundle in this set that is.
    expect(internal.requestedBy).toBe(opsLead);
    expect(internal.approvedBy).toBeNull();
    expect(internal.deliveredTo).toBeNull();
    expect(internal.createdAt).toBe(NOW - 40 * MINUTE);
    const internalScope = { subjectRef: "case:cs_test1", from: NOW - 60 * DAY, to: NOW, purpose: "internal" };
    const internalManifest = {
      version: 1,
      tenantId,
      generatedAt: internal.createdAt,
      requestedBy: opsLead,
      scope: internalScope,
      files: await Promise.all(
        internalFiles.map(async (f) => ({
          path: f.path,
          sizeBytes: f.sizeBytes,
          sha256: await sha256Hex(`${tenantId}:${internal.createdAt}:${f.path}:${f.sizeBytes}`)
        }))
      ),
      truncated: false
    };
    expect(internal.bundleHash).toBe(await sha256Hex(canonicalJson(internalManifest)));

    const failedRegulator = find("regulator", "failed");
    expect(failedRegulator.requestedBy).toBe(compliance);
    expect(failedRegulator.createdAt).toBe(NOW - 121 * DAY);
    expect(JSON.parse(failedRegulator.scopeJson)).toEqual({ subjectRef: null, from: 0, to: NOW - 120 * DAY, purpose: "regulator" });
  });

  it("opens incidents with the 72-hour clock and the kill switch as real columns", async () => {
    const rows = await db.select().from(schema.incidents).where(eq(schema.incidents.tenantId, tenantId));
    expect(rows).toHaveLength(6);
    for (const r of rows) expect(r.id).toMatch(/^inc_/);
    const find = (title: string) => rows.find((r) => r.title === title)!;

    const statement = find("Broker statement emailed to the wrong partner contact");
    expect(statement.kind).toBe("data");
    expect(statement.severity).toBe("sev1");
    expect(statement.agentsPaused).toBe(false);
    expect(statement.notifiableAt).toBe(NOW - 88 * DAY + 72 * HOUR);
    expect(statement.notifiedAt).toBe(NOW - 88 * DAY + 31 * HOUR);
    expect(statement.state).toBe("postmortem");
    expect(statement.openedBy).toBe(compliance);
    expect(statement.resolvedAt).toBe(NOW - 86 * DAY);
    expect(statement.postmortemRef).toBe("review/2025-10-statement-misdelivery");
    expect(statement.createdAt).toBe(NOW - 88 * DAY);
    expect(statement.updatedAt).toBe(NOW - 80 * DAY);
    expect(JSON.parse(statement.affectedJson!)).toEqual({
      partners: 2,
      statements: 1,
      customersNamed: 41,
      fieldsExposed: ["name", "policyRef", "premium"]
    });

    const drafts = find("Arabic renewal drafts quoted a premium the ledger did not have");
    expect(drafts.kind).toBe("model");
    expect(drafts.severity).toBe("sev2");
    // The per-agent kill switch, pulled and recorded.
    expect(drafts.agentsPaused).toBe(true);
    expect(drafts.notifiableAt).toBeNull();
    expect(drafts.notifiedAt).toBeNull();
    expect(drafts.state).toBe("mitigated");
    expect(drafts.openedBy).toBe(devAdmin);
    expect(drafts.resolvedAt).toBeNull();
    expect(drafts.postmortemRef).toBeNull();
    expect(drafts.createdAt).toBe(NOW - 2 * DAY);
    expect(drafts.updatedAt).toBe(NOW - 20 * HOUR);

    const quietHours = find("Outbound calls attempted inside quiet hours");
    expect(quietHours.kind).toBe("regulatory");
    expect(quietHours.severity).toBe("sev3");
    expect(quietHours.agentsPaused).toBe(false);
    expect(quietHours.state).toBe("mitigated");
    expect(quietHours.openedBy).toBe(compliance);
    expect(quietHours.resolvedAt).toBeNull();
    expect(JSON.parse(quietHours.affectedJson!)).toEqual({ queued: 12, blocked: 9, connected: 3, channel: "call_centre" });

    const outage = find("Oryx quote responses timed out for 40 minutes");
    expect(outage.kind).toBe("outage");
    expect(outage.severity).toBe("sev3");
    expect(outage.state).toBe("resolved");
    expect(outage.openedBy).toBe(opsLead);
    expect(outage.resolvedAt).toBe(NOW - 34 * DAY);
    expect(outage.postmortemRef).toBe("review/2025-12-oryx-timeouts");
    expect(outage.createdAt).toBe(NOW - 34 * DAY - 40 * MINUTE);
    expect(outage.updatedAt).toBe(NOW - 34 * DAY);

    const stuffing = find("Credential stuffing against the customer portal");
    expect(stuffing.kind).toBe("security");
    expect(stuffing.severity).toBe("sev2");
    expect(stuffing.state).toBe("resolved");
    expect(stuffing.openedBy).toBe(devAdmin);
    expect(stuffing.resolvedAt).toBe(NOW - 47 * DAY);
    expect(stuffing.postmortemRef).toBe("review/2025-11-portal-stuffing");
    expect(JSON.parse(stuffing.affectedJson!)).toEqual({ attempts: 4_012, accountsMatched: 0, sessionsCreated: 0 });

    const device = find("Unrecognised device on a compliance session");
    expect(device.kind).toBe("security");
    expect(device.severity).toBe("sev4");
    expect(device.state).toBe("open");
    expect(device.openedBy).toBe(admin);
    expect(device.resolvedAt).toBeNull();
    expect(device.postmortemRef).toBeNull();
    expect(device.createdAt).toBe(NOW - 5 * HOUR);
  });

  it("records which rulepack version was in force, always the one with the latest effectiveAt", async () => {
    const rows = await db
      .select()
      .from(schema.rulepackApplications)
      .where(eq(schema.rulepackApplications.tenantId, tenantId));
    expect(rows).toHaveLength(7);
    for (const r of rows) {
      expect(r.id).toMatch(/^rpa_/);
      // rpk_new has the latest effectiveAt (NOW + 60 * DAY) of the three seeded.
      expect(r.rulepackId).toBe("rpk_new");
    }
    const find = (ruleKey: string) => rows.find((r) => r.ruleKey === ruleKey)!;

    const rankingShown = find("disclosure.ranking_criteria_shown");
    expect(rankingShown.subjectRef).toBe("quote_request:qr_test1");
    expect(rankingShown.outcome).toBe("pass");
    expect(rankingShown.ts).toBe(NOW + 40_000);
    expect(JSON.parse(rankingShown.detailJson!)).toEqual({ disclosureKey: "quote.ranking_criteria", acknowledged: true });

    const consent = find("consent.data_sharing_before_fanout");
    expect(consent.subjectRef).toBe("quote_request:qr_test1");
    expect(consent.outcome).toBe("pass");
    expect(consent.ts).toBe(NOW + 3_000);
    expect(JSON.parse(consent.detailJson!)).toEqual({ consentId: "cn_test1", purpose: "dataSharing", checkedAt: NOW + 2_000 });

    const screening = find("screening.sanctions_before_bind");
    expect(screening.subjectRef).toBe("case:cs_test1");
    expect(screening.outcome).toBe("pass");
    expect(screening.ts).toBe(NOW + 2 * DAY - 18 * MINUTE);
    expect(JSON.parse(screening.detailJson!)).toEqual({ kind: "sanctions", result: "clear", provider: "stub" });

    const claims = find("claims.decision_out_of_scope");
    expect(claims.subjectRef).toBe("case:cs_test1");
    // Nothing asked the platform to decide a claim: a result, not a silence.
    expect(claims.outcome).toBe("not_applicable");
    expect(claims.ts).toBe(NOW + 3 * DAY);
    expect(JSON.parse(claims.detailJson!)).toEqual({ reason: "No claim decision was requested on this case." });

    const quietHours = find("telemarketing.quiet_hours");
    expect(quietHours.subjectRef).toBe(customerRef);
    expect(quietHours.outcome).toBe("fail");
    expect(quietHours.ts).toBe(NOW - 9 * DAY);
    expect(JSON.parse(quietHours.detailJson!)).toEqual({
      attemptedAtLocal: "22:41",
      window: "09:00-21:00",
      outcome: "call connected",
      incident: "Outbound calls attempted inside quiet hours"
    });

    const frequency = find("telemarketing.contact_frequency");
    expect(frequency.subjectRef).toBe(customerRef);
    expect(frequency.outcome).toBe("pass");
    expect(frequency.ts).toBe(NOW - 9 * DAY + MINUTE);
    expect(JSON.parse(frequency.detailJson!)).toEqual({ contactsIn30Days: 2, ceiling: 4 });

    const recordKeeping = find("record_keeping.policy_documents_seven_years");
    expect(recordKeeping.subjectRef).toBe("policy:pol_test1");
    expect(recordKeeping.outcome).toBe("pass");
    expect(recordKeeping.ts).toBe(NOW + 2 * DAY); // ctx.issuedAt
    expect(JSON.parse(recordKeeping.detailJson!)).toEqual({
      retainUntil: NOW + 2 * DAY + 7 * 365 * DAY,
      documents: 3
    });
  });

  it("versions policy thresholds instead of editing one in place", async () => {
    const rows = await db.select().from(schema.policyThresholds).where(eq(schema.policyThresholds.tenantId, tenantId));
    expect(rows).toHaveLength(7);
    for (const r of rows) expect(r.id).toMatch(/^pth_/);
    const find = (key: string, version: number) => rows.find((r) => r.key === key && r.version === version)!;

    const refundV1 = find("ledger.refund", 1);
    expect(refundV1.dualControl).toBe(false);
    expect(refundV1.effectiveFrom).toBe(NOW - 210 * DAY);
    // Closed off by version 2, never overwritten.
    expect(refundV1.effectiveTo).toBe(NOW - 30 * DAY);
    expect(refundV1.setBy).toBe(controller);
    expect(JSON.parse(refundV1.valueJson)).toEqual({ amountMinor: 50_000, currency: "AED" });

    const refundV2 = find("ledger.refund", 2);
    // Raised, and dual control raised with it.
    expect(refundV2.dualControl).toBe(true);
    expect(refundV2.effectiveFrom).toBe(NOW - 30 * DAY);
    expect(refundV2.effectiveTo).toBeNull();
    expect(refundV2.setBy).toBe(controller);
    expect(JSON.parse(refundV2.valueJson)).toEqual({ amountMinor: 100_000, currency: "AED" });

    const creditNote = find("ledger.credit_note", 1);
    expect(creditNote.dualControl).toBe(true);
    expect(creditNote.effectiveFrom).toBe(NOW - 210 * DAY);
    expect(creditNote.setBy).toBe(controller);

    const priceMatch = find("axis.price_match", 1);
    expect(priceMatch.dualControl).toBe(true);
    expect(priceMatch.effectiveFrom).toBe(NOW - 180 * DAY);
    expect(priceMatch.setBy).toBe(admin);
    expect(JSON.parse(priceMatch.valueJson)).toEqual({ amountMinor: 100_000, currency: "AED" });

    const bind = find("axis.bind", 1);
    expect(bind.dualControl).toBe(true);
    expect(bind.effectiveFrom).toBe(NOW - 180 * DAY);
    expect(bind.setBy).toBe(admin);
    expect(JSON.parse(bind.valueJson)).toEqual({ amountMinor: 25_000_000, currency: "AED" });

    const budget = find("signal.budget_commit", 1);
    expect(budget.dualControl).toBe(false);
    expect(budget.effectiveFrom).toBe(NOW - 120 * DAY);
    expect(budget.setBy).toBe(admin);
    expect(JSON.parse(budget.valueJson)).toEqual({ amountMinor: 5_000_000, currency: "AED" });

    const dsarTarget = find("compliance.dsar_service_target", 1);
    expect(dsarTarget.dualControl).toBe(false);
    expect(dsarTarget.effectiveFrom).toBe(NOW - 300 * DAY);
    expect(dsarTarget.effectiveTo).toBeNull();
    expect(dsarTarget.setBy).toBe(compliance);
    expect(JSON.parse(dsarTarget.valueJson)).toEqual({ days: 30, warnAtDays: 25, escalateTo: "tenant.compliance" });
  });
});

describe("seedCompliance edge cases", () => {
  it("mints a rulepack id when the tenant has none, rather than crashing or borrowing another tenant's", async () => {
    const tenantId = "tn_no_rulepack";
    await seedCompliance(buildCtx(db, tenantId));
    const rows = await db
      .select()
      .from(schema.rulepackApplications)
      .where(eq(schema.rulepackApplications.tenantId, tenantId));
    expect(rows).toHaveLength(7);
    const rulepackId = rows[0]!.rulepackId;
    expect(rulepackId).toMatch(/^rpk_/);
    // Not the id owned by the "main" tenant seeded in the suite above.
    expect(rulepackId).not.toBe("rpk_new");
    for (const r of rows) expect(r.rulepackId).toBe(rulepackId);
  });

  it("resolves a role with no user in the map to an empty actor rather than throwing", async () => {
    const tenantId = "tn_missing_role";
    const { "dev.admin": _drop, ...usersWithoutDevAdmin } = buildCtx(db, tenantId).users;
    await seedCompliance({ ...buildCtx(db, tenantId), users: usersWithoutDevAdmin });
    const rows = await db.select().from(schema.incidents).where(eq(schema.incidents.tenantId, tenantId));
    const drafts = rows.find((r) => r.title === "Arabic renewal drafts quoted a premium the ledger did not have")!;
    // ctx.users["dev.admin"] is missing, so `user()` falls back to the empty string.
    expect(drafts.openedBy).toBe("user:");
    const stuffing = rows.find((r) => r.title === "Credential stuffing against the customer portal")!;
    expect(stuffing.openedBy).toBe("user:");
  });
});
