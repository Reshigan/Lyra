import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson, ScopeJson, schema } from "@lyra/db";
import { decide, gate, permissionsForRole, type AppError, type Ctx } from "@lyra/core";
import {
  changeRoles,
  expireDelegations,
  grantDelegation,
  inviteStaff,
  listStaff,
  offboardStaff,
  resolveDelegates,
  revokeDelegation
} from "./engines/staff.js";

// docs/06 §4. Three of the rules below are security boundaries rather than
// features — a mover may not grant what they do not hold, a leaver keeps no
// live credential, and a delegate never decides something the delegator could
// not have decided themselves — so each of them is asserted from the outside,
// against the rows, not against the function's return value.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

const T = "t_test";
const OTHER = "t_other";
const DAY = 86_400_000;

let ctx: Ctx;

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  for (const stmt of statements()) await client.execute(stmt);
  ctx = {
    db: drizzle(client) as unknown as Ctx["db"],
    tenantId: T,
    actor: { kind: "user", id: "u_admin", tenantId: T, grants: [{ roleKey: "tenant.admin", permissions: ["*:*:*"] }] },
    requestId: "req_test",
    now: Date.UTC(2026, 5, 15, 12),
    locale: "en",
    // Delegation is approval-gated; most cases here are about what the
    // delegation then does, so the tenant auto-approves the grant itself. The
    // gate has its own test below with the default policy.
    policy: PolicyJson.parse({ autoApprove: ["core.delegation_grant"] }),
    entitlements: EntitlementsJson.parse({})
  };

  await seedRole("tenant.admin");
  await seedRole("axis.agent");
  await seedRole("axis.lead");
  await seedRole("finance.controller");
  await seedUser("u_admin", "admin@x.test", ["tenant.admin"]);
});

/* ------------------------------------------------------------------ fixtures */

async function seedRole(key: string, tenantId = T, permissions?: string[]): Promise<void> {
  await ctx.db.insert(schema.roles).values({
    id: `rol_${tenantId}_${key}`,
    tenantId,
    key,
    name: key,
    permissionsJson: JSON.stringify(permissions ?? permissionsForRole(key)),
    system: true,
    createdAt: ctx.now
  });
}

async function seedUser(userId: string, email: string, roleKeys: string[], tenantId = T): Promise<string> {
  await ctx.db.insert(schema.users).values({
    id: userId,
    tenantId,
    email,
    name: email.split("@")[0] as string,
    locale: "en",
    status: "active",
    authProvider: "password",
    createdAt: ctx.now,
    updatedAt: ctx.now
  });
  for (const [i, key] of roleKeys.entries()) {
    await ctx.db.insert(schema.userRoles).values({
      id: `url_${userId}_${i}`,
      tenantId,
      userId,
      roleId: `rol_${tenantId}_${key}`,
      scopeJson: null,
      createdAt: ctx.now
    });
  }
  return userId;
}

/** An actor holding exactly one role's compiled bundle. */
function as(userId: string, roleKey: string, tenantId = T): Ctx {
  return {
    ...ctx,
    tenantId,
    actor: { kind: "user", id: userId, tenantId, grants: [{ roleKey, permissions: [...permissionsForRole(roleKey)] }] }
  };
}

async function detailOf(fn: () => unknown): Promise<string> {
  try {
    await fn();
  } catch (e) {
    const err = e as { detail?: string; permission?: string };
    return err.detail ?? err.permission ?? String(e);
  }
  return "";
}

/** May assign roles, holds nothing else worth stealing. */
function hr(): Ctx {
  const permissions = ["core:users:read", "core:users:update", "core:roles:read", "core:roles:assign"];
  return { ...ctx, actor: { kind: "user", id: "u_hr", tenantId: T, grants: [{ roleKey: "hr", permissions }] } };
}

async function activeDelegation(overrides: Partial<typeof schema.delegations.$inferInsert> = {}): Promise<string> {
  const row = {
    id: `dlg_${Math.random().toString(36).slice(2, 10)}`,
    tenantId: T,
    fromUserId: "u_from",
    toUserId: "u_to",
    reason: "leave",
    scopeJson: null,
    maxAmountMinor: null,
    currency: null,
    startsAt: ctx.now - DAY,
    endsAt: ctx.now + DAY,
    status: "active",
    createdBy: "user:u_admin",
    createdAt: ctx.now - DAY,
    ...overrides
  };
  await ctx.db.insert(schema.delegations).values(row);
  return row.id;
}

