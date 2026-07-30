import { desc, eq } from "drizzle-orm";
import { id, schema } from "@lyra/db";
import { canonicalJson, sha256Hex } from "../crypto.js";
import { DAY, HOUR, MINUTE, type SeedContext } from "./context.js";

// docs/12. The compliance workspace is a record of things that already
// happened, so the seed has to be a plausible *history*, not a tidy end state:
// a subject request still inside its clock next to one that was answered, a
// screening hit somebody cleared next to one nobody has looked at yet, an
// erasure that a legal hold is holding open. Every row hangs off the same
// customer as the rest of the demo — Rania Haddad — because a compliance
// screen that names people no other workspace has heard of proves nothing.
//
// Regulatory wording is taken from docs/12 and nowhere else: the 72-hour
// notification clock (§2), the retention floors (§3, conversations 24 months,
// financial records seven years), ranking-criteria and telemarketing
// disclosure (§3), claims decisions being out of scope (§3), AI identifying
// itself on first contact and the kill switches (§4). Nothing here names an
// authority, an article or a penalty, because docs/12 does not.

/** `user:<id>`, the same shape `actorRef` writes at runtime. */
const user = (ctx: SeedContext, role: string): string => `user:${ctx.users[role] ?? ""}`;

/**
 * The market rulepack in force. `seedAdmin` owns `core_rulepacks` and runs
 * before this file, so the query normally finds it; the fallback only keeps a
 * reordered seed from throwing, and mints an id rather than writing a rulepack
 * this seeder does not own.
 */
async function activeRulepackId(ctx: SeedContext): Promise<string> {
  const [row] = await ctx.db
    .select({ id: schema.rulepacks.id })
    .from(schema.rulepacks)
    .where(eq(schema.rulepacks.tenantId, ctx.tenantId))
    .orderBy(desc(schema.rulepacks.effectiveAt))
    .limit(1);
  return row?.id ?? id("rpk", ctx.now);
}

