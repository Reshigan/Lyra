import { asc, desc, eq } from "drizzle-orm";
import { id, schema } from "@lyra/db";
import { computeChainHash, type AuditRow } from "../audit.js";
import { canonicalJson, sha256Hex } from "../crypto.js";
import { DAY, HOUR, MINUTE, type SeedContext } from "./context.js";

// The platform's own record of itself: who did what (core_audit_log), what the
// model spend looked like while they did it (ai_budgets) and which events the
// bus could not deliver (core_event_dlq).
//
// This seeder runs last, after every module seeder, and that ordering is the
// whole design: an audit row is a *statement about a row that exists*, so the
// approvals, postings, subject requests and API keys below are read back out of
// the database rather than invented here. A seeded audit log full of actions on
// ids nothing else knows about would teach an operator to distrust the screen,
// which is the opposite of what an audit log is for.
//
// docs/12 §1: the log is append-only and hash-chained per tenant. Every row
// below is chained with the same helper the API writes with
// (`computeChainHash`), from the tenant's current tip, in `ts` order — so
// `verifyChain` reports an intact chain over the seed exactly as it does over
// production traffic. Nothing here is allowed to weaken that.

/** An audit row before it is chained: the parts a caller of `audit()` supplies. */
interface Entry {
  ts: number;
  /** `user:<id>`, `system:<worker>`, `api:<key prefix>` — the shape `actorRef` writes. */
  actor: string;
  action: string;
  subject?: string | null;
  before?: unknown;
  after?: unknown;
}

/** UTC day, matching `dayKey` in the model gateway — the budget window never
 *  shifts with a timezone. Duplicated rather than imported because core cannot
 *  depend on model-gateway (model-gateway depends on core). */
const dayKeyOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

export async function seedPlatform(ctx: SeedContext): Promise<void> {
  await seedAuditLog(ctx);
  await seedBudgets(ctx);
  await seedDlq(ctx);
}

/* ------------------------------------------------------------- audit log */