/* -------------------------------------------------------------------- joiner */

describe("joiner", () => {
  it("creates an invited account with roles and a checklist", async () => {
    const { user, steps } = await inviteStaff(ctx, {
      email: "Layla@X.test",
      name: "Layla Nasser",
      roleKeys: ["axis.agent"]
    });

    expect(user.status).toBe("invited");
    expect(user.email).toBe("layla@x.test");
    expect(user.passwordHash).toBeNull();
    expect(steps).toBe(7);

    const rows = await ctx.db
      .select()
      .from(schema.onboardingSteps)
      .where(and(eq(schema.onboardingSteps.tenantId, T), eq(schema.onboardingSteps.subjectRef, `users:${user.id}`)));
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.subjectKind === "staff" && r.state === "pending")).toBe(true);
    // Labels are i18n keys, never strings (CLAUDE.md §7).
    expect(JSON.parse(rows[0]!.labelJson) as { key: string }).toEqual({ key: "onboarding.staff.contract_signed" });
  });

  it("persists a team scope under the canonical teamIds key that ScopeJson can read", async () => {
    // Regression: the invite wrote {teams:[...]} while ScopeJson parses teamIds,
    // so login stripped the overlay and the grant was silently tenant-wide.
    await ctx.db.insert(schema.teams).values({ id: "tm_1", tenantId: T, name: "Motor desk", createdAt: ctx.now });
    const { user } = await inviteStaff(ctx, {
      email: "scoped@x.test",
      name: "Scoped",
      roleKeys: ["axis.agent"],
      teamIds: ["tm_1"]
    });
    const [grant] = await ctx.db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, user.id));
    const scope = ScopeJson.parse(JSON.parse(grant!.scopeJson!));
    expect(scope.teamIds).toEqual(["tm_1"]);
  });

  it("refuses a second account on the same email", async () => {
    await inviteStaff(ctx, { email: "dup@x.test", name: "One", roleKeys: ["axis.agent"] });
    expect(await detailOf(() => inviteStaff(ctx, { email: "dup@x.test", name: "Two", roleKeys: ["axis.agent"] }))).toBe(
      "a user with that email already exists"
    );
  });

  it("refuses an unknown role before writing any row", async () => {
    expect(await detailOf(() => inviteStaff(ctx, { email: "n@x.test", name: "N", roleKeys: ["not.a.role"] }))).toBe(
      "unknown role: not.a.role"
    );
    const users = await ctx.db.select().from(schema.users).where(eq(schema.users.email, "n@x.test"));
    expect(users).toHaveLength(0);
  });

  it("refuses to invite past the tenant's seat limit", async () => {
    // Only u_admin exists (seeded in beforeEach), so a 1-seat entitlement is already full.
    ctx.entitlements = EntitlementsJson.parse({ seats: 1 });
    expect(
      await detailOf(() => inviteStaff(ctx, { email: "over@x.test", name: "Over", roleKeys: ["axis.agent"] }))
    ).toBe("seat limit reached (1 seats)");
    const users = await ctx.db.select().from(schema.users).where(eq(schema.users.email, "over@x.test"));
    expect(users).toHaveLength(0);
  });
});

/* --------------------------------------------------------------------- mover */

