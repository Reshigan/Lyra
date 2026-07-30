import { and, eq, gt, inArray, isNull, like, lte, ne, or } from "drizzle-orm";
import { id as newId, schema, type Db } from "@lyra/db";
import {
  APPROVAL_POLICIES,
  actorRef,
  audit,
  badRequest,
  can,
  conflict,
  emit,
  expand,
  forbidden,
  gate,
  notFound,
  permissionsForRole,
  require_,
  scoped,
  type Actor,
  type Ctx,
  type Grant
} from "@lyra/core";
import { grantsFor } from "../auth.js";
import { must, one } from "../rows.js";

/**
 * docs/06 §4 — the back office's own lifecycle. A person joins, moves between
 * roles and leaves, and every one of those is a permission change, so none of
 * them may be a profile edit: joining generates a checklist somebody has to
 * clear, moving is refused if it would hand out authority the mover does not
 * hold, and leaving revokes every credential and names a successor for every
 * open piece of work rather than letting it fall on the floor.
 *
 * Delegation is the other half. An approval queue nobody can clear is an outage
 * in a platform where every consequential action pauses for a human — but a
 * delegation is itself consequential (docs/19 §7), so it is scoped, dated,
 * capped, approved and swept, and it never lends out authority the delegator
 * does not have at the moment the decision is taken.
 */

/* ------------------------------------------------------------- checklists */

export interface StaffStep {
  key: string;
  /** i18n key, never a string (CLAUDE.md §7). */
  labelKey: string;
  /** The stage this step must clear before the person may leave it. */
  gatesStage: string;
  evidenceKind?: string | undefined;
  required?: false;
}

/**
 * The two staff runs, in the same shape `core_onboarding_steps` stores for
 * partners and channels. Exported so the shared onboarding engine can merge
 * them into its own `TEMPLATES` record instead of learning about staff.
 */
export const STAFF_TEMPLATES: Record<string, readonly StaffStep[]> = {
  "staff.onboard": [
    { key: "contract_signed", labelKey: "onboarding.staff.contract_signed", gatesStage: "hired", evidenceKind: "agreement" },
    { key: "right_to_work", labelKey: "onboarding.staff.right_to_work", gatesStage: "hired", evidenceKind: "verification" },
    { key: "background_check", labelKey: "onboarding.staff.background_check", gatesStage: "hired", evidenceKind: "screening" },
    { key: "policy_attestations", labelKey: "onboarding.staff.policy_attestations", gatesStage: "active", evidenceKind: "attestation" },
    { key: "security_training", labelKey: "onboarding.staff.security_training", gatesStage: "active", evidenceKind: "attestation" },
    { key: "systems_access", labelKey: "onboarding.staff.systems_access", gatesStage: "active" },
    { key: "manager_signoff", labelKey: "onboarding.staff.manager_signoff", gatesStage: "active", evidenceKind: "attestation" }
  ],
  "staff.offboard": [
    { key: "access_revoked", labelKey: "offboarding.staff.access_revoked", gatesStage: "offboarded" },
    { key: "work_reassigned", labelKey: "offboarding.staff.work_reassigned", gatesStage: "offboarded" },
    { key: "assets_returned", labelKey: "offboarding.staff.assets_returned", gatesStage: "offboarded" },
    { key: "final_pay", labelKey: "offboarding.staff.final_pay", gatesStage: "offboarded", evidenceKind: "attestation" },
    { key: "exit_interview", labelKey: "offboarding.staff.exit_interview", gatesStage: "offboarded", required: false }
  ]
};

const STAFF = "staff";

/**
 * Write a template out as rows. Conflict-do-nothing on the natural key, so
 * re-running an onboarding never duplicates a checklist and never resets a step
 * somebody already cleared.
 */
