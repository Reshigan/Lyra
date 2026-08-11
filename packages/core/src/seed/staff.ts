import { and, eq } from "drizzle-orm";
import { id, schema } from "@lyra/db";
import { DAY, HOUR, type SeedContext } from "./context.js";

// The back office's own story, told with rows. A demo tenant whose staff table
// is fifteen finished people cannot show what the internal screens are for:
// there is nobody halfway through a checklist, nobody whose work had to be
// handed over, and no delegation to explain why an approval that looks like the
// finance controller's is sitting in somebody else's inbox.
//
// So this seeder adds four things the other seeders deliberately do not have: a
// joiner who started on Monday, a leaver whose queue was emptied onto a named
// successor, and delegations in all four of the states the resolver has to tell
// apart — scoped, capped, revoked and expired.

/** A role's id from its key. The core seed mints these in a loop, so ask. */
async function roleByKey(ctx: SeedContext, key: string): Promise<string> {
  const [row] = await ctx.db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(and(eq(schema.roles.tenantId, ctx.tenantId), eq(schema.roles.key, key)))
    .limit(1);
  if (!row) throw new Error(`seed: no role ${key}`);
  return row.id;
}

/** Mirrors `STAFF_TEMPLATES` in apps/api/src/engines/staff.ts. */
const ONBOARD: readonly [string, string, string][] = [
  ["contract_signed", "onboarding.staff.contract_signed", "hired"],
  ["right_to_work", "onboarding.staff.right_to_work", "hired"],
  ["background_check", "onboarding.staff.background_check", "hired"],
  ["policy_attestations", "onboarding.staff.policy_attestations", "active"],
  ["security_training", "onboarding.staff.security_training", "active"],
  ["systems_access", "onboarding.staff.systems_access", "active"],
  ["manager_signoff", "onboarding.staff.manager_signoff", "active"]
];

const OFFBOARD: readonly [string, string][] = [
  ["access_revoked", "offboarding.staff.access_revoked"],
  ["work_reassigned", "offboarding.staff.work_reassigned"],
  ["assets_returned", "offboarding.staff.assets_returned"],
  ["final_pay", "offboarding.staff.final_pay"],
  ["exit_interview", "offboarding.staff.exit_interview"]
];