describe("mover", () => {
  it("refuses to grant a permission the acting user does not hold", async () => {
    const target = await seedUser("u_target", "t@x.test", ["axis.agent"]);
    const detail = await detailOf(() => changeRoles(hr(), target, { add: ["tenant.admin"], reason: "promotion" }));
    expect(detail).toMatch(/via role tenant.admin/);

    const after = await ctx.db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, target));
    expect(after.map((r) => r.roleId)).toEqual([`rol_${T}_axis.agent`]);
  });

  it("allows a grant the acting user does hold, and audits it", async () => {
    const target = await seedUser("u_target", "t@x.test", ["axis.agent"]);
    const out = await changeRoles(ctx, target, { add: ["axis.lead"], remove: ["axis.agent"], reason: "moved to team lead" });

    expect(out.roleKeys).toEqual(["axis.lead"]);
    const audit = await ctx.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, T), eq(schema.auditLog.action, "core.staff.roles_changed")));
    expect(audit).toHaveLength(1);
  });

  it("takes authority away without the escalation check", async () => {
    const target = await seedUser("u_target", "t@x.test", ["tenant.admin"]);
    const out = await changeRoles(hr(), target, { remove: ["tenant.admin"], reason: "left the admin group" });
    expect(out.roleKeys).toEqual([]);
  });
});

/* -------------------------------------------------------------------- leaver */

describe("leaver", () => {
  async function leaverFixture(): Promise<{ leaver: string; successor: string }> {
    const leaver = await seedUser("u_leaver", "leaver@x.test", ["axis.agent"]);
    const successor = await seedUser("u_next", "next@x.test", ["axis.lead"]);

    for (const n of [1, 2]) {
      await ctx.db.insert(schema.sessions).values({
        id: `ses_${n}`,
        tenantId: T,
        userId: leaver,
        tokenHash: `hash_${n}`,
        mfaSatisfied: true,
        expiresAt: ctx.now + DAY,
        createdAt: ctx.now
      });
    }
    await ctx.db.insert(schema.apiKeys).values({
      id: "key_1",
      tenantId: T,
      name: "his integration",
      prefix: "qvk_test_abcd1234",
      keyHash: "kh",
      mode: "test",
      scopesJson: JSON.stringify(["axis:cases:read"]),
      createdBy: `user:${leaver}`,
      createdAt: ctx.now
    });
    await ctx.db.insert(schema.axisTasks).values([
      {
        id: "tsk_open",
        tenantId: T,
        type: "chase",
        titleKey: "task.chase",
        assigneeRef: leaver,
        state: "open",
        createdBy: leaver,
        createdAt: ctx.now,
        updatedAt: ctx.now
      },
      {
        id: "tsk_done",
        tenantId: T,
        type: "chase",
        titleKey: "task.chase",
        assigneeRef: leaver,
        state: "done",
        createdBy: leaver,
        createdAt: ctx.now,
        updatedAt: ctx.now
      }
    ]);
    await ctx.db.insert(schema.orbitConversations).values([
      {
        id: "cnv_open",
        tenantId: T,
        channel: "email",
        state: "human",
        assigneeRef: leaver,
        lang: "en",
        createdAt: ctx.now,
        updatedAt: ctx.now
      },
      {
        id: "cnv_closed",
        tenantId: T,
        channel: "email",
        state: "closed",
        assigneeRef: leaver,
        lang: "en",
        createdAt: ctx.now,
        updatedAt: ctx.now
      }
    ]);
    return { leaver, successor };
  }

  it("revokes every session and api key the leaver owned", async () => {
    const { leaver, successor } = await leaverFixture();
    const out = await offboardStaff(ctx, leaver, { lastDay: ctx.now, reassignTo: successor });

    expect(out.sessionsRevoked).toBe(2);
    expect(out.apiKeysRevoked).toBe(1);

    const sessions = await ctx.db.select().from(schema.sessions).where(eq(schema.sessions.userId, leaver));
    expect(sessions.every((s) => s.revokedAt === ctx.now)).toBe(true);
    const keys = await ctx.db.select().from(schema.apiKeys).where(eq(schema.apiKeys.tenantId, T));
    expect(keys.every((k) => k.revokedAt === ctx.now)).toBe(true);
    const [user] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, leaver));
    expect(user!.status).toBe("suspended");
  });

  it("reassigns open work and leaves finished work alone", async () => {
    const { leaver, successor } = await leaverFixture();
    const out = await offboardStaff(ctx, leaver, { lastDay: ctx.now, reassignTo: successor });

    expect(out.tasksReassigned).toBe(1);
    expect(out.conversationsReassigned).toBe(1);

    const tasks = await ctx.db.select().from(schema.axisTasks).where(eq(schema.axisTasks.tenantId, T));
    expect(tasks.find((t) => t.id === "tsk_open")!.assigneeRef).toBe(successor);
    expect(tasks.find((t) => t.id === "tsk_done")!.assigneeRef).toBe(leaver);

    const conversations = await ctx.db
      .select()
      .from(schema.orbitConversations)
      .where(eq(schema.orbitConversations.tenantId, T));
    expect(conversations.find((c) => c.id === "cnv_open")!.assigneeRef).toBe(successor);
    expect(conversations.find((c) => c.id === "cnv_closed")!.assigneeRef).toBe(leaver);

    expect(out.steps).toBe(5);
  });

  it("hands the leaver's approvals to the successor and ends the ones they lent out", async () => {
    const { leaver, successor } = await leaverFixture();
    const inbound = await activeDelegation({ fromUserId: "u_admin", toUserId: leaver });
    const outbound = await activeDelegation({ fromUserId: leaver, toUserId: "u_admin" });

    const out = await offboardStaff(ctx, leaver, { lastDay: ctx.now, reassignTo: successor });
    expect(out.delegationsReassigned).toBe(1);
    expect(out.delegationsRevoked).toBe(1);

    const rows = await ctx.db.select().from(schema.delegations).where(eq(schema.delegations.tenantId, T));
    expect(rows.find((r) => r.id === inbound)!.toUserId).toBe(successor);
    expect(rows.find((r) => r.id === outbound)!.status).toBe("revoked");
    // The successor delegation is what stops an approval only the leaver could
    // have decided from becoming undecidable.
    const handover = rows.find((r) => r.id === out.delegationId)!;
    expect([handover.fromUserId, handover.toUserId, handover.reason]).toEqual([leaver, successor, "offboarding"]);
  });

  it("refuses to orphan the work", async () => {
    const { leaver } = await leaverFixture();
    expect(await detailOf(() => offboardStaff(ctx, leaver, { lastDay: ctx.now, reassignTo: leaver }))).toBe(
      "cannot reassign a leaver's work to themselves"
    );
    expect(await detailOf(() => offboardStaff(ctx, leaver, { lastDay: ctx.now, reassignTo: "u_ghost" }))).toBe(
      "unknown successor"
    );
  });
});