async function generateSteps(
  ctx: Ctx,
  template: keyof typeof STAFF_TEMPLATES | string,
  subjectRef: string,
  opts: { ownerRef?: string | undefined; dueAt?: number | undefined } = {}
): Promise<number> {
  const steps = STAFF_TEMPLATES[template];
  if (!steps) throw badRequest(`unknown template: ${template}`);

  const rows = steps.map((step, i) => ({
    id: newId("obs", ctx.now + i),
    tenantId: ctx.tenantId,
    subjectKind: STAFF,
    subjectRef,
    template,
    key: step.key,
    labelJson: JSON.stringify({ key: step.labelKey }),
    seq: i + 1,
    required: step.required !== false,
    gatesStage: step.gatesStage,
    state: "pending",
    evidenceKind: step.evidenceKind ?? null,
    ownerRef: opts.ownerRef ?? null,
    dueAt: opts.dueAt ?? null,
    createdAt: ctx.now,
    updatedAt: ctx.now
  }));

  await ctx.db.insert(schema.onboardingSteps).values(rows).onConflictDoNothing();
  return rows.length;
}

/* ------------------------------------------------- privilege-escalation guard */

/**
 * The security boundary of the whole file: nobody hands out authority they do
 * not hold. Bundles are expanded first, because `core:*:*` is a grant of every
 * concrete permission under it and checking the wildcard string would let an
 * actor with one `core:users:read` pass a role that carries thirty writes.
 */
function assertCanGrant(ctx: Ctx, permissions: readonly string[], roleKey: string): void {
  for (const permission of expand(permissions)) {
    if (!can(ctx.actor, permission, { tenantId: ctx.tenantId })) {
      throw forbidden(`${permission} (via role ${roleKey})`);
    }
  }
}

interface RoleRow {
  id: string;
  key: string;
  permissionsJson: string;
}

/** Tenant role rows for a set of keys; an unknown key is a 400, not a silent skip. */
async function rolesByKey(ctx: Ctx, keys: readonly string[]): Promise<RoleRow[]> {
  if (!keys.length) return [];
  const rows = await ctx.db
    .select({ id: schema.roles.id, key: schema.roles.key, permissionsJson: schema.roles.permissionsJson })
    .from(schema.roles)
    .where(and(eq(schema.roles.tenantId, ctx.tenantId), inArray(schema.roles.key, [...keys])));

  for (const key of keys) {
    if (!rows.some((r) => r.key === key)) throw badRequest(`unknown role: ${key}`);
  }
  return rows;
}

/** The bundle a role actually confers: the stored one wins, as it does at login. */
function bundleOf(role: RoleRow): readonly string[] {
  try {
    const stored = JSON.parse(role.permissionsJson) as string[];
    if (Array.isArray(stored) && stored.length) return stored;
  } catch {
    /* fall through to the compiled table */
  }
  return permissionsForRole(role.key);
}

async function currentRoleKeys(ctx: Ctx, userId: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ key: schema.roles.key })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(and(eq(schema.userRoles.tenantId, ctx.tenantId), eq(schema.userRoles.userId, userId)));
  return rows.map((r) => r.key);
}

/* ------------------------------------------------------------------ joiner */

export interface InviteStaffInput {
  email: string;
  name: string;
  locale?: string | undefined;
  /** Role keys, checked against what the inviter holds before any row is written. */
  roleKeys: readonly string[];
  /** core_teams ids; stored as the ABAC overlay on each role grant. */
  teamIds?: readonly string[] | undefined;
  /** Who owns the checklist. Defaults to the inviter. */
  managerId?: string | undefined;
  /** Checklist due date; the first day is a reasonable default deadline. */
  dueAt?: number | undefined;
}

/**
 * Joiner. One call creates the account, its roles and the checklist that has to
 * be cleared before the account is anything more than an invitation — the user
 * lands in `invited`, with no password and no session, so nothing here grants
 * access on its own.
 */
