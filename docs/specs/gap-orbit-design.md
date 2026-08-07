# ORBIT gap design — channels, routing, AI drafts

Scope: F6 (inbound channels), F7 (AI draft producer), F29 (routing/queueing),
F30 (journeys never advance), F31 (3 of 8 tools), F32 (KB/macros/deflection),
F42–F43 channel side, plus the ORBIT items in docs/27 P2. Constrained by F33,
F37, F38, F39 where they touch this surface.

Design only. Nothing here is implemented. Every task in §H names its failing
test first.

---

## 0. What actually exists today (the ground this stands on)

Facts verified in the tree, not assumptions. The design is shaped to reuse each
of these rather than replace it.

| Fact | Location |
| --- | --- |
| The whole hand-written ORBIT API is 56 lines: one turn endpoint, one renewal sweep. | `apps/api/src/routes/orbit.ts` |
| `withContext` authenticates everything except a hard-coded `PUBLIC` set and two prefix escapes (`/v1/auth/sso/`, `/v1/portal/`). | `apps/api/src/mw.ts:19-51` |
| Inbound message dedupe already has an index. `uniqueIndex("orbit_messages_ext_uq").on(tenant_id, external_ref)` — SQLite treats NULLs as distinct, so internal messages are unaffected. | `packages/db/src/schema/orbit.ts:53` |
| Journey due-scan already has an index. `index("orbit_journey_runs_due_idx").on(tenant_id, state, next_at)`. | `packages/db/src/schema/orbit.ts:116` |
| Outbound HMAC convention: `hmacHex(secret, \`${ts}.${payload}\`)`, header `x-lyra-signature: v1=<hex>`, `AbortSignal.timeout(10_000)`. | `apps/api/src/dispatch.ts:131-146` |
| `hmacHex`, `timingSafeEqual`, `sealField`/`openField` all exist. | `packages/core/src/crypto.ts:47,56`, `packages/core/src/field-crypto.ts:29,39` |
| Generated CRUD already gives idempotency, PII sealing, immutability, actor columns, `beforeWrite`, `afterWrite`, and emits `<module>.<name>.created/updated/deleted`. | `apps/api/src/crud.ts:118,124,395,442,464,501` |
| `conversation.tsx` **already renders a draft** if one exists: trailing `orbit_messages` row with `role === "agent_ai"`, `deliveryStatus === null`, joined to `/v1/ai/runs?subjectRef=<conversationId>` on `outputRef === aiAuditId`. | `apps/web/app/routes/conversation.tsx:189-210` |
| Approving a draft POSTs a *second immutable message* with the same `aiAuditId` and `deliveryStatus: "queued"`. Nothing consumes `"queued"`. | `apps/web/app/routes/conversation.tsx:276-303` |
| `AgentRoom.turn()` appends, checkpoints, embeds. It never calls a model. | `apps/api/src/engines/agent-room.ts` |
| Room logic is framework-free and unit-testable: `openRoom`/`applyTurn`/`checkpoint`. | `apps/api/src/engines/orbit-room.ts:41,46,60` |
| `triggerJourney` writes one run at `startNode(graph)` and nothing ever advances it. | `apps/api/src/engines/orbit-journeys.ts:84-165` |
| `executeOrbitToolCalls` re-validates every tool name server-side against an allowlist, gates consequential calls, and writes `ai_tool_calls`. **Extend, never replace.** | `apps/api/src/engines/orbit-tools.ts:189-239` |
| The cron loop is a per-tenant try/catch with a nightly `isBackupWindow` gate. New jobs slot straight in. | `apps/api/src/index.ts:149-206` |
| Snapshotter convention: typed compute per metric key, percent stored as basis points (`×10_000`), money in minor units, `day` + month-to-date periods, idempotent upsert. | `apps/api/src/engines/north-snapshotter.ts:30-207` |
| The CX judge already exists, versioned and eval-gated at 4.2/5 with a 0.2 ar/en parity cap. Nothing in the API calls it. | `packages/model-gateway/src/cx-judge.ts`, `evals/cx-quality/thresholds.json` |
| Eval convention: one directory per task with `cases.jsonl` + `thresholds.json`, registered in `SCORERS`. | `packages/model-gateway/evals/run.ts:303-310` |
| `ModelRequest` already carries `intent` and `responseSchema`. | `packages/model-gateway/src/types.ts:37-56` |

### 0.1 The `Channel` seam, precisely

`packages/core/src/seams.ts:9-10` states outright that `Channel` is not defined
there — it is `type Channel = keyof ChannelOptinsJson` in
`packages/core/src/consent.ts`, i.e. `"email" | "sms" | "whatsapp" | "voice" |
"push"` (`packages/db/src/schema/json.ts:106-113`).

That is a **consent vocabulary**, not a transport interface. It does not contain
`web` or `agent`, which `orbit_conversations.channel` documents
(`packages/db/src/schema/orbit.ts:11`).

**Decision:** leave `Channel` alone and add a `ChannelAdapter` interface beside
`ExtensionManifest` in `seams.ts`; the adapter declares which consent `Channel`
(if any) governs *outbound* on that transport. Reconciling by widening
`ChannelOptinsJson` was rejected because it silently changes what every existing
consent record means. A customer who opened a web chat has consented by the act
of opening it, so `web` and `agent` map to `consentChannel: null` — inbound is
never consent-gated, only outbound is.

---

# CAPABILITY 1 — Inbound (and outbound) channels

WhatsApp Cloud API / BSP, inbound email, web widget. One adapter interface, one
public webhook shape, one delivery path out.

## 1A. Role design

New permission keys, appended to the closed `PERMISSIONS` catalogue in
`packages/core/src/rbac.ts` after line 115 (same block, same convention
`module:resource:action`):

```ts
  "orbit:channels:read", "orbit:channels:write", "orbit:channels:connect",
  "orbit:channels:secrets_rotate",
  "orbit:teams:read", "orbit:teams:write",
  "orbit:presence:read", "orbit:presence:write",
  "orbit:conversations:route",
  "orbit:kb:read", "orbit:kb:write", "orbit:kb:publish",
  "orbit:macros:read", "orbit:macros:write",
  "orbit:drafts:generate",
```

Who holds what:

| Role (existing bundle) | Adds | Rationale |
| --- | --- | --- |
| `orbit.agent` | `orbit:presence:write` (own row only, enforced by `userId = ctx.actor.id` in the resource's `beforeWrite`), `orbit:drafts:generate` | An agent sets their own availability and can ask for a draft. Reads of teams/KB/macros arrive free via `...readsOf("orbit")`. |
| `orbit.lead` (supervisor) | `orbit:conversations:route`, `orbit:teams:write`, `orbit:presence:write`, `orbit:macros:write`, `orbit:kb:write`, `orbit:kb:publish` | Reassignment, team composition, and the macro/KB library are supervisory. |
| `orbit.admin` | already `orbit:*:*` | Includes channels. |
| New bundle `orbit.channel_admin` | `...readsOf("orbit")`, `orbit:channels:read/write/connect/secrets_rotate` | Connecting a WABA is an integration job, not a CX job. Separating it means the person who can exfiltrate a provider token is not every shift supervisor. |

**Send-without-approval vs draft-only** — the split is two permissions already in
the catalogue plus one new one:

- `orbit:messages:send` → may put words on the wire in their own name.
- `orbit:drafts:generate` **without** `orbit:messages:send` → the trainee: can
  ask the model for a draft, can read it, cannot dispatch it. This is a real
  configuration, not theatre — `conversation.tsx:276` already refuses the
  approve/reply forms when `orbit:messages:send` is withheld.
- `orbit:conversations:route` → may move someone else's conversation.

**What the autonomy policy controls** (not the RBAC layer): whether the *model*
may dispatch without a human. That lives on `ai_agents.autonomyLevel` and is
raised only through `POST /v1/ai/runs`… `/agents/:key/autonomy`, which is
`neverAutoApprove` dual control (`packages/core/src/approvals.ts:131`). RBAC says
which human may act; autonomy says whether a human is needed. See §2A.

**Secrets.** `orbit:channels:secrets_rotate` is separate from `:write` because a
connector's config (display name, routing) is edited weekly and its credentials
almost never — and one of those two operations hands over a token that can send
messages as the tenant.

## 1B. Routing and queueing

This is the engine that does not exist. `LiveConversation.teamId`
(`orbit-console.tsx:45`) is loaded and never used; `SLOW_MS = 15 * 60_000`
(`orbit-console.tsx:66`) only recolours a badge.

### The model in one paragraph

A conversation enters with a `channel`, a `priority` and a `slaPolicyKey`. A
first-match-wins rule list maps it to a team. Within the team, the router picks
the longest-idle available member whose skills cover the conversation and whose
`activeCount < maxConcurrent`. If nobody qualifies it stays unassigned in the
team queue and the console's existing "take" action serves as the pull path. A
cron sweep advances SLA state, escalates on breach, and unassigns agents who went
away with work in hand.

### New tables (Drizzle, SQLite dialect, `tenant_id` on all)

Added to `packages/db/src/schema/orbit.ts`.

```ts
/** A queue of people. `skillsJson` is the union of what the team can handle. */
export const teams = sqliteTable(
  "orbit_teams",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    key: text("key").notNull(),
    nameJson: text("name_json").notNull(),
    /** string[] — matched against a conversation's required skills. */
    skillsJson: text("skills_json"),
    /** Fallback when routing finds no rule match. Exactly one per tenant, enforced in beforeWrite. */
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    slaPolicyKey: text("sla_policy_key"),
    status: text("status").notNull().default("active"), // active|archived
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [uniqueIndex("orbit_teams_uq").on(t.tenantId, t.key)]
);

export const teamMembers = sqliteTable(
  "orbit_team_members",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    teamId: text("team_id").notNull(),
    userId: text("user_id").notNull(),
    /** string[] — the member's own skills, a subset of what they may be handed. */
    skillsJson: text("skills_json"),
    maxConcurrent: integer("max_concurrent").notNull().default(3),
    /** agent|supervisor — a supervisor is routable but also receives escalations. */
    seat: text("seat").notNull().default("agent"),
    createdAt: integer("created_at").notNull()
  },
  (t) => [
    uniqueIndex("orbit_team_members_uq").on(t.tenantId, t.teamId, t.userId),
    index("orbit_team_members_user_idx").on(t.tenantId, t.userId)
  ]
);

/**
 * One row per agent, not per session. `activeCount` is denormalised on purpose:
 * the router reads it once per assignment and a COUNT(*) over open
 * conversations per candidate is the query that makes routing O(agents × convs).
 * ponytail: reconciled by the same cron sweep that expires presence, so drift
 * self-heals within one tick.
 */
export const agentPresence = sqliteTable(
  "orbit_agent_presence",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    userId: text("user_id").notNull(),
    status: text("status").notNull().default("offline"), // available|busy|away|offline
    activeCount: integer("active_count").notNull().default(0),
    /** When the agent last finished a conversation — drives longest-idle-first. */
    idleSince: integer("idle_since"),
    /** Heartbeat. Older than PRESENCE_STALE_MS and the sweep marks them offline. */
    seenAt: integer("seen_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [
    uniqueIndex("orbit_presence_uq").on(t.tenantId, t.userId),
    index("orbit_presence_avail_idx").on(t.tenantId, t.status, t.idleSince)
  ]
);

/**
 * First match wins, ordered by `seq`. `matchJson` is a flat AND of equality and
 * membership tests — deliberately not an expression language, because a routing
 * rule nobody can read at 3am is an outage.
 * Shape: { channel?: string[]; intent?: string[]; lang?: string[];
 *          customerTier?: string[]; sentimentBelow?: number; keywords?: string[] }
 */
export const routingRules = sqliteTable(
  "orbit_routing_rules",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    seq: integer("seq").notNull(),
    nameJson: text("name_json").notNull(),
    matchJson: text("match_json").notNull(),
    teamId: text("team_id").notNull(),
    /** 0 = urgent, 1 = high, 2 = normal, 3 = low. Lower sorts first, like nice(1). */
    priority: integer("priority").notNull().default(2),
    /** string[] — skills the assignee must have on top of team membership. */
    requireSkillsJson: text("require_skills_json"),
    slaPolicyKey: text("sla_policy_key"),
    status: text("status").notNull().default("active"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [uniqueIndex("orbit_routing_rules_seq_uq").on(t.tenantId, t.seq)]
);

/**
 * Targets in wall-clock ms. Business hours are a 7-element array of
 * [openMinute, closeMinute] in the tenant's timezone, or null for 24/7.
 */
export const slaPolicies = sqliteTable(
  "orbit_sla_policies",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    key: text("key").notNull(),
    nameJson: text("name_json").notNull(),
    /** Indexed by priority 0..3; array of 4 integers, ms. */
    firstResponseMsJson: text("first_response_ms_json").notNull(),
    resolutionMsJson: text("resolution_ms_json").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    businessHoursJson: text("business_hours_json"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [uniqueIndex("orbit_sla_policies_uq").on(t.tenantId, t.key)]
);
```

### Columns added to `orbit_conversations`

Forward-only `ALTER TABLE ADD COLUMN`, all nullable or defaulted — safe on D1 and
libSQL alike.

```ts
    priority: integer("priority").notNull().default(2),      // 0..3
    slaPolicyKey: text("sla_policy_key"),
    requireSkillsJson: text("require_skills_json"),
    queuedAt: integer("queued_at"),                          // entered the queue unassigned
    assignedAt: integer("assigned_at"),
    firstResponseDueAt: integer("first_response_due_at"),
    resolutionDueAt: integer("resolution_due_at"),
    frtBreachedAt: integer("frt_breached_at"),
    resolutionBreachedAt: integer("resolution_breached_at"),
    reopenCount: integer("reopen_count").notNull().default(0),
    connectorId: text("connector_id"),                       // -> orbit_channel_connectors.id
```

Plus one index the queue view needs:

```ts
    index("orbit_conv_queue_idx").on(t.tenantId, t.teamId, t.state, t.priority, t.queuedAt)
```

`firstResponseMs` (existing, `orbit.ts:22`) stays as the *achieved* number;
`firstResponseDueAt` is the target. Two columns because SLA attainment needs both.

### The engine — `apps/api/src/engines/orbit-routing.ts`

```ts
export interface RouteDecision {
  teamId: string;
  priority: number;
  slaPolicyKey: string | null;
  requireSkills: string[];
  ruleId: string | null;
}

/** Pure: rules in, decision out. The unit under test — no I/O. */
export function pickRoute(
  rules: readonly RoutingRuleRow[],
  conv: { channel: string; intent: string | null; lang: string; sentiment: number | null; text: string },
  fallbackTeamId: string
): RouteDecision;

/** Least-loaded, then longest-idle. Pure. */
export function pickAssignee(
  candidates: readonly { userId: string; skills: string[]; maxConcurrent: number; activeCount: number; idleSince: number | null }[],
  requireSkills: readonly string[],
  now: number
): string | null;

/** Applies a decision + assignment to the row and stamps SLA due times. I/O. */
export async function routeConversation(ctx: Ctx, conversationId: string): Promise<{ teamId: string; assigneeRef: string | null }>;

/** Cron: SLA clocks, breach escalation, absence reassignment, presence expiry. */
export async function sweepRouting(ctx: Ctx): Promise<{ breached: number; reassigned: number; expired: number }>;
```

`pickAssignee` ordering, exactly: filter to `status === "available"` **and**
`activeCount < maxConcurrent` **and** `requireSkills ⊆ skills`; sort by
`activeCount` ascending, then `idleSince ?? 0` ascending, then `userId`
ascending. The final `userId` tiebreak makes the function deterministic, which is
what makes it testable.

**Escalation on breach** (in `sweepRouting`):
1. `state != "closed"` AND `firstResponseMs IS NULL` AND `firstResponseDueAt < now`
   AND `frtBreachedAt IS NULL` → set `frtBreachedAt = now`,
   `priority = max(0, priority - 1)`, emit `orbit.sla.breached`
   (`{conversationId, kind: "first_response", overdueMs}`), and re-run
   `routeConversation` so the new priority re-sorts the queue.
2. Same shape for `resolutionDueAt` / `resolutionBreachedAt`, kind
   `"resolution"`, but **no** priority bump — a long investigation is not a
   routing failure, and bumping it would starve new arrivals.

**Absence reassignment**: `agent_presence.seenAt < now - PRESENCE_STALE_MS`
(15 min, one constant, exported so a test can shrink it) → set
`status = "offline"`; every conversation assigned to that user in state `human`
gets `assigneeRef = null`, `queuedAt = now`, and is re-routed. Emitted as
`orbit.conversation.unassigned` so the console's snapshot picks it up on its
next poll.

**Priority definition** (0 urgent → 3 low). Reserved rather than computed: a
routing rule sets it, breach lowers the number by one, nothing else writes it.
Sentiment-driven priority is a rule (`sentimentBelow: -40`), not a special case.

`SLOW_MS` in `orbit-console.tsx:66` is deleted; the badge recolours off
`firstResponseDueAt` versus now, which is the number the SLA policy actually
promised.

## 1C. Data model — the channel tables

```ts
/**
 * One row per (tenant, provider, account). The webhook URL contains this row's
 * id, which is how a public request finds its tenant without a session.
 * Credentials are sealed with the tenant field key (packages/core/src/field-crypto.ts),
 * never stored in the clear, and `secretRef` is the escape hatch for
 * platform-wide credentials that name a wrangler secret instead (the pattern
 * core_sso_providers.client_secret_ref already uses, core.ts:381).
 */
export const channelConnectors = sqliteTable(
  "orbit_channel_connectors",
  {
    id: text("id").primaryKey(),                      // "chc_..."
    tenantId: text("tenant_id").notNull(),
    /** whatsapp_cloud | whatsapp_bsp | email_inbound | web_widget | (voice reserved) */
    provider: text("provider").notNull(),
    /** Transport this connector serves: whatsapp|email|web|voice|agent. */
    transport: text("transport").notNull(),
    nameJson: text("name_json").notNull(),
    /**
     * The provider's own addressable identity for this account — WhatsApp
     * phone_number_id, inbound email address, widget public key. Unique per
     * tenant AND globally per provider (see the second index) so a shared-app
     * webhook can resolve the tenant from the payload.
     */
    address: text("address").notNull(),
    /** Non-secret provider config: waba_id, graph version, from-name, reply-to. */
    configJson: text("config_json"),
    /** Sealed. Signing secret used to verify inbound (Meta app secret, Mailgun key, widget HMAC key). */
    inboundSecret: text("inbound_secret"),
    /** Sealed. Bearer token used to send outbound (Cloud API access token, SMTP/API key). */
    outboundSecret: text("outbound_secret"),
    /** Names a wrangler secret when the credential is platform-wide, not tenant-owned. */
    secretRef: text("secret_ref"),
    /** Meta's GET-handshake verify token. Sealed. */
    verifyToken: text("verify_token"),
    /** CSV of allowed browser origins — web_widget only. */
    allowedOrigins: text("allowed_origins"),
    status: text("status").notNull().default("disabled"), // disabled|verifying|active|failed
    lastInboundAt: integer("last_inbound_at"),
    lastErrorAt: integer("last_error_at"),
    lastError: text("last_error"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [
    uniqueIndex("orbit_connectors_addr_uq").on(t.provider, t.address),
    index("orbit_connectors_tenant_idx").on(t.tenantId, t.transport, t.status)
  ]
);

/**
 * The inbound inbox. Every accepted webhook body lands here first and is acked;
 * processing happens after. This is what makes replay protection, provider
 * retries and a 20-second Meta ack budget all the same mechanism.
 */
export const channelEvents = sqliteTable(
  "orbit_channel_events",
  {
    id: text("id").primaryKey(),                      // "che_..."
    tenantId: text("tenant_id").notNull(),
    connectorId: text("connector_id").notNull(),
    /** The provider's delivery id, or sha256 of the raw body when it gives none. */
    providerEventId: text("provider_event_id").notNull(),
    direction: text("direction").notNull().default("inbound"),
    /** message|status|reaction|unsupported */
    kind: text("kind").notNull(),
    /** Raw body, capped at RAW_MAX bytes; over that, an R2 key instead. */
    rawJson: text("raw_json"),
    rawFileKey: text("raw_file_key"),
    state: text("state").notNull().default("received"), // received|processed|failed|ignored
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    conversationId: text("conversation_id"),
    messageId: text("message_id"),
    receivedAt: integer("received_at").notNull(),
    processedAt: integer("processed_at")
  },
  (t) => [
    uniqueIndex("orbit_channel_events_uq").on(t.connectorId, t.providerEventId),
    index("orbit_channel_events_pending_idx").on(t.tenantId, t.state, t.receivedAt)
  ]
);

/**
 * Which conversation a given (connector, customer address) belongs to, so an
 * inbound message from +9715… lands on the open thread instead of opening a new
 * one every time. `expiresAt` is the session window: WhatsApp's 24h customer
 * service window is the reason this is not just "the newest open conversation".
 */
export const channelIdentities = sqliteTable(
  "orbit_channel_identities",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    connectorId: text("connector_id").notNull(),
    /** Sealed: a phone number or email address is PII. */
    handle: text("handle").notNull(),
    /** sha256(lowercased handle) — what the lookup joins on, since the value is sealed. */
    handleHash: text("handle_hash").notNull(),
    customerId: text("customer_id"),
    conversationId: text("conversation_id"),
    /** Provider profile name, if given. Sealed. */
    displayName: text("display_name"),
    /** End of the free-form reply window (WhatsApp 24h). Null = no window. */
    windowExpiresAt: integer("window_expires_at"),
    firstSeenAt: integer("first_seen_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull()
  },
  (t) => [uniqueIndex("orbit_channel_identities_uq").on(t.connectorId, t.handleHash)]
);
```

Three tables, not six. There is no separate media table: attachments live in
`orbit_messages.attachmentsJson`, which already exists (`orbit.ts:44`).

### The seam — `packages/core/src/seams.ts`

Added next to `ExtensionManifest`, which already reserves `kind: "channel"`:

```ts
/** What arrives from a provider, normalised. docs/16 H3 modality vocabulary. */
export interface InboundMessage {
  /** Provider's own message id — becomes orbit_messages.external_ref. */
  readonly externalRef: string;
  /** The customer's address on this transport (phone, email, widget session). */
  readonly handle: string;
  readonly displayName?: string;
  readonly text: string;
  readonly modality: "text" | "voice" | "image" | "video" | "document";
  /** Media the adapter can fetch later; bytes are NOT carried here. */
  readonly media?: readonly { readonly providerId: string; readonly mime: string; readonly filename?: string; readonly bytes?: number }[];
  readonly sentAt: number;
  /** Free-form reply window close, if the transport has one. */
  readonly windowExpiresAt?: number;
}

export interface DeliveryReceipt {
  readonly externalRef: string;
  readonly status: "sent" | "delivered" | "read" | "failed";
  readonly at: number;
  readonly error?: string;
}

export type InboundEvent =
  | { readonly kind: "message"; readonly message: InboundMessage }
  | { readonly kind: "status"; readonly receipt: DeliveryReceipt }
  | { readonly kind: "ignored"; readonly why: string };

export interface VerifiedRequest {
  readonly rawBody: string;
  readonly headers: Headers;
  readonly query: URLSearchParams;
}

export interface ChannelAdapter {
  readonly provider: string;
  readonly transport: "whatsapp" | "email" | "web" | "voice" | "agent";
  /**
   * Which consent channel governs OUTBOUND on this transport. Null means the
   * customer's own inbound act is the consent (web widget, agent channel).
   */
  readonly consentChannel: Channel | null;
  /** Provider handshake (Meta's hub.challenge). Return null when unsupported. */
  challenge?(req: VerifiedRequest, secrets: ConnectorSecrets): string | null;
  /**
   * Throw `unauthorized()` on a bad signature. Must be constant-time and must
   * reject a timestamp outside `REPLAY_WINDOW_MS`.
   */
  verify(req: VerifiedRequest, secrets: ConnectorSecrets, now: number): Promise<void>;
  /** Raw body to zero or more normalised events. Pure — no I/O, so it is unit-tested. */
  parse(req: VerifiedRequest): InboundEvent[];
  /** Provider media id to bytes. Only called when a message carried media. */
  fetchMedia(providerId: string, secrets: ConnectorSecrets, config: Record<string, unknown>): Promise<{ body: ArrayBuffer; mime: string; filename?: string }>;
  /** Send. Returns the provider's message id for external_ref. */
  send(out: OutboundMessage, secrets: ConnectorSecrets, config: Record<string, unknown>): Promise<{ externalRef: string }>;
}
```

The adapter registry is `apps/api/src/engines/channels/index.ts` —
`const ADAPTERS: Record<string, ChannelAdapter>` with `whatsapp_cloud`,
`email_inbound`, `web_widget`. Adding a BSP is a new file in that directory and
one line in the record. Per docs/16 H10 each ships with an `ExtensionManifest`
literal (`kind: "channel"`) validated by the existing
`validateExtensionManifest`, so the first-party adapters are packaged the same
way a third-party one would be.

### The public webhook

New file `apps/api/src/routes/channels.ts`, mounted in `apps/api/src/index.ts`
next to the other cross-module routers (after line 90):

```ts
app.route("/v1/channels", channelRoutes);
```

and made public by prefix in `apps/api/src/mw.ts:48`:

```ts
  if (PUBLIC.has(c.req.path) || c.req.path.startsWith("/v1/auth/sso/") ||
      c.req.path.startsWith("/v1/portal/") || c.req.path.startsWith("/v1/channels/")) {
```

It sits outside `/v1/orbit` for two reasons: the whole `/v1/orbit` router is
behind `withContext`, and a channel is not ORBIT's property — SIGNAL will send on
the same connector.

Routes:

| Method + path | Purpose |
| --- | --- |
| `GET /v1/channels/:connectorId/inbound` | Provider handshake. Meta sends `hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`; we compare `verify_token` with `timingSafeEqual` and echo the challenge as `text/plain`. Any other provider gets 404. |
| `POST /v1/channels/:connectorId/inbound` | The webhook. |
| `POST /v1/channels/:connectorId/widget/session` | Web widget only: mints a short-lived session token. |
| `POST /v1/channels/:connectorId/widget/message` | Web widget only: posts a message under that token. |

`POST …/inbound` in order, and nothing may be reordered:

1. **Rate limit before anything else.** `env.RATE.idFromName(\`chin:${connectorId}\`)` →
   `hit(60, now)`; over 600/min → 429 with `retry-after`. The counter is keyed on
   the path segment, so an unknown connector cannot be used to hammer D1.
2. **Read the raw body once** (`await c.req.text()`). Signature verification is
   over bytes; re-serialising JSON breaks Meta's HMAC.
3. **Load the connector** by id. Unknown or `status === "disabled"` → 404. Note:
   404 *after* the rate limit, and with no body, so the endpoint is not a tenant
   enumeration oracle.
4. **Build a system Ctx** for `connector.tenantId` using the exact
   `ctxFor(env, {tenantId, locale: "en", actor: {kind: "system", id: "channel", tenantId, grants: []}, policy: PolicyJson.parse({}), entitlements: EntitlementsJson.parse({})}, now)`
   pattern from `index.ts:165-175`. This is where tenancy re-enters: from here
   down, everything is `ctx`-scoped exactly like an authenticated request.
5. **Open the secrets** with `openFields(fieldKey(c.env), connector)` — or read
   `c.env[connector.secretRef]` when `secretRef` is set.
6. **`adapter.verify(req, secrets, now)`.** Throws `unauthorized()`; the handler
   still returns **200** to the provider (see below) but writes nothing.
7. **`adapter.parse(req)`** → `InboundEvent[]`.
8. **Insert one `orbit_channel_events` row per event**, inside the unique index
   on `(connector_id, provider_event_id)`. A duplicate insert is caught and the
   event is skipped — that is the replay/retry defence, and it is the database's
   job, not a cache's.
9. **Ack 200 immediately**, then `c.executionCtx.waitUntil(processChannelEvents(ctx, connector, ids))`.

**Why 200 on a bad signature.** Meta retries 4xx/5xx with backoff for 7 days; a
misconfigured secret would produce a permanent retry storm against a public
endpoint. The rejection is recorded (`orbit_channel_events` row with
`state: "failed"`, `lastError: "signature"`, and `audit(ctx, {action:
"orbit.channel.signature_rejected"})`) and surfaced on the connector admin screen
as `lastError`. The one exception: the handshake `GET` returns 403 on a bad
verify token, because that is a human running setup, not a retry loop.

### Signature verification, per adapter — concretely

| Adapter | Scheme |
| --- | --- |
| `whatsapp_cloud` | Header `x-hub-signature-256: sha256=<hex>`. Compute `hmacHex(appSecret, rawBody)` and compare with `timingSafeEqual`. Meta signs the body only — no timestamp — so replay protection is the `(connector_id, provider_event_id)` unique index plus a `sentAt` sanity window: any message whose `sentAt` is more than `REPLAY_WINDOW_MS` (10 min) from `now` is stored `state: "ignored"`, never processed. |
| `email_inbound` | Mailgun-shape: `timestamp`, `token`, `signature` form fields; `hmacHex(signingKey, \`${timestamp}${token}\`)`, `timingSafeEqual`, and reject `|now/1000 − timestamp| > 300`. `token` is the provider event id, so the unique index doubles as Mailgun's own replay guard. Chosen over SES/SNS first because it is HMAC, like everything else in this repo; SNS needs X.509 chain validation, which is a second adapter and a second ADR. |
| `web_widget` | Two-legged, because a browser cannot hold a secret. `POST /widget/session` checks `origin` against `allowedOrigins`, rate-limits per IP (`env.RATE`, 10/min), and returns `{token, conversationId, expiresAt}` where `token = base64url(payload) + "." + hmacHex(inboundSecret, payload)` and `payload = {cid, conv, exp}`. `POST /widget/message` verifies that HMAC with `timingSafeEqual`, rejects `exp < now`, and rate-limits per token (30/min). The token *is* the signature; there is no unsigned path in. |

`REPLAY_WINDOW_MS = 600_000` and the Mailgun 300 s window are exported constants
in `apps/api/src/engines/channels/index.ts` so a test can assert them without
sleeping.

### Idempotent delivery — three layers, all database-enforced

1. `orbit_channel_events_uq (connector_id, provider_event_id)` — the same webhook
   delivery cannot be processed twice.
2. `orbit_messages_ext_uq (tenant_id, external_ref)` — **already exists**
   (`orbit.ts:53`). The same provider message cannot become two rows even if two
   different deliveries carried it.
3. `orbit_channel_identities_uq (connector_id, handle_hash)` — the same customer
   cannot open two parallel threads on one connector.

No new dedupe cache, no TTL sweeper, no "seen" set in a DO. Three unique indexes.

### Tenant resolution — answered twice

**Primary: the URL.** The connector's id is in the path. Each connector is
provisioned with its own webhook URL, which the admin pastes into Meta / Mailgun
/ the widget snippet. Tenant resolution is a primary-key read. This is the design
because it cannot be spoofed into another tenant: the signature must verify
against *that connector's* secret, so a valid body for tenant A posted to tenant
B's URL fails step 6.

**Fallback: the address.** Some providers can only register one callback per app
(a BSP fronting many WABAs, one Mailgun route for a whole domain). For those,
the connector at the URL is a *dispatcher*: `parse()` yields events carrying the
destination address (`phone_number_id`, `To:` header), and
`resolveConnector(db, provider, address)` reads
`orbit_connectors_addr_uq (provider, address)` — globally unique, deliberately
not tenant-scoped, because at that moment we do not yet know the tenant. The
signature is then re-verified against the *resolved* connector's secret before
anything is written. Two connectors from different tenants claiming the same
address is impossible: the unique index rejects the second insert at admin time,
with a 409 that says so.

Unresolvable address → `orbit_channel_events` row on the dispatcher connector
with `state: "ignored"`, `lastError: "unresolved:<address>"`. Visible, not
silent, and not an error the provider retries into.

### Media handling

`processChannelEvents` (in `apps/api/src/engines/channels/inbound.ts`), per event:

1. Resolve or create the identity row (`channelIdentities`), sealing `handle` and
   `displayName` with the tenant field key.
2. Resolve or create the conversation. Reuse `identity.conversationId` when the
   conversation is not `closed`; otherwise open a new one with
   `channel = adapter.transport`, `connectorId`, `lang` from the provider hint or
   the tenant default, `state: "bot"`, `queuedAt = now`.
3. Call `routeConversation(ctx, conversationId)` (§1B) for a new conversation.
4. Push the turn through the **existing** DO path — `env.AGENT_ROOM.idFromName(\`${tenantId}:${conversationId}\`)` then `room.turn({...})`
   — so inbound webhooks and the staff API converge on one write path
   (`routes/orbit.ts:30-48` already does exactly this). `external_ref` is set on
   the resulting `orbit_messages` row; `checkpoint()` in `orbit-room.ts:60-74`
   gains `externalRef` and `attachmentsJson` passthrough on `RoomTurn`.
5. For each media item, `adapter.fetchMedia(...)` → `env.FILES.put(\`tenants/${tenantId}/orbit/${conversationId}/${externalRef}-${i}\`, body, {httpMetadata: {contentType: mime}})`.
   Cap `MEDIA_MAX_BYTES = 16 * 1024 * 1024` (WhatsApp's document ceiling); over
   it, store nothing and record `{skipped: "too_large", bytes}` in the
   attachment entry. `attachmentsJson` is
   `[{key, mime, bytes, filename?, sha256, skipped?}]`.
6. Media fetch happens inside the same `waitUntil` but **after** the message row
   is committed, so a provider CDN timeout costs an attachment, never the
   message. Failures set `orbit_channel_events.state = "failed"` with
   `attempts += 1`; the cron sweep retries `failed` rows with `attempts < 3`.

Voice: `modality: "voice"` with the audio in R2 and `content` set to the
provider's transcript when it supplies one, `""` otherwise — docs/16 H3's
"normalised transcript" convention. No STT here; `SpeechProvider` is the seam for
that and it stays unimplemented.

### Outbound — closing the `deliveryStatus: "queued"` hole

`conversation.tsx:297` writes `deliveryStatus: "queued"` and nothing reads it.
The dispatch hook is `afterWrite` on the messages resource, which already exists
in the CRUD contract (`apps/api/src/crud.ts:124,443`):

```ts
  r("messages", schema.orbitMessages, "msg", "orbit", { … }, {
    immutable: true,
    pii: { content: "text" },
    serverColumns: ["ts"],
    fixed: (ctx) => ({ ts: ctx.now }),
    afterWrite: async (ctx, row, op, env) => {
      if (op !== "create" || row.deliveryStatus !== "queued") return;
      await dispatchOutbound(ctx, env, row);
    }
  }),
```

`afterWrite` is currently `(ctx, row, op)` — it needs the same fourth `env`
parameter `beforeWrite` already takes (`crud.ts:118-124`). That is a one-word
signature widening, not a redesign.

`dispatchOutbound` (`apps/api/src/engines/channels/outbound.ts`):
1. Load the conversation → connector; no connector (an `agent`-channel or
   seeded conversation) → set `deliveryStatus: "sent"` and stop.
2. **Consent check**: if `adapter.consentChannel !== null`, read
   `currentConsent(ctx, customerId)` — the same helper `orbit-journeys.ts`
   already uses — and refuse on an explicit opt-out with
   `deliveryStatus: "failed"`, `content` untouched, and an audit row. Consent is
   checked outbound and never inbound.
3. **Window check** (WhatsApp): if `identity.windowExpiresAt < now`, the free-form
   send is illegal. Refuse with `deliveryStatus: "failed"` and
   `lastError: "window_closed"`, and surface the reason on the thread. Template
   messages are the fix and are out of scope for this pass —
   `// ponytail: no template catalogue yet; add orbit_channel_templates when a
   tenant needs outside-window sends.`
4. `adapter.send(...)` with `AbortSignal.timeout(10_000)`, mirroring
   `dispatch.ts:146`.
5. Immutability: `orbit_messages` is `immutable: true`, so the delivery status is
   updated by the engine directly on the row (`ctx.db.update`), not through the
   API. Same exception the room checkpoint already takes. `external_ref` is
   stamped from the provider's returned id, which is what later matches the
   provider's delivery receipt back to this row.

Receipts (`InboundEvent.kind === "status"`) update `deliveryStatus` by
`external_ref` — the reason that column is on `orbit_messages` at all.

## 1D. CRUD surfaces

### Channel connector admin

| | |
| --- | --- |
| Route | `route("orbit/channels", "routes/orbit-channels.tsx")` in `apps/web/app/routes.ts`, in the ORBIT block after line 55. |
| API | Generated CRUD from `apps/api/src/resources.ts`: `r("channel-connectors", schema.orbitChannelConnectors, "chc", "orbit", { read: "orbit:channels:read", create: "orbit:channels:write", update: "orbit:channels:write", remove: "orbit:channels:write" }, { pii: { inboundSecret: "text", outboundSecret: "text", verifyToken: "text" }, serverColumns: ["status", "lastInboundAt", "lastErrorAt", "lastError"], actorColumns: ["createdBy"] })`. Secrets are write-only: the `pii` sealer masks them on read without `core:pii:view`, and the screen never renders them, only "set / not set". |
| Loader | `{ locale, may: {read, write, connect}, connectors: Page<Connector>, adapters: {provider, transport, needs: string[]}[], webhookBase: string, recent: Page<ChannelEvent> }` — `recent` is the last 20 `orbit_channel_events` for the tenant, which is the only debugging surface an integrator gets. |
| Action intents | `create` (provider + name + address), `secrets` (paste inbound/outbound secret; requires `orbit:channels:secrets_rotate`), `verify` (POST `/v1/orbit/channels/:id/verify` — sends a provider-side ping and flips `status` to `active` on success), `disable`, `enable`. |
| Empty state | `EmptyState title="No channels connected" body="WhatsApp, email and the web widget all arrive here. Connect one to start receiving messages."` with a primary action per available adapter. |
| Copy-out | Each connector row shows its webhook URL `${webhookBase}/v1/channels/${id}/inbound` and its verify token as a copy button — the two strings an admin must paste into Meta. |

The `verify` action is a hand-written route because it makes an outbound call and
flips a `serverColumn`; everything else is generated CRUD.

### Teams, members, presence, routing rules, SLA policies

All five are plain generated CRUD rows in `resources.ts`:

```ts
  r("teams", schema.orbitTeams, "tm", "orbit", rw("orbit:teams"), { searchable: ["key"] }),
  r("team-members", schema.orbitTeamMembers, "tmm", "orbit", rw("orbit:teams")),
  r("presence", schema.orbitAgentPresence, "prs", "orbit", {
    read: "orbit:presence:read", create: "orbit:presence:write", update: "orbit:presence:write"
  }, {
    // An agent may only write their own row; a supervisor with orbit:teams:write may write any.
    beforeWrite: (ctx, values, existing) => {
      const target = (existing?.userId ?? values.userId) as string;
      if (target !== ctx.actor.id && !can(ctx.actor, "orbit:teams:write", { tenantId: ctx.tenantId, module: "orbit" })) {
        throw forbidden("presence is your own");
      }
      return values;
    }
  }),
  r("routing-rules", schema.orbitRoutingRules, "rrl", "orbit", rw("orbit:teams")),
  r("sla-policies", schema.orbitSlaPolicies, "sla", "orbit", rw("orbit:teams")),
```

**Workforce / roster view**: `route("orbit/workforce", "routes/orbit-workforce.tsx")`.
Loader `{ locale, may, teams, members, presence, queueDepth: {teamId, waiting, oldestWaitMs}[], breaching: LiveConversation[] }` from
`GET /v1/orbit/workforce` (one hand-written aggregate, because six round trips
for one screen is the thing loaders exist to avoid). Action intents:
`presence` (set own status), `reassign` (requires `orbit:conversations:route`),
`capacity` (change a member's `maxConcurrent`), `addMember`, `removeMember`.
Empty state: `"No teams yet — every conversation goes to the default queue."`

### KB / article manager

```ts
export const kbArticles = sqliteTable(
  "orbit_kb_articles",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    key: text("key").notNull(),
    locale: text("locale").notNull().default("en"),
    version: integer("version").notNull().default(1),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** string[] — used both as retrieval filter and as the deflection index. */
    tagsJson: text("tags_json"),
    /** Where the answer comes from, so a grounded reply can cite something real. */
    sourceRef: text("source_ref"),
    status: text("status").notNull().default("draft"), // draft|published|retired
    /** Set when the published body was last embedded, so the sweeper knows what is stale. */
    embeddedAt: integer("embedded_at"),
    publishedBy: text("published_by"),
    publishedAt: integer("published_at"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [
    uniqueIndex("orbit_kb_uq").on(t.tenantId, t.key, t.locale, t.version),
    index("orbit_kb_live_idx").on(t.tenantId, t.status, t.locale)
  ]
);
```

Route `route("orbit/knowledge", "routes/orbit-kb.tsx")`. Resource:
`r("kb-articles", schema.orbitKbArticles, "kba", "orbit", { read: "orbit:kb:read", create: "orbit:kb:write", update: "orbit:kb:write", remove: "orbit:kb:write" }, { searchable: ["title", "body"], actorColumns: ["createdBy"] })`.
Publishing is a hand-written `POST /v1/orbit/kb-articles/:id/publish` requiring
`orbit:kb:publish`, because it sets `serverColumns` and triggers the embed.
Loader `{ locale, may, articles: Page<Article>, locales: string[], staleCount: number }`.
Intents: `save`, `publish`, `retire`, `newVersion`.
Empty state: `"No articles yet. The assistant answers from what you write here — start with the five questions you answer most."`

Embedding: `embedUpsert` (`apps/api/src/engines/vectorize.ts`, already used by
`resources.ts`) into **`VEC_CONVO`** with metadata `{kind: "kb", articleId, key,
locale, tenantId}`. Reusing the existing index rather than adding a `VEC_KB`
binding avoids a wrangler change in every environment; retrieval filters on
`kind`. `// ponytail: shared index; split to VEC_KB if conversation recall and KB
retrieval ever need different dimensions.`

### Macros

```ts
export const macros = sqliteTable(
  "orbit_macros",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    key: text("key").notNull(),
    locale: text("locale").notNull().default("en"),
    nameJson: text("name_json").notNull(),
    /** Body with {slot} placeholders filled from the conversation context. */
    body: text("body").notNull(),
    tagsJson: text("tags_json"),
    /** Macros that state a price or a coverage decision are not one-click. */
    consequential: integer("consequential", { mode: "boolean" }).notNull().default(false),
    usageCount: integer("usage_count").notNull().default(0),
    status: text("status").notNull().default("active"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [uniqueIndex("orbit_macros_uq").on(t.tenantId, t.key, t.locale)]
);
```

No dedicated screen. Macros surface **inside** `conversation.tsx` as a
`<datalist>`-backed insert control above the reply box, and are managed through
the generic `/orbit/macros` list that `routes/module.tsx` already renders for any
registered resource. Building a bespoke macro CRUD screen when the generic one
exists is the definition of unnecessary work.

### Journey builder that executes

The screen exists: `route("orbit/journeys/:id/builder", "routes/orbit-journey.tsx")`
(`routes.ts:88`). What is missing is the runtime.

`advanceJourneys(ctx)` added to `apps/api/src/engines/orbit-journeys.ts`, run from
cron. It scans on the index that already exists
(`orbit_journey_runs_due_idx (tenant_id, state, next_at)`):

```ts
export interface JourneyNode {
  id: string;
  kind: "wait" | "send" | "branch" | "task" | "end";
  /** wait: milliseconds, or an ISO-ish {days,hours} the builder writes. */
  waitMs?: number;
  /** send: which macro/template, on which channel. */
  macroKey?: string;
  channel?: string;
  /** branch: flat predicates over contextJson + customer, first match wins. */
  cases?: { when: Record<string, unknown>; to: string }[];
  /** task: an ORBIT tool name from ORBIT_TOOL_DEFS, args templated from context. */
  tool?: string;
  args?: Record<string, unknown>;
}

/** One tick. Returns counts so the cron log says something useful. */
export async function advanceJourneys(ctx: Ctx, limit = 200): Promise<{ advanced: number; halted: number; sent: number }>;
```

Per due run, in a bounded loop of at most `MAX_STEPS_PER_TICK = 20` node
transitions (a graph with a cycle must not spin a Worker to its CPU limit):

- `wait` → `state: "waiting"`, `nextAt = now + waitMs`, return.
- `send` → resolve the macro for the run's locale, resolve the customer's
  connector for `node.channel`, **re-check consent and the reply window through
  the same `dispatchOutbound` path** (a journey send is an outbound send and gets
  no special exemption), insert the message. Emit `orbit.journey.sent`.
- `branch` → evaluate `cases` in order against `contextJson`; no match → the
  edge with no `when`; still no match → `state: "halted"`,
  `contextJson.haltReason = "no_branch"`.
- `task` → `runOrbitTool(ctx, node.tool, args)` through the **existing** registry,
  so a journey cannot call a tool the tool registry does not know, and a
  consequential tool raises `approval_required`, which parks the run as
  `state: "waiting"` with `contextJson.approvalId` and no `nextAt` (a human
  decision, not a timer).
- `end` → `state: "done"`.

The unremovable floors already in `triggerJourney` (cooldown ≥ 1 day at
`orbit-journeys.ts` ORB-051, consent-withdrawn skip) are re-checked on every
`send`, not only at trigger, because a customer can withdraw consent mid-journey.

### Self-service deflection

Public, reusing the already-public `/v1/portal/` prefix rather than opening a new
unauthenticated surface:

`POST /v1/portal/:tenantSlug/ask` → `{question, locale, sessionRef}` →
`{answer, citations: [{articleId, title, sourceRef}], confidence, escalate: boolean}`.
Rate-limited per IP via `env.RATE` at 20/min. Grounded strictly in published KB
articles (§2G); `escalate: true` whenever confidence is below the threshold or no
article scored above the retrieval floor, in which case the response carries a
`conversationId` opened on the tenant's `web_widget` connector so the visitor
lands in the same queue as everyone else.

```ts
export const deflections = sqliteTable(
  "orbit_deflections",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    sessionRef: text("session_ref").notNull(),
    question: text("question").notNull(),
    /** Which articles were cited, so a bad answer is traceable to a bad article. */
    citationsJson: text("citations_json"),
    aiAuditId: text("ai_audit_id"),
    confidence: integer("confidence"), // 0..100
    outcome: text("outcome").notNull().default("answered"), // answered|escalated|abandoned
    conversationId: text("conversation_id"),
    ts: integer("ts").notNull()
  },
  (t) => [index("orbit_deflections_idx").on(t.tenantId, t.outcome, t.ts)]
);
```

Web route `route("orbit/deflection", "routes/orbit-deflection.tsx")` (staff-side
review of what the self-service layer answered). Loader
`{ locale, may, deflections: Page<Deflection>, rate: {answered, escalated} }`.
Intents: `promote` (turn a frequently-escalated question into a KB article
draft), `flag`. Empty state: `"Nothing asked yet. Questions answered without a
human land here."`

## 1E. Reporting

One hand-written endpoint, because a single screen wants all of it and six
generic list calls per render is a worse answer:

`GET /v1/orbit/ops-report?since=<ms>&until=<ms>&grain=day|week&teamId=&channel=`
requires `orbit:conversations:read`, returns:

```ts
interface OpsReport {
  volume: { bucket: string; opened: number; closed: number; byChannel: Record<string, number> }[];
  backlog: { teamId: string | null; waiting: number; assigned: number; oldestWaitMs: number }[];
  firstResponse: { bucket: string; p50Ms: number; p90Ms: number; withinSla: number; total: number }[];
  resolution:   { bucket: string; p50Ms: number; p90Ms: number; withinSla: number; total: number }[];
  deflection:   { bucket: string; answered: number; escalated: number };
  qa:           { rubricKey: string; agentMean: number; reviewerMean: number; scored: number; disputed: number }[];
  scorecards:   AgentScorecard[];
}

interface AgentScorecard {
  userId: string;
  handled: number;
  frtP50Ms: number | null;
  ahtP50Ms: number | null;
  csatMean: number | null;      // 1..5, null when fewer than K responses
  qaMean: number | null;
  draftsShown: number;
  draftsAccepted: number;       // accepted + edited, matching /v1/ai/suggestions/acceptance
  reopens: number;
}
```

Computation, all from existing columns:

- **volume**: `count(*)` grouped on `strftime` bucket of `createdAt` /
  `closedAt`, split by `channel`.
- **backlog**: point-in-time; `state != 'closed'` grouped by `teamId`, with
  `waiting = assigneeRef IS NULL`, `oldestWaitMs = now - min(queuedAt)`.
- **firstResponse**: `firstResponseMs` where not null;
  `withinSla = count(frtBreachedAt IS NULL)`.
- **resolution**: `closedAt - createdAt`; `withinSla = count(resolutionBreachedAt IS NULL)`.
- **deflection**: `orbit_deflections` grouped by `outcome`.
- **qa**: `orbit_qa_scores` split on `scoredBy LIKE 'agent:%'` — the split
  `orbit-quality.tsx:68` already makes client-side, moved server-side so the
  average is over the whole period rather than the first 50 rows.
- **scorecards**: grouped on `assigneeRef`; `draftsShown/Accepted` from
  `ai_suggestions` where `module = 'orbit' AND surface = 'draft' AND userId = …`.

**Percentiles** are `ORDER BY … LIMIT 1 OFFSET ceil(n*p)-1`, matching
`quoteLatencyP95` in `north-snapshotter.ts:86-103`, and carry the same
`// ponytail:` note about volume.

**k-anonymity**: `csatMean` is suppressed to `null` below `DEFAULT_K_FLOOR`
responses using the existing `checkKAnonymity` helper — a scorecard built on two
survey responses is a disciplinary hazard, not a metric.

Screen: extend the existing `route("orbit/analytics", "routes/orbit-analytics.tsx")`
rather than adding a route. Empty state per panel:
`"No conversations in this window."`

## 1F. Analytics / KPIs

Registered in `north_metrics` (seeded, not hard-coded) with a typed compute in
`REGISTRY` at `apps/api/src/engines/north-snapshotter.ts:196-207`. Conventions
inherited exactly: percent/ratio metrics are **basis points** (`Math.round(x *
10_000)`), money is **minor units**, durations are **ms**, `null` means "no
denominator" and writes no snapshot.

| `north_metrics.key` | unit | direction | grain | Computation |
| --- | --- | --- | --- | --- |
| `cx_csat` | percent | up | day, month | `avg(orbit_conversations.csat)` over conversations with `closedAt` in window and `csat NOT NULL`, normalised: csat is 1–5, so `round(((mean − 1) / 4) × 10_000)`. Null below `DEFAULT_K_FLOOR` responses. |
| `cx_fcr` | percent | up | day | Conversations closed in window with `reopenCount = 0` **and** no other conversation for the same `customerId` opened within 7 days of `closedAt`, over all closed. The second clause is what makes it *first contact* resolution and not *no reopen*. |
| `cx_aht_ms` | duration_ms | down | day | Median of `closedAt − createdAt` over conversations closed in window whose `state` path included `human` (i.e. `assignedAt NOT NULL`). Bot-only conversations are containment, not handling time, and averaging them in flatters AHT. |
| `cx_sla_attainment` | percent | up | day, month | `count(firstResponseMs IS NOT NULL AND frtBreachedAt IS NULL) / count(firstResponseMs IS NOT NULL)` × 10 000. Denominator excludes conversations still awaiting a first response so a busy hour does not retroactively rewrite yesterday. |
| `cx_containment_rate` | percent | up | day | Conversations closed in window with `assignedAt IS NULL` over all closed. "The bot finished it." |
| `cx_deflection_rate` | percent | up | day | `orbit_deflections` `outcome = 'answered'` over all rows in window. Kept separate from containment because they answer different questions: containment is "a conversation that never needed a person", deflection is "a question that never became a conversation". |
| `cx_draft_acceptance_rate` | percent | up | day, month | From `ai_suggestions` where `module = 'orbit' AND surface = 'draft'`: `(accepted + edited) / shown` × 10 000. Identical arithmetic to `/v1/ai/suggestions/acceptance` (`routes/ai.ts:333`) — one definition, computed in one place and snapshotted in the other. |
| `cx_cost_per_contact` | money (minor) | down | day, month | `sum(ai_audit_log.cost_micro WHERE module='orbit') / MICRO_PER_MINOR / count(conversations created in window)`. Same shape as `aiCostPerCase` (`north-snapshotter.ts:175-189`); model cost only, because staff cost is not in this system and a made-up loaded rate would be worse than an honest partial number. Documented in the metric's `nameJson` description. |

Grain choice: day for everything (the snapshotter's `periodsFor` writes yesterday
closed + month-to-date), month additionally for the four board-level numbers —
CSAT, SLA attainment, draft acceptance, cost per contact. Rate metrics that are
noisy at day grain still get a day row because the anomaly hunter needs a series;
`anomalyThresholdBp` already uses the wider 500 bp band for percent units.

`ai_cost_per_case` (existing) is untouched. `cx_cost_per_contact` is a second
metric, not a redefinition — AXIS cases and ORBIT contacts are different
denominators.

## 1G. AI at the core (channel side)

Covered in full under §2G. The channel-specific pieces are: intent
classification and language detection run on the **inbound** path so the routing
rules in §1B have something to match on, and both are cheap-tier calls attached
to the same run as the draft (one round trip, not three).

## 1H. Implementation plan — channels

Tasks are globally numbered T1…T27 across both capabilities so the order is
unambiguous. Each names its failing test first.

| # | Task | Failing test first |
| --- | --- | --- |
| T1 | `ChannelAdapter`, `InboundMessage`, `DeliveryReceipt`, `InboundEvent` in `packages/core/src/seams.ts`; `consentChannel` reconciliation documented. | `packages/core/src/seams.test.ts` — `"a ChannelAdapter declares the consent channel that governs its outbound"` and `"@seam:H10 every first-party adapter validates as an extension manifest"` |
| T2 | Migration `0016_orbit_channels.sql`: `orbit_channel_connectors`, `orbit_channel_events`, `orbit_channel_identities` + indexes. | `packages/db/src/schema.test.ts` — `"orbit channel tables carry tenant_id and their unique indexes"` |
| T3 | `whatsapp_cloud` adapter `verify` + `parse` (pure halves only). | `apps/api/src/engines/channels/whatsapp.test.ts` — `"rejects a body whose x-hub-signature-256 does not match"`, `"parses a Cloud API text message into one InboundEvent"`, `"ignores a message whose timestamp is outside the replay window"` |
| T4 | `email_inbound` adapter `verify` + `parse`. | `apps/api/src/engines/channels/email.test.ts` — `"rejects a Mailgun signature older than 300 seconds"` |
| T5 | `web_widget` session token mint + verify. | `apps/api/src/engines/channels/widget.test.ts` — `"a widget token forged with the wrong key is refused"`, `"an expired widget token is refused"` |
| T6 | `POST/GET /v1/channels/:id/inbound` incl. the `mw.ts` public prefix, rate limit, connector load, system Ctx, event insert, 200-ack. | `apps/api/src/routes/channels.test.ts` — `"an unauthenticated inbound webhook reaches the handler"`, `"a replayed delivery writes exactly one orbit_channel_events row"`, `"a bad signature is recorded and still answers 200"`, `"an unknown connector id answers 404 with no body"` |
| T7 | `resolveConnector(provider, address)` fallback + re-verification against the resolved connector. | `apps/api/src/routes/channels.test.ts` — `"a shared-app delivery resolves its tenant from the destination address"`, `"a body signed for tenant A posted to tenant B's connector is refused"` |
| T8 | `processChannelEvents`: identity, conversation, DO turn with `externalRef`; `RoomTurn` gains `externalRef`/`attachments`. | `apps/api/src/engines/channels/inbound.test.ts` — `"two deliveries of the same provider message create one orbit_messages row"`, `"a second message from the same handle reuses the open conversation"` |
| T9 | Media fetch to R2 with the 16 MB cap. | `apps/api/src/engines/channels/inbound.test.ts` — `"an oversized attachment is skipped without losing the message"` |
| T10 | Migration `0017_orbit_routing.sql`: teams, members, presence, rules, SLA policies, plus the `orbit_conversations` columns and queue index. | `packages/db/src/schema.test.ts` — `"orbit_conversations carries priority and sla due columns"` |
| T11 | `pickRoute` + `pickAssignee` (pure). | `apps/api/src/engines/orbit-routing.test.ts` — `"the first matching rule wins"`, `"an agent at maxConcurrent is not picked"`, `"ties break on longest idle then userId"` |
| T12 | `routeConversation` + SLA stamping. | `apps/api/src/engines/orbit-routing.test.ts` — `"a routed conversation gets a team, a priority and both due timestamps"` |
| T13 | `sweepRouting` (breach, escalation, absence reassignment, presence expiry) wired into `index.ts` cron. | `apps/api/src/engines/orbit-routing.test.ts` — `"a first-response breach raises priority once and emits orbit.sla.breached"`, `"a stale agent's conversations return to the queue"` |
| T14 | `dispatchOutbound` + the `afterWrite(ctx, row, op, env)` widening in `crud.ts`. | `apps/api/src/engines/channels/outbound.test.ts` — `"a queued agent message is sent and stamped with the provider ref"`, `"an outbound send to a withdrawn consent is refused, not sent"`, `"a send outside the WhatsApp window fails with window_closed"` |
| T15 | Delivery receipts update `deliveryStatus` by `external_ref`. | `apps/api/src/engines/channels/inbound.test.ts` — `"a delivery receipt marks the matching message delivered"` |
| T16 | Connector admin screen + `POST /v1/orbit/channels/:id/verify`. | `apps/web/app/routes/orbit-channels.test.tsx` — `"the empty state names the three connectable channels"`, `"secrets are never rendered, only set/not-set"` |
| T17 | Workforce screen + `GET /v1/orbit/workforce`. | `apps/web/app/routes/orbit-workforce.test.tsx` — `"reassign is hidden without orbit:conversations:route"` |
| T18 | `advanceJourneys` (wait/send/branch/task/end) wired into cron. | `apps/api/src/engines/orbit-journeys.test.ts` — `"a wait node resumes only after its delay"`, `"a send node re-checks consent at send time, not only at trigger"`, `"a cyclic graph stops at MAX_STEPS_PER_TICK"`, `"a consequential task node parks the run on approval_required"` |
| T19 | `GET /v1/orbit/ops-report` + the analytics screen panels. | `apps/api/src/routes/orbit.test.ts` — `"the ops report suppresses a CSAT mean below the k floor"` |
| T20 | The eight `cx_*` metrics + computes in the snapshotter registry, and their seed rows. | `apps/api/src/engines/north-snapshotter.test.ts` — `"cx_sla_attainment excludes conversations still awaiting a first response"`, `"cx_containment_rate counts only conversations that never reached a human"` |

Journey acceptance (the milestone-level failing spec that gates the lot):
`apps/e2e/specs/orbit-whatsapp.spec.ts` tagged `@journey:J-O1` —
`"an Arabic WhatsApp message arrives, is routed to a team, and is answered"`,
matching `docs/modules/orbit.md §8`.

---

# CAPABILITY 2 — The AI draft loop

Today nothing produces a draft. The console that consumes one is already built.

## 2A. Role design

The permission keys are in §1A. What matters here is the **three-way split**:

| Question | Answered by | Where |
| --- | --- | --- |
| May this human make the model draft? | `orbit:drafts:generate` | `require_` in the draft route/engine |
| May this human put words on the wire? | `orbit:messages:send` | already enforced by the messages resource |
| May the model put words on the wire with no human? | `ai_agents.autonomyLevel` | the producer, per §2A table below |

**Agent vs supervisor vs admin.**

- **Agent** (`orbit.agent`): `orbit:drafts:generate` + `orbit:messages:send`. Sees
  the draft, may accept it verbatim, may edit and send, may discard. Cannot
  change the agent's autonomy, cannot approve a consequential tool call.
- **Trainee** (`orbit.agent` minus `orbit:messages:send`): may generate and read
  drafts; every send is somebody else's. This is the "who can only draft" case
  and it needs no new machinery.
- **Supervisor** (`orbit.lead`): everything an agent has plus
  `orbit:conversations:route`, `orbit:qa:score`, `orbit:renewals:update`. Approves
  the consequential ORBIT tools whose policies name a permission they hold
  (`orbit.renewal_offer` → `orbit:renewals:approve`).
- **Admin** (`orbit.admin`, `orbit:*:*`): plus `ai:agents:write` from the AI
  bundle to raise autonomy — which is itself `dualControl: "always",
  neverAutoApprove` (`approvals.ts:131`), so an admin cannot unilaterally let the
  model send.

**What the autonomy policy controls, exactly.** `ai_agents.autonomyLevel` uses the
`suggest | act_with_approval | act_within_limits | autonomous` vocabulary of
`routes/ai.ts:484` (F39 notes three competing vocabularies; this design picks the
one the API already validates and leaves the reconciliation to its own ADR rather
than smuggling it in here):

| Level | Draft written? | `deliveryStatus` on the draft row | Tool calls |
| --- | --- | --- | --- |
| `suggest` | yes | `null` — human must approve | read-only tools only |
| `act_with_approval` | yes | `null` | consequential tools run behind `gate()` |
| `act_within_limits` | yes | `"queued"` **iff** every limit below holds, else `null` | as above |
| `autonomous` | yes | `"queued"` unless a guardrail flag fired | as above |

The limits for `act_within_limits`, all of which must hold:

1. `run.confidence >= tenant policy floor` (default 75, on `PolicyJson`).
2. `conversation.state === "bot"` — a conversation a human has taken is never
   auto-sent into.
3. `final.flags` is empty (the gateway's guardrail output, `routes/ai.ts:167`).
4. The classified `intent` is on the tenant's ORBIT auto-send allowlist —
   reusing `ctx.policy.autoApprove` semantics, keyed `orbit.autosend:<intent>`.
5. No tool call in the run was `consequential`.
6. `channel !== "voice"`.

Failing any one of them downgrades to a draft. It never fails the turn — a
conversation with no reply is worse than a slow one.

## 2B. Routing and queueing (draft side)

The producer is not a queue of its own. Two triggers, both existing surfaces:

**Trigger 1 — inline, in `AgentRoom.turn()`** (`apps/api/src/engines/agent-room.ts`),
immediately after `checkpoint()` and beside the existing `embedFlushed` call,
which already demonstrates building a system Ctx and a `Gateway` from inside a
Durable Object. Conditions: the flushed turn's role is `customer`, the
conversation is not `closed`, and the tenant has ORBIT drafting enabled. This is
the normal path and it is where latency matters — docs/15's ambient budget wants
the draft present when the agent opens the thread.

**Trigger 2 — cron catch-up**, `draftSweep(ctx)` in the per-tenant loop at
`index.ts:176-196`. Picks conversations where the newest message is `customer`,
older than `DRAFT_LAG_MS` (90 s), with no `agent_ai` message after it and no
`ai_runs` row in flight for that `subjectRef`. This covers DO eviction, a failed
inline call, and any inbound path that bypassed the room. Capped at 50
conversations per tenant per tick so one backlogged tenant cannot eat the
scheduler.

Both call the same function. Neither is a queue, because a third mechanism to
operate is a third mechanism to page someone about.

Concurrency guard: before producing, `SELECT 1 FROM ai_runs WHERE tenant_id = ?
AND subject_ref = ? AND state = 'running' AND started_at > now − 120_000` — if a
run is in flight, return. Cheap, uses the row the producer writes anyway, and
prevents the inline and cron triggers from double-billing the tenant.

## 2C. Data model (draft side)

**No new tables.** This is the point of the design: `conversation.tsx:189-210`
already discovers a draft as "the trailing `orbit_messages` row with
`role = 'agent_ai'`, `deliveryStatus IS NULL`, `aiAuditId` set", joined to
`ai_runs` on `outputRef = aiAuditId` and `subjectRef = conversationId`. The
producer's entire contract is to write that pair.

Two column additions, both on tables that exist:

```ts
// ai_runs — packages/db/src/schema/ai.ts
    /** 0..100. What the console's ConfidenceMeter renders; today it has nothing to read. */
    confidence: integer("confidence"),
    /** string[] of evidence refs (kb article ids, policy ids) the reply is grounded in. */
    groundingJson: text("grounding_json"),
```

`evidenceJson` already exists on `ai_runs` but holds `{flags, model, provider}`
(`routes/ai.ts:167`) — provenance, not citations. Overloading it would break the
explainability view; `groundingJson` is the citation list `EvidenceLink` needs.

And one on `orbit_conversations`, already listed in §1B: `intent` and `sentiment`
exist (`orbit.ts:20-21`) and are simply never written today. The producer writes
them.

## 2D. CRUD surfaces (draft side)

**`conversation.tsx` needs no change for the happy path.** That is the design
constraint that shaped everything above. What it gains:

| Addition | Why |
| --- | --- |
| A `regenerate` action intent → `POST /v1/orbit/conversations/:id/draft`, requires `orbit:drafts:generate`. | The agent who does not like the draft has one control that is not "write it yourself". |
| A macro insert control above the reply box, populated from `/v1/orbit/macros?locale=…&status=active`. | §1D. |
| `ConfidenceMeter` fed from `run.confidence` instead of nothing. | The component is already imported and rendered. |
| `EvidenceLink` entries from `run.groundingJson`, each linking to `/orbit/kb-articles/:id`. | docs/15: an AI artifact carries an inspectable "why". |
| An `ai_suggestions` `shown` row posted on render (surface `"draft"`, module `"orbit"`, `runId`, `subjectRef`) and an outcome row on approve (`accepted`), edit-then-send (`edited`, with `editDistance`), or discard (`dismissed`). | This is what makes `cx_draft_acceptance_rate` a real number rather than a guess, and it uses `POST /v1/ai/suggestions` + `/:id/outcome`, which already exist (`routes/ai.ts:241-298`). |

New API route (hand-written, mounted in `routes/orbit.ts` before generated CRUD):

```
POST /v1/orbit/conversations/:id/draft   → { runId, messageId, confidence, autoSent }
```

Requires `orbit:drafts:generate`; `must(ctx, schema.orbitConversations, id, "conversation")`
for tenancy; 409 when a run is already in flight.

Empty states: a conversation with no draft and drafting disabled shows nothing at
all — no placeholder, no spinner, no "AI is thinking". docs/15 §4 is explicit that
a background draft either arrives or does not; an empty promise box is the
anti-pattern.

## 2E. Reporting (draft side)

Folded into §1E's `OpsReport.scorecards` (`draftsShown`, `draftsAccepted`) and the
existing `GET /v1/ai/suggestions/acceptance`, which already computes acceptance
per `module/surface`. No new endpoint. A surface whose acceptance rate falls is
supposed to be visible in the place every other AI surface is measured, not in a
bespoke ORBIT chart.

## 2F. Analytics / KPIs (draft side)

`cx_draft_acceptance_rate` in §1F. Plus one operational number that is not a
board metric and therefore is *not* snapshotted — draft latency p90 — read from
`ai_runs.latencyMs` filtered to `purpose = 'orbit.draft_reply'` in the AI console
that already renders run detail (`routes/ai-run.tsx`). Adding a ninth
`north_metrics` row for an engineering number would put it in front of a board
that cannot act on it.

## 2G. AI at the core

All calls go through `packages/model-gateway`. The producer never touches a
provider SDK.

### The shared producer

`apps/api/src/engines/agent-run.ts` — extracted from the body of
`aiRoutes.post("/runs")` (`routes/ai.ts:50-198`), which becomes a thin caller:

```ts
export interface AgentRunInput {
  agentKey: string;
  purpose: string;
  subjectRef?: string;
  locale?: "en" | "ar";
  input: string;
  context?: Record<string, unknown>;
  trigger: "user" | "event" | "schedule" | "api";
  /** Extra retrieval the caller already resolved (KB chunks, policy facts). */
  grounding?: { ref: string; title: string; text: string }[];
}

export async function runAgent(ctx: Ctx, gateway: Gateway, input: AgentRunInput): Promise<AgentRunResult>;
```

Extraction, not duplication: the ai_runs bookkeeping, the two-completion tool
loop, the refusal handling and the usage accounting are already correct and are
exactly what the draft producer needs. The route keeps its permission check and
its 201.

While extracting, one F37 fix rides along because it is one line and the
extraction touches the same code: `checkInput` in `packages/model-gateway/src/gateway.ts:69-71`
only scans `role === "user"`, while `executeOrbitToolCalls` returns
`{role: "tool"}` messages (`orbit-tools.ts:238`) that carry provider-controlled
text straight into the second completion. Widen the scan to
`role === "user" || role === "tool"`. Its failing test is named in T21.

### The draft producer

`apps/api/src/engines/orbit-draft.ts`:

```ts
export const DRAFT_PURPOSE = "orbit.draft_reply";

export async function draftReply(
  ctx: Ctx,
  gateway: Gateway,
  env: Env,
  conversationId: string
): Promise<{ runId: string; messageId: string; autoSent: boolean } | null>;
```

Steps:

1. Load the conversation and the last `TRANSCRIPT_TURNS = 20` messages.
2. **Classify** — one cheap-tier gateway call, `purpose:
   "orbit.classify_turn"`, `responseSchema` (the field already exists on
   `ModelRequest`) returning
   `{intent: string, sentiment: number, lang: string, escalationRisk: number, requiredSkills: string[]}`.
   Write `intent`, `sentiment`, `lang` onto the conversation; feed
   `requiredSkills` into `routeConversation`. One call, not four, because
   intent/sentiment/language/escalation all read the same last turn and four
   round trips would blow the latency budget for no accuracy gain.
3. **Retrieve** — `embedQuery(ctx, gateway, env.VEC_CONVO, {module: "orbit",
   purpose: "orbit.kb.retrieve", text, topK: 5, filter: {tenantId, kind: "kb",
   locale}})`, then load those `orbit_kb_articles` rows and keep the ones above
   the score floor (`KB_SCORE_FLOOR = 0.72`).
4. **Draft** — `runAgent(ctx, gateway, {agentKey: "orbit.assistant", purpose:
   DRAFT_PURPOSE, subjectRef: conversationId, locale: conversation.lang, input:
   transcript, grounding: kbChunks, trigger: "event"})`. The agent row supplies
   the tier, the versioned prompt and the autonomy level, so none of those are in
   this file.
5. **Confidence** — the model returns it inside the structured response
   (`{reply, confidence, citations}` via `responseSchema`), clamped 0..100 and
   floored to 0 when `citations` is empty and the intent is one that requires
   grounding (anything factual about a policy, a price or a claim). A
   self-reported confidence with no citation behind it is not evidence.
6. **Write the pair** — `ai_runs` (already written by `runAgent`, now with
   `confidence` and `groundingJson`) and one `orbit_messages` row
   `{role: "agent_ai", content: reply, aiAuditId: result.auditId,
   deliveryStatus: autoSend ? "queued" : null}`. The `"queued"` branch triggers
   `dispatchOutbound` through `afterWrite` — one send path for humans and models
   alike, which is what stops an autonomous send from skipping the consent and
   window checks.
7. Emit `orbit.draft.created` with `{conversationId, runId, autoSent, confidence}`.

### Escalation prediction

`escalationRisk` from step 2, 0..100. It is **not** an autonomy input; it is a
routing input. A `routing_rules` match on `sentimentBelow` plus an
`escalationRisk` threshold sets `priority: 0` and targets the supervisor seat.
Human decision boundary: the model never closes, transfers, or compensates — it
raises the priority of a queue a human already watches.

### Summarisation on handover

`orbit_handover_notes` exists (`orbit.ts:195-210`) with `generatedBy` defaulting
to `"ai"` and an `acceptedBy` column that nothing writes. Producer:
`summariseForHandover(ctx, gateway, conversationId)`, `purpose:
"orbit.handover_summary"`, triggered from the existing `handover` intent in
`conversation.tsx:309`. Writes `summary` + `factsJson` (`{policyRefs, claimRefs,
promises, openQuestions}`), `generatedBy: "ai"`, `acceptedBy: null`. The
receiving agent's "accept" sets `acceptedBy` — the human decision boundary is
that an unaccepted summary is displayed with the ✦ mark and is never treated as
the record of what was said.

### QA auto-scoring

`packages/model-gateway/src/cx-judge.ts` is built, versioned (`cx-rubric-v1`),
eval-gated, and called by nothing. Wire it: `scoreClosedConversations(ctx,
gateway)` in the nightly `isBackupWindow` branch of the cron loop, sampling
`QA_SAMPLE_RATE` (default 20%, tenant-configurable) of conversations closed in
the last 24 h that have no `agent:` score.

For each: build `CxSample {locale: conversation.lang, context: transcript, reply:
lastAgentMessage}`, run `cxJudgePrompt` through the gateway `CX_JUDGE_SAMPLES`
(5) times, `aggregateCxScore` the replies, and insert `orbit_qa_scores`
`{rubricKey: CX_JUDGE_VERSION, score: round(median × 20), scoredBy:
"agent:cx-judge", breakdownJson: {dimensions, why, samples: 5}}` — ×20 because
the judge is 1–5 and the column is 0–100 (`orbit.ts:219`).
`orbit-quality.tsx:68` already renders `scoredBy` starting `agent:` as the
agent's read with an inspectable breakdown, and a reviewer correction is already
a new row. Zero UI change.

Human decision boundary: an auto-score is never disciplinary evidence on its own.
`orbit_qa_scores.disputedBy` exists; the screen notes today that the API cannot
set it (`orbit-quality.tsx:171`). Add `POST /v1/orbit/qa-scores/:id/dispute`
requiring `orbit:qa:score` so the loop closes.

### The five missing tools

`docs/modules/orbit.md` promises eight. `ORBIT_TOOL_DEFS` (`orbit-tools.ts:14-57`)
ships three: `fetch_policy`, `start_quote`, `create_endorsement_request`. The five
added, appended to the same array with handlers in the same `HANDLERS` record so
`executeOrbitToolCalls`'s re-validation (`orbit-tools.ts:189-239`) covers them
unchanged:

| Tool | `consequential` | Human decision boundary | Evidence cited | Approval policy |
| --- | --- | --- | --- | --- |
| `send_document` `{policyRef, documentKind, mode: "send" \| "request"}` | **true** | The model chooses *which* document; a human authorises the send. `mode: "request"` (asking the customer to upload) is still consequential because it is an outbound message. | The `axis_documents` row id and the policy ref, returned in the tool result and surfaced as an `EvidenceLink`. | new `orbit.document_send`, `decide: "orbit:messages:send"`, `dualControl: "never"` |
| `offer_renewal` `{renewalId, premiumMinor, validUntil}` | **true** | The model may not price. It may only present a premium that `orbit_renewals.requotesJson` already contains; a premium not in that list is rejected by the handler before any approval is sought. | The `orbit_renewals` row and the specific requote entry. | new `orbit.renewal_offer`, `decide: "orbit:renewals:approve"`, `dualControl: "above_threshold"`, `defaultThresholdMinor: 25_000_00`, `neverAutoApprove: true` |
| `fnol_guidance` `{claimType, locale}` | false | **Guide only — never adjudicates.** The handler returns a script from a published KB article tagged `fnol:<claimType>`; if no such article exists it returns `{available: false}` and the model must say so. It cannot state coverage, liability or a settlement figure; the output guardrail regex set gets an ORBIT entry for coverage assertions. | The KB article id and version. | none |
| `book_callback` `{conversationId, windowStartAt, windowEndAt, phoneRef}` | false | Booking a slot commits a human's time, not money or contract state. It writes an `orbit_handover_notes` row plus a `waiting` conversation state; a human confirms by taking it. | The conversation and the requested window. | none |
| `request_handover` `{conversationId, reason, urgency}` | false | The model may always ask for a human; it may never refuse to. Sets `state: "human"`, calls `routeConversation`, and triggers `summariseForHandover`. | The classified intent and the escalation risk that motivated it. | none |

`send_document` and `offer_renewal` reuse the exact gate idiom already in
`createEndorsementRequest` (`orbit-tools.ts`): a `subjectRef` of
`` `orbit_<tool>:${primaryId}:${await sha256Hex(JSON.stringify(args))}` `` so the
approval is bound to the precise arguments and a changed offer needs a new
approval. `orbitToolsFor(agent)` continues to be the allowlist, and
`executeOrbitToolCalls` continues to be the only executor.

F38 note: `consequential` is currently written to `ai_tool_calls` and nothing
branches on it. With these five, the `gate()` call inside each handler is what
makes the flag load-bearing — the flag itself stays descriptive, which is correct;
a boolean that decides authorisation is a boolean somebody will flip.

### Eval cases and thresholds

Three new directories under `packages/model-gateway/evals`, each
`cases.jsonl` + `thresholds.json` + a scorer registered in
`evals/run.ts:303`. All are scored against canned model output, matching the
existing convention that a gate which calls a live model is not a gate.

**`orbit-draft`** — the draft itself. Reuses the existing `cx-quality` scorer
shape (canned judge replies, median, ar/en split):
```json
{ "rubricMin": 4.2, "parityGapMax": 0.2, "groundedMin": 0.95, "citationPrecisionMin": 0.9 }
```
`groundedMin`: fraction of drafts whose every numeric claim appears in the
supplied grounding, checked with the existing `verifyNumericClaims` from
`@lyra/core` that `evals/run.ts` already imports for NORTH.
`citationPrecisionMin`: fraction of cited article ids that were actually in the
retrieved set. 24 cases minimum, 12 en / 12 ar, covering: quote question, claim
status, renewal, document request, complaint, out-of-scope regulated advice
(must refuse), coverage question with no KB hit (must escalate), and a prompt
injection embedded in the customer's own message.

**`orbit-intent`** — classification. Scored as flat accuracy against a labelled
set; 40 cases across 10 intents, 20 en / 20 ar:
```json
{ "intentAccuracyMin": 0.85, "langAccuracyMin": 0.98, "sentimentMaeMax": 20, "escalationRecallMin": 0.8 }
```
`escalationRecallMin` is deliberately the strict one and precision is not gated:
missing an angry customer costs more than over-flagging a calm one.

**`orbit-tools`** — tool selection. Cases are a conversation plus the expected
tool name (or `null`), scored on exact-match selection and, separately, on
never-selecting-a-consequential-tool-when-the-turn-did-not-ask:
```json
{ "toolSelectionMin": 0.9, "spuriousConsequentialMax": 0.0 }
```
`spuriousConsequentialMax: 0.0` is the one hard zero in this design: a model that
offers a renewal price nobody asked for is a regulatory incident, and a
threshold above zero says we tolerate some.

`evals/cx-quality` is untouched — it gates the judge, and these gate the
producer.

## 2H. Implementation plan — draft loop

| # | Task | Failing test first |
| --- | --- | --- |
| T21 | Extract `runAgent` into `apps/api/src/engines/agent-run.ts`; `routes/ai.ts` becomes a caller; widen `checkInput` to `role === "tool"`. | `apps/api/src/engines/agent-run.test.ts` — `"a tool result carrying an injection string is scanned"`; `apps/api/src/routes/ai.test.ts` — `"POST /v1/ai/runs behaves identically after extraction"` |
| T22 | Migration `0018_orbit_ai.sql`: `ai_runs.confidence`, `ai_runs.grounding_json`, `orbit_kb_articles`, `orbit_macros`, `orbit_deflections`. | `packages/db/src/schema.test.ts` — `"ai_runs carries confidence and grounding"` |
| T23 | KB CRUD + publish + embed into `VEC_CONVO` with `kind: "kb"`. | `apps/api/src/routes/orbit.test.ts` — `"publishing an article embeds it and stamps embeddedAt"`, `"a draft article is never retrieved"` |
| T24 | `evals/orbit-intent` cases + thresholds + scorer, then the classify step. | `pnpm eval` gate — task `orbit-intent`; `apps/api/src/engines/orbit-draft.test.ts` — `"classification writes intent, sentiment and lang onto the conversation"` |
| T25 | `evals/orbit-draft` cases + thresholds + scorer, then `draftReply` writing the message/run pair. | `pnpm eval` gate — task `orbit-draft`; `apps/api/src/engines/orbit-draft.test.ts` — `"a draft is a trailing agent_ai message with a null deliveryStatus and a matching ai_run"`, `"a draft with no citation on a factual intent gets confidence 0"` |
| T26 | Autonomy gating: the six limits, the `"queued"` branch, and the in-flight guard. | `apps/api/src/engines/orbit-draft.test.ts` — `"act_within_limits auto-sends only when every limit holds"`, `"a conversation a human has taken is never auto-sent into"`, `"a run already in flight is not duplicated"` |
| T27 | Triggers: `AgentRoom.turn()` inline + `draftSweep` in cron. | `apps/api/src/engines/orbit-room.test.ts` — `"a customer turn schedules a draft"`; `apps/api/src/engines/orbit-draft.test.ts` — `"the sweep picks up a conversation the room missed"` |
| T28 | `evals/orbit-tools`, then the five tool defs + handlers + the two new approval policies. | `pnpm eval` gate — task `orbit-tools`; `apps/api/src/engines/orbit-tools.test.ts` — `"offer_renewal rejects a premium absent from requotesJson"`, `"fnol_guidance returns available:false rather than inventing a script"`, `"send_document raises approval_required before sending"`, `"a tool outside orbitToolsFor is still refused"` |
| T29 | Handover summarisation + `acceptedBy`. | `apps/api/src/engines/orbit-draft.test.ts` — `"a handover writes an unaccepted ai summary"` |
| T30 | QA auto-scoring wired to `cx-judge` + the dispute route. | `apps/api/src/engines/orbit-qa.test.ts` — `"a closed conversation is scored on the frozen rubric version"`, `"a disputed score keeps the agent's row"` |
| T31 | `conversation.tsx`: regenerate intent, macro insert, confidence, evidence links, suggestion telemetry. | `apps/web/app/routes/conversation.test.tsx` — `"a draft posts an ai_suggestions shown row"`, `"editing then sending records outcome=edited with an edit distance"` |
| T32 | Deflection endpoint + review screen. | `apps/api/src/routes/portal.test.ts` — `"an ungrounded question escalates instead of guessing"` |

Acceptance spec gating the capability: `apps/e2e/specs/orbit-draft.spec.ts`
tagged `@journey:J-O2` — `"a customer message produces a grounded draft the agent
approves in one click"`, plus `@accept:M4` for
`docs/modules/orbit.md §8`'s "quote → bind with exactly one human approval".

---

## 3. Ordering, in one line

T1→T2→T3-T5 (adapters, parallel) →T6→T7→T8→T9 (inbound works) →
T10→T11→T12→T13 (routing works) →T14→T15 (outbound works) →
T21→T22→T23→T24→T25→T26→T27 (drafts work) →
T16→T17→T18→T19→T20 (surfaces and numbers) →T28→T29→T30→T31→T32.

Inbound before routing before outbound before drafts, because each is the
previous one's only real test fixture.

## 4. Deliberate ceilings

Marked in code with `ponytail:` comments at the sites named above.

- **No streaming** (F35). A draft arrives whole. The gateway has no streaming
  surface and adding one to serve a text box that renders in 200 ms is work
  without a reader. Upgrade path: the `realtime` route and `UserChannel` DO
  already exist.
- **No WhatsApp template catalogue.** Outside-window sends fail loudly rather
  than silently not sending. Add `orbit_channel_templates` when a tenant needs it.
- **No SES/SNS email adapter.** Mailgun-shape HMAC first; SNS needs certificate
  chain validation and is a second adapter, not a branch in the first.
- **`activeCount` is denormalised** on `orbit_agent_presence` and reconciled by
  the sweep rather than computed per assignment.
- **Percentiles by OFFSET**, matching the existing snapshotter.
- **KB shares `VEC_CONVO`** rather than taking a new Vectorize binding.
- **Console still polls**, as `orbit-console.tsx`'s own header comment already
  records; nothing here changes that, and the SLA sweep emits events a realtime
  topic can later consume.

## 5. Where the existing code fights this design

Four places, none fatal, all named so nobody rediscovers them mid-build.

1. **`afterWrite` has no `env`.** `crud.ts:124` types it `(ctx, row, op)` while
   `beforeWrite` at `:118` gets `(ctx, values, existing, env)`. Outbound dispatch
   needs bindings. One-word widening; every existing `afterWrite` keeps
   compiling.
2. **`orbit_messages` is `immutable: true`.** Delivery status and `external_ref`
   must be updated after the row is written, so the channel engine writes them
   with `ctx.db.update` directly, bypassing the CRUD layer — the same exception
   `orbit-room.ts:60` already takes. If immutability is later enforced by a DB
   trigger rather than by the router, this breaks; the alternative is a separate
   `orbit_message_deliveries` table, which is a second table for one mutable
   column.
3. **`Channel` is a consent union, not a transport interface.** There is no
   connector seam to implement against, despite CLAUDE.md §15 and docs/16
   naming `Channel` as a reserved seam. `seams.ts:9-10` says so explicitly.
   Adding `ChannelAdapter` is therefore *creating* the seam, not implementing to
   one — arguably an ADR-worthy act. It is also unavoidable: nothing in the tree
   can carry a WhatsApp message.
4. **Three autonomy vocabularies still disagree** (F39): `seams.ts:39`
   (`observe_only|act_with_approval|act_and_notify|act_autonomously`),
   `routes/ai.ts:484` (`suggest|act_with_approval|act_within_limits|autonomous`),
   and docs/16's L0–L3. This design uses the `routes/ai.ts` set because it is the
   one the API validates and the one `ai_agents.autonomyLevel` actually stores.
   That leaves the `AutonomyEnvelope` seam unimplemented and the disagreement
   unresolved — deliberately, because reconciling it is a platform-wide ADR and
   folding it into an ORBIT spec would decide it by stealth.