async function seedAuditLog(ctx: SeedContext): Promise<void> {
  const { db, tenantId, now } = ctx;
  const user = (role: string): string => `user:${ctx.users[role] ?? "seed"}`;
  // Module seeders store a bare user id in columns like `requested_by`, but at
  // runtime `actorRef` writes `<kind>:<id>` into the audit log. Normalise on the
  // way in so an actor filter matches one spelling, not two.
  const actorOf = (value: string | null | undefined, fallback: string): string =>
    value == null || value === "" ? fallback : value.includes(":") ? value : `user:${value}`;
  const admin = user("tenant.admin");
  const compliance = user("tenant.compliance");
  const controller = user("finance.controller");
  const analyst = user("finance.analyst");
  const developer = user("dev.admin");

  // Where these people work from. An `ip` filter over a log in which every row
  // carries the same address selects everything, which is the same as selecting
  // nothing; the office range, one home line and one phone is enough to tell a
  // "signed in from somewhere new" story.
  const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
  const EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0";
  const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1";
  const seats = new Map<string, { ip: string; ua: string }>([
    [admin, { ip: "94.200.14.87", ua: CHROME }],
    [compliance, { ip: "94.200.14.91", ua: EDGE }],
    [controller, { ip: "94.200.14.88", ua: CHROME }],
    [analyst, { ip: "94.200.14.94", ua: EDGE }],
    [developer, { ip: "5.32.180.212", ua: CHROME }],
    [user("axis.agent"), { ip: "94.200.14.102", ua: CHROME }],
    [user("axis.lead"), { ip: "2.51.44.19", ua: IOS }],
    [user("orbit.retention"), { ip: "94.200.14.107", ua: CHROME }],
    [user("north.exec"), { ip: "2.51.9.140", ua: IOS }]
  ]);

  const entries: Entry[] = [];

  /* --------------------------------------------------------- approvals */
  // Every gate the demo passed through, in the shape `packages/core/approvals`
  // writes: the request carries the pending image, the decision carries pending
  // before and decided after. Both rows point at the approval's *subject* — the
  // transaction or case being gated — not at the approval id, because that is
  // what an investigator searches for.
  const approvals = await db
    .select()
    .from(schema.approvals)
    .where(eq(schema.approvals.tenantId, tenantId))
    .orderBy(asc(schema.approvals.requestedAt));
  for (const a of approvals) {
    const pending = { ...a, decidedBy: null, decision: "pending", reason: null, decidedAt: null };
    entries.push({
      ts: a.requestedAt,
      actor: actorOf(a.requestedBy, admin),
      action: "core.approval.requested",
      subject: a.subjectRef,
      after: pending
    });
    if (a.decision !== "pending" && a.decidedAt != null) {
      entries.push({
        ts: a.decidedAt,
        // Dual control means the decider is never the requester; the seeded
        // rows already respect that, so the actor is taken from the row.
        actor: actorOf(a.decidedBy ?? a.requestedBy, admin),
        action: `core.approval.${a.decision}`,
        subject: a.subjectRef,
        before: pending,
        after: a
      });
    }
  }

  /* ------------------------------------------------------------ ledger */
  // Money moves are the rows an auditor opens this screen for. `postTxn` writes
  // one audit row per settled transaction named after the catalogue code, so a
  // BIND settles as `ledger.txn.bind`; the reversal writes a second row against
  // the *original* transaction, which is why the loop looks at `reversalOf`.
  const txns = await db
    .select()
    .from(schema.ledgerTxns)
    .where(eq(schema.ledgerTxns.tenantId, tenantId))
    .orderBy(asc(schema.ledgerTxns.createdAt));
  for (const t of txns) {
    const settledLike = t.state === "settled" || t.state === "reversed" || t.state === "adjusted";
    if (!settledLike) continue; // A transaction that never settled never posted.
    const at = t.settledAt ?? t.updatedAt;
    entries.push({
      ts: at,
      actor: `${t.actorKind}:${t.actorId}`,
      action: `ledger.txn.${t.type.toLowerCase()}`,
      subject: `txn:${t.id}`,
      after: { type: t.type, state: "settled", grossMinor: t.grossMinor, batch: t.ledgerBatchId }
    });
    if (t.reversalOf) {
      entries.push({
        ts: at + MINUTE,
        actor: `${t.actorKind}:${t.actorId}`,
        action: "ledger.txn.reverse",
        subject: `txn:${t.reversalOf}`,
        before: { state: "settled" },
        after: {
          state: "reversed",
          reversalTxnId: t.id,
          reason: t.failureDetail ?? "posted against the wrong offering; corrected by reversal"
        }
      });
    }
  }

  // A closed period is the finance month locked; the checklist that justified
  // the close is on the period row, so the after-image quotes it rather than
  // asserting a fresh one.
  const periods = await db
    .select()
    .from(schema.ledgerPeriods)
    .where(eq(schema.ledgerPeriods.tenantId, tenantId))
    .orderBy(asc(schema.ledgerPeriods.startAt));
  for (const p of periods) {
    if (p.state === "open" || p.closedAt == null) continue;
    entries.push({
      ts: p.closedAt,
      actor: actorOf(p.closedBy, controller),
      action: "ledger.period.close",
      subject: `period:${p.code}`,
      before: { state: "open" },
      after: {
        state: p.state,
        checks: p.checklistJson ? (JSON.parse(p.checklistJson) as unknown) : [],
        forced: false
      }
    });
  }

  // A finance export leaving the building is a read worth a record (docs/12).
  entries.push({
    ts: now - 2 * DAY + 9 * HOUR,
    actor: analyst,
    action: "ledger.report.export",
    subject: "report:trial-balance",
    after: { report: "trial-balance", format: "xlsx", periodCode: dayKeyOf(now).slice(0, 7) }
  });

  /* -------------------------------------------------------- compliance */
  // Subject requests: raised through the privacy portal, answered by the
  // compliance officer. The CRUD writer names the action after the resource
  // path (`compliance.dsar-requests.*`) and uses the bare row id as the
  // subject, so these match what the API would have written.
  const dsars = await db
    .select()
    .from(schema.dsarRequests)
    .where(eq(schema.dsarRequests.tenantId, tenantId))
    .orderBy(desc(schema.dsarRequests.createdAt))
    .limit(5);
  for (const d of dsars) {
    entries.push({
      ts: d.createdAt,
      // Nobody has picked up a request that just landed, so the portal is the
      // actor until a person takes it.
      actor: actorOf(d.handledBy, "system:privacy-portal"),
      action: "compliance.dsar-requests.create",
      subject: d.id,
      after: { type: d.type, channel: d.channel, state: "received", dueAt: d.dueAt }
    });
    if (d.fulfilledAt != null) {
      entries.push({
        ts: d.fulfilledAt,
        actor: actorOf(d.handledBy, compliance),
        action: "compliance.dsar-requests.update",
        subject: d.id,
        before: { state: "in_progress", fulfilledAt: null },
        after: { state: d.state, fulfilledAt: d.fulfilledAt, bundleFileId: d.bundleFileId }
      });
    }
  }

  // Screenings: the audit row carries the whole screening, hit or clear, so the
  // block that stopped a bind can be reconstructed from the log alone.
  const screenings = await db
    .select()
    .from(schema.screenings)
    .where(eq(schema.screenings.tenantId, tenantId))
    .orderBy(desc(schema.screenings.ts))
    .limit(3);
  for (const s of screenings) {
    entries.push({
      ts: s.ts,
      actor: actorOf(s.dispositionedBy, compliance),
      action: "compliance.screening.run",
      subject: s.subjectRef,
      after: s
    });
  }

  const holds = await db
    .select()
    .from(schema.legalHolds)
    .where(eq(schema.legalHolds.tenantId, tenantId))
    .orderBy(desc(schema.legalHolds.createdAt))
    .limit(2);
  for (const h of holds) {
    entries.push({
      ts: h.createdAt,
      actor: actorOf(h.placedBy, compliance),
      action: "compliance.legal-holds.create",
      subject: h.id,
      after: { subjectRef: h.subjectRef, reason: h.reason, authority: h.authority }
    });
  }

  const retention = await db
    .select()
    .from(schema.retentionRuns)
    .where(eq(schema.retentionRuns.tenantId, tenantId))
    .orderBy(desc(schema.retentionRuns.startedAt))
    .limit(2);
  for (const r of retention) {
    entries.push({
      ts: r.startedAt,
      actor: compliance,
      action: "compliance.retention.run",
      subject: `retention:${r.policyKey}`,
      after: r
    });
  }

  const bundles = await db
    .select()
    .from(schema.evidenceBundles)
    .where(eq(schema.evidenceBundles.tenantId, tenantId))
    .orderBy(desc(schema.evidenceBundles.createdAt))
    .limit(1);
  for (const b of bundles) {
    entries.push({
      ts: b.createdAt,
      actor: actorOf(b.requestedBy, compliance),
      action: "compliance.evidence.export",
      subject: `evidence_bundle:${b.id}`,
      after: { purpose: b.purpose, bundleHash: b.bundleHash, state: b.state }
    });
    // Exporting the bundle and handing it over are two separate acts, and the
    // second is the one a regulator asks about.
    if (b.state === "delivered") {
      entries.push({
        ts: b.updatedAt,
        actor: actorOf(b.approvedBy ?? b.requestedBy, compliance),
        action: "compliance.evidence.download",
        subject: `evidence_bundle:${b.id}`,
        after: { bundleHash: b.bundleHash }
      });
    }
  }

  /* -------------------------------------------------- keys and endpoints */
  // The leaked key is the story: issued months ago, revoked half an hour after
  // it turned up in a public repository. Both halves have to be in the log or
  // the revocation has no beginning.
  const keys = await db
    .select()
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.tenantId, tenantId))
    .orderBy(asc(schema.apiKeys.createdAt));
  for (const k of keys) {
    if (k.revokedAt == null && k.mode !== "live") continue; // Test keys are noise here.
    entries.push({
      ts: k.createdAt,
      actor: actorOf(k.createdBy, developer),
      action: "core.api-keys.create",
      subject: `api-keys:${k.id}`,
      after: { name: k.name, prefix: k.prefix, mode: k.mode, scopesJson: k.scopesJson }
    });
    if (k.revokedAt != null) {
      entries.push({
        ts: k.revokedAt,
        actor: admin,
        action: "core.api-keys.update",
        subject: k.id,
        before: { revokedAt: null },
        after: { revokedAt: k.revokedAt, reason: "exposed_in_public_repo" }
      });
    }
  }

  // Enterprise sign-in routes. Adding one changes who can get in, so it is
  // consequential even though it writes no money.
  const idps = await db
    .select()
    .from(schema.identityProviders)
    .where(eq(schema.identityProviders.tenantId, tenantId))
    .orderBy(desc(schema.identityProviders.createdAt))
    .limit(2);
  for (const p of idps) {
    entries.push({
      ts: p.createdAt,
      actor: developer,
      action: "core.identity-providers.create",
      subject: p.id,
      after: {
        kind: p.kind,
        name: p.name,
        emailDomain: p.emailDomain,
        enabled: p.enabled,
        mfaAsserted: p.mfaAsserted
      }
    });
  }

  const paused = await db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.tenantId, tenantId))
    .orderBy(asc(schema.webhooks.createdAt));
  for (const w of paused) {
    if (w.status !== "paused") continue;
    entries.push({
      ts: w.createdAt,
      actor: developer,
      action: "core.webhooks.create",
      subject: `webhooks:${w.id}`,
      after: { url: w.url, eventTypesJson: w.eventTypesJson, status: "active" }
    });
    entries.push({
      // Paused this morning, after the endpoint had been answering 410 for a
      // fortnight — the delivery rows the admin seeder wrote are the evidence.
      ts: now - 3 * HOUR,
      actor: developer,
      action: "core.webhooks.update",
      subject: w.id,
      before: { status: "active" },
      after: { status: "paused" }
    });
  }

  /* ------------------------------------------------------------------ ai */
  // A guardrail block is a refusal to act, and a refusal is exactly the kind of
  // thing that must be provable after the fact. `ai_guardrail_events` holds the
  // detail; this is its entry in the tenant-wide chain.
  //
  // ponytail: `ai.guardrail.block` has no call site yet — today the gateway
  // records a block in `ai_guardrail_events` and `ai_audit_log` only. The name
  // follows the module.resource.verb grammar the rest of the log uses, so the
  // writer, when it lands, adopts it rather than inventing a second name.
  const blocks = await db
    .select()
    .from(schema.aiGuardrailEvents)
    .where(eq(schema.aiGuardrailEvents.tenantId, tenantId))
    .orderBy(desc(schema.aiGuardrailEvents.ts))
    .limit(6);
  for (const g of blocks.filter((row) => row.severity === "block").slice(0, 2)) {
    entries.push({
      ts: g.ts,
      actor: "system:model-gateway",
      action: "ai.guardrail.block",
      subject: g.subjectRef ?? `ai_runs:${g.runId ?? "unknown"}`,
      after: { rule: g.rule, severity: g.severity, detail: g.detail, runId: g.runId }
    });
  }

  // What a person did about it: the agent that produced the blocked draft was
  // paused by hand, which is the kill switch docs/12 §4 asks for.
  const pausedAgents = await db
    .select()
    .from(schema.aiAgents)
    .where(eq(schema.aiAgents.tenantId, tenantId))
    .orderBy(desc(schema.aiAgents.updatedAt))
    .limit(8);
  for (const a of pausedAgents.filter((row) => row.status === "paused").slice(0, 1)) {
    entries.push({
      ts: a.updatedAt,
      actor: actorOf(a.pausedBy, admin),
      action: "ai.agent.pause",
      subject: a.id,
      before: { key: a.key, status: "active", pausedBy: null, pausedReason: null },
      after: { reason: a.pausedReason }
    });
  }

  // Moving a spend ceiling is consequential (CLAUDE.md rule 4), so `setLimits`
  // audits it. This is the raise the SIGNAL marketer asked for six hours ago.
  entries.push({
    ts: now - 3 * HOUR - 20 * MINUTE,
    actor: admin,
    action: "ai.budget.set_limits",
    subject: "ai_budget:signal",
    before: { module: "signal", tokensLimit: 250_000, costMicroLimit: 8_000_000 },
    after: { module: "signal", tokensLimit: 250_000, costMicroLimit: 12_000_000 }
  });

  /* ----------------------------------------------------------- sign-ins */
  // Sessions expire and are pruned; the audit row outlives them, which is the
  // point of writing it. The subject is therefore a session id that no longer
  // resolves — exactly what a login from three days ago looks like in
  // production.
  const signIns: ReadonlyArray<readonly [string, number]> = [
    [admin, now - 3 * DAY - 2 * HOUR],
    [controller, now - 2 * DAY - 30 * MINUTE],
    [user("axis.agent"), now - DAY - 3 * HOUR],
    [compliance, now - 26 * HOUR],
    [user("north.exec"), now - 5 * HOUR],
    [user("axis.lead"), now - 90 * MINUTE]
  ];
  let session = 0;
  for (const [actor, at] of signIns) {
    const sessionId = id("ses", at + session++);
    entries.push({ ts: at, actor, action: "core.session.login", subject: sessionId });
    // Privileged roles must clear a second factor before the session is usable.
    if (actor === admin || actor === compliance) {
      entries.push({ ts: at + 40_000, actor, action: "core.mfa.verified", subject: sessionId });
    }
    // The exec signs in from a phone on a mobile network and the platform
    // admin cut that session short when it looked wrong.
    if (actor === user("north.exec")) {
      entries.push({
        ts: at + 12 * MINUTE,
        actor: admin,
        action: "core.session.revoke",
        subject: sessionId,
        after: { reason: "sign-in from an unrecognised network" }
      });
    }
  }

  await writeChained(ctx, entries, seats);
}