export async function inviteStaff(
  ctx: Ctx,
  input: InviteStaffInput
): Promise<{ user: typeof schema.users.$inferSelect; steps: number }> {
  require_(ctx.actor, "core:users:create", { tenantId: ctx.tenantId, module: "core" });
  require_(ctx.actor, "core:roles:assign", { tenantId: ctx.tenantId, module: "core" });

  const email = input.email.trim().toLowerCase();
  const roles = await rolesByKey(ctx, input.roleKeys);
  if (!roles.length) throw badRequest("a joiner needs at least one role");
  for (const role of roles) assertCanGrant(ctx, bundleOf(role), role.key);

  if (input.teamIds?.length) {
    const teams = await ctx.db
      .select({ id: schema.teams.id })
      .from(schema.teams)
      .where(and(eq(schema.teams.tenantId, ctx.tenantId), inArray(schema.teams.id, [...input.teamIds])));
    if (teams.length !== input.teamIds.length) throw badRequest("unknown team");
  }

  const [clash] = await ctx.db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.tenantId, ctx.tenantId), eq(schema.users.email, email)))
    .limit(1);
  if (clash) throw conflict("a user with that email already exists");

  const user: typeof schema.users.$inferInsert = {
    id: newId("usr", ctx.now),
    tenantId: ctx.tenantId,
    email,
    name: input.name,
    locale: input.locale ?? ctx.locale,
    status: "invited",
    authProvider: "password",
    createdAt: ctx.now,
    updatedAt: ctx.now
  };
  await ctx.db.insert(schema.users).values(user);

  const scopeJson = input.teamIds?.length ? JSON.stringify({ teams: input.teamIds }) : null;
  await ctx.db.insert(schema.userRoles).values(
    roles.map((role, i) => ({
      id: newId("url", ctx.now + i),
      tenantId: ctx.tenantId,
      userId: user.id,
      roleId: role.id,
      scopeJson,
      createdAt: ctx.now
    }))
  );

  const steps = await startStaffOnboarding(ctx, user.id, {
    ownerRef: input.managerId ?? ctx.actor.id,
    ...(input.dueAt === undefined ? {} : { dueAt: input.dueAt })
  });

  await audit(ctx, {
    action: "core.staff.invite",
    subjectRef: `users:${user.id}`,
    after: { ...user, roleKeys: roles.map((r) => r.key), teamIds: input.teamIds ?? [] }
  });
  await emit(ctx, {
    module: "core",
    type: "core.staff.invited",
    subject: `users:${user.id}`,
    data: { userId: user.id, roleKeys: roles.map((r) => r.key) }
  });

  const [row] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, user.id)).limit(1);
  return { user: row as typeof schema.users.$inferSelect, steps };
}

/** The checklist half of the joiner, for someone whose account already exists. */
export async function startStaffOnboarding(
  ctx: Ctx,
  userId: string,
  opts: { ownerRef?: string | undefined; dueAt?: number | undefined } = {}
): Promise<number> {
  require_(ctx.actor, "core:onboarding:write", { tenantId: ctx.tenantId, module: "core" });
  return generateSteps(ctx, "staff.onboard", `users:${userId}`, opts);
}

/* ------------------------------------------------------------------- mover */

export interface ChangeRolesInput {
  add?: readonly string[] | undefined;
  remove?: readonly string[] | undefined;
  /** Why, in the operator's words. A role change with no reason is unreviewable. */
  reason: string;
}

/**
 * Mover. Refuses to grant any permission the acting user does not themselves
 * hold — without that check `core:roles:assign` is a self-service route to
 * `*:*:*`, which is the escalation the permission model exists to prevent.
 * Removal is not guarded the same way: taking authority away is always safe.
 */