/* ---------------------------------------------------------------- delegation */

describe("delegation grant", () => {
  beforeEach(async () => {
    await seedUser("u_from", "from@x.test", ["finance.controller"]);
    await seedUser("u_to", "to@x.test", ["axis.agent"]);
  });

  it("is approval-gated when the tenant has not auto-approved it", async () => {
    const gated: Ctx = { ...ctx, policy: PolicyJson.parse({}) };
    expect(
      await detailOf(() =>
        grantDelegation(gated, {
          fromUserId: "u_from",
          toUserId: "u_to",
          reason: "leave",
          startsAt: ctx.now,
          endsAt: ctx.now + DAY
        })
      )
    ).toBe("core.delegation_grant");

    const pending = await ctx.db.select().from(schema.approvals).where(eq(schema.approvals.tenantId, T));
    expect(pending).toHaveLength(1);
    expect(pending[0]!.policyKey).toBe("core.delegation_grant");
  });

  it("lets a decider delegate their own approvals without the admin permission", async () => {
    // `orbit.retention` can decide approvals but holds no `core:delegations:write`.
    await seedRole("self.decider", T, ["core:approvals:decide"]);
    const self = {
      ...ctx,
      actor: { kind: "user" as const, id: "u_from", tenantId: T, grants: [{ roleKey: "self.decider", permissions: ["core:approvals:decide"] }] }
    };
    const row = await grantDelegation(self, {
      toUserId: "u_to",
      reason: "leave",
      startsAt: ctx.now,
      endsAt: ctx.now + DAY
    });
    expect(row.fromUserId).toBe("u_from");
  });

  it("refuses to delegate somebody else's authority without the admin permission", async () => {
    const self = {
      ...ctx,
      actor: { kind: "user" as const, id: "u_to", tenantId: T, grants: [{ roleKey: "self.decider", permissions: ["core:approvals:decide"] }] }
    };
    expect(
      await detailOf(() =>
        grantDelegation(self, { fromUserId: "u_from", toUserId: "u_to", reason: "leave", startsAt: ctx.now, endsAt: ctx.now + DAY })
      )
    ).toBe("core:delegations:write");
  });

  it("rejects a window that has already closed, a cap with no currency and an unknown policy key", async () => {
    const base = { fromUserId: "u_from", toUserId: "u_to", reason: "leave" as const, startsAt: ctx.now };
    expect(await detailOf(() => grantDelegation(ctx, { ...base, endsAt: ctx.now - DAY }))).toBe(
      "endsAt must be after startsAt"
    );
    expect(
      await detailOf(() => grantDelegation(ctx, { ...base, endsAt: ctx.now + DAY, maxAmountMinor: 100 }))
    ).toBe("currency is required with maxAmountMinor");
    expect(
      await detailOf(() =>
        grantDelegation(ctx, { ...base, endsAt: ctx.now + DAY, scope: { policyKeys: ["ledger.not_a_policy"] } })
      )
    ).toBe("unknown approval policy: ledger.not_a_policy");
  });
});

