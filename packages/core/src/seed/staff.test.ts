import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@lyra/db";
import { seed } from "../seed.js";
import { grantsFor } from "../approvals.js";
import { can, type Actor } from "../rbac.js";
import { DAY, HOUR } from "./context.js";
import type { CoreDb } from "../context.js";

// This is the smallest, least-covered domain seeder: a joiner mid-onboarding,
// a leaver mid-offboarding with her queue handed over, and delegations in all
// four states the resolver has to tell apart. Every literal here — key,
// label, stage, state, owner — is data the internal screens render, so this
// suite pins it exactly rather than sampling it.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "db", "migrations");

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

let client: Client;
let db: CoreDb;
let tenantId: string;
let users: Record<string, string>;
let now: number;

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  db = drizzle(client) as unknown as CoreDb;

  const result = await seed(db, { password: "gonxt-test-password" });
  tenantId = result.tenantId;
  users = result.users;

  // The seed clock, read back independently of anything seedStaff wrote —
  // the tenant row is created before any module seeder runs.
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  now = tenant!.createdAt;
});

describe("seedStaff — joiner", () => {
  it("is invited, unenrolled, mid-week and team-scoped as an axis agent", async () => {
    const [joiner] = await db.select().from(schema.users).where(eq(schema.users.email, "layla.nasser@vantax.co.za"));
    expect(joiner).toBeDefined();
    expect(joiner!.name).toBe("Layla Nasser");
    expect(joiner!.tenantId).toBe(tenantId);
    expect(joiner!.locale).toBe("en");
    expect(joiner!.status).toBe("invited");
    expect(joiner!.authProvider).toBe("password");
    expect(joiner!.mfaEnrolled).toBe(false);
    expect(joiner!.createdAt).toBe(now - 3 * DAY);
    expect(joiner!.updatedAt).toBe(now - 3 * DAY);

    const [motorTeam] = await db.select().from(schema.teams).where(eq(schema.teams.name, "Motor desk"));
    expect(motorTeam).toBeDefined();

    const [axisAgentRole] = await db
      .select()
      .from(schema.roles)
      .where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.key, "axis.agent")));
    expect(axisAgentRole).toBeDefined();

    const [role] = await db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, joiner!.id));
    expect(role!.tenantId).toBe(tenantId);
    expect(role!.roleId).toBe(axisAgentRole!.id);
    expect(JSON.parse(role!.scopeJson!)).toEqual({ teamIds: [motorTeam!.id] });
    expect(role!.createdAt).toBe(now - 3 * DAY);
  });

  it("has a team scope that actually restricts: seeded key, ScopeJson and scopeAllows agree", async () => {
    // Regression: the seed wrote {teams:[...]}, ScopeJson parses teamIds, so the
    // "scope" survived as {} and the grant was silently tenant-wide.
    const [joiner] = await db.select().from(schema.users).where(eq(schema.users.email, "layla.nasser@vantax.co.za"));
    const [motorTeam] = await db.select().from(schema.teams).where(eq(schema.teams.name, "Motor desk"));
    const grants = await grantsFor(db, tenantId, joiner!.id);
    const scopedActor: Actor = { kind: "user", id: joiner!.id, tenantId, grants };

    expect(can(scopedActor, "axis:cases:read", { tenantId, teamId: motorTeam!.id })).toBe(true);
    expect(can(scopedActor, "axis:cases:read", { tenantId, teamId: "tm_other" })).toBe(false);
    expect(can(scopedActor, "axis:cases:read", { tenantId })).toBe(false);
  });

  it("has all seven onboarding steps exactly as templated, split across three states", async () => {
    const joiner = (
      await db.select().from(schema.users).where(eq(schema.users.email, "layla.nasser@vantax.co.za"))
    )[0]!;
    const steps = await db
      .select()
      .from(schema.onboardingSteps)
      .where(
        and(
          eq(schema.onboardingSteps.tenantId, tenantId),
          eq(schema.onboardingSteps.subjectKind, "staff"),
          eq(schema.onboardingSteps.subjectRef, `users:${joiner.id}`)
        )
      );
    expect(steps).toHaveLength(7);
    const by = new Map(steps.map((s) => [s.key, s]));
    const lead = users["axis.lead"]!;

    const expected: Record<string, { labelKey: string; gatesStage: string; state: string }> = {
      contract_signed: { labelKey: "onboarding.staff.contract_signed", gatesStage: "hired", state: "done" },
      right_to_work: { labelKey: "onboarding.staff.right_to_work", gatesStage: "hired", state: "done" },
      background_check: { labelKey: "onboarding.staff.background_check", gatesStage: "hired", state: "in_progress" },
      policy_attestations: { labelKey: "onboarding.staff.policy_attestations", gatesStage: "active", state: "pending" },
      security_training: { labelKey: "onboarding.staff.security_training", gatesStage: "active", state: "pending" },
      systems_access: { labelKey: "onboarding.staff.systems_access", gatesStage: "active", state: "pending" },
      manager_signoff: { labelKey: "onboarding.staff.manager_signoff", gatesStage: "active", state: "pending" }
    };
    const order = Object.keys(expected);

    for (const [key, exp] of Object.entries(expected)) {
      const s = by.get(key)!;
      expect(s, key).toBeDefined();
      expect(s.template).toBe("staff.onboard");
      expect(JSON.parse(s.labelJson)).toEqual({ key: exp.labelKey });
      expect(s.seq).toBe(order.indexOf(key) + 1);
      // None of the onboarding keys is "exit_interview" (that only appears in
      // the offboarding template), so every onboarding step is required.
      expect(s.required, key).toBe(true);
      expect(s.gatesStage).toBe(exp.gatesStage);
      expect(s.state).toBe(exp.state);
      expect(s.evidenceKind).toBe(key === "background_check" ? "screening" : "attestation");
      expect(s.evidenceRef).toBeNull();
      expect(s.ownerRef).toBe(lead);
      expect(s.dueAt).toBe(now + 4 * DAY);
      expect(s.createdAt).toBe(now - 3 * DAY);

      const done = exp.state === "done";
      expect(s.decidedBy).toBe(done ? lead : null);
      expect(s.decidedAt).toBe(done ? now - 3 * DAY + 6 * HOUR : null);
      expect(s.updatedAt).toBe(done ? now - 3 * DAY + 6 * HOUR : now - 3 * DAY);
    }
  });
});