export async function changeRoles(
  ctx: Ctx,
  userId: string,
  input: ChangeRolesInput
): Promise<{ userId: string; roleKeys: string[] }> {
  require_(ctx.actor, "core:roles:assign", { tenantId: ctx.tenantId, module: "core" });
  if (!input.add?.length && !input.remove?.length) throw badRequest("nothing to change");
  if (input.reason.trim().length < 3) throw badRequest("reason is required");

  const user = await must(ctx, schema.users, userId, "user");
  const before = await currentRoleKeys(ctx, user.id);

  const add = await rolesByKey(ctx, input.add ?? []);
  for (const role of add) assertCanGrant(ctx, bundleOf(role), role.key);
  const remove = await rolesByKey(ctx, input.remove ?? []);

  if (remove.length) {
    await ctx.db
      .delete(schema.userRoles)
      .where(
        and(
          eq(schema.userRoles.tenantId, ctx.tenantId),
          eq(schema.userRoles.userId, user.id),
          inArray(
            schema.userRoles.roleId,
            remove.map((r) => r.id)
          )
        )
      );
  }
  if (add.length) {
    await ctx.db
      .insert(schema.userRoles)
      .values(
        add.map((role, i) => ({
          id: newId("url", ctx.now + i),
          tenantId: ctx.tenantId,
          userId: user.id,
          roleId: role.id,
          createdAt: ctx.now
        }))
      )
      .onConflictDoNothing();
  }

  const after = await currentRoleKeys(ctx, user.id);
  await audit(ctx, {
    action: "core.staff.roles_changed",
    subjectRef: `users:${user.id}`,
    before: { roleKeys: before },
    after: { roleKeys: after, reason: input.reason }
  });
  await emit(ctx, {
    module: "core",
    type: "core.staff.roles_changed",
    subject: `users:${user.id}`,
    data: { userId: user.id, added: add.map((r) => r.key), removed: remove.map((r) => r.key) }
  });

  return { userId: user.id, roleKeys: after };
}

/* ------------------------------------------------------------------ leaver */

export interface OffboardInput {
  /** Last working day. The successor delegation runs a month past it. */
  lastDay: number;
  /** Who inherits the open work. Mandatory — nothing is allowed to be orphaned. */
  reassignTo: string;
  reason?: string | undefined;
}

export interface OffboardResult {
  steps: number;
  sessionsRevoked: number;
  apiKeysRevoked: number;
  conversationsReassigned: number;
  tasksReassigned: number;
  delegationsReassigned: number;
  delegationsRevoked: number;
  /** The successor delegation that keeps the leaver's approvals decidable. */
  delegationId: string;
}

/** How long the successor keeps the leaver's approval authority after the last day. */
const HANDOVER_MS = 30 * 86_400_000;

/**
 * Leaver. Everything the account could still do stops, and everything it was
 * holding gets a named owner. The successor is a parameter and not a default,
 * because the failure mode of offboarding is silence: a conversation with no
 * assignee and an approval with no possible decider look exactly like a queue
 * that happens to be quiet.
 */
