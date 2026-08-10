# ORBIT Routing/Queueing Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ORBIT conversations a real team/assignee, so the console and supervisor-wall screens (which already render `teamId`/`assigneeRef`) stop showing empty fields, and SLA breaches get detected and escalated automatically.

**Architecture:** A new pure-function core (`pickRoute`, `pickAssignee`) decides team and agent from routing rules, team membership and live presence; a thin I/O wrapper (`routeConversation`) reads the DB, calls the pure functions, and stamps the conversation row; a cron-driven sweep (`sweepRouting`) re-routes conversations whose SLA clock has run out or whose assigned agent has gone quiet. `routeConversation` is called once, synchronously, right after a new conversation row is inserted in the inbound webhook path (`orbit-channel-inbound.ts`) — there is no bot→human handover function in this codebase to hook into instead (confirmed by direct search: no `state: "human"` transition exists anywhere in production code), so conversation-creation time is the only correct hook point today.

**Tech Stack:** Drizzle ORM (SQLite dialect, D1 + libSQL), Hono routes, Vitest + `@libsql/client` in-memory migration replay for tests, `@lyra/core`'s `scoped()`/`emit()`/`Ctx`.

## Global Constraints

- Every new table has `tenant_id`; every query against it goes through `scoped(ctx, table, ...)` from `@lyra/core` — no hand-built `and(eq(table.tenantId, ctx.tenantId))` (CLAUDE.md rule 1).
- Migrations are forward-only, generated via `pnpm --filter @lyra/db generate` — never hand-author or edit an applied migration file (CLAUDE.md rule 9).
- Routing/assignment is an operational action, not `consequential: true` — no approval gate (CLAUDE.md rule 4; pricing/claims/payment/outbound-send are the consequential list, routing is none of those).
- State changes go through the event bus: `emit(ctx, { module: "orbit", type, subject, data })`, never a direct cross-module call (CLAUDE.md rule 6).
- Every new `/v1` route must appear in `apps/api/src/openapi.ts` — `apps/api/src/routes/*.test.ts`'s router-walk test treats an undocumented route as a failure.
- No third-party service additions (CLAUDE.md rule 2 in Guardrails) — this plan touches only `packages/db`, `apps/api`, and `@lyra/core`.
- Out of scope for this plan, by design: no generic CRUD routes/resources for the five new tables (`orbit_teams`, `orbit_team_members`, `orbit_agent_presence`, `orbit_routing_rules`, `orbit_sla_policies`) — they are engine-managed for now, not exposed for tenant self-service until a future admin-console milestone. No bot→human handover flow — that remains a separate, future piece of work; this plan only makes sure routing data exists once a conversation is created.

---

## File Structure