/**
 * Chain and insert. `verifyChain` walks a tenant's rows in (`ts`, `id`) order
 * and expects each `prev_hash` to be the previous row's `chain_hash`, so the
 * entries are sorted first and their ids minted in that same order — an id
 * minted out of order would fork the chain even though every hash was correct.
 */
async function writeChained(
  ctx: SeedContext,
  entries: Entry[],
  seats: Map<string, { ip: string; ua: string }>
): Promise<void> {
  const { db, tenantId, now } = ctx;

  const tip = await db
    .select({ chainHash: schema.auditLog.chainHash })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.tenantId, tenantId))
    .orderBy(desc(schema.auditLog.ts), desc(schema.auditLog.id))
    .limit(1);

  entries.sort((a, b) => a.ts - b.ts);

  const hashOrNull = async (value: unknown): Promise<string | null> =>
    value === undefined ? null : sha256Hex(canonicalJson(value));

  let prevHash = tip[0]?.chainHash ?? null;
  const rows: AuditRow[] = [];
  for (const [index, entry] of entries.entries()) {
    const base: Omit<AuditRow, "chainHash"> = {
      id: id("aud", now + index),
      tenantId,
      actorRef: entry.actor,
      action: entry.action,
      subjectRef: entry.subject ?? null,
      beforeHash: await hashOrNull(entry.before),
      afterHash: await hashOrNull(entry.after),
      prevHash,
      ip: null,
      ua: null,
      ts: entry.ts
    };
    const seat = seats.get(entry.actor);
    if (seat) {
      base.ip = seat.ip;
      base.ua = seat.ua;
    }
    const chainHash = await computeChainHash(base);
    rows.push({ ...base, chainHash });
    prevHash = chainHash;
  }

  // ponytail: 25 at a time keeps the statement inside D1's bound-parameter
  // limit without anybody having to count columns when one is added.
  for (let i = 0; i < rows.length; i += 25) {
    await db.insert(schema.auditLog).values(rows.slice(i, i + 25));
  }
}