export async function offboardStaff(ctx: Ctx, userId: string, input: OffboardInput): Promise<OffboardResult> {
  require_(ctx.actor, "core:users:update", { tenantId: ctx.tenantId, module: "core" });
  // The handover below is a delegation, so it is held to the delegation permission.
  require_(ctx.actor, "core:delegations:write", { tenantId: ctx.tenantId, module: "core" });

  const user = await must(ctx, schema.users, userId, "user");
  if (input.reassignTo === user.id) throw badRequest("cannot reassign a leaver's work to themselves");
  const successor = await one(ctx, schema.users, input.reassignTo);
  if (!successor) throw badRequest("unknown successor");
  if (successor.status === "suspended") throw badRequest("successor is not an active user");

  const steps = await generateSteps(ctx, "staff.offboard", `users:${user.id}`, {
    ownerRef: successor.id,
    dueAt: input.lastDay
  });

  // Credentials first: the rest of this is bookkeeping, but a live session is access.
  const sessions = await ctx.db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.tenantId, ctx.tenantId),
        eq(schema.sessions.userId, user.id),
        isNull(schema.sessions.revokedAt)
      )
    );
  if (sessions.length) {
    await ctx.db
      .update(schema.sessions)
      .set({ revokedAt: ctx.now })
      .where(
        and(
          eq(schema.sessions.tenantId, ctx.tenantId),
          eq(schema.sessions.userId, user.id),
          isNull(schema.sessions.revokedAt)
        )
      );
  }

  const ownerRef = `user:${user.id}`;
  const keys = await ctx.db
    .select({ id: schema.apiKeys.id })
    .from(schema.apiKeys)
    .where(
      and(
        eq(schema.apiKeys.tenantId, ctx.tenantId),
        eq(schema.apiKeys.createdBy, ownerRef),
        isNull(schema.apiKeys.revokedAt)
      )
    );
  if (keys.length) {
    await ctx.db
      .update(schema.apiKeys)
      .set({ revokedAt: ctx.now })
      .where(
        and(
          eq(schema.apiKeys.tenantId, ctx.tenantId),
          eq(schema.apiKeys.createdBy, ownerRef),
          isNull(schema.apiKeys.revokedAt)
        )
      );
  }

  // Open work. Both tables address a person by bare user id.
  const openConversations = and(
    eq(schema.orbitConversations.tenantId, ctx.tenantId),
    eq(schema.orbitConversations.assigneeRef, user.id),
    ne(schema.orbitConversations.state, "closed")
  );
  const conversations = await ctx.db
    .select({ id: schema.orbitConversations.id })
    .from(schema.orbitConversations)
    .where(openConversations);
  if (conversations.length) {
    await ctx.db
      .update(schema.orbitConversations)
      .set({ assigneeRef: successor.id, updatedAt: ctx.now })
      .where(openConversations);
  }

  const openTasks = and(
    eq(schema.axisTasks.tenantId, ctx.tenantId),
    eq(schema.axisTasks.assigneeRef, user.id),
    inArray(schema.axisTasks.state, ["open", "in_progress", "blocked"])
  );
  const tasks = await ctx.db.select({ id: schema.axisTasks.id }).from(schema.axisTasks).where(openTasks);
  if (tasks.length) {
    await ctx.db.update(schema.axisTasks).set({ assigneeRef: successor.id, updatedAt: ctx.now }).where(openTasks);
  }

  // Delegations *to* the leaver were somebody else's authority parked with them:
  // it moves to the successor. Delegations *from* the leaver end, because the
  // authority they lent out is authority they are about to stop having.
  const inbound = and(
    eq(schema.delegations.tenantId, ctx.tenantId),
    eq(schema.delegations.toUserId, user.id),
    eq(schema.delegations.status, "active")
  );
  const inboundRows = await ctx.db.select({ id: schema.delegations.id }).from(schema.delegations).where(inbound);
  if (inboundRows.length) {
    await ctx.db.update(schema.delegations).set({ toUserId: successor.id }).where(inbound);
  }

  const outbound = and(
    eq(schema.delegations.tenantId, ctx.tenantId),
    eq(schema.delegations.fromUserId, user.id),
    eq(schema.delegations.status, "active")
  );
  const outboundRows = await ctx.db.select({ id: schema.delegations.id }).from(schema.delegations).where(outbound);
  if (outboundRows.length) {
    await ctx.db
      .update(schema.delegations)
      .set({ status: "revoked", revokedBy: actorRef(ctx), revokedAt: ctx.now })
      .where(outbound);
  }

  // The leaver's own approval authority. An approval whose only possible decider
  // has left is an approval nobody can clear, so the successor gets it for a
  // bounded window. Not gated on `core.delegation_grant`: this is not somebody
  // choosing to hand their authority away, it is the consequence of an
  // offboarding the actor already holds both permissions for.
  const delegation: typeof schema.delegations.$inferInsert = {
    id: newId("dlg", ctx.now),
    tenantId: ctx.tenantId,
    fromUserId: user.id,
    toUserId: successor.id,
    reason: "offboarding",
    scopeJson: null,
    maxAmountMinor: null,
    currency: null,
    startsAt: ctx.now,
    endsAt: input.lastDay + HANDOVER_MS,
    status: "active",
    createdBy: actorRef(ctx),
    createdAt: ctx.now
  };
  await ctx.db.insert(schema.delegations).values(delegation);

  await ctx.db
    .update(schema.users)
    .set({ status: "suspended", updatedAt: ctx.now })
    .where(scoped(ctx, schema.users, eq(schema.users.id, user.id)));

  const result: OffboardResult = {
    steps,
    sessionsRevoked: sessions.length,
    apiKeysRevoked: keys.length,
    conversationsReassigned: conversations.length,
    tasksReassigned: tasks.length,
    delegationsReassigned: inboundRows.length,
    delegationsRevoked: outboundRows.length,
    delegationId: delegation.id
  };

  await audit(ctx, {
    action: "core.staff.offboard",
    subjectRef: `users:${user.id}`,
    before: { status: user.status },
    after: { status: "suspended", reassignTo: successor.id, lastDay: input.lastDay, reason: input.reason ?? null, ...result }
  });
  await emit(ctx, {
    module: "core",
    type: "core.staff.offboarded",
    subject: `users:${user.id}`,
    data: { userId: user.id, reassignTo: successor.id, lastDay: input.lastDay }
  });

  return result;
}