- `packages/db/src/schema/orbit.ts` — modify: extend `conversations` with SLA/queue columns + a queue index; add five new tables (`teams`, `teamMembers`, `agentPresence`, `routingRules`, `slaPolicies`).
- `packages/db/src/schema.ts` — modify: barrel-export the five new tables (aliased, since `teams` collides with `core.ts`'s AXIS-internal `teams`).
- `packages/db/migrations/` — new auto-generated migration (via drizzle-kit, do not hand-name).
- `packages/db/src/indexes.test.ts` — modify: add uniqueness/default-value assertions for the new tables/columns.
- `apps/api/src/engines/orbit-routing.ts` — new: `pickRoute`, `pickAssignee`, `routeConversation`, `sweepRouting`, `PRESENCE_STALE_MS`.
- `apps/api/src/engines/orbit-routing.test.ts` — new: unit tests for all four functions.
- `apps/api/src/engines/orbit-channel-inbound.ts` — modify: call `routeConversation` right after a new conversation is inserted.
- `apps/api/src/engines/orbit-channel-inbound.test.ts` — modify: two new tests for the routing hook.
- `apps/api/src/routes/orbit.ts` — modify: add `POST /routing/sweep`.
- `apps/api/src/openapi.ts` — modify: document the new route.
- `apps/api/src/index.ts` — modify: wire `sweepRouting` into the cron `scheduled()` handler.

---

### Task 1: Schema — teams, presence, routing rules, SLA policies, conversation queue columns

**Files:**
- Modify: `packages/db/src/schema/orbit.ts:5-34` (conversations table), end of file (new tables)
- Modify: `packages/db/src/schema.ts:78-90` (orbit export block)
- Create: a new file under `packages/db/migrations/` (via `drizzle-kit generate` — do not hand-name)
- Modify: `packages/db/src/indexes.test.ts`

**Interfaces:**
- Produces: `schema.orbitConversations` gains columns `priority` (int, default 2), `slaPolicyKey` (text, nullable), `requireSkillsJson` (text, nullable), `queuedAt`/`assignedAt`/`firstResponseDueAt`/`resolutionDueAt`/`frtBreachedAt`/`resolutionBreachedAt` (int, nullable), `reopenCount` (int, default 0).
- Produces: `schema.orbitTeams` (`id`, `tenantId`, `key`, `nameJson`, `isDefault`, `status`, `createdAt`, `updatedAt`), `schema.orbitTeamMembers` (`id`, `tenantId`, `teamId`, `userId`, `skillsJson`, `maxConcurrent`, `createdAt`), `schema.orbitAgentPresence` (`id`, `tenantId`, `userId`, `status`, `activeCount`, `updatedAt`), `schema.orbitRoutingRules` (`id`, `tenantId`, `teamId`, `seq`, `enabled`, `conditionsJson`, `createdAt`, `updatedAt`), `schema.orbitSlaPolicies` (`id`, `tenantId`, `key`, `frtMinutes`, `resolutionMinutes`, `createdAt`, `updatedAt`).
- Produces: id prefixes `otm` (teams — `tm` is already used by `packages/core/src/seed.ts` for AXIS's internal insurance-line teams), `tmm` (team members), `ap` (agent presence), `rr` (routing rules), `slp` (SLA policies).

- [ ] **Step 1: Extend the conversations table and add its queue index**

In `packages/db/src/schema/orbit.ts`, replace the `conversations` table definition (lines 5-34):

```ts
export const conversations = sqliteTable(
  "orbit_conversations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    customerId: text("customer_id"),
    channel: text("channel").notNull(), // whatsapp|web|voice|email|agent (H1 reserved)
    externalRef: text("external_ref"), // wa id, thread id
    connectorId: text("connector_id"), // orbit_channel_connectors.id (null for internally-raised conversations)
    doId: text("do_id"), // UserChannel Durable Object
    state: text("state").notNull().default("bot"), // bot|human|closed
    assigneeRef: text("assignee_ref"),
    teamId: text("team_id"),
    csat: integer("csat"),
    summary: text("summary"),
    lang: text("lang").notNull().default("en"),
    intent: text("intent"),
    sentiment: integer("sentiment"), // -100..100
    firstResponseMs: integer("first_response_ms"),
    lastMessageAt: integer("last_message_at"),
    closedAt: integer("closed_at"),
    // Routing/SLA (gap-orbit-design.md §1B). Lower priority number = more
    // urgent; 2 is the unrouted/default level, sweepRouting only ever moves
    // it down (toward 0) on an FRT breach, never up.
    priority: integer("priority").notNull().default(2),
    slaPolicyKey: text("sla_policy_key"),
    requireSkillsJson: text("require_skills_json"), // JSON string[]; null = no skill requirement
    queuedAt: integer("queued_at"),
    assignedAt: integer("assigned_at"),
    firstResponseDueAt: integer("first_response_due_at"),
    resolutionDueAt: integer("resolution_due_at"),
    frtBreachedAt: integer("frt_breached_at"),
    resolutionBreachedAt: integer("resolution_breached_at"),
    reopenCount: integer("reopen_count").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [
    index("orbit_conv_tenant_idx").on(t.tenantId, t.state, t.lastMessageAt),
    index("orbit_conv_customer_idx").on(t.tenantId, t.customerId),
    index("orbit_conv_assignee_idx").on(t.tenantId, t.assigneeRef, t.state),
    // The sweep's own read pattern: "give me this team's open queue, most
    // urgent and longest-waiting first."
    index("orbit_conv_queue_idx").on(t.tenantId, t.teamId, t.state, t.priority, t.queuedAt)
  ]
);
```

- [ ] **Step 2: Add the five new tables**

Append to the end of `packages/db/src/schema/orbit.ts` (after `qaScores`):

```ts
/**
 * A routable unit of agents. `isDefault` marks the team new conversations
 * fall into when no routing rule matches — at most one per tenant, enforced
 * in `routeConversation`/application code, not the schema (SQLite has no
 * partial-unique-boolean shorthand worth reaching for here).
 */
export const teams = sqliteTable(
  "orbit_teams",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    key: text("key").notNull(),
    nameJson: text("name_json").notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    status: text("status").notNull().default("active"), // active|disabled
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [uniqueIndex("orbit_teams_key_uq").on(t.tenantId, t.key)]
);

export const teamMembers = sqliteTable(
  "orbit_team_members",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    teamId: text("team_id").notNull(),
    userId: text("user_id").notNull(),
    skillsJson: text("skills_json").notNull().default("[]"), // JSON string[]
    maxConcurrent: integer("max_concurrent").notNull().default(5),
    createdAt: integer("created_at").notNull()
  },
  (t) => [
    uniqueIndex("orbit_team_members_uq").on(t.tenantId, t.teamId, t.userId),
    index("orbit_team_members_user_idx").on(t.tenantId, t.userId)
  ]
);

/** One row per agent per tenant — an agent has one presence, regardless of how many teams they're on. */
export const agentPresence = sqliteTable(
  "orbit_agent_presence",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    userId: text("user_id").notNull(),
    status: text("status").notNull().default("offline"), // available|away|offline
    activeCount: integer("active_count").notNull().default(0),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [uniqueIndex("orbit_agent_presence_uq").on(t.tenantId, t.userId)]
);

/**
 * First-matching-rule-wins, ordered by `seq` ascending. `conditionsJson` is
 * `{ channel?, intent?, sentimentBelow? }` — an omitted field is a wildcard.
 */
export const routingRules = sqliteTable(
  "orbit_routing_rules",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    teamId: text("team_id").notNull(),
    seq: integer("seq").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    conditionsJson: text("conditions_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [uniqueIndex("orbit_routing_rules_seq_uq").on(t.tenantId, t.seq)]
);

export const slaPolicies = sqliteTable(
  "orbit_sla_policies",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    key: text("key").notNull(),
    frtMinutes: integer("frt_minutes").notNull(),
    resolutionMinutes: integer("resolution_minutes").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [uniqueIndex("orbit_sla_policies_key_uq").on(t.tenantId, t.key)]
);
```

- [ ] **Step 3: Barrel-export the new tables**

In `packages/db/src/schema.ts`, replace the orbit export block (lines 78-90):

```ts
export {
  conversations as orbitConversations,
  messages as orbitMessages,
  renewals as orbitRenewals,
  journeys as orbitJourneys,
  journeyRuns as orbitJourneyRuns,
  partners as orbitPartners,
  partnerTxns as orbitPartnerTxns,
  handoverNotes as orbitHandoverNotes,
  qaScores as orbitQaScores,
  channelConnectors as orbitChannelConnectors,
  channelIdentities as orbitChannelIdentities,
  teams as orbitTeams,
  teamMembers as orbitTeamMembers,
  agentPresence as orbitAgentPresence,
  routingRules as orbitRoutingRules,
  slaPolicies as orbitSlaPolicies
} from "./schema/orbit.js";
```

(`teams` bare is already taken by `core.ts`'s AXIS-internal teams table at line 11 of the same file — the alias avoids that collision.)

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @lyra/db generate`
Expected: a new file appears under `packages/db/migrations/` (e.g. `0021_<generated-name>.sql`) containing `ALTER TABLE orbit_conversations ADD COLUMN ...` statements and `CREATE TABLE orbit_teams (...)` etc., plus a matching `meta/_journal.json` entry. Do not hand-edit the generated file's SQL; if drizzle-kit prompts for a rename/recreate decision, answer "create column" / "create table" (these are new columns/tables, not renames).

- [ ] **Step 5: Add schema invariant tests**

In `packages/db/src/indexes.test.ts`, add inside the existing `describe("uniqueness constraints survive the migrated schema", ...)` block (after the outbox test, before the closing `});` at line 104):

```ts
  it("a tenant cannot register two routing rules at the same seq, but two tenants can reuse the same seq", async () => {
    const rule = (id: string, tenant: string, seq: number) =>
      db.execute({
        sql: "INSERT INTO orbit_routing_rules (id, tenant_id, team_id, seq, created_at, updated_at) VALUES (?, ?, 'tm1', ?, 1, 1)",
        args: [id, tenant, seq]
      });
    await rule("rr1", "t1", 10);
    await rule("rr2", "t2", 10); // different tenant, same seq: fine
    await expect(rule("rr3", "t1", 10)).rejects.toThrow(/UNIQUE/i);
  });

  it("a new conversation defaults to priority 2 with no SLA clock set", async () => {
    await db.execute({
      sql: "INSERT INTO orbit_conversations (id, tenant_id, channel, created_at, updated_at) VALUES ('cnv1', 't1', 'web', 1, 1)",
      args: []
    });
    const row = (await db.execute("SELECT priority, first_response_due_at, reopen_count FROM orbit_conversations WHERE id = 'cnv1'")).rows[0]!;
    expect(row.priority).toBe(2);
    expect(row.first_response_due_at).toBeNull();
    expect(row.reopen_count).toBe(0);
  });

  it("one tenant cannot register the same team key or agent presence row twice", async () => {
    const team = (id: string, key: string) =>
      db.execute({
        sql: "INSERT INTO orbit_teams (id, tenant_id, key, name_json, created_at, updated_at) VALUES (?, 't1', ?, '{}', 1, 1)",
        args: [id, key]
      });
    await team("otm1", "default");
    await expect(team("otm2", "default")).rejects.toThrow(/UNIQUE/i);

    const presence = (id: string, userId: string) =>
      db.execute({
        sql: "INSERT INTO orbit_agent_presence (id, tenant_id, user_id, updated_at) VALUES (?, 't1', ?, 1)",
        args: [id, userId]
      });
    await presence("ap1", "u1");
    await expect(presence("ap2", "u1")).rejects.toThrow(/UNIQUE/i);
  });
```

- [ ] **Step 6: Run the schema tests**

Run: `pnpm --filter @lyra/db test`
Expected: PASS, including the three new tests above.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/orbit.ts packages/db/src/schema.ts packages/db/migrations packages/db/src/indexes.test.ts
git commit -m "feat(db): add ORBIT routing schema — teams, presence, routing rules, SLA policies"
```

---

### Task 2: `pickRoute` and `pickAssignee` — pure decision functions

**Files:**
- Create: `apps/api/src/engines/orbit-routing.ts`
- Create: `apps/api/src/engines/orbit-routing.test.ts`

**Interfaces:**
- Consumes: nothing outside this task (pure functions, no DB).
- Produces: `RoutingConditions` type, `RoutingRuleInput` type, `pickRoute(rules: RoutingRuleInput[], input: { channel: string; intent: string | null; sentiment: number | null }): string | null`; `TeamMemberInput` type, `PresenceInput` type, `pickAssignee(members: TeamMemberInput[], presence: Map<string, PresenceInput>, requireSkills: string[]): string | null`. Both are consumed by Task 3's `routeConversation`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/engines/orbit-routing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pickAssignee, pickRoute } from "./orbit-routing.js";

describe("pickRoute", () => {
  const rule = (seq: number, teamId: string, conditions: object, enabled = true) => ({
    seq,
    teamId,
    enabled,
    conditionsJson: JSON.stringify(conditions)
  });

  it("picks the first matching rule by seq, not insertion order", () => {
    const rules = [rule(2, "team_b", { channel: "whatsapp" }), rule(1, "team_a", { channel: "whatsapp" })];
    expect(pickRoute(rules, { channel: "whatsapp", intent: null, sentiment: null })).toBe("team_a");
  });

  it("skips a disabled rule even when it would otherwise match", () => {
    const rules = [rule(1, "team_a", { channel: "whatsapp" }, false), rule(2, "team_b", { channel: "whatsapp" })];
    expect(pickRoute(rules, { channel: "whatsapp", intent: null, sentiment: null })).toBe("team_b");
  });

  it("matches on a sentiment-below threshold", () => {
    const rules = [rule(1, "escalation", { sentimentBelow: -20 })];
    expect(pickRoute(rules, { channel: "whatsapp", intent: null, sentiment: -50 })).toBe("escalation");
    expect(pickRoute(rules, { channel: "whatsapp", intent: null, sentiment: -10 })).toBeNull();
    expect(pickRoute(rules, { channel: "whatsapp", intent: null, sentiment: null })).toBeNull();
  });

  it("requires every present condition to match, treating an omitted field as a wildcard", () => {
    const rules = [rule(1, "claims_team", { channel: "whatsapp", intent: "claim" })];
    expect(pickRoute(rules, { channel: "whatsapp", intent: "claim", sentiment: null })).toBe("claims_team");
    expect(pickRoute(rules, { channel: "email", intent: "claim", sentiment: null })).toBeNull();
  });

  it("returns null when no rule matches, leaving fallback-to-default-team to the caller", () => {
    expect(pickRoute([], { channel: "whatsapp", intent: null, sentiment: null })).toBeNull();
  });
});

describe("pickAssignee", () => {
  const member = (userId: string, skills: string[] = [], maxConcurrent = 3) => ({
    userId,
    skillsJson: JSON.stringify(skills),
    maxConcurrent
  });
  const available = (activeCount: number, updatedAt: number) => ({ status: "available" as const, activeCount, updatedAt });

  it("excludes an agent already at their concurrency ceiling", () => {
    const members = [member("u1", [], 1), member("u2", [], 3)];
    const presence = new Map([
      ["u1", available(1, 100)],
      ["u2", available(0, 100)]
    ]);
    expect(pickAssignee(members, presence, [])).toBe("u2");
  });

  it("excludes an agent missing a required skill", () => {
    const members = [member("u1", ["motor"]), member("u2", ["claims"])];
    const presence = new Map([
      ["u1", available(0, 100)],
      ["u2", available(0, 100)]
    ]);
    expect(pickAssignee(members, presence, ["claims"])).toBe("u2");
  });

  it("picks the least-loaded agent, then the longest-idle, then the lowest userId", () => {
    const members = [member("u1"), member("u2"), member("u3")];
    const presence = new Map([
      ["u1", available(2, 100)],
      ["u2", available(0, 200)], // fewest active (0), wins outright
      ["u3", available(1, 150)]
    ]);
    expect(pickAssignee(members, presence, [])).toBe("u2"); // fewest active

    const tiedLoad = new Map([
      ["u1", available(0, 200)], // idle since 200 (more recently active)
      ["u2", available(0, 100)], // idle since 100 (longest idle) -> wins
      ["u3", available(0, 100)] // tied idle time with u2 -> userId tiebreak, but u2 < u3
    ]);
    expect(pickAssignee(members, tiedLoad, [])).toBe("u2");
  });

  it("returns null when nobody is available", () => {
    const members = [member("u1")];
    const presence = new Map([["u1", { status: "away" as const, activeCount: 0, updatedAt: 100 }]]);
    expect(pickAssignee(members, presence, [])).toBeNull();
  });

  it("returns null when a member has no presence row at all", () => {
    const members = [member("u1")];
    expect(pickAssignee(members, new Map(), [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @lyra/api exec vitest run src/engines/orbit-routing.test.ts`
Expected: FAIL with `Cannot find module './orbit-routing.js'`

- [ ] **Step 3: Implement `pickRoute` and `pickAssignee`**

Create `apps/api/src/engines/orbit-routing.ts`:

```ts
// gap-orbit-design.md §1B — routing/queueing engine. pickRoute and pickAssignee
// are pure: no DB, no clock, so every branch is a table-driven unit test.
// routeConversation and sweepRouting (below, once added) are the only I/O.

export interface RoutingConditions {
  readonly channel?: string;
  readonly intent?: string;
  readonly sentimentBelow?: number;
}

export interface RoutingRuleInput {
  readonly seq: number;
  readonly teamId: string;
  readonly enabled: boolean;
  readonly conditionsJson: string;
}

export interface RouteInput {
  readonly channel: string;
  readonly intent: string | null;
  readonly sentiment: number | null;
}

function matches(conditions: RoutingConditions, input: RouteInput): boolean {
  if (conditions.channel !== undefined && conditions.channel !== input.channel) return false;
  if (conditions.intent !== undefined && conditions.intent !== input.intent) return false;
  if (conditions.sentimentBelow !== undefined) {
    if (input.sentiment === null || input.sentiment >= conditions.sentimentBelow) return false;
  }
  return true;
}

/** First enabled rule (by `seq` ascending) whose conditions all match wins. Null = no rule matched; caller falls back to the tenant's default team. */
export function pickRoute(rules: readonly RoutingRuleInput[], input: RouteInput): string | null {
  const sorted = [...rules].filter((r) => r.enabled).sort((a, b) => a.seq - b.seq);
  for (const rule of sorted) {
    if (matches(JSON.parse(rule.conditionsJson) as RoutingConditions, input)) return rule.teamId;
  }
  return null;
}

export interface TeamMemberInput {
  readonly userId: string;
  readonly skillsJson: string;
  readonly maxConcurrent: number;
}

export interface PresenceInput {
  readonly status: "available" | "away" | "offline";
  readonly activeCount: number;
  readonly updatedAt: number;
}

/** Least-loaded, then longest-idle, then lowest userId (stable tiebreak). Null = nobody eligible. */
export function pickAssignee(
  members: readonly TeamMemberInput[],
  presence: ReadonlyMap<string, PresenceInput>,
  requireSkills: readonly string[]
): string | null {
  const eligible = members
    .map((m) => ({ member: m, presence: presence.get(m.userId) }))
    .filter((x): x is { member: TeamMemberInput; presence: PresenceInput } => {
      if (!x.presence || x.presence.status !== "available") return false;
      if (x.presence.activeCount >= x.member.maxConcurrent) return false;
      const skills = JSON.parse(x.member.skillsJson) as string[];
      return requireSkills.every((s) => skills.includes(s));
    });
  if (!eligible.length) return null;
  eligible.sort((a, b) => {
    if (a.presence.activeCount !== b.presence.activeCount) return a.presence.activeCount - b.presence.activeCount;
    if (a.presence.updatedAt !== b.presence.updatedAt) return a.presence.updatedAt - b.presence.updatedAt;
    return a.member.userId < b.member.userId ? -1 : 1;
  });
  return eligible[0]!.member.userId;
}

/** An agent idle longer than this (no presence heartbeat) is treated as gone: sweepRouting reassigns their open conversations. */
export const PRESENCE_STALE_MS = 15 * 60_000;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lyra/api exec vitest run src/engines/orbit-routing.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/engines/orbit-routing.ts apps/api/src/engines/orbit-routing.test.ts
git commit -m "feat(orbit): add pickRoute/pickAssignee pure routing functions"
```

---

### Task 3: `routeConversation` — stamp team, assignee and SLA clock on a conversation

**Files:**
- Modify: `apps/api/src/engines/orbit-routing.ts` (append)
- Modify: `apps/api/src/engines/orbit-routing.test.ts` (append)

**Interfaces:**
- Consumes: `pickRoute`, `pickAssignee`, `RouteInput` from Task 2; `Ctx`, `scoped` from `@lyra/core`; `schema`, `id` from `@lyra/db`.
- Produces: `routeConversation(ctx: Ctx, conversationId: string): Promise<{ teamId: string | null; assigneeRef: string | null }>`, consumed by Task 5 (inbound wiring) and Task 4 (re-routing inside `sweepRouting`).

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/engines/orbit-routing.test.ts` (new imports at top, new `describe` block at bottom):

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { schema } from "@lyra/db";
import type { Ctx } from "@lyra/core";
import { PolicyJson, EntitlementsJson } from "@lyra/db";
import { routeConversation } from "./orbit-routing.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "..", "packages", "db", "migrations");
const tenantId = "t_1";
const now = 1_700_000_000_000;

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("routeConversation", () => {
  let client: Client;
  let ctx: Ctx;

  beforeEach(async () => {
    client = createClient({ url: ":memory:" });
    for (const sql of statements()) await client.execute(sql);
    const db = drizzle(client) as unknown as Ctx["db"];
    ctx = {
      db,
      tenantId,
      actor: { kind: "system", id: "test", tenantId, grants: [] },
      requestId: "req_1",
      now,
      locale: "en",
      policy: PolicyJson.parse({}),
      entitlements: EntitlementsJson.parse({})
    };
    await db.insert(schema.orbitConversations).values({
      id: "cnv_1",
      tenantId,
      channel: "whatsapp",
      state: "bot",
      createdAt: now,
      updatedAt: now
    });
  });

  it("routes to the default team and assigns the least-loaded available agent", async () => {
    await ctx.db.insert(schema.orbitTeams).values({
      id: "otm_default",
      tenantId,
      key: "default",
      nameJson: "{}",
      isDefault: true,
      createdAt: now,
      updatedAt: now
    });
    await ctx.db.insert(schema.orbitTeamMembers).values({
      id: "tmm_1",
      tenantId,
      teamId: "otm_default",
      userId: "u_1",
      createdAt: now
    });
    await ctx.db.insert(schema.orbitAgentPresence).values({
      id: "ap_1",
      tenantId,
      userId: "u_1",
      status: "available",
      activeCount: 0,
      updatedAt: now
    });

    const result = await routeConversation(ctx, "cnv_1");
    expect(result).toEqual({ teamId: "otm_default", assigneeRef: "u_1" });

    const [row] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_1"));
    expect(row!.teamId).toBe("otm_default");
    expect(row!.assigneeRef).toBe("u_1");
    expect(row!.queuedAt).toBe(now);
    expect(row!.assignedAt).toBe(now);
  });

  it("routes via a matching rule instead of the default team when one matches", async () => {
    await ctx.db.insert(schema.orbitTeams).values([
      { id: "otm_default", tenantId, key: "default", nameJson: "{}", isDefault: true, createdAt: now, updatedAt: now },
      { id: "otm_claims", tenantId, key: "claims", nameJson: "{}", isDefault: false, createdAt: now, updatedAt: now }
    ]);
    await ctx.db.insert(schema.orbitRoutingRules).values({
      id: "rr_1",
      tenantId,
      teamId: "otm_claims",
      seq: 1,
      enabled: true,
      conditionsJson: JSON.stringify({ channel: "whatsapp" }),
      createdAt: now,
      updatedAt: now
    });

    const result = await routeConversation(ctx, "cnv_1");
    expect(result.teamId).toBe("otm_claims");
  });

  it("leaves the conversation unrouted, without throwing, when the tenant has no team configured yet", async () => {
    const result = await routeConversation(ctx, "cnv_1");
    expect(result).toEqual({ teamId: null, assigneeRef: null });

    const [row] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_1"));
    expect(row!.teamId).toBeNull();
    expect(row!.assigneeRef).toBeNull();
    expect(row!.queuedAt).toBeNull();
  });

  it("stamps SLA due timestamps from the conversation's SLA policy, and leaves them null when none is configured", async () => {
    await ctx.db.insert(schema.orbitTeams).values({
      id: "otm_default",
      tenantId,
      key: "default",
      nameJson: "{}",
      isDefault: true,
      createdAt: now,
      updatedAt: now
    });
    await ctx.db.insert(schema.orbitSlaPolicies).values({
      id: "slp_1",
      tenantId,
      key: "default",
      frtMinutes: 15,
      resolutionMinutes: 240,
      createdAt: now,
      updatedAt: now
    });
    await ctx.db
      .update(schema.orbitConversations)
      .set({ slaPolicyKey: "default" })
      .where(eq(schema.orbitConversations.id, "cnv_1"));

    await routeConversation(ctx, "cnv_1");
    const [row] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_1"));
    expect(row!.firstResponseDueAt).toBe(now + 15 * 60_000);
    expect(row!.resolutionDueAt).toBe(now + 240 * 60_000);
  });
});
```

Add `beforeEach` to the existing `import { describe, expect, it } from "vitest";` line at the top of the file:

```ts
import { beforeEach, describe, expect, it } from "vitest";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @lyra/api exec vitest run src/engines/orbit-routing.test.ts`
Expected: FAIL with `routeConversation is not a function` (or `Cannot find module`, depending on export state)

- [ ] **Step 3: Implement `routeConversation`**

Append to `apps/api/src/engines/orbit-routing.ts`:

```ts
import { eq } from "drizzle-orm";
import { schema } from "@lyra/db";
import { scoped, type Ctx } from "@lyra/core";

async function defaultTeamId(ctx: Ctx): Promise<string | null> {
  const [team] = await ctx.db
    .select({ id: schema.orbitTeams.id })
    .from(schema.orbitTeams)
    .where(scoped(ctx, schema.orbitTeams, eq(schema.orbitTeams.isDefault, true)));
  return team?.id ?? null;
}

/**
 * Route and assign one conversation, stamping its SLA clock. Called right
 * after a conversation is created (there is no bot->human handover step in
 * this codebase to hook into instead) and again by sweepRouting when a
 * breach or an absent agent forces a re-route.
 *
 * ponytail: a tenant with no default team configured yet gets a no-op, not a
 * throw — every existing inbound-webhook test seeds zero orbit_teams rows,
 * and this must not break inbound processing for a tenant that hasn't set
 * ORBIT teams up yet. Upgrade path: once onboarding always seeds a default
 * team, this branch can go back to throwing on a genuinely misconfigured tenant.
 */
export async function routeConversation(
  ctx: Ctx,
  conversationId: string
): Promise<{ teamId: string | null; assigneeRef: string | null }> {
  const [conversation] = await ctx.db
    .select()
    .from(schema.orbitConversations)
    .where(scoped(ctx, schema.orbitConversations, eq(schema.orbitConversations.id, conversationId)));
  if (!conversation) throw new Error(`conversation not found: ${conversationId}`);

  const rules = await ctx.db
    .select({
      seq: schema.orbitRoutingRules.seq,
      teamId: schema.orbitRoutingRules.teamId,
      enabled: schema.orbitRoutingRules.enabled,
      conditionsJson: schema.orbitRoutingRules.conditionsJson
    })
    .from(schema.orbitRoutingRules)
    .where(scoped(ctx, schema.orbitRoutingRules));

  const teamId =
    pickRoute(rules, { channel: conversation.channel, intent: conversation.intent, sentiment: conversation.sentiment }) ??
    (await defaultTeamId(ctx));

  if (!teamId) return { teamId: null, assigneeRef: null };

  const members = await ctx.db
    .select({
      userId: schema.orbitTeamMembers.userId,
      skillsJson: schema.orbitTeamMembers.skillsJson,
      maxConcurrent: schema.orbitTeamMembers.maxConcurrent
    })
    .from(schema.orbitTeamMembers)
    .where(scoped(ctx, schema.orbitTeamMembers, eq(schema.orbitTeamMembers.teamId, teamId)));
  const presenceRows = await ctx.db
    .select()
    .from(schema.orbitAgentPresence)
    .where(scoped(ctx, schema.orbitAgentPresence));
  const presence = new Map(presenceRows.map((p) => [p.userId, p]));
  const requireSkills = conversation.requireSkillsJson ? (JSON.parse(conversation.requireSkillsJson) as string[]) : [];
  const assigneeRef = pickAssignee(members, presence, requireSkills);

  let firstResponseDueAt: number | null = null;
  let resolutionDueAt: number | null = null;
  if (conversation.slaPolicyKey) {
    const [policy] = await ctx.db
      .select()
      .from(schema.orbitSlaPolicies)
      .where(scoped(ctx, schema.orbitSlaPolicies, eq(schema.orbitSlaPolicies.key, conversation.slaPolicyKey)));
    if (policy) {
      firstResponseDueAt = ctx.now + policy.frtMinutes * 60_000;
      resolutionDueAt = ctx.now + policy.resolutionMinutes * 60_000;
    }
  }

  await ctx.db
    .update(schema.orbitConversations)
    .set({
      teamId,
      assigneeRef,
      queuedAt: ctx.now,
      assignedAt: assigneeRef ? ctx.now : null,
      firstResponseDueAt,
      resolutionDueAt,
      updatedAt: ctx.now
    })
    .where(eq(schema.orbitConversations.id, conversationId));

  return { teamId, assigneeRef };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lyra/api exec vitest run src/engines/orbit-routing.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/engines/orbit-routing.ts apps/api/src/engines/orbit-routing.test.ts
git commit -m "feat(orbit): add routeConversation — team/assignee/SLA stamping"
```

---

### Task 4: `sweepRouting` — SLA breach escalation and absence reassignment

**Files:**
- Modify: `apps/api/src/engines/orbit-routing.ts` (append)
- Modify: `apps/api/src/engines/orbit-routing.test.ts` (append)

**Interfaces:**
- Consumes: `routeConversation`, `pickAssignee`, `PRESENCE_STALE_MS` from this file; `emit`, `scoped`, `Ctx` from `@lyra/core`.
- Produces: `sweepRouting(ctx: Ctx): Promise<{ frtBreaches: number; resolutionBreaches: number; reassigned: number }>`, consumed by Task 6 (sweep endpoint + cron).

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/engines/orbit-routing.test.ts`:

```ts
import { emit } from "@lyra/core";
import { sweepRouting } from "./orbit-routing.js";

describe("sweepRouting", () => {
  let client: Client;
  let ctx: Ctx;

  beforeEach(async () => {
    client = createClient({ url: ":memory:" });
    for (const sql of statements()) await client.execute(sql);
    const db = drizzle(client) as unknown as Ctx["db"];
    ctx = {
      db,
      tenantId,
      actor: { kind: "system", id: "test", tenantId, grants: [] },
      requestId: "req_1",
      now,
      locale: "en",
      policy: PolicyJson.parse({}),
      entitlements: EntitlementsJson.parse({})
    };
    await ctx.db.insert(schema.orbitTeams).values({
      id: "otm_default",
      tenantId,
      key: "default",
      nameJson: "{}",
      isDefault: true,
      createdAt: now,
      updatedAt: now
    });
  });

  it("bumps priority down by one and re-routes a conversation that missed its first-response SLA", async () => {
    await ctx.db.insert(schema.orbitTeamMembers).values({ id: "tmm_1", tenantId, teamId: "otm_default", userId: "u_1", createdAt: now });
    await ctx.db.insert(schema.orbitAgentPresence).values({ id: "ap_1", tenantId, userId: "u_1", status: "available", activeCount: 0, updatedAt: now });
    await ctx.db.insert(schema.orbitConversations).values({
      id: "cnv_frt",
      tenantId,
      channel: "whatsapp",
      state: "bot",
      priority: 2,
      firstResponseDueAt: now - 1,
      createdAt: now - 1000,
      updatedAt: now - 1000
    });

    const result = await sweepRouting(ctx);
    expect(result.frtBreaches).toBe(1);

    const [row] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_frt"));
    expect(row!.priority).toBe(1);
    expect(row!.frtBreachedAt).toBe(now);
    expect(row!.teamId).toBe("otm_default");
    expect(row!.assigneeRef).toBe("u_1");

    const events = await ctx.db.select().from(schema.eventOutbox);
    const breach = events.find((e) => JSON.parse(e.envelopeJson).type === "orbit.sla.breached");
    expect(JSON.parse(breach!.envelopeJson).data).toEqual({ conversationId: "cnv_frt", kind: "frt", priority: 1 });
  });

  it("does not bump priority for a resolution-SLA breach, and does not re-fire on a second sweep", async () => {
    await ctx.db.insert(schema.orbitConversations).values({
      id: "cnv_res",
      tenantId,
      channel: "whatsapp",
      state: "human",
      priority: 2,
      resolutionDueAt: now - 1,
      createdAt: now - 1000,
      updatedAt: now - 1000
    });

    await sweepRouting(ctx);
    let [row] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_res"));
    expect(row!.priority).toBe(2);
    expect(row!.resolutionBreachedAt).toBe(now);

    const events = await ctx.db.select().from(schema.eventOutbox);
    expect(events.filter((e) => JSON.parse(e.envelopeJson).type === "orbit.sla.breached")).toHaveLength(1);

    await sweepRouting(ctx); // idempotent: already-breached rows are not touched again
    const eventsAfter = await ctx.db.select().from(schema.eventOutbox);
    expect(eventsAfter).toHaveLength(1);
  });

  it("does not touch a closed conversation even if its SLA timestamps are in the past", async () => {
    await ctx.db.insert(schema.orbitConversations).values({
      id: "cnv_closed",
      tenantId,
      channel: "whatsapp",
      state: "closed",
      priority: 2,
      firstResponseDueAt: now - 1,
      resolutionDueAt: now - 1,
      createdAt: now - 1000,
      updatedAt: now - 1000
    });

    const result = await sweepRouting(ctx);
    expect(result.frtBreaches).toBe(0);
    expect(result.resolutionBreaches).toBe(0);
  });

  it("reassigns an open conversation whose agent's presence has gone stale, marking them offline", async () => {
    await ctx.db.insert(schema.orbitTeamMembers).values([
      { id: "tmm_1", tenantId, teamId: "otm_default", userId: "u_stale", createdAt: now },
      { id: "tmm_2", tenantId, teamId: "otm_default", userId: "u_fresh", createdAt: now }
    ]);
    await ctx.db.insert(schema.orbitAgentPresence).values([
      { id: "ap_1", tenantId, userId: "u_stale", status: "available", activeCount: 1, updatedAt: now - PRESENCE_STALE_MS - 1 },
      { id: "ap_2", tenantId, userId: "u_fresh", status: "available", activeCount: 0, updatedAt: now }
    ]);
    await ctx.db.insert(schema.orbitConversations).values({
      id: "cnv_stale",
      tenantId,
      channel: "whatsapp",
      state: "human",
      teamId: "otm_default",
      assigneeRef: "u_stale",
      priority: 2,
      createdAt: now - 1000,
      updatedAt: now - 1000
    });

    const result = await sweepRouting(ctx);
    expect(result.reassigned).toBe(1);

    const [staleAgent] = await ctx.db.select().from(schema.orbitAgentPresence).where(eq(schema.orbitAgentPresence.userId, "u_stale"));
    expect(staleAgent!.status).toBe("offline");

    const [row] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_stale"));
    expect(row!.assigneeRef).toBe("u_fresh");
  });

  it("unassigns (instead of throwing) and emits orbit.conversation.unassigned when nobody else is available", async () => {
    await ctx.db.insert(schema.orbitTeamMembers).values({ id: "tmm_1", tenantId, teamId: "otm_default", userId: "u_stale", createdAt: now });
    await ctx.db.insert(schema.orbitAgentPresence).values({
      id: "ap_1",
      tenantId,
      userId: "u_stale",
      status: "available",
      activeCount: 1,
      updatedAt: now - PRESENCE_STALE_MS - 1
    });
    await ctx.db.insert(schema.orbitConversations).values({
      id: "cnv_alone",
      tenantId,
      channel: "whatsapp",
      state: "human",
      teamId: "otm_default",
      assigneeRef: "u_stale",
      priority: 2,
      createdAt: now - 1000,
      updatedAt: now - 1000
    });

    await sweepRouting(ctx);
    const [row] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_alone"));
    expect(row!.assigneeRef).toBeNull();

    const events = await ctx.db.select().from(schema.eventOutbox);
    expect(events.some((e) => JSON.parse(e.envelopeJson).type === "orbit.conversation.unassigned")).toBe(true);
  });
});
```

`emit` is imported for parity with the file's other test blocks even though these tests read `schema.eventOutbox` directly rather than calling `emit` themselves — remove the unused import if your linter is strict about it; the assertions only need `schema.eventOutbox`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @lyra/api exec vitest run src/engines/orbit-routing.test.ts`
Expected: FAIL with `sweepRouting is not a function`

- [ ] **Step 3: Implement `sweepRouting`**

Append to `apps/api/src/engines/orbit-routing.ts`:

```ts
import { isNull, lte, ne } from "drizzle-orm";
import { emit } from "@lyra/core";

/**
 * Cron tick (gap-orbit-design.md §1B): escalate conversations that missed
 * their SLA clock, and reassign whoever a now-absent agent was holding.
 * Order matters — breach escalation runs first so a conversation reassigned
 * for absence in the same tick already carries its bumped priority.
 */
export async function sweepRouting(ctx: Ctx): Promise<{ frtBreaches: number; resolutionBreaches: number; reassigned: number }> {
  const frtDue = await ctx.db
    .select({ id: schema.orbitConversations.id, priority: schema.orbitConversations.priority })
    .from(schema.orbitConversations)
    .where(
      scoped(
        ctx,
        schema.orbitConversations,
        isNull(schema.orbitConversations.frtBreachedAt),
        lte(schema.orbitConversations.firstResponseDueAt, ctx.now),
        ne(schema.orbitConversations.state, "closed")
      )
    );
  for (const conv of frtDue) {
    const priority = Math.max(0, conv.priority - 1);
    await ctx.db
      .update(schema.orbitConversations)
      .set({ priority, frtBreachedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(schema.orbitConversations.id, conv.id));
    await routeConversation(ctx, conv.id);
    await emit(ctx, { module: "orbit", type: "orbit.sla.breached", subject: conv.id, data: { conversationId: conv.id, kind: "frt", priority } });
  }

  const resolutionDue = await ctx.db
    .select({ id: schema.orbitConversations.id, priority: schema.orbitConversations.priority })
    .from(schema.orbitConversations)
    .where(
      scoped(
        ctx,
        schema.orbitConversations,
        isNull(schema.orbitConversations.resolutionBreachedAt),
        lte(schema.orbitConversations.resolutionDueAt, ctx.now),
        ne(schema.orbitConversations.state, "closed")
      )
    );
  for (const conv of resolutionDue) {
    await ctx.db
      .update(schema.orbitConversations)
      .set({ resolutionBreachedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(schema.orbitConversations.id, conv.id));
    await emit(ctx, {
      module: "orbit",
      type: "orbit.sla.breached",
      subject: conv.id,
      data: { conversationId: conv.id, kind: "resolution", priority: conv.priority }
    });
  }

  const stalePresence = await ctx.db
    .select()
    .from(schema.orbitAgentPresence)
    .where(scoped(ctx, schema.orbitAgentPresence, eq(schema.orbitAgentPresence.status, "available"), lte(schema.orbitAgentPresence.updatedAt, ctx.now - PRESENCE_STALE_MS)));

  let reassigned = 0;
  for (const stale of stalePresence) {
    await ctx.db
      .update(schema.orbitAgentPresence)
      .set({ status: "offline", updatedAt: ctx.now })
      .where(eq(schema.orbitAgentPresence.id, stale.id));

    const held = await ctx.db
      .select({ id: schema.orbitConversations.id, teamId: schema.orbitConversations.teamId })
      .from(schema.orbitConversations)
      .where(
        scoped(
          ctx,
          schema.orbitConversations,
          eq(schema.orbitConversations.assigneeRef, stale.userId),
          ne(schema.orbitConversations.state, "closed")
        )
      );
    for (const conv of held) {
      if (!conv.teamId) continue;
      const members = await ctx.db
        .select({ userId: schema.orbitTeamMembers.userId, skillsJson: schema.orbitTeamMembers.skillsJson, maxConcurrent: schema.orbitTeamMembers.maxConcurrent })
        .from(schema.orbitTeamMembers)
        .where(scoped(ctx, schema.orbitTeamMembers, eq(schema.orbitTeamMembers.teamId, conv.teamId)));
      const presenceRows = await ctx.db.select().from(schema.orbitAgentPresence).where(scoped(ctx, schema.orbitAgentPresence));
      const presence = new Map(presenceRows.map((p) => [p.userId, { ...p, status: p.status as PresenceInput["status"] }]));
      const nextAssignee = pickAssignee(
        members.filter((m) => m.userId !== stale.userId),
        presence,
        []
      );
      await ctx.db
        .update(schema.orbitConversations)
        .set({ assigneeRef: nextAssignee, assignedAt: nextAssignee ? ctx.now : null, updatedAt: ctx.now })
        .where(eq(schema.orbitConversations.id, conv.id));
      reassigned++;
      if (!nextAssignee) {
        await emit(ctx, { module: "orbit", type: "orbit.conversation.unassigned", subject: conv.id, data: { conversationId: conv.id } });
      }
    }
  }

  return { frtBreaches: frtDue.length, resolutionBreaches: resolutionDue.length, reassigned };
}
```

Note: `orbitAgentPresence.status` is a plain `text` column typed as `string`, while `pickAssignee`'s `PresenceInput.status` is the narrow union `"available" | "away" | "offline"` (same gap Task 3 hit for `routeConversation`) — the cast above at the `presence` Map construction site is the established fix; no schema change needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lyra/api exec vitest run src/engines/orbit-routing.test.ts`
Expected: PASS (19 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/engines/orbit-routing.ts apps/api/src/engines/orbit-routing.test.ts
git commit -m "feat(orbit): add sweepRouting — SLA breach escalation and absence reassignment"
```

---

### Task 5: Wire `routeConversation` into the inbound path

**Files:**
- Modify: `apps/api/src/engines/orbit-channel-inbound.ts`
- Modify: `apps/api/src/engines/orbit-channel-inbound.test.ts`

**Interfaces:**
- Consumes: `routeConversation` from Task 3 (`./orbit-routing.js`).

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/engines/orbit-channel-inbound.test.ts` (add `schema.orbitTeams`/`orbitTeamMembers`/`orbitAgentPresence` inserts inline — no new imports needed, `schema` is already imported in this file):

```ts
describe("processChannelEvents routing", () => {
  it("routes and assigns a new conversation when the tenant has a default team and an available agent", async () => {
    await ctx.db.insert(schema.orbitTeams).values({
      id: "otm_default",
      tenantId,
      key: "default",
      nameJson: "{}",
      isDefault: true,
      createdAt: now,
      updatedAt: now
    });
    await ctx.db.insert(schema.orbitTeamMembers).values({ id: "tmm_1", tenantId, teamId: "otm_default", userId: "u_1", createdAt: now });
    await ctx.db.insert(schema.orbitAgentPresence).values({ id: "ap_1", tenantId, userId: "u_1", status: "available", activeCount: 0, updatedAt: now });

    await processChannelEvents(ctx, connector, [
      { kind: "message", message: { externalRef: "wamid.1", handle: "97150", text: "Hello", modality: "text", sentAt: now } }
    ]);

    const [conversation] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.tenantId, tenantId));
    expect(conversation!.teamId).toBe("otm_default");
    expect(conversation!.assigneeRef).toBe("u_1");
  });

  it("leaves a conversation unrouted when the tenant has no team configured yet", async () => {
    await processChannelEvents(ctx, connector, [
      { kind: "message", message: { externalRef: "wamid.1", handle: "97150", text: "Hello", modality: "text", sentAt: now } }
    ]);
    const [conversation] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.tenantId, tenantId));
    expect(conversation!.teamId).toBeNull();
    expect(conversation!.assigneeRef).toBeNull();
  });
});
```

Check the top of `apps/api/src/engines/orbit-channel-inbound.test.ts` for its exact `tenantId`/`now`/`ctx`/`connector` fixture variable names before pasting — this task's tests must reuse whatever the file's existing `beforeEach` already sets up (they follow the same pattern as every other `describe` block already in that file).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @lyra/api exec vitest run src/engines/orbit-channel-inbound.test.ts`
Expected: the first new test FAILs (`conversation!.teamId` is `null`, not `"otm_default"`); the second new test already passes (nothing routes yet, so it's a true no-op already) — that is expected, TDD only requires the routed-path assertion to be red first.

- [ ] **Step 3: Wire the call**

In `apps/api/src/engines/orbit-channel-inbound.ts`, add to the imports at the top:

```ts
import { routeConversation } from "./orbit-routing.js";
```

Then, inside `getOrCreateConversation`, immediately after the `ctx.db.insert(schema.orbitConversations).values({...})` call and before `return { id: conversationId, customerId };`, add:

```ts
  await routeConversation(ctx, conversationId);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lyra/api exec vitest run src/engines/orbit-channel-inbound.test.ts`
Expected: PASS, including all 8 pre-existing tests (none of them seed `orbit_teams`, so `routeConversation`'s no-op-on-no-default-team path is exactly what keeps them green) and the 2 new ones.

- [ ] **Step 5: Run the full engine suite once more for the outbound file, which also exercises `processChannelEvents`**

Run: `pnpm --filter @lyra/api exec vitest run src/engines/orbit-channel-outbound.test.ts`
Expected: PASS — that file's fixtures also seed no `orbit_teams`, so the routing call is a no-op there too.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/engines/orbit-channel-inbound.ts apps/api/src/engines/orbit-channel-inbound.test.ts
git commit -m "feat(orbit): route new conversations to a team/assignee on creation"
```

---

### Task 6: Callable sweep endpoint + cron wiring

**Files:**
- Modify: `apps/api/src/routes/orbit.ts`
- Modify: `apps/api/src/openapi.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/src/routes/orbit.test.ts`

**Interfaces:**
- Consumes: `sweepRouting` from Task 4 (`../engines/orbit-routing.js` / `./engines/orbit-routing.js`).

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/routes/orbit.test.ts`, as a new `describe` block after the existing `describe("POST /v1/orbit/conversations/:id/reply", ...)` block:

```ts
describe("POST /v1/orbit/routing/sweep", () => {
  it("runs the routing sweep and reports counts", async () => {
    const res = await call(agentToken, "POST", "/v1/orbit/routing/sweep");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ frtBreaches: expect.any(Number), resolutionBreaches: expect.any(Number), reassigned: expect.any(Number) });
  });

  it("is 403 without orbit:conversations:assign", async () => {
    const res = await call(outsiderToken, "POST", "/v1/orbit/routing/sweep");
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @lyra/api exec vitest run src/routes/orbit.test.ts`
Expected: FAIL with a 404 (no such route yet)

- [ ] **Step 3: Add the route**

In `apps/api/src/routes/orbit.ts`, add to the imports:

```ts
import { sweepRouting } from "../engines/orbit-routing.js";
```

Then append, after the existing `/renewals/sweep` handler:

```ts
/**
 * Force the routing sweep now (SLA breach escalation + absence reassignment).
 * Same idiom as `/renewals/sweep` above: this otherwise only runs off the
 * Workers cron tick, so without this an operator (or an e2e test) has no way
 * to force it. Reuses `orbit:conversations:assign` — this endpoint changes
 * exactly the fields that permission already governs (team/assignee),
 * so a new permission would be a distinction without a difference.
 */
orbitRoutes.post("/routing/sweep", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "orbit:conversations:assign", { tenantId: ctx.tenantId, module: "orbit" });
  return c.json(await sweepRouting(ctx));
});
```

- [ ] **Step 4: Document the route**

In `apps/api/src/openapi.ts`, add after the `/v1/orbit/renewals/sweep` line:

```ts
  { method: "post", path: "/v1/orbit/routing/sweep", summary: "Force the routing sweep now — SLA breach escalation and absence reassignment (also runs on the scheduled tick)", permission: "orbit:conversations:assign", tag: "orbit" },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @lyra/api exec vitest run src/routes/orbit.test.ts`
Expected: PASS

- [ ] **Step 6: Wire the cron tick**

In `apps/api/src/index.ts`, add to the imports (alongside the existing `import { sweepRenewals } from "./engines/renewals.js";`):

```ts
import { sweepRouting } from "./engines/orbit-routing.js";
```

Then, inside `scheduled()`, insert immediately after the existing `await sweepRenewals(ctx, env.WF);` line and before `await runBudgetAutopilot(ctx);`:

```ts
    // Conversations that missed their SLA clock get escalated and, if their
    // agent went quiet, requeued — before anything else touches assignment
    // state this tick.
    await sweepRouting(ctx);
```

- [ ] **Step 7: Run the full API test suite**

Run: `pnpm --filter @lyra/api test`
Expected: PASS — this also re-confirms the router-walk test in `api.test.ts` accepts the new documented route.

- [ ] **Step 8: Run the whole repo's checks**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/orbit.ts apps/api/src/openapi.ts apps/api/src/index.ts apps/api/src/routes/orbit.test.ts
git commit -m "feat(orbit): add routing sweep endpoint and wire it into the cron tick"
```

---

## Self-Review

**Spec coverage** — every item from the design doc's routing/queueing scope (§1B/§1H T10-T13) has a task: schema (Task 1), `pickRoute`/`pickAssignee` (Task 2), `routeConversation` with SLA stamping (Task 3), `sweepRouting` with breach escalation + absence reassignment (Task 4), inbound wiring (Task 5), callable sweep + cron (Task 6). The one design-doc assumption this plan deliberately departs from — a throw on "no default team" — is called out explicitly in Task 3 with its `ponytail:` rationale, since the alternative breaks all 8 pre-existing inbound tests.

**Placeholder scan** — no task contains "TBD"/"handle appropriately"/unshown code; every step has complete, paste-ready TypeScript. Task 4 Step 3's `held` query originally built its "state is not closed" filter as `and(...OPEN_STATES.map(...))`, redundant with itself by construction; pre-simplified to a single `ne(schema.orbitConversations.state, "closed")` call (dropping the now-dead `and` import and `OPEN_STATES` const) after Task 3 showed that leaving a "simplify this" instruction for the implementer creates the same dead-import lint trap as the `newId` bug — cheaper to fix in the plan once than to re-discover per task.

**Type/signature consistency** — `routeConversation(ctx: Ctx, conversationId: string): Promise<{ teamId: string | null; assigneeRef: string | null }>` (Task 3) matches its use in Task 5 (inbound wiring, return value discarded) and Task 4 (`await routeConversation(ctx, conv.id)` inside `sweepRouting`, return value discarded). `pickRoute`/`pickAssignee` signatures from Task 2 are used identically in Task 3 and Task 4. `sweepRouting(ctx: Ctx): Promise<{ frtBreaches: number; resolutionBreaches: number; reassigned: number }>` matches its use in Task 6's route handler (`c.json(await sweepRouting(ctx))`) and test assertion. `PRESENCE_STALE_MS` is exported from Task 2 and consumed by both Task 4's implementation and its own test.