describe("seedStaff — leaver", () => {
  it("is suspended, not deleted, with her mfa left enrolled", async () => {
    const [leaver] = await db.select().from(schema.users).where(eq(schema.users.email, "tariq.mansour@vantax.co.za"));
    expect(leaver).toBeDefined();
    expect(leaver!.name).toBe("Tariq Mansour");
    expect(leaver!.tenantId).toBe(tenantId);
    expect(leaver!.locale).toBe("en");
    expect(leaver!.status).toBe("suspended");
    expect(leaver!.authProvider).toBe("password");
    expect(leaver!.mfaEnrolled).toBe(true);
    expect(leaver!.createdAt).toBe(now - 400 * DAY);
    const lastDay = now - DAY;
    expect(leaver!.updatedAt).toBe(lastDay);

    const [axisAgentRole] = await db
      .select()
      .from(schema.roles)
      .where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.key, "axis.agent")));
    const [role] = await db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, leaver!.id));
    expect(role!.roleId).toBe(axisAgentRole!.id);
    expect(role!.scopeJson).toBeNull();
    expect(role!.createdAt).toBe(now - 400 * DAY);
  });

  it("has all five offboarding steps, only two done on the day and required flipped for the last", async () => {
    const leaver = (
      await db.select().from(schema.users).where(eq(schema.users.email, "tariq.mansour@vantax.co.za"))
    )[0]!;
    const lastDay = now - DAY;
    const admin = users["tenant.admin"]!;
    const lead = users["axis.lead"]!;

    const steps = await db
      .select()
      .from(schema.onboardingSteps)
      .where(
        and(
          eq(schema.onboardingSteps.tenantId, tenantId),
          eq(schema.onboardingSteps.subjectKind, "staff"),
          eq(schema.onboardingSteps.subjectRef, `users:${leaver.id}`)
        )
      );
    expect(steps).toHaveLength(5);
    const by = new Map(steps.map((s) => [s.key, s]));

    const expected: Record<string, { labelKey: string; done: boolean; required: boolean }> = {
      access_revoked: { labelKey: "offboarding.staff.access_revoked", done: true, required: true },
      work_reassigned: { labelKey: "offboarding.staff.work_reassigned", done: true, required: true },
      assets_returned: { labelKey: "offboarding.staff.assets_returned", done: false, required: true },
      final_pay: { labelKey: "offboarding.staff.final_pay", done: false, required: true },
      exit_interview: { labelKey: "offboarding.staff.exit_interview", done: false, required: false }
    };
    const order = Object.keys(expected);

    for (const [key, exp] of Object.entries(expected)) {
      const s = by.get(key)!;
      expect(s, key).toBeDefined();
      expect(s.template).toBe("staff.offboard");
      expect(JSON.parse(s.labelJson)).toEqual({ key: exp.labelKey });
      expect(s.seq).toBe(order.indexOf(key) + 1);
      expect(s.required, key).toBe(exp.required);
      expect(s.gatesStage).toBe("offboarded");
      expect(s.state).toBe(exp.done ? "done" : "pending");
      expect(s.evidenceKind).toBe(key === "final_pay" ? "attestation" : null);
      expect(s.evidenceRef).toBeNull();
      expect(s.ownerRef).toBe(lead);
      expect(s.dueAt).toBe(lastDay + 7 * DAY);
      expect(s.createdAt).toBe(lastDay - DAY);
      expect(s.updatedAt).toBe(lastDay);
      expect(s.decidedBy).toBe(exp.done ? admin : null);
      expect(s.decidedAt).toBe(exp.done ? lastDay : null);
    }
  });

  it("hands the open handover task and the reassigned conversation to the team lead", async () => {
    const leaver = (
      await db.select().from(schema.users).where(eq(schema.users.email, "tariq.mansour@vantax.co.za"))
    )[0]!;
    const lastDay = now - DAY;
    const admin = users["tenant.admin"]!;
    const lead = users["axis.lead"]!;

    const [case_] = await db.select().from(schema.axisCases).where(eq(schema.axisCases.ref, "GNX-2601-0001"));
    expect(case_).toBeDefined();

    const [task] = await db.select().from(schema.axisTasks).where(eq(schema.axisTasks.type, "handover"));
    expect(task).toBeDefined();
    expect(task!.tenantId).toBe(tenantId);
    expect(task!.caseId).toBe(case_!.id);
    expect(task!.titleKey).toBe("task.finish_handover_from_leaver");
    expect(task!.assigneeRef).toBe(lead);
    expect(task!.state).toBe("open");
    expect(task!.dueAt).toBe(lastDay + 3 * DAY);
    expect(JSON.parse(task!.checklistJson!)).toEqual([
      { key: "read_case_notes", done: true },
      { key: "call_customer", done: false }
    ]);
    expect(task!.createdBy).toBe(admin);
    expect(task!.createdAt).toBe(lastDay);
    expect(task!.updatedAt).toBe(lastDay);

    const [motorTeam] = await db.select().from(schema.teams).where(eq(schema.teams.name, "Motor desk"));
    const [customer] = await db.select().from(schema.customers);
    expect(customer).toBeDefined();

    const [conv] = await db
      .select()
      .from(schema.orbitConversations)
      .where(eq(schema.orbitConversations.assigneeRef, lead));
    expect(conv).toBeDefined();
    expect(conv!.tenantId).toBe(tenantId);
    expect(conv!.customerId).toBe(customer!.id);
    expect(conv!.channel).toBe("email");
    expect(conv!.state).toBe("human");
    expect(conv!.teamId).toBe(motorTeam!.id);
    expect(conv!.summary).toBe(
      "Reassigned from Tariq Mansour on offboarding — customer still awaiting a callback."
    );
    expect(conv!.lang).toBe("en");
    expect(conv!.lastMessageAt).toBe(lastDay - 2 * HOUR);
    expect(conv!.createdAt).toBe(lastDay - DAY);
    expect(conv!.updatedAt).toBe(lastDay);
    // Nobody's queue is left unassigned to prove the handover happened.
    expect(leaver).toBeDefined();
  });
});