/* -------------------------------------------------------------- delegation */

export interface DelegationScope {
  policyKeys?: readonly string[] | undefined;
  modules?: readonly string[] | undefined;
}

export interface GrantDelegationInput {
  /** Defaults to the caller: "while I am away, my approvals go to them." */
  fromUserId?: string | undefined;
  toUserId: string;
  reason: string;
  scope?: DelegationScope | undefined;
  maxAmountMinor?: number | undefined;
  currency?: string | undefined;
  startsAt: number;
  endsAt: number;
}

/**
 * Delegating your own approvals is something a decider may do for themselves;
 * delegating on somebody else's behalf is an administrative act over another
 * person's authority, and needs the administrative permission.
 */
function assertMayDelegate(ctx: Ctx, fromUserId: string): void {
  const subject = { tenantId: ctx.tenantId, module: "core" };
  if (fromUserId === ctx.actor.id && can(ctx.actor, "core:approvals:decide", subject)) return;
  require_(ctx.actor, "core:delegations:write", subject);
}

export async function grantDelegation(
  ctx: Ctx,
  input: GrantDelegationInput
): Promise<typeof schema.delegations.$inferSelect> {
  const fromUserId = input.fromUserId ?? ctx.actor.id;
  assertMayDelegate(ctx, fromUserId);

  if (fromUserId === input.toUserId) throw badRequest("cannot delegate to yourself");
  if (input.endsAt <= input.startsAt) throw badRequest("endsAt must be after startsAt");
  if (input.endsAt <= ctx.now) throw badRequest("delegation has already ended");
  if (input.maxAmountMinor !== undefined) {
    if (input.maxAmountMinor <= 0) throw badRequest("maxAmountMinor must be positive");
    if (!input.currency) throw badRequest("currency is required with maxAmountMinor");
  }
  for (const key of input.scope?.policyKeys ?? []) {
    if (!APPROVAL_POLICIES[key]) throw badRequest(`unknown approval policy: ${key}`);
  }

  const from = await one(ctx, schema.users, fromUserId);
  if (!from) throw notFound("delegator");
  const to = await one(ctx, schema.users, input.toUserId);
  if (!to) throw notFound("delegate");
  if (to.status === "suspended") throw badRequest("delegate is not an active user");

  // Stable across the retry that follows an approval: minting the id first would
  // ask for a fresh approval every time the caller came back with the old one.
  const subjectRef = `delegations:${fromUserId}->${input.toUserId}@${input.endsAt}`;
  const approval = await gate(ctx, {
    policyKey: "core.delegation_grant",
    subjectRef,
    ...(input.maxAmountMinor === undefined ? {} : { amountMinor: input.maxAmountMinor }),
    context: { fromUserId, toUserId: input.toUserId, reason: input.reason, scope: input.scope ?? null }
  });

  const row: typeof schema.delegations.$inferInsert = {
    id: newId("dlg", ctx.now),
    tenantId: ctx.tenantId,
    fromUserId,
    toUserId: input.toUserId,
    reason: input.reason,
    scopeJson: input.scope ? JSON.stringify(input.scope) : null,
    maxAmountMinor: input.maxAmountMinor ?? null,
    currency: input.currency ?? null,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    status: "active",
    createdBy: actorRef(ctx),
    createdAt: ctx.now
  };
  await ctx.db.insert(schema.delegations).values(row);

  await audit(ctx, {
    action: "core.delegation.grant",
    subjectRef: `delegations:${row.id}`,
    after: { ...row, approvalId: approval?.id ?? null }
  });
  await emit(ctx, {
    module: "core",
    type: "core.delegation.granted",
    subject: `delegations:${row.id}`,
    data: { fromUserId, toUserId: input.toUserId, endsAt: input.endsAt }
  });

  return row as typeof schema.delegations.$inferSelect;
}