export async function seedCompliance(ctx: SeedContext): Promise<void> {
  const { tenantId, now } = ctx;
  const compliance = user(ctx, "tenant.compliance"); // Khalid Al Rashed
  const admin = user(ctx, "tenant.admin");
  const controller = user(ctx, "finance.controller");
  const opsLead = user(ctx, "axis.lead");
  const devAdmin = user(ctx, "dev.admin");
  const customerRef = `customer:${ctx.customerId}`;

  /* ---------------------------------------------------------- disclosures */
  // DISCLOSURE-PRESENT (docs/19 §12) is a snapshot of the wording that was on
  // the screen, so the hash is taken over the wording itself: two rows with the
  // same `wordingRef` and different hashes mean the text moved underneath it.
  // The ranking rows carry the criteria docs/12 §3 requires a quote comparison
  // to declare; the rest carry none, because there is nothing to rank.
  const disclosureRows: ReadonlyArray<{
    key: string;
    locale: string;
    subjectRef: string;
    customerId: string | null;
    channel: string;
    wording: string;
    wordingRef: string;
    criteria: unknown;
    acknowledgedAt: number | null;
    ts: number;
  }> = [
    {
      key: "panel.data_sharing",
      locale: "en",
      subjectRef: `quote_request:${ctx.quoteRequestId}`,
      customerId: ctx.customerId,
      channel: "web",
      wording:
        "Your details are sent to the underwriters on the panel so that each of them can price your cover. You can withdraw this at any time and we will stop sharing.",
      wordingRef: "wording/panel-data-sharing@2026-01-02",
      criteria: null,
      // Shown and accepted before the fan-out, which is what licenses it.
      acknowledgedAt: now + 5_000,
      ts: now + 2_000
    },
    {
      key: "quote.ranking_criteria",
      locale: "en",
      subjectRef: `quote_request:${ctx.quoteRequestId}`,
      customerId: ctx.customerId,
      channel: "web",
      wording:
        "These quotes are ordered by annual price. Cover level, excess and repair type differ between them and are shown on each quote.",
      wordingRef: "wording/quote-ranking-criteria@2026-01-02",
      criteria: {
        primary: "price",
        order: "lowest annual premium first",
        shown: ["premium", "excess", "agencyRepair", "roadside", "valueScore"],
        panelSize: 4,
        ownPaperInPanel: true
      },
      // The core seed shares the ranking with the customer at now + 40s.
      acknowledgedAt: now + 45_000,
      ts: now + 40_000
    },
    {
      key: "commission.disclosure",
      locale: "en",
      subjectRef: `quote_request:${ctx.quoteRequestId}`,
      customerId: ctx.customerId,
      channel: "web",
      wording:
        "GONXT is paid a commission by the underwriter when you buy. The commission does not change the price you are quoted.",
      wordingRef: "wording/commission-disclosure@2025-11-14",
      criteria: null,
      acknowledgedAt: now + 45_000,
      ts: now + 40_000
    },
    {
      key: "quote.ranking_criteria",
      locale: "ar",
      subjectRef: `policy:${ctx.renewalPolicyId}`,
      customerId: ctx.customerId,
      channel: "app",
      wording:
        "تُرتَّب هذه العروض حسب القسط السنوي من الأقل إلى الأعلى. يختلف مستوى التغطية والتحمّل ونوع الإصلاح بين العروض، وهي موضّحة في كل عرض.",
      wordingRef: "wording/quote-ranking-criteria-ar@2026-01-02",
      criteria: {
        primary: "price",
        order: "lowest annual premium first",
        shown: ["premium", "excess", "agencyRepair"],
        panelSize: 3,
        ownPaperInPanel: true
      },
      // Renewal options opened in the app and not yet acted on: the wording was
      // presented, nobody has pressed anything. A null here is the honest state.
      acknowledgedAt: null,
      ts: now - 3 * DAY
    },
    {
      key: "ai.assistant_identity",
      locale: "en",
      subjectRef: customerRef,
      customerId: ctx.customerId,
      channel: "whatsapp",
      // docs/12 §4: an AI interlocutor identifies itself on first contact.
      wording: "You are chatting with an AI assistant. Ask for a person at any point and we will hand you over.",
      wordingRef: "wording/ai-identity@2025-10-01",
      criteria: null,
      acknowledgedAt: null,
      ts: now - 6 * DAY
    },
    {
      key: "claims.guidance_informational",
      locale: "en",
      subjectRef: `case:${ctx.caseId}`,
      customerId: ctx.customerId,
      channel: "app",
      // docs/12 §3: guidance is informational and a claims decision is out of
      // scope for this platform. The wording says exactly that and no more.
      wording:
        "This guidance is informational and helps you report what happened. It is not a decision on your claim; your insurer decides that.",
      wordingRef: "wording/claims-guidance@2025-12-08",
      criteria: null,
      acknowledgedAt: now + 3 * DAY,
      ts: now + 3 * DAY - 2 * MINUTE
    },
    {
      key: "telemarketing.optout",
      locale: "ar",
      subjectRef: customerRef,
      customerId: ctx.customerId,
      channel: "voice",
      // docs/12 §3: opt-out honouring is a guardrail, so the offer to stop has
      // to be evidenced per call, not assumed from a policy document.
      wording: "يمكنك إخبارنا في أي وقت بالتوقف عن الاتصال، وسنتوقف ولن نتصل بك مرة أخرى.",
      wordingRef: "wording/telemarketing-optout-ar@2025-09-30",
      criteria: null,
      acknowledgedAt: now - 9 * DAY + 4 * MINUTE,
      ts: now - 9 * DAY
    }
  ];
  let d = 0;
  for (const row of disclosureRows) {
    await ctx.db.insert(schema.disclosures).values({
      id: id("dsc", now + d),
      tenantId,
      key: row.key,
      locale: row.locale,
      subjectRef: row.subjectRef,
      customerId: row.customerId,
      wordingHash: await sha256Hex(row.wording),
      wordingRef: row.wordingRef,
      criteriaJson: row.criteria ? JSON.stringify(row.criteria) : null,
      channel: row.channel,
      acknowledgedAt: row.acknowledgedAt,
      ts: row.ts
    });
    d++;
  }

  /* ------------------------------------------------------ subject requests */
  // docs/12 §2 asks for rights workflows with SLA tracking, so the interesting
  // rows are the ones with the clock still running. The due dates are the
  // tenant's own 30-day service target, not a statutory period — docs/12 does
  // not state one, so this seed does not invent one either.
  const dsarIds = {
    access: id("dsr", now),
    erasureHeld: id("dsr", now + 1),
    erasureDone: id("dsr", now + 2),
    portability: id("dsr", now + 3),
    rectification: id("dsr", now + 4),
    objection: id("dsr", now + 5),
    restriction: id("dsr", now + 6),
    fresh: id("dsr", now + 7)
  };
  await ctx.db.insert(schema.dsarRequests).values([
    {
      id: dsarIds.access,
      tenantId,
      customerId: ctx.customerId,
      subjectIdentifier: "rania.haddad@example.ae",
      type: "access",
      channel: "portal",
      verificationRef: "portal_session_mfa",
      state: "fulfilled",
      dueAt: now + 6 * DAY,
      fulfilledAt: now - 17 * DAY,
      refusalReason: null,
      bundleFileId: null,
      // Completeness is proven rather than asserted (schema note on this table):
      // the answer names every table that was searched and what it returned.
      completenessProofJson: JSON.stringify({
        checkedAt: now - 17 * DAY,
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
      }),
      handledBy: compliance,
      createdAt: now - 24 * DAY,
      updatedAt: now - 17 * DAY
    },
    {
      id: dsarIds.erasureHeld,
      tenantId,
      customerId: ctx.customerId,
      subjectIdentifier: "rania.haddad@example.ae",
      type: "erasure",
      channel: "email",
      verificationRef: "id_document_matched",
      // Paused, not refused: the legal hold below freezes deletion for this
      // subject while the motor case is disputed, and the clock keeps running.
      state: "awaiting_legal",
      dueAt: now + 9 * DAY,
      fulfilledAt: null,
      refusalReason: null,
      bundleFileId: null,
      completenessProofJson: null,
      handledBy: compliance,
      createdAt: now - 21 * DAY,
      updatedAt: now - 2 * DAY
    },
    {
      id: dsarIds.erasureDone,
      tenantId,
      // A marketing contact who never became a customer, so there is no
      // customer row to point at — the identifier is all there ever was.
      customerId: null,
      subjectIdentifier: "hana.abbas@example.ae",
      type: "erasure",
      channel: "portal",
      verificationRef: "email_challenge",
      state: "fulfilled",
      dueAt: now - 4 * DAY,
      fulfilledAt: now - 11 * DAY,
      refusalReason: null,
      bundleFileId: null,
      completenessProofJson: JSON.stringify({
        checkedAt: now - 11 * DAY,
        tablesErased: 4,
        tablesRetained: 2,
        downstream: ["vector index", "audience cache", "export bucket"],
        verifiedBy: "erasure-completeness job"
      }),
      handledBy: compliance,
      createdAt: now - 34 * DAY,
      updatedAt: now - 11 * DAY
    },
    {
      id: dsarIds.portability,
      tenantId,
      customerId: ctx.customerId,
      subjectIdentifier: "rania.haddad@example.ae",
      type: "portability",
      channel: "portal",
      verificationRef: "portal_session_mfa",
      state: "in_progress",
      dueAt: now + 18 * DAY,
      fulfilledAt: null,
      refusalReason: null,
      bundleFileId: null,
      completenessProofJson: null,
      handledBy: compliance,
      createdAt: now - 12 * DAY,
      updatedAt: now - DAY
    },
    {
      id: dsarIds.rectification,
      tenantId,
      customerId: ctx.customerId,
      subjectIdentifier: "+971501234567",
      type: "rectification",
      channel: "whatsapp",
      verificationRef: "known_number_and_otp",
      state: "fulfilled",
      dueAt: now + 24 * DAY,
      // A spelling correction on the Arabic name: answered the same day, which
      // is what the tab should show is possible, not just the 30-day case.
      fulfilledAt: now - 6 * DAY + 3 * HOUR,
      refusalReason: null,
      bundleFileId: null,
      completenessProofJson: JSON.stringify({
        checkedAt: now - 6 * DAY + 3 * HOUR,
        field: "core_customers.name_json.ar",
        rowsUpdated: 1,
        downstream: ["policy documents reissued"]
      }),
      handledBy: compliance,
      createdAt: now - 6 * DAY,
      updatedAt: now - 6 * DAY + 3 * HOUR
    },
    {
      id: dsarIds.objection,
      tenantId,
      customerId: null,
      subjectIdentifier: "+971502223344",
      type: "objection",
      channel: "regulator",
      verificationRef: null,
      // Refused on evidence, not on merit: nobody could show the request came
      // from the person it names, and answering it would itself be a
      // disclosure to a stranger.
      state: "refused",
      dueAt: now - 8 * DAY,
      fulfilledAt: null,
      refusalReason:
        "The request could not be verified as coming from the data subject. No identity evidence was provided within the verification window, and the contact details on file do not match.",
      bundleFileId: null,
      completenessProofJson: null,
      handledBy: compliance,
      createdAt: now - 30 * DAY,
      updatedAt: now - 8 * DAY
    },
    {
      id: dsarIds.restriction,
      tenantId,
      customerId: null,
      subjectIdentifier: "omar.khalil@example.ae",
      type: "restriction",
      channel: "email",
      verificationRef: null,
      state: "verifying",
      dueAt: now + 27 * DAY,
      fulfilledAt: null,
      refusalReason: null,
      bundleFileId: null,
      completenessProofJson: null,
      handledBy: compliance,
      createdAt: now - 3 * DAY,
      updatedAt: now - 3 * DAY
    },
    {
      id: dsarIds.fresh,
      tenantId,
      customerId: null,
      subjectIdentifier: "lina.saeed@example.ae",
      type: "access",
      channel: "portal",
      verificationRef: null,
      // Landed this morning and nobody has touched it: `handledBy` stays null
      // until somebody picks it up, which is what makes the queue a queue.
      state: "received",
      dueAt: now + 30 * DAY,
      fulfilledAt: null,
      refusalReason: null,
      bundleFileId: null,
      completenessProofJson: null,
      handledBy: null,
      createdAt: now - 2 * HOUR,
      updatedAt: now - 2 * HOUR
    }
  ]);

  /* ----------------------------------------------------------- erasure log */
  // What the one completed erasure actually did, table by table. Two tables
  // kept their rows and say why: docs/12 §3 puts a seven-year floor under
  // financial records, and §2 makes the consent ledger the evidence that the
  // processing was permitted in the first place — deleting it would destroy
  // the proof that the erasure itself was lawful.
  const erasureAt = now - 11 * DAY;
  await ctx.db.insert(schema.erasureLog).values([
    {
      id: id("ers", now),
      tenantId,
      dsarId: dsarIds.erasureDone,
      tableName: "orbit_messages",
      rowsErased: 46,
      rowsTombstoned: 0,
      retainedReason: null,
      ts: erasureAt
    },
    {
      id: id("ers", now + 1),
      tenantId,
      dsarId: dsarIds.erasureDone,
      tableName: "orbit_conversations",
      rowsErased: 0,
      // The thread has to keep existing for the agent handover history to make
      // sense; what was in it is gone and the reference is a tombstone.
      rowsTombstoned: 3,
      retainedReason: null,
      ts: erasureAt
    },
    {
      id: id("ers", now + 2),
      tenantId,
      dsarId: dsarIds.erasureDone,
      tableName: "signal_attribution_events",
      rowsErased: 18,
      rowsTombstoned: 0,
      retainedReason: null,
      ts: erasureAt
    },
    {
      id: id("ers", now + 3),
      tenantId,
      dsarId: dsarIds.erasureDone,
      tableName: "core_customers",
      rowsErased: 1,
      rowsTombstoned: 0,
      retainedReason: null,
      ts: erasureAt
    },
    {
      id: id("ers", now + 4),
      tenantId,
      dsarId: dsarIds.erasureDone,
      tableName: "core_consents",
      rowsErased: 0,
      rowsTombstoned: 1,
      retainedReason:
        "The consent ledger is kept as the evidence of what was permitted and when it was withdrawn; the identifiers on it are tombstoned instead.",
      ts: erasureAt
    },
    {
      id: id("ers", now + 5),
      tenantId,
      dsarId: dsarIds.erasureDone,
      tableName: "ledger_journal_lines",
      rowsErased: 0,
      rowsTombstoned: 0,
      retainedReason:
        "Financial records are kept for seven years under the tenant's retention policy, which is above the floor and cannot be shortened by a request.",
      ts: erasureAt
    },
    {
      id: id("ers", now + 6),
      tenantId,
      dsarId: dsarIds.erasureDone,
      tableName: "core_files",
      rowsErased: 2,
      rowsTombstoned: 1,
      retainedReason: null,
      ts: erasureAt + 4 * MINUTE
    }
  ]);

  /* ------------------------------------------------------------ screenings */
  // Every row names `stub` as the provider because that is the only screening
  // provider this platform has (routes/compliance.ts): no watchlist is on the
  // approved-services list, so a seed that named a real one would be claiming a
  // check nobody ran. The `queryHash` is computed the way the endpoint computes
  // it, over the normalised question — so these rows verify like real ones.
  const screeningRows: ReadonlyArray<{
    subjectRef: string;
    kind: string;
    name: string;
    identifiers: Record<string, string>;
    result: string;
    hits: unknown[] | null;
    disposition: string | null;
    dispositionedBy: string | null;
    blocked: boolean;
    caseRef: string | null;
    ts: number;
  }> = [
    {
      subjectRef: customerRef,
      kind: "sanctions",
      name: "rania haddad",
      identifiers: { dob: "1992-04-11", nationality: "LB" },
      result: "clear",
      hits: null,
      disposition: null,
      dispositionedBy: null,
      blocked: false,
      caseRef: `case:${ctx.caseId}`,
      // Run at bind time: the screen is part of selling the policy, not a
      // monthly sweep that finds out afterwards.
      ts: now + 2 * DAY - 20 * MINUTE
    },
    {
      subjectRef: customerRef,
      kind: "pep",
      name: "rania haddad",
      identifiers: { dob: "1992-04-11" },
      result: "clear",
      hits: null,
      disposition: null,
      dispositionedBy: null,
      blocked: false,
      caseRef: `case:${ctx.caseId}`,
      ts: now + 2 * DAY - 19 * MINUTE
    },
    {
      subjectRef: "name:mansour auto workshop",
      kind: "sanctions",
      name: "mansour auto workshop",
      identifiers: { tradeLicence: "DXB-118442" },
      result: "hit",
      hits: [
        {
          listRef: "stub:lyra-test-hit",
          matchedName: "mansour auto workshop",
          matchPct: 78,
          note: "Produced locally by the built-in stub. No watchlist was consulted.",
          stub: true
        }
      ],
      // Cleared by a person: a partial name match on a different trade licence
      // in a different emirate. The disposition is what lifts the block.
      disposition: "false_positive",
      dispositionedBy: compliance,
      blocked: false,
      caseRef: `case:${ctx.caseId}`,
      ts: now - 5 * DAY
    },
    {
      subjectRef: "name:northline recovery services",
      kind: "sanctions",
      name: "northline recovery services",
      identifiers: { tradeLicence: "AUH-993120" },
      result: "hit",
      // Still open — nobody has dispositioned it, so the block stands. This is
      // the state the screen exists to make visible.
      hits: [
        {
          listRef: "stub:lyra-test-hit",
          matchedName: "northline recovery services",
          matchPct: 91,
          note: "Produced locally by the built-in stub. No watchlist was consulted.",
          stub: true
        }
      ],
      disposition: null,
      dispositionedBy: null,
      blocked: true,
      caseRef: null,
      ts: now - 16 * HOUR
    },
    {
      subjectRef: "name:tarek bin sulayem",
      kind: "adverse_media",
      name: "tarek bin sulayem",
      identifiers: {},
      result: "inconclusive",
      hits: [
        {
          listRef: "stub:lyra-test-inconclusive",
          matchedName: "tarek bin sulayem",
          matchPct: 55,
          note: "Produced locally by the built-in stub. No watchlist was consulted.",
          stub: true
        }
      ],
      disposition: "escalated",
      dispositionedBy: compliance,
      blocked: false,
      caseRef: null,
      ts: now - 9 * DAY
    },
    {
      subjectRef: "name:sami rahal",
      kind: "fraud",
      name: "sami rahal",
      identifiers: { claimRef: "MOT-2025-4471" },
      result: "hit",
      hits: [
        {
          listRef: "stub:lyra-test-hit",
          matchedName: "sami rahal",
          matchPct: 100,
          note: "Produced locally by the built-in stub. No watchlist was consulted.",
          stub: true
        }
      ],
      // Confirmed, so the block stays on and the case carries it forward.
      disposition: "confirmed",
      dispositionedBy: compliance,
      blocked: true,
      caseRef: `case:${ctx.caseId}`,
      ts: now - 27 * DAY
    },
    {
      subjectRef: `provider:${ctx.providers.oryx}`,
      kind: "sanctions",
      name: "oryx insurance",
      identifiers: { counterparty: "underwriter" },
      result: "clear",
      hits: null,
      disposition: null,
      dispositionedBy: null,
      blocked: false,
      caseRef: null,
      // Counterparties get screened before they join the panel, not only
      // customers — the panel is where the money goes.
      ts: now - 45 * DAY
    }
  ];
  let s = 0;
  for (const row of screeningRows) {
    await ctx.db.insert(schema.screenings).values({
      id: id("scr", now + s),
      tenantId,
      subjectRef: row.subjectRef,
      kind: row.kind,
      provider: "stub",
      queryHash: await sha256Hex(
        canonicalJson({ kind: row.kind, name: row.name, identifiers: row.identifiers })
      ),
      result: row.result,
      hitsJson: row.hits ? JSON.stringify(row.hits) : null,
      dispositionedBy: row.dispositionedBy,
      disposition: row.disposition,
      blocked: row.blocked,
      caseRef: row.caseRef,
      ts: row.ts
    });
    s++;
  }

  /* -------------------------------------------------------- retention runs */
  // One policy key, because `messages` is the only record class the purge can
  // run today (routes/compliance.ts) — a seeded `files` run would advertise a
  // capability that is not there. The cutoff is 24 months back: docs/12 §3's
  // conversation floor, which the tenant's policy may raise but never lower.
  const messagesCutoff = (startedAt: number): number => startedAt - 730 * DAY;
  await ctx.db.insert(schema.retentionRuns).values([
    {
      id: id("ret", now),
      tenantId,
      policyKey: "messages",
      tableName: "orbit_messages",
      cutoffAt: messagesCutoff(now - 62 * DAY),
      rowsAffected: 500,
      rowsHeld: 14,
      state: "done",
      error: null,
      startedAt: now - 62 * DAY,
      endedAt: now - 62 * DAY + 41_000
    },
    {
      id: id("ret", now + 1),
      tenantId,
      policyKey: "messages",
      // The purge runs in batches, so a full batch means "call again": this is
      // the call after the one above, and it is the one that finished the job.
      tableName: "orbit_messages",
      cutoffAt: messagesCutoff(now - 62 * DAY),
      rowsAffected: 137,
      rowsHeld: 14,
      state: "done",
      error: null,
      startedAt: now - 62 * DAY + 2 * MINUTE,
      endedAt: now - 62 * DAY + 2 * MINUTE + 12_000
    },
    {
      id: id("ret", now + 2),
      tenantId,
      policyKey: "messages",
      tableName: "orbit_messages",
      cutoffAt: messagesCutoff(now - 31 * DAY),
      rowsAffected: 0,
      rowsHeld: 14,
      state: "failed",
      error: "The batch exceeded the request budget before it committed. Nothing was deleted; the run was retried the next day.",
      startedAt: now - 31 * DAY,
      endedAt: now - 31 * DAY + 30_000
    },
    {
      id: id("ret", now + 3),
      tenantId,
      policyKey: "messages",
      tableName: "orbit_messages",
      cutoffAt: messagesCutoff(now - 30 * DAY),
      rowsAffected: 88,
      rowsHeld: 14,
      state: "done",
      error: null,
      startedAt: now - 30 * DAY,
      endedAt: now - 30 * DAY + 9_000
    },
    {
      id: id("ret", now + 4),
      tenantId,
      policyKey: "messages",
      tableName: "orbit_messages",
      cutoffAt: messagesCutoff(now - 20 * MINUTE),
      rowsAffected: 0,
      rowsHeld: 16,
      // In flight: `endedAt` is null until it commits, which is the only way to
      // tell a running purge from one that died without saying so.
      state: "running",
      error: null,
      startedAt: now - 20 * MINUTE,
      endedAt: null
    }
  ]);

  /* ------------------------------------------------------------ legal holds */
  // A hold freezes deletion for its subject: the retention purge skips it and
  // the erasure above sits in `awaiting_legal` until it is released. Releasing
  // one is not a delete — it goes through the compliance.legal_hold_release
  // approval (approvals.ts), which is dual-control and never auto-approved.
  // `authority` is left null where the hold is the tenant's own decision;
  // naming an outside body would be a claim this seed cannot support.
  await ctx.db.insert(schema.legalHolds).values([
    {
      id: id("lgh", now),
      tenantId,
      subjectRef: customerRef,
      reason:
        "The motor claim on this customer's policy is disputed. Nothing about her may be deleted while the dispute is open, including by an erasure request.",
      authority: "External counsel",
      placedBy: compliance,
      releasedBy: null,
      releasedAt: null,
      createdAt: now - 20 * DAY
    },
    {
      id: id("lgh", now + 1),
      tenantId,
      subjectRef: `case:${ctx.caseId}`,
      reason: "Evidence preservation for the disputed motor claim: the case, its documents and its messages.",
      authority: "External counsel",
      placedBy: compliance,
      releasedBy: null,
      releasedAt: null,
      createdAt: now - 20 * DAY
    },
    {
      id: id("lgh", now + 2),
      tenantId,
      subjectRef: `provider:${ctx.providers.oryx}`,
      reason: "Commercial dispute over unpaid commission on the Oryx panel row; correspondence is being preserved.",
      authority: null,
      placedBy: admin,
      releasedBy: null,
      releasedAt: null,
      createdAt: now - 7 * DAY
    },
    {
      id: id("lgh", now + 3),
      tenantId,
      subjectRef: `channel:${ctx.channels.brokerAlpha}`,
      reason: "Internal audit of broker-channel commission splits for the last two quarters.",
      authority: "Internal audit",
      placedBy: controller,
      // Released once the audit closed — through the approval, by somebody
      // other than the person who placed it.
      releasedBy: compliance,
      releasedAt: now - 12 * DAY,
      createdAt: now - 96 * DAY
    },
    {
      id: id("lgh", now + 4),
      tenantId,
      subjectRef: `policy:${ctx.renewalPolicyId}`,
      reason: "Complaint about last year's renewal price; the quote history was frozen while it was answered.",
      authority: null,
      placedBy: compliance,
      releasedBy: admin,
      releasedAt: now - 40 * DAY,
      createdAt: now - 110 * DAY
    }
  ]);

  /* ------------------------------------------------------ evidence bundles */
  // AUDIT-EXPORT: a manifest of what was gathered and a hash per file. The real
  // export hashes the archive it built; this seed has no archive in the object
  // store, so `fileId` is null — nothing here claims a download that does not
  // exist — and `bundleHash` is taken over the manifest so the column is a real
  // sha256 rather than decorative hex.
  const bundleRows: ReadonlyArray<{
    purpose: string;
    scope: Record<string, unknown>;
    files: ReadonlyArray<{ path: string; sizeBytes: number }>;
    requestedBy: string;
    approvedBy: string | null;
    state: string;
    deliveredTo: string | null;
    createdAt: number;
    updatedAt: number;
  }> = [
    {
      purpose: "regulator",
      scope: { subjectRef: null, from: now - 365 * DAY, to: now - 30 * DAY, purpose: "regulator" },
      files: [
        { path: "audit.jsonl", sizeBytes: 1_842_113 },
        { path: "ai-audit.jsonl", sizeBytes: 962_004 },
        { path: "summary.pdf", sizeBytes: 41_220 }
      ],
      requestedBy: compliance,
      // Handed over, so it carries a second signature: the export is the
      // evidence, and who agreed to hand it over is part of it.
      approvedBy: admin,
      state: "delivered",
      deliveredTo: "Supervisory correspondence, reference SUP-2025-1180",
      createdAt: now - 28 * DAY,
      updatedAt: now - 26 * DAY
    },
    {
      purpose: "audit",
      scope: { subjectRef: null, from: now - 92 * DAY, to: now, purpose: "audit" },
      files: [
        { path: "audit.jsonl", sizeBytes: 612_880 },
        { path: "ai-audit.jsonl", sizeBytes: 388_412 },
        { path: "summary.pdf", sizeBytes: 39_004 }
      ],
      requestedBy: compliance,
      approvedBy: null,
      state: "ready",
      deliveredTo: "External auditor, quarterly walkthrough",
      createdAt: now - 5 * DAY,
      updatedAt: now - 5 * DAY
    },
    {
      purpose: "dispute",
      scope: { subjectRef: customerRef, from: 0, to: now, purpose: "dispute" },
      files: [
        { path: "audit.jsonl", sizeBytes: 88_412 },
        { path: "ai-audit.jsonl", sizeBytes: 21_006 },
        { path: "summary.pdf", sizeBytes: 34_770 }
      ],
      requestedBy: compliance,
      approvedBy: null,
      state: "ready",
      deliveredTo: null,
      createdAt: now - 19 * DAY,
      updatedAt: now - 19 * DAY
    },
    {
      purpose: "internal",
      scope: { subjectRef: `case:${ctx.caseId}`, from: now - 60 * DAY, to: now, purpose: "internal" },
      files: [
        { path: "audit.jsonl", sizeBytes: 12_004 },
        { path: "ai-audit.jsonl", sizeBytes: 4_118 },
        { path: "summary.pdf", sizeBytes: 33_902 }
      ],
      requestedBy: opsLead,
      approvedBy: null,
      state: "building",
      deliveredTo: null,
      createdAt: now - 40 * MINUTE,
      updatedAt: now - 40 * MINUTE
    },
    {
      purpose: "regulator",
      scope: { subjectRef: null, from: 0, to: now - 120 * DAY, purpose: "regulator" },
      files: [
        { path: "audit.jsonl", sizeBytes: 0 },
        { path: "ai-audit.jsonl", sizeBytes: 0 },
        { path: "summary.pdf", sizeBytes: 0 }
      ],
      requestedBy: compliance,
      approvedBy: null,
      // Failed loudly and stayed on the list: a bundle that quietly disappears
      // is indistinguishable from one nobody asked for.
      state: "failed",
      deliveredTo: null,
      createdAt: now - 121 * DAY,
      updatedAt: now - 121 * DAY
    }
  ];
  let b = 0;
  for (const row of bundleRows) {
    const manifest = {
      version: 1,
      tenantId,
      generatedAt: row.createdAt,
      requestedBy: row.requestedBy,
      scope: row.scope,
      files: await Promise.all(
        row.files.map(async (f) => ({
          path: f.path,
          sizeBytes: f.sizeBytes,
          sha256: await sha256Hex(`${tenantId}:${row.createdAt}:${f.path}:${f.sizeBytes}`)
        }))
      ),
      truncated: false
    };
    await ctx.db.insert(schema.evidenceBundles).values({
      id: id("evb", now + b),
      tenantId,
      purpose: row.purpose,
      scopeJson: JSON.stringify(row.scope),
      manifestJson: JSON.stringify(manifest),
      bundleHash: await sha256Hex(canonicalJson(manifest)),
      fileId: null,
      requestedBy: row.requestedBy,
      approvedBy: row.approvedBy,
      state: row.state,
      deliveredTo: row.deliveredTo,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    });
    b++;
  }

  /* ------------------------------------------------------------- incidents */
  // docs/12 §2 keeps a 72-hour notification clock and §4 keeps the kill
  // switches; both show up here as columns rather than as prose in a runbook.
  // `notifiableAt` is when the clock runs out, `notifiedAt` is when somebody
  // actually wrote — the gap between them is the thing worth seeing.
  await ctx.db.insert(schema.incidents).values([
    {
      id: id("inc", now),
      tenantId,
      kind: "data",
      severity: "sev1",
      title: "Broker statement emailed to the wrong partner contact",
      summary:
        "A commission statement for Alpha Brokers was sent to a contact at a different partner. Root cause: the statement job resolved the recipient from the channel record rather than the partner contact on the settlement, so a stale address was used. The address list is now taken from the settlement, and the job refuses to send when the two disagree.",
      affectedJson: JSON.stringify({ partners: 2, statements: 1, customersNamed: 41, fieldsExposed: ["name", "policyRef", "premium"] }),
      agentsPaused: false,
      notifiableAt: now - 88 * DAY + 72 * HOUR,
      notifiedAt: now - 88 * DAY + 31 * HOUR,
      state: "postmortem",
      openedBy: compliance,
      resolvedAt: now - 86 * DAY,
      postmortemRef: "review/2025-10-statement-misdelivery",
      createdAt: now - 88 * DAY,
      updatedAt: now - 80 * DAY
    },
    {
      id: id("inc", now + 1),
      tenantId,
      kind: "model",
      severity: "sev2",
      title: "Arabic renewal drafts quoted a premium the ledger did not have",
      summary:
        "Two renewal drafts in Arabic carried a premium that did not match the quote they were drafted from. The number-verification gate passed them because the digits were Arabic-Indic and the comparison ran on the raw string. The renewal agent is paused while the gate is fixed; no draft was sent.",
      affectedJson: JSON.stringify({ drafts: 2, sent: 0, locale: "ar", agent: "renewal-drafter" }),
      // The per-agent kill switch, pulled and recorded rather than described.
      agentsPaused: true,
      notifiableAt: null,
      notifiedAt: null,
      state: "mitigated",
      openedBy: devAdmin,
      resolvedAt: null,
      postmortemRef: null,
      createdAt: now - 2 * DAY,
      updatedAt: now - 20 * HOUR
    },
    {
      id: id("inc", now + 2),
      tenantId,
      kind: "regulatory",
      severity: "sev3",
      title: "Outbound calls attempted inside quiet hours",
      summary:
        "The call-centre dialler queued 12 calls after the quiet-hours boundary because the queue used the server's clock instead of the customer's local time. Nine were blocked by the guardrail and three connected. The guardrail floor cannot be configured away, so the fix is in the queue, not the policy.",
      affectedJson: JSON.stringify({ queued: 12, blocked: 9, connected: 3, channel: "call_centre" }),
      agentsPaused: false,
      notifiableAt: null,
      notifiedAt: null,
      state: "mitigated",
      openedBy: compliance,
      resolvedAt: null,
      postmortemRef: null,
      createdAt: now - 9 * DAY,
      updatedAt: now - 8 * DAY
    },
    {
      id: id("inc", now + 3),
      tenantId,
      kind: "outage",
      severity: "sev3",
      title: "Oryx quote responses timed out for 40 minutes",
      summary:
        "One underwriter's endpoint stopped answering and the fan-out waited the full timeout on every request. Comparisons still returned with three rows instead of four. Root cause: no per-provider circuit breaker; one was added with a 30-second half-open probe.",
      affectedJson: JSON.stringify({ provider: "oryx", quoteRequests: 63, degradedComparisons: 63, lostSales: 0 }),
      agentsPaused: false,
      notifiableAt: null,
      notifiedAt: null,
      state: "resolved",
      openedBy: opsLead,
      resolvedAt: now - 34 * DAY,
      postmortemRef: "review/2025-12-oryx-timeouts",
      createdAt: now - 34 * DAY - 40 * MINUTE,
      updatedAt: now - 34 * DAY,
    },
    {
      id: id("inc", now + 4),
      tenantId,
      kind: "security",
      severity: "sev2",
      title: "Credential stuffing against the customer portal",
      summary:
        "Roughly 4,000 sign-in attempts from one address range over an hour, against email addresses that were not ours. No session was created. Rate limiting per address range and a longer lockout were added, and the affected accounts were unaffected because none existed.",
      affectedJson: JSON.stringify({ attempts: 4_012, accountsMatched: 0, sessionsCreated: 0 }),
      agentsPaused: false,
      notifiableAt: null,
      notifiedAt: null,
      state: "resolved",
      openedBy: devAdmin,
      resolvedAt: now - 47 * DAY,
      postmortemRef: "review/2025-11-portal-stuffing",
      createdAt: now - 48 * DAY,
      updatedAt: now - 47 * DAY
    },
    {
      id: id("inc", now + 5),
      tenantId,
      kind: "security",
      severity: "sev4",
      title: "Unrecognised device on a compliance session",
      summary:
        "A session for the compliance officer appeared from a device that had not been seen before. Being triaged: the officer is travelling and the second factor was satisfied, so this is probably nothing, and 'probably nothing' is still filed.",
      affectedJson: JSON.stringify({ users: 1, sessions: 1, mfaSatisfied: true }),
      agentsPaused: false,
      notifiableAt: null,
      notifiedAt: null,
      state: "open",
      openedBy: admin,
      resolvedAt: null,
      postmortemRef: null,
      createdAt: now - 5 * HOUR,
      updatedAt: now - 5 * HOUR
    }
  ]);

  /* -------------------------------------------------- rulepack applications */
  // Written by the engine as it applies a rule, which is why this tab is
  // read-only: it records which version of the market rules was in force when a
  // decision was made. The `fail` row is the one that matters — it is the same
  // quiet-hours breach the regulatory incident above was opened for, seen from
  // the rule's side.
  const rulepackId = await activeRulepackId(ctx);
  await ctx.db.insert(schema.rulepackApplications).values([
    {
      id: id("rpa", now),
      tenantId,
      rulepackId,
      subjectRef: `quote_request:${ctx.quoteRequestId}`,
      ruleKey: "disclosure.ranking_criteria_shown",
      outcome: "pass",
      detailJson: JSON.stringify({ disclosureKey: "quote.ranking_criteria", acknowledged: true }),
      ts: now + 40_000
    },
    {
      id: id("rpa", now + 1),
      tenantId,
      rulepackId,
      subjectRef: `quote_request:${ctx.quoteRequestId}`,
      ruleKey: "consent.data_sharing_before_fanout",
      outcome: "pass",
      detailJson: JSON.stringify({ consentId: ctx.consentId, purpose: "dataSharing", checkedAt: now + 2_000 }),
      ts: now + 3_000
    },
    {
      id: id("rpa", now + 2),
      tenantId,
      rulepackId,
      subjectRef: `case:${ctx.caseId}`,
      ruleKey: "screening.sanctions_before_bind",
      outcome: "pass",
      detailJson: JSON.stringify({ kind: "sanctions", result: "clear", provider: "stub" }),
      ts: now + 2 * DAY - 18 * MINUTE
    },
    {
      id: id("rpa", now + 3),
      tenantId,
      rulepackId,
      subjectRef: `case:${ctx.caseId}`,
      ruleKey: "claims.decision_out_of_scope",
      outcome: "not_applicable",
      // Nothing in this case asked the platform to decide a claim, so the rule
      // had nothing to judge — which is a result, not a silence.
      detailJson: JSON.stringify({ reason: "No claim decision was requested on this case." }),
      ts: now + 3 * DAY
    },
    {
      id: id("rpa", now + 4),
      tenantId,
      rulepackId,
      subjectRef: customerRef,
      ruleKey: "telemarketing.quiet_hours",
      outcome: "fail",
      detailJson: JSON.stringify({
        attemptedAtLocal: "22:41",
        window: "09:00-21:00",
        outcome: "call connected",
        incident: "Outbound calls attempted inside quiet hours"
      }),
      ts: now - 9 * DAY
    },
    {
      id: id("rpa", now + 5),
      tenantId,
      rulepackId,
      subjectRef: customerRef,
      ruleKey: "telemarketing.contact_frequency",
      outcome: "pass",
      detailJson: JSON.stringify({ contactsIn30Days: 2, ceiling: 4 }),
      ts: now - 9 * DAY + MINUTE
    },
    {
      id: id("rpa", now + 6),
      tenantId,
      rulepackId,
      subjectRef: `policy:${ctx.policyId}`,
      ruleKey: "record_keeping.policy_documents_seven_years",
      outcome: "pass",
      detailJson: JSON.stringify({ retainUntil: ctx.issuedAt + 7 * 365 * DAY, documents: 3 }),
      ts: ctx.issuedAt
    }
  ]);

  /* ------------------------------------------------------ policy thresholds */
  // "What was the limit in March" is an audit question, so a change is a new
  // version with the old one closed off, never an edit in place. The keys are
  // the approval policy keys from approvals.ts — a threshold that names nothing
  // enforceable is a number in a spreadsheet.
  await ctx.db.insert(schema.policyThresholds).values([
    {
      id: id("pth", now),
      tenantId,
      key: "ledger.refund",
      version: 1,
      valueJson: JSON.stringify({ amountMinor: 50_000, currency: "AED" }),
      dualControl: false,
      effectiveFrom: now - 210 * DAY,
      // Closed off by version 2 rather than overwritten: the refunds approved
      // under it were approved against this number.
      effectiveTo: now - 30 * DAY,
      setBy: controller
    },
    {
      id: id("pth", now + 1),
      tenantId,
      key: "ledger.refund",
      version: 2,
      valueJson: JSON.stringify({ amountMinor: 100_000, currency: "AED" }),
      // Raised, and dual control raised with it: a bigger ceiling that one
      // person can clear alone is not a control.
      dualControl: true,
      effectiveFrom: now - 30 * DAY,
      effectiveTo: null,
      setBy: controller
    },
    {
      id: id("pth", now + 2),
      tenantId,
      key: "ledger.credit_note",
      version: 1,
      valueJson: JSON.stringify({ amountMinor: 100_000, currency: "AED" }),
      dualControl: true,
      effectiveFrom: now - 210 * DAY,
      effectiveTo: null,
      setBy: controller
    },
    {
      id: id("pth", now + 3),
      tenantId,
      key: "axis.price_match",
      version: 1,
      valueJson: JSON.stringify({ amountMinor: 100_000, currency: "AED" }),
      dualControl: true,
      effectiveFrom: now - 180 * DAY,
      effectiveTo: null,
      setBy: admin
    },
    {
      id: id("pth", now + 4),
      tenantId,
      key: "axis.bind",
      version: 1,
      valueJson: JSON.stringify({ amountMinor: 25_000_000, currency: "AED" }),
      dualControl: true,
      effectiveFrom: now - 180 * DAY,
      effectiveTo: null,
      setBy: admin
    },
    {
      id: id("pth", now + 5),
      tenantId,
      key: "signal.budget_commit",
      version: 1,
      valueJson: JSON.stringify({ amountMinor: 5_000_000, currency: "AED" }),
      dualControl: false,
      effectiveFrom: now - 120 * DAY,
      effectiveTo: null,
      setBy: admin
    },
    {
      id: id("pth", now + 6),
      tenantId,
      key: "compliance.dsar_service_target",
      version: 1,
      // Not a money limit: the service target the subject-request queue is
      // tracked against, and the point at which an unanswered request starts
      // shouting. The tenant chose these days; docs/12 states no period.
      valueJson: JSON.stringify({ days: 30, warnAtDays: 25, escalateTo: "tenant.compliance" }),
      dualControl: false,
      effectiveFrom: now - 300 * DAY,
      effectiveTo: null,
      setBy: compliance
    }
  ]);
}