/* --------------------------------------------------------------- budgets */

async function seedBudgets(ctx: SeedContext): Promise<void> {
  const { db, tenantId, now } = ctx;

  // The tenant-wide ceiling is the policy default (packages/db json.ts); the
  // per-module rows are same-day throttles, which is what `module` on this
  // table is for — a standing per-module cap has nowhere to live in policy yet.
  const CEILINGS: Record<string, { tokens: number; cost: number }> = {
    "*": { tokens: 2_000_000, cost: 50_000_000 },
    axis: { tokens: 400_000, cost: 10_000_000 },
    dist: { tokens: 500_000, cost: 12_000_000 },
    orbit: { tokens: 300_000, cost: 8_000_000 },
    signal: { tokens: 250_000, cost: 8_000_000 },
    core: { tokens: 200_000, cost: 4_000_000 }
  };

  interface Window {
    /** Any instant inside the day; the UTC day it falls in is the window. */
    at: number;
    module: string;
    tokens: number;
    cost: number;
    stoppedAt?: number;
    thresholdNotifiedAt?: number;
  }

  // Today first, because `/admin/ai/budget` shows one window — the day of the
  // live `*` row — and renders nothing at all if today has no rows.
  const windows: Window[] = [
    { at: now, module: "*", tokens: 486_200, cost: 21_480_000 },
    { at: now, module: "axis", tokens: 128_400, cost: 3_120_000 },
    { at: now, module: "dist", tokens: 210_600, cost: 6_840_000 },
    { at: now, module: "orbit", tokens: 96_200, cost: 2_410_000 },
    {
      at: now,
      module: "signal",
      // 99% of the cost cap with the day still running: this is the row behind
      // the "budget raise requested" notification the admin seeder wrote, and
      // the reason the admin console should be showing a warning, not a stop.
      tokens: 194_000,
      cost: 7_960_000,
      thresholdNotifiedAt: now - 6 * HOUR
    },
    // Embedding dominates tokens without dominating cost — the shape an
    // operator has to learn to read.
    { at: now, module: "core", tokens: 178_400, cost: 1_640_000 },

    // Yesterday, in the window the bulk quote import ran in. The gateway wrote
    // `state: "budget_stopped"` on that run and `outcome: "budget_exceeded"` in
    // ai_audit_log; this is the row that stopped it, and the timestamps line up
    // to the millisecond so the two screens agree.
    {
      at: now - 26 * HOUR,
      module: "dist",
      tokens: 512_400,
      cost: 12_180_000,
      stoppedAt: now - 26 * HOUR + 640,
      thresholdNotifiedAt: now - 30 * HOUR
    },
    { at: now - DAY, module: "*", tokens: 1_284_000, cost: 42_600_000, thresholdNotifiedAt: now - 27 * HOUR },
    { at: now - DAY, module: "axis", tokens: 214_800, cost: 5_940_000 },
    { at: now - DAY, module: "signal", tokens: 88_400, cost: 2_180_000 },

    { at: now - 2 * DAY, module: "*", tokens: 742_600, cost: 24_180_000 },
    { at: now - 2 * DAY, module: "axis", tokens: 162_400, cost: 4_120_000 },
    { at: now - 2 * DAY, module: "dist", tokens: 208_200, cost: 6_040_000 },
    { at: now - 2 * DAY, module: "core", tokens: 141_800, cost: 1_120_000 },

    { at: now - 3 * DAY, module: "*", tokens: 918_400, cost: 31_240_000 },
    { at: now - 3 * DAY, module: "north", tokens: 121_600, cost: 8_400_000 },
    { at: now - 3 * DAY, module: "orbit", tokens: 142_200, cost: 3_260_000 },

    // The weekend: the schedulers still tick, nobody else is working.
    { at: now - 4 * DAY, module: "*", tokens: 214_800, cost: 6_420_000 },
    { at: now - 4 * DAY, module: "orbit", tokens: 84_600, cost: 1_940_000 },
    { at: now - 5 * DAY, module: "*", tokens: 186_200, cost: 5_180_000 },
    { at: now - 5 * DAY, module: "ledger", tokens: 42_800, cost: 940_000 },
    { at: now - 6 * DAY, module: "*", tokens: 864_200, cost: 28_940_000 },
    { at: now - 6 * DAY, module: "dist", tokens: 246_400, cost: 7_120_000 }
  ];

  // `ai_budgets` is unique on (tenant, day, module) and the stopped window is
  // pinned to an hour rather than a day offset, so two entries can land on one
  // day if the seed clock sits near midnight. Last one wins, as an upsert would.
  const byKey = new Map<string, Window>();
  for (const w of windows) byKey.set(`${dayKeyOf(w.at)}|${w.module}`, w);

  const rows = [...byKey.values()].map((w, index) => {
    const ceiling = CEILINGS[w.module] ?? CEILINGS["*"]!;
    return {
      id: id("bdg", now + index),
      tenantId,
      day: dayKeyOf(w.at),
      module: w.module,
      tokensUsed: w.tokens,
      costMicroUsed: w.cost,
      tokensLimit: ceiling.tokens,
      costMicroLimit: ceiling.cost,
      thresholdNotifiedAt: w.thresholdNotifiedAt ?? null,
      stoppedAt: w.stoppedAt ?? null,
      // The last charge of that window, not the day's end: a budget row is
      // touched by traffic, and the column is what the console sorts on.
      updatedAt: w.at
    };
  });

  await db.insert(schema.aiBudgets).values(rows);
}