export async function revokeDelegation(
  ctx: Ctx,
  delegationId: string,
  reason?: string
): Promise<typeof schema.delegations.$inferSelect> {
  const row = await must(ctx, schema.delegations, delegationId, "delegation");
  // Handing your authority back early needs no administrator.
  if (row.fromUserId !== ctx.actor.id) {
    require_(ctx.actor, "core:delegations:write", { tenantId: ctx.tenantId, module: "core" });
  }
  if (row.status !== "active") throw conflict(`delegation is ${row.status}`);

  await ctx.db
    .update(schema.delegations)
    .set({ status: "revoked", revokedBy: actorRef(ctx), revokedAt: ctx.now })
    .where(and(eq(schema.delegations.tenantId, ctx.tenantId), eq(schema.delegations.id, row.id)));

  const after = { ...row, status: "revoked", revokedBy: actorRef(ctx), revokedAt: ctx.now };
  await audit(ctx, {
    action: "core.delegation.revoke",
    subjectRef: `delegations:${row.id}`,
    before: row,
    after: { ...after, reason: reason ?? null }
  });
  await emit(ctx, {
    module: "core",
    type: "core.delegation.revoked",
    subject: `delegations:${row.id}`,
    data: { fromUserId: row.fromUserId, toUserId: row.toUserId }
  });

  return after;
}

/**
 * Scheduled sweep. A delegation that has run out is dead the moment its window
 * closes — `resolveDelegates` enforces the window itself and never trusts the
 * status alone — but leaving `active` rows behind makes every admin screen lie
 * about who currently holds what.
 */
export async function expireDelegations(ctx: Ctx): Promise<number> {
  const due = and(
    eq(schema.delegations.tenantId, ctx.tenantId),
    eq(schema.delegations.status, "active"),
    lte(schema.delegations.endsAt, ctx.now)
  );
  const rows = await ctx.db.select({ id: schema.delegations.id }).from(schema.delegations).where(due);
  if (!rows.length) return 0;

  await ctx.db.update(schema.delegations).set({ status: "expired" }).where(due);
  await audit(ctx, {
    action: "core.delegation.expire",
    subjectRef: "delegations:sweep",
    after: { expired: rows.map((r) => r.id) }
  });
  return rows.length;
}

/* ---------------------------------------------------------------- resolve */

export interface ResolveInput {
  policyKey: string;
  /** Overrides the policy's own module when a caller scopes more narrowly. */
  module?: string | undefined;
  /** The amount at stake, checked against each delegation's ceiling. */
  amountMinor?: number | undefined;
  /** Ask about one delegator only. Omit to ask "who may decide this at all". */
  fromUserId?: string | undefined;
}