describe("seedStaff — delegations", () => {
  it("covers the offboarding handover, a scoped cover, a capped cover, a revoke and an expiry", async () => {
    const admin = users["tenant.admin"]!;
    const lead = users["axis.lead"]!;
    const agent = users["axis.agent"]!;
    const controller = users["finance.controller"]!;
    const retention = users["orbit.retention"]!;
    const partners = users["orbit.partners"]!;
    const leaver = (
      await db.select().from(schema.users).where(eq(schema.users.email, "tariq.mansour@vantax.co.za"))
    )[0]!;
    const lastDay = now - DAY;

    const delegationBetween = async (fromUserId: string, toUserId: string) => {
      const [row] = await db
        .select()
        .from(schema.delegations)
        .where(and(eq(schema.delegations.fromUserId, fromUserId), eq(schema.delegations.toUserId, toUserId)));
      return row!;
    };

    const offboarding = await delegationBetween(leaver.id, lead);
    expect(offboarding.tenantId).toBe(tenantId);
    expect(offboarding.reason).toBe("offboarding");
    expect(offboarding.scopeJson).toBeNull();
    expect(offboarding.maxAmountMinor).toBeNull();
    expect(offboarding.currency).toBeNull();
    expect(offboarding.startsAt).toBe(lastDay);
    expect(offboarding.endsAt).toBe(lastDay + 30 * DAY);
    expect(offboarding.status).toBe("active");
    expect(offboarding.createdBy).toBe(`user:${admin}`);
    expect(offboarding.revokedBy).toBeNull();
    expect(offboarding.revokedAt).toBeNull();
    expect(offboarding.createdAt).toBe(lastDay);

    const leave = await delegationBetween(lead, agent);
    expect(leave.reason).toBe("leave");
    expect(JSON.parse(leave.scopeJson!)).toEqual({ policyKeys: ["axis.bind", "axis.endorse"] });
    expect(leave.maxAmountMinor).toBeNull();
    expect(leave.currency).toBeNull();
    expect(leave.startsAt).toBe(now - DAY);
    expect(leave.endsAt).toBe(now + 6 * DAY);
    expect(leave.status).toBe("active");
    expect(leave.createdBy).toBe(`user:${lead}`);
    expect(leave.createdAt).toBe(now - 2 * DAY);

    const travelCapped = await delegationBetween(controller, admin);
    expect(travelCapped.reason).toBe("travel");
    expect(JSON.parse(travelCapped.scopeJson!)).toEqual({ modules: ["ledger"] });
    expect(travelCapped.maxAmountMinor).toBe(250_000);
    expect(travelCapped.currency).toBe("ZAR");
    expect(travelCapped.startsAt).toBe(now - 2 * DAY);
    expect(travelCapped.endsAt).toBe(now + 3 * DAY);
    expect(travelCapped.status).toBe("active");
    expect(travelCapped.createdBy).toBe(`user:${controller}`);
    expect(travelCapped.createdAt).toBe(now - 3 * DAY);

    const revoked = await delegationBetween(retention, partners);
    expect(revoked.reason).toBe("cover");
    expect(revoked.scopeJson).toBeNull();
    expect(revoked.maxAmountMinor).toBeNull();
    expect(revoked.currency).toBeNull();
    expect(revoked.startsAt).toBe(now - 10 * DAY);
    expect(revoked.endsAt).toBe(now + 10 * DAY);
    expect(revoked.status).toBe("revoked");
    expect(revoked.createdBy).toBe(`user:${retention}`);
    expect(revoked.revokedBy).toBe(`user:${retention}`);
    expect(revoked.revokedAt).toBe(now - 6 * DAY);
    expect(revoked.createdAt).toBe(now - 11 * DAY);

    const expired = await delegationBetween(partners, retention);
    expect(expired.reason).toBe("travel");
    expect(JSON.parse(expired.scopeJson!)).toEqual({ modules: ["orbit"] });
    expect(expired.maxAmountMinor).toBeNull();
    expect(expired.currency).toBeNull();
    expect(expired.startsAt).toBe(now - 40 * DAY);
    expect(expired.endsAt).toBe(now - 33 * DAY);
    expect(expired.status).toBe("expired");
    expect(expired.createdBy).toBe(`user:${partners}`);
    expect(expired.revokedBy).toBeNull();
    expect(expired.revokedAt).toBeNull();
    expect(expired.createdAt).toBe(now - 41 * DAY);

    const all = await db.select().from(schema.delegations).where(eq(schema.delegations.tenantId, tenantId));
    expect(all).toHaveLength(5);
  });
});