/* ------------------------------------------------------------------- dlq */

async function seedDlq(ctx: SeedContext): Promise<void> {
  const { db, tenantId, now } = ctx;

  // The dead-letter queue is the honest half of an event bus. Each row is a real
  // envelope (docs/04 §7) that a named consumer failed on five times — five
  // because `consume` only writes here once `attempts` reaches MAX_ATTEMPTS, so
  // a DLQ row can never carry any other count. The replay screen re-parses
  // `envelope_json` with the Zod schema, so these are valid envelopes, not
  // JSON-shaped prose.
  const envelope = (
    at: number,
    module: string,
    type: string,
    actor: string,
    subject: string,
    data: Record<string, unknown>
  ): string => JSON.stringify({ id: id("ev", at), ts: at, tenant_id: tenantId, module, type, actor, subject, data, v: 1 });

  const rows = [
    {
      id: id("dlq", now - 9 * DAY),
      tenantId,
      type: "axis.policy.issued",
      consumer: "webhook-dispatcher",
      envelopeJson: envelope(
        now - 9 * DAY,
        "axis",
        "axis.policy.issued",
        "system:axis-issue",
        `policies:${ctx.policyId}`,
        { policyId: ctx.policyId, offeringId: ctx.offerings.cedarMotor }
      ),
      // The endpoint behind this is the legacy broker hook that has since been
      // paused: the delivery failures, the pause and this row are one story.
      error: "POST https://legacy.alphabrokers.ae/hooks/quotes -> 410 Gone",
      attempts: 5,
      replayedAt: null,
      createdAt: now - 9 * DAY
    },
    {
      id: id("dlq", now - 6 * DAY),
      tenantId,
      type: "ledger.settlement.posted",
      consumer: "north-briefings",
      envelopeJson: envelope(
        now - 6 * DAY,
        "ledger",
        "ledger.settlement.posted",
        "user:seed-controller",
        "settlements:cedar-2512",
        { settlementId: "cedar-2512", currency: "AED" }
      ),
      error: "briefing rollup timed out after 30000ms",
      attempts: 5,
      // Replayed once the rollup query was fixed, and it went through.
      replayedAt: now - 5 * DAY - 4 * HOUR,
      createdAt: now - 6 * DAY
    },
    {
      id: id("dlq", now - 4 * DAY),
      tenantId,
      type: "dist.commission.accrued",
      consumer: "ledger-postings",
      envelopeJson: envelope(
        now - 4 * DAY,
        "dist",
        "dist.commission.accrued",
        "system:dist-fanout",
        `commissions:${ctx.quoteRequestId}`,
        { grossMinor: 84_000, currency: "AED" }
      ),
      // Nothing retries its way past a closed period; this one waits for a
      // human to decide whether to reopen or post to the current month.
      error: "period 2025-12 is hard_closed: refusing to post",
      attempts: 5,
      replayedAt: null,
      createdAt: now - 4 * DAY
    },
    {
      id: id("dlq", now - 3 * DAY),
      tenantId,
      type: "compliance.screening.hit",
      consumer: "axis-cases",
      envelopeJson: envelope(
        now - 3 * DAY,
        "compliance",
        "compliance.screening.hit",
        "system:screening",
        `customer:${ctx.customerId}`,
        { kind: "sanctions", result: "hit", blocked: true }
      ),
      error: "case open failed: no queue for team motor at 03:00",
      attempts: 5,
      replayedAt: now - 3 * DAY + 7 * HOUR,
      createdAt: now - 3 * DAY
    },
    {
      id: id("dlq", now - 2 * DAY),
      tenantId,
      type: "orbit.renewal.due",
      consumer: "signal-campaigns",
      envelopeJson: envelope(
        now - 2 * DAY,
        "orbit",
        "orbit.renewal.due",
        "system:orbit-tick",
        `policies:${ctx.renewalPolicyId}`,
        { policyId: ctx.renewalPolicyId, dueInDays: 21 }
      ),
      error: "audience segment 'renewal-30d' not found",
      attempts: 5,
      replayedAt: null,
      createdAt: now - 2 * DAY
    },
    {
      id: id("dlq", now - 40 * HOUR),
      tenantId,
      type: "dist.quote_request.fanned_out",
      consumer: "signal-attribution",
      envelopeJson: envelope(
        now - 40 * HOUR,
        "dist",
        "dist.quote_request.fanned_out",
        "api:qvk_live_a1b2c3d4",
        `quote-requests:${ctx.quoteRequestId}`,
        { requestId: ctx.quoteRequestId, providers: 4, policyId: ctx.policyId }
      ),
      error: "attribution store rejected the write: unknown channel broker-alpha",
      attempts: 5,
      replayedAt: null,
      createdAt: now - 40 * HOUR
    },
    {
      id: id("dlq", now - 20 * HOUR),
      tenantId,
      type: "dist.quote_request.fanned_out",
      consumer: "signal-attribution",
      // Same envelope, second death: the replay ran before the channel was
      // registered, failed its five attempts again and parked itself here. A
      // console that hides this teaches an operator that replay always works.
      envelopeJson: envelope(
        now - 40 * HOUR,
        "dist",
        "dist.quote_request.fanned_out",
        "api:qvk_live_a1b2c3d4",
        `quote-requests:${ctx.quoteRequestId}`,
        { requestId: ctx.quoteRequestId, providers: 4, policyId: ctx.policyId }
      ),
      error: "attribution store rejected the write: unknown channel broker-alpha",
      attempts: 5,
      replayedAt: null,
      createdAt: now - 20 * HOUR
    }
  ];

  await db.insert(schema.eventDlq).values(rows);
}