/**
 * Who may currently decide this policy on somebody's behalf.
 *
 * Four rules, all of them load-bearing:
 *  - the window is checked here, so a row the sweep has not reached yet is
 *    already inert;
 *  - a revoked or expired row resolves to nothing;
 *  - `maxAmountMinor` caps what may be decided under the delegation;
 *  - the delegate never gains a permission the delegator does not hold *now* —
 *    the delegator's live grants are re-read, so a mover that stripped their
 *    roles this morning silently narrows every delegation they left behind.
 *
 * Deliberately one hop. A→B and B→C are two independent loans of two different
 * people's authority; feeding a resolved delegate back in as a delegator would
 * make C an approver for A, which is precisely the chain a scoped delegation is
 * supposed to prevent.
 */
export async function resolveDelegates(ctx: Ctx, input: ResolveInput): Promise<string[]> {
  const policy = APPROVAL_POLICIES[input.policyKey];
  if (!policy) return [];

  const rows = await ctx.db
    .select()
    .from(schema.delegations)
    .where(
      and(
        eq(schema.delegations.tenantId, ctx.tenantId),
        eq(schema.delegations.status, "active"),
        lte(schema.delegations.startsAt, ctx.now),
        gt(schema.delegations.endsAt, ctx.now),
        input.fromUserId ? eq(schema.delegations.fromUserId, input.fromUserId) : undefined
      )
    );

  const module = input.module ?? policy.module;
  const holds = new Map<string, boolean>();
  const out = new Set<string>();

  for (const row of rows) {
    if (!inScope(row.scopeJson, input.policyKey, module)) continue;
    if (row.maxAmountMinor != null && (input.amountMinor ?? 0) > row.maxAmountMinor) continue;

    let held = holds.get(row.fromUserId);
    if (held === undefined) {
      held = can(await delegatorActor(ctx, row.fromUserId), policy.decide, {
        tenantId: ctx.tenantId,
        module: policy.module
      });
      holds.set(row.fromUserId, held);
    }
    if (held) out.add(row.toUserId);
  }

  return [...out];
}

function inScope(scopeJson: string | null, policyKey: string, module: string): boolean {
  if (!scopeJson) return true;
  let scope: DelegationScope;
  try {
    scope = JSON.parse(scopeJson) as DelegationScope;
  } catch {
    // An unreadable scope is not an open one.
    return false;
  }
  if (scope.policyKeys?.length && !scope.policyKeys.includes(policyKey)) return false;
  if (scope.modules?.length && !scope.modules.includes(module)) return false;
  return true;
}

/**
 * The delegator as `can()` sees them. `grantsFor` is the same expansion login
 * uses, so a delegation can never resolve to authority a login would not give.
 */
async function delegatorActor(ctx: Ctx, userId: string): Promise<Actor> {
  // ponytail: reuse the login path's role expansion. Ctx["db"] is the structural
  // subset both drivers satisfy and grantsFor only reads, so the cast is safe.
  const grants: Grant[] = await grantsFor(ctx.db as unknown as Db, ctx.tenantId, userId);
  return { kind: "user", id: userId, tenantId: ctx.tenantId, grants };
}

/* ------------------------------------------------------------- assignee picker */

export interface StaffOption {
  id: string;
  name: string;
}

/**
 * Id and display name, nothing else. Every assignment UI needs a person picker
 * and none of them needs an email address, a phone number or a last-seen time.
 */
export async function listStaff(ctx: Ctx, q: string | undefined, limit: number): Promise<StaffOption[]> {
  // LIKE wildcards are stripped rather than escaped: drizzle emits no ESCAPE
  // clause, and a picker has no use for pattern syntax anyway.
  const needle = q?.trim().replace(/[%_\\]/g, "");
  const rows = await ctx.db
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(
      scoped(
        ctx,
        schema.users,
        or(eq(schema.users.status, "active"), eq(schema.users.status, "invited")),
        needle ? or(like(schema.users.name, `%${needle}%`), like(schema.users.email, `%${needle}%`)) : undefined
      )
    )
    .orderBy(schema.users.name)
    .limit(Math.min(limit, 200));
  return rows;
}