describe("delegation resolution", () => {
  const PAYOUT = "ledger.payout"; // decided with ledger:payouts:approve

  beforeEach(async () => {
    await seedUser("u_from", "from@x.test", ["finance.controller"]);
    await seedUser("u_to", "to@x.test", ["axis.agent"]);
  });

  it("resolves an active in-scope delegation to the delegate", async () => {
    await activeDelegation();
    expect(await resolveDelegates(ctx, { policyKey: PAYOUT })).toEqual(["u_to"]);
  });

  it("never lends a permission the delegator does not hold", async () => {
    // The agent cannot approve a payout, so delegating "their approvals" hands
    // over nothing — the delegate does not inherit the *queue*, only the rights.
    await activeDelegation({ fromUserId: "u_to", toUserId: "u_from" });
    expect(await resolveDelegates(ctx, { policyKey: PAYOUT, fromUserId: "u_to" })).toEqual([]);
  });

  it("re-reads the delegator's rights, so a role change narrows the delegation", async () => {
    await activeDelegation();
    expect(await resolveDelegates(ctx, { policyKey: PAYOUT })).toEqual(["u_to"]);
    await changeRoles(ctx, "u_from", { remove: ["finance.controller"], reason: "moved off finance" });
    expect(await resolveDelegates(ctx, { policyKey: PAYOUT })).toEqual([]);
  });

  it("caps what may be decided under it", async () => {
    await activeDelegation({ maxAmountMinor: 250_000, currency: "ZAR" });
    expect(await resolveDelegates(ctx, { policyKey: PAYOUT, amountMinor: 250_000 })).toEqual(["u_to"]);
    expect(await resolveDelegates(ctx, { policyKey: PAYOUT, amountMinor: 250_001 })).toEqual([]);
  });

  it("honours a policy-key scope and a module scope", async () => {
    await activeDelegation({ scopeJson: JSON.stringify({ policyKeys: ["ledger.refund"] }) });
    expect(await resolveDelegates(ctx, { policyKey: PAYOUT })).toEqual([]);
    expect(await resolveDelegates(ctx, { policyKey: "ledger.refund" })).toEqual(["u_to"]);

    await ctx.db.delete(schema.delegations).where(eq(schema.delegations.tenantId, T));
    await activeDelegation({ scopeJson: JSON.stringify({ modules: ["axis"] }) });
    expect(await resolveDelegates(ctx, { policyKey: PAYOUT })).toEqual([]);
  });

  it("resolves nothing once revoked or expired", async () => {
    const live = await activeDelegation();
    expect(await resolveDelegates(ctx, { policyKey: PAYOUT })).toEqual(["u_to"]);
    await revokeDelegation(ctx, live, "back early");
    expect(await resolveDelegates(ctx, { policyKey: PAYOUT })).toEqual([]);

    await activeDelegation({ status: "expired" });
    expect(await resolveDelegates(ctx, { policyKey: PAYOUT })).toEqual([]);
  });

  it("resolves nothing outside the window, before the sweep has run", async () => {
    await activeDelegation({ startsAt: ctx.now - 10 * DAY, endsAt: ctx.now - DAY });
    expect(await resolveDelegates(ctx, { policyKey: PAYOUT })).toEqual([]);
    await activeDelegation({ startsAt: ctx.now + DAY, endsAt: ctx.now + 10 * DAY });
    expect(await resolveDelegates(ctx, { policyKey: PAYOUT })).toEqual([]);
  });

  it("does not chain: A→B, B→C never makes C an approver for A", async () => {
    await seedUser("u_c", "c@x.test", ["axis.agent"]);
    await activeDelegation({ fromUserId: "u_from", toUserId: "u_to" });
    await activeDelegation({ fromUserId: "u_to", toUserId: "u_c" });

    expect(await resolveDelegates(ctx, { policyKey: PAYOUT, fromUserId: "u_from" })).toEqual(["u_to"]);
    // C is only ever reachable through B's own rights, which do not include this.
    expect(await resolveDelegates(ctx, { policyKey: PAYOUT })).toEqual(["u_to"]);
  });

  it("resolves nothing for an unknown policy key", async () => {
    await activeDelegation();
    expect(await resolveDelegates(ctx, { policyKey: "not.a.policy" })).toEqual([]);
  });
});