export async function seedStaff(ctx: SeedContext): Promise<void> {
  const { db, now, tenantId, users, teams, customerId, caseId } = ctx;

  const admin = users["tenant.admin"]!;
  const lead = users["axis.lead"]!;
  const agent = users["axis.agent"]!;
  const controller = users["finance.controller"]!;
  const retention = users["orbit.retention"]!;
  const partners = users["orbit.partners"]!;

  /* ---------------------------------------------------------------- joiner */
  // Started three days ago. Right-to-work and the contract cleared on day one,
  // the background check is still with the vendor, and everything gated on
  // `active` is untouched — which is exactly why she has no password yet and
  // her account is `invited` rather than live.
  const joiner = id("us", now + 1);
  await db.insert(schema.users).values({
    id: joiner,
    tenantId,
    email: "layla.nasser@vantax.co.za",
    name: "Layla Nasser",
    locale: "en",
    status: "invited",
    authProvider: "password",
    mfaEnrolled: false,
    createdAt: now - 3 * DAY,
    updatedAt: now - 3 * DAY
  });
  await db.insert(schema.userRoles).values({
    id: id("url", now + 2),
    tenantId,
    userId: joiner,
    roleId: await roleByKey(ctx, "axis.agent"),
    scopeJson: JSON.stringify({ teamIds: [teams.motor] }),
    createdAt: now - 3 * DAY
  });

  const done = new Set(["contract_signed", "right_to_work"]);
  await db.insert(schema.onboardingSteps).values(
    ONBOARD.map(([key, labelKey, gatesStage], i) => ({
      id: id("obs", now + 10 + i),
      tenantId,
      subjectKind: "staff",
      subjectRef: `users:${joiner}`,
      template: "staff.onboard",
      key,
      labelJson: JSON.stringify({ key: labelKey }),
      seq: i + 1,
      required: key !== "exit_interview",
      gatesStage,
      state: done.has(key) ? "done" : key === "background_check" ? "in_progress" : "pending",
      evidenceKind: key === "background_check" ? "screening" : "attestation",
      evidenceRef: null,
      ownerRef: lead,
      dueAt: now + 4 * DAY,
      decidedBy: done.has(key) ? lead : null,
      decidedAt: done.has(key) ? now - 3 * DAY + 6 * HOUR : null,
      createdAt: now - 3 * DAY,
      updatedAt: done.has(key) ? now - 3 * DAY + 6 * HOUR : now - 3 * DAY
    }))
  );

  /* ---------------------------------------------------------------- leaver */
  // Resigned, last day was yesterday. Suspended rather than deleted: his name is
  // on an audit trail and a deleted row would break the chain that proves it.
  const leaver = id("us", now + 30);
  const lastDay = now - DAY;
  await db.insert(schema.users).values({
    id: leaver,
    tenantId,
    email: "tariq.mansour@vantax.co.za",
    name: "Tariq Mansour",
    locale: "en",
    status: "suspended",
    authProvider: "password",
    mfaEnrolled: true,
    createdAt: now - 400 * DAY,
    updatedAt: lastDay
  });
  await db.insert(schema.userRoles).values({
    id: id("url", now + 31),
    tenantId,
    userId: leaver,
    roleId: await roleByKey(ctx, "axis.agent"),
    scopeJson: null,
    createdAt: now - 400 * DAY
  });

  await db.insert(schema.onboardingSteps).values(
    OFFBOARD.map(([key, labelKey], i) => ({
      id: id("obs", now + 40 + i),
      tenantId,
      subjectKind: "staff",
      subjectRef: `users:${leaver}`,
      template: "staff.offboard",
      key,
      labelJson: JSON.stringify({ key: labelKey }),
      seq: i + 1,
      required: key !== "exit_interview",
      gatesStage: "offboarded",
      // Access and the queue were dealt with on the day; the laptop is still in
      // a courier's van and payroll runs at month end.
      state: key === "access_revoked" || key === "work_reassigned" ? "done" : "pending",
      evidenceKind: key === "final_pay" ? "attestation" : null,
      evidenceRef: null,
      ownerRef: lead,
      dueAt: lastDay + 7 * DAY,
      decidedBy: key === "access_revoked" || key === "work_reassigned" ? admin : null,
      decidedAt: key === "access_revoked" || key === "work_reassigned" ? lastDay : null,
      createdAt: lastDay - DAY,
      updatedAt: lastDay
    }))
  );

  // His open work, already on the successor. Both rows carry the leaver in the
  // narrative and the successor in the assignee column, which is the whole point
  // of the handover: nothing sits unassigned waiting to be noticed.
  await db.insert(schema.axisTasks).values({
    id: id("tsk", now + 50),
    tenantId,
    caseId,
    type: "handover",
    titleKey: "task.finish_handover_from_leaver",
    assigneeRef: lead,
    state: "open",
    dueAt: lastDay + 3 * DAY,
    checklistJson: JSON.stringify([
      { key: "read_case_notes", done: true },
      { key: "call_customer", done: false }
    ]),
    createdBy: admin,
    createdAt: lastDay,
    updatedAt: lastDay
  });
  await db.insert(schema.orbitConversations).values({
    id: id("cnv", now + 51),
    tenantId,
    customerId,
    channel: "email",
    state: "human",
    assigneeRef: lead,
    teamId: teams.motor,
    summary: "Reassigned from Tariq Mansour on offboarding — customer still awaiting a callback.",
    lang: "en",
    lastMessageAt: lastDay - 2 * HOUR,
    createdAt: lastDay - DAY,
    updatedAt: lastDay
  });

  /* ----------------------------------------------------------- delegations */
  await db.insert(schema.delegations).values([
    // The offboarding handover itself: whatever only Tariq could have decided is
    // decidable by his team lead for a month, then it lapses on its own.
    {
      id: id("dlg", now + 60),
      tenantId,
      fromUserId: leaver,
      toUserId: lead,
      reason: "offboarding",
      scopeJson: null,
      maxAmountMinor: null,
      currency: null,
      startsAt: lastDay,
      endsAt: lastDay + 30 * DAY,
      status: "active",
      createdBy: `user:${admin}`,
      createdAt: lastDay
    },
    // Scoped: the lead is away for a week and only the two bind decisions move.
    // Everything else in his queue waits for him rather than quietly widening
    // somebody's authority for the sake of a clean inbox.
    {
      id: id("dlg", now + 61),
      tenantId,
      fromUserId: lead,
      toUserId: agent,
      reason: "leave",
      scopeJson: JSON.stringify({ policyKeys: ["axis.bind", "axis.endorse"] }),
      maxAmountMinor: null,
      currency: null,
      startsAt: now - DAY,
      endsAt: now + 6 * DAY,
      status: "active",
      createdBy: `user:${lead}`,
      createdAt: now - 2 * DAY
    },
    // Capped: the controller is travelling and the admin may sign off refunds,
    // but only up to R2 500. Above the cap the delegation resolves to nobody and
    // the decision waits for the person who actually owns the money.
    {
      id: id("dlg", now + 62),
      tenantId,
      fromUserId: controller,
      toUserId: admin,
      reason: "travel",
      scopeJson: JSON.stringify({ modules: ["ledger"] }),
      maxAmountMinor: 250_000,
      currency: "ZAR",
      startsAt: now - 2 * DAY,
      endsAt: now + 3 * DAY,
      status: "active",
      createdBy: `user:${controller}`,
      createdAt: now - 3 * DAY
    },
    // Revoked early: she came back sooner than planned.
    {
      id: id("dlg", now + 63),
      tenantId,
      fromUserId: retention,
      toUserId: partners,
      reason: "cover",
      scopeJson: null,
      maxAmountMinor: null,
      currency: null,
      startsAt: now - 10 * DAY,
      endsAt: now + 10 * DAY,
      status: "revoked",
      createdBy: `user:${retention}`,
      revokedBy: `user:${retention}`,
      revokedAt: now - 6 * DAY,
      createdAt: now - 11 * DAY
    },
    // Expired: the window closed and the sweep marked it. Kept, not deleted —
    // "who could approve this last month" is an audit question.
    {
      id: id("dlg", now + 64),
      tenantId,
      fromUserId: partners,
      toUserId: retention,
      reason: "travel",
      scopeJson: JSON.stringify({ modules: ["orbit"] }),
      maxAmountMinor: null,
      currency: null,
      startsAt: now - 40 * DAY,
      endsAt: now - 33 * DAY,
      status: "expired",
      createdBy: `user:${partners}`,
      createdAt: now - 41 * DAY
    }
  ]);
}