/**
 * The point of the whole feature: the resolution above has to actually let the
 * delegate decide. A delegation that grants nothing is a lie in the UI, so each
 * refusal path is asserted through `decide()` itself, not through the resolver.
 */
describe("delegated decision", () => {
  const PAYOUT = "ledger.payout"; // decided with ledger:payouts:approve

  beforeEach(async () => {
    await seedUser("u_from", "from@x.test", ["finance.controller"]);
    await seedUser("u_to", "to@x.test", ["axis.agent"]);
  });

  /** Gate a payout as the admin, and hand back the pending approval it created. */
  async function pendingPayout(amountMinor?: number): Promise<string> {
    try {
      await gate(ctx, {
        policyKey: PAYOUT,
        subjectRef: `payouts:po_${amountMinor ?? 0}`,
        ...(amountMinor === undefined ? {} : { amountMinor })
      });
    } catch (e) {
      return (e as AppError).extras.approval_id as string;
    }
    throw new Error("a payout must never approve itself");
  }

  const delegate = () => as("u_to", "axis.agent");

  it("lets a delegate decide what they could not decide alone", async () => {
    const approvalId = await pendingPayout();
    expect(await detailOf(() => decide(delegate(), approvalId, "approved"))).toBe("ledger:payouts:approve");

    const dlg = await activeDelegation();
    const out = await decide(delegate(), approvalId, "approved");
    expect(out.decision).toBe("approved");
    expect(out.decidedBy).toBe("user:u_to");
    // The audit trail has to say whose authority was used.
    expect(out.delegationId).toBe(dlg);

    const [row] = await ctx.db.select().from(schema.approvals).where(eq(schema.approvals.id, approvalId));
    expect(row!.delegationId).toBe(dlg);
  });

  it("names no delegation when the decider held the permission themselves", async () => {
    const approvalId = await pendingPayout();
    const out = await decide(as("u_from", "finance.controller"), approvalId, "approved");
    expect(out.delegationId).toBeNull();
  });

  it("refuses above the delegation's cap", async () => {
    await activeDelegation({ maxAmountMinor: 250_000, currency: "ZAR" });
    const under = await pendingPayout(250_000);
    const over = await pendingPayout(250_001);

    expect((await decide(delegate(), under, "approved")).decision).toBe("approved");
    expect(await detailOf(() => decide(delegate(), over, "approved"))).toBe("ledger:payouts:approve");
  });

  it("refuses outside the delegation's window", async () => {
    await activeDelegation({ startsAt: ctx.now + DAY, endsAt: ctx.now + 10 * DAY });
    const approvalId = await pendingPayout();
    expect(await detailOf(() => decide(delegate(), approvalId, "approved"))).toBe("ledger:payouts:approve");
  });

  it("refuses out of scope", async () => {
    await activeDelegation({ scopeJson: JSON.stringify({ policyKeys: ["ledger.refund"] }) });
    const approvalId = await pendingPayout();
    expect(await detailOf(() => decide(delegate(), approvalId, "approved"))).toBe("ledger:payouts:approve");
  });

  it("refuses once revoked", async () => {
    const dlg = await activeDelegation();
    const approvalId = await pendingPayout();
    await revokeDelegation(ctx, dlg, "back early");
    expect(await detailOf(() => decide(delegate(), approvalId, "approved"))).toBe("ledger:payouts:approve");
  });
});

describe("delegation sweep", () => {
  beforeEach(async () => {
    await seedUser("u_from", "from@x.test", ["finance.controller"]);
    await seedUser("u_to", "to@x.test", ["axis.agent"]);
  });

  it("expires only the rows whose window has closed", async () => {
    const stale = await activeDelegation({ startsAt: ctx.now - 10 * DAY, endsAt: ctx.now - DAY });
    const live = await activeDelegation();

    expect(await expireDelegations(ctx)).toBe(1);
    const rows = await ctx.db.select().from(schema.delegations).where(eq(schema.delegations.tenantId, T));
    expect(rows.find((r) => r.id === stale)!.status).toBe("expired");
    expect(rows.find((r) => r.id === live)!.status).toBe("active");
    expect(await expireDelegations(ctx)).toBe(0);
  });

  it("refuses to revoke a delegation twice", async () => {
    const live = await activeDelegation();
    await revokeDelegation(ctx, live);
    expect(await detailOf(() => revokeDelegation(ctx, live))).toBe("delegation is revoked");
  });
});

/* ------------------------------------------------------------------ tenancy */

describe("tenancy", () => {
  beforeEach(async () => {
    await seedRole("finance.controller", OTHER);
    await seedRole("axis.agent", OTHER);
    await seedUser("u_from", "from@x.test", ["finance.controller"], OTHER);
    await seedUser("u_to", "to@x.test", ["axis.agent"], OTHER);
    await activeDelegation({ tenantId: OTHER });
  });

  it("never resolves another tenant's delegation", async () => {
    expect(await resolveDelegates(ctx, { policyKey: "ledger.payout" })).toEqual([]);
    expect(await resolveDelegates(as("u_admin", "tenant.admin", OTHER), { policyKey: "ledger.payout" })).toEqual([
      "u_to"
    ]);
  });

  it("never revokes, offboards or lists across the tenant line", async () => {
    const [foreign] = await ctx.db.select().from(schema.delegations).where(eq(schema.delegations.tenantId, OTHER));
    expect(await detailOf(() => revokeDelegation(ctx, foreign!.id))).toBe("delegation");
    expect(await detailOf(() => offboardStaff(ctx, "u_to", { lastDay: ctx.now, reassignTo: "u_from" }))).toBe("user");
    expect(await detailOf(() => changeRoles(ctx, "u_to", { add: ["axis.lead"], reason: "cross tenant" }))).toBe("user");

    await seedUser("u_local", "local@x.test", ["axis.agent"]);
    expect((await listStaff(ctx, undefined, 50)).map((u) => u.id)).toEqual(["u_admin", "u_local"]);
  });

  it("the sweep only touches its own tenant", async () => {
    await ctx.db
      .update(schema.delegations)
      .set({ endsAt: ctx.now - DAY })
      .where(eq(schema.delegations.tenantId, OTHER));
    expect(await expireDelegations(ctx)).toBe(0);
  });
});

/* ------------------------------------------------------------------- picker */

describe("assignee picker", () => {
  it("returns id and display name only, and matches on name or email", async () => {
    await seedUser("u_rania", "rania.haddad@x.test", ["axis.agent"]);
    const all = await listStaff(ctx, undefined, 50);
    expect(all).toHaveLength(2);
    expect(Object.keys(all[0] as object).sort()).toEqual(["id", "name"]);

    expect((await listStaff(ctx, "haddad", 50)).map((u) => u.id)).toEqual(["u_rania"]);
    expect((await listStaff(ctx, "rania.hadd", 50)).map((u) => u.id)).toEqual(["u_rania"]);
    // A wildcard is not a query; stripping it must not turn into "match all".
    expect(await listStaff(ctx, "%", 50)).toEqual(all);
  });
});
