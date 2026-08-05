import { Hono } from "hono";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { id as newId, schema } from "@lyra/db";
import {
  actorRef,
  audit,
  badRequest,
  base32Encode,
  can,
  forbidden,
  isKnownPermission,
  require_,
  requiresMfa,
  sha256Hex,
  type Ctx,
  type Envelope
} from "@lyra/core";
import { LOGIN_MAX, LOGIN_WINDOW_SEC, MFA_MAX, SESSION_TTL_MS } from "../auth.js";
import { deliver } from "../dispatch.js";
import { body, created } from "../http.js";
import { must } from "../rows.js";
import type { App } from "../env.js";

// docs/06 §2. Everything about the core module that generated CRUD cannot do:
// minting an API key (the plaintext is shown once and never stored, so the
// client can neither supply `prefix` nor `keyHash` — exactly what a CRUD
// create would ask it for) and revoking one (generic CRUD delete only
// soft-deletes off a `deletedAt` column; api-keys has `revokedAt` instead).
// List and record still come from the generated resource in resources.ts.

export const coreRoutes = new Hono<App>();

const ctxOf = (c: { get(k: "ctx"): Ctx }): Ctx => c.get("ctx");

/**
 * `.strict()` is the whole defence against a spoofed `tenantId` or `createdBy`:
 * both are server-derived, so a body carrying either is a 400 rather than a
 * silently ignored field. Same rule the generated CRUD applies to owned columns.
 */
const KeyBody = z
  .object({
    name: z.string().min(1).max(120),
    mode: z.enum(["test", "live"]).default("test"),
    scopes: z.array(z.string().min(3).max(120)).max(200).default([]),
    /** Epoch ms. A key with no expiry is a key nobody ever rotates. */
    expiresAt: z.number().int().positive().optional()
  })
  .strict();

/** 32 bytes of CSPRNG, base32 for the alphabet auth.ts can slice a prefix out of. */
const SECRET_BYTES = 32;

coreRoutes.post("/api-keys", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "core:api_keys:create", { tenantId: ctx.tenantId, module: "core" });
  const input = await body(c, KeyBody);
  if (input.expiresAt !== undefined && input.expiresAt <= ctx.now) throw badRequest("expiresAt is in the past");

  // A key may never be stronger than the person who minted it. Unknown strings
  // are rejected outright (a typo grants nothing but reads as if it does), and
  // every remaining scope has to be one the acting session actually holds —
  // `can()` is the same matcher authorization uses, wildcards included.
  for (const scope of input.scopes) {
    if (!isKnownPermission(scope)) throw badRequest(`unknown permission: ${scope}`);
    if (!can(ctx.actor, scope, { tenantId: ctx.tenantId })) throw forbidden(scope);
  }

  const bytes = new Uint8Array(SECRET_BYTES);
  crypto.getRandomValues(bytes);
  // base32, not base64url: auth.ts finds a presented key by
  // `token.slice(0, token.lastIndexOf("_") + 9)`, and a base64url `_` inside the
  // secret would move that boundary and make the key unverifiable. The alphabet
  // is also free of 0/1/8/O/I, so a key read off a screen survives the trip.
  const secret = base32Encode(bytes);
  const prefix = `qvk_${input.mode}_${secret.slice(0, 8)}`;
  const plaintext = `qvk_${input.mode}_${secret}`;
  // SHA-256, no KDF: this is 256 bits of machine-generated entropy, not a
  // user-chosen password, so there is no dictionary to slow an attacker down
  // over — and verification happens on every API call. The digest covers the
  // whole plaintext including the prefix, which is what auth.ts hashes back.
  const keyHash = await sha256Hex(plaintext);

  const row = {
    id: newId("key", ctx.now),
    tenantId: ctx.tenantId,
    name: input.name,
    prefix,
    keyHash,
    mode: input.mode,
    scopesJson: JSON.stringify(input.scopes),
    createdBy: actorRef(ctx),
    lastUsedAt: null,
    expiresAt: input.expiresAt ?? null,
    revokedAt: null,
    createdAt: ctx.now
  };
  await ctx.db.insert(schema.apiKeys).values(row);
  // `after` is the stored row: it holds the hash, never the plaintext. The
  // plaintext exists only in the response below — not in a log, not in an
  // error, not in a column.
  await audit(ctx, { action: "core.api-keys.create", subjectRef: `api-keys:${row.id}`, after: row });

  // `keyHash` is a `secretColumns` entry on the generated resource, so no read
  // path returns it; the mint must agree or it becomes the one way to get it.
  const { keyHash: _hash, ...safe } = row;
  return created(c, { ...safe, key: plaintext });
});

// Same structural problem as create, the other direction: `core_api_keys` has
// `revokedAt`, not `deletedAt`, so generic CRUD's delete (which only takes the
// soft-delete branch off a `deletedAt` column) would hard-delete the row.
// That destroys the audit trail a revoked credential is supposed to leave
// behind. Mounted before CRUD, this shadows that delete and revokes instead —
// same shape as meRoutes' session revoke in routes/me.ts.
coreRoutes.delete("/api-keys/:id", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "core:api_keys:revoke", { tenantId: ctx.tenantId, module: "core" });
  const rowId = c.req.param("id");
  await must(ctx, schema.apiKeys, rowId, "api-keys");
  await ctx.db
    .update(schema.apiKeys)
    .set({ revokedAt: ctx.now })
    .where(and(eq(schema.apiKeys.tenantId, ctx.tenantId), eq(schema.apiKeys.id, rowId)));
  await audit(ctx, { action: "core.api-keys.revoke", subjectRef: `api-keys:${rowId}` });
  return c.body(null, 204);
});

/* ------------------------------------------------------------- webhooks */

// Same structural problem as the key: `core_webhooks.secret` is notNull with no
// default, so the generated create asks the caller to type the signing secret it
// is then verified against. Mounted before CRUD, this shadows that create and
// generates the secret instead — the admin form never offered the field.

const WebhookBody = z
  .object({
    url: z.string().url().max(2000),
    // Same leaf the generated create uses for a `*Json` column, so the admin
    // form's json field posts unchanged: an array, or the text of one.
    eventTypesJson: z.union([z.array(z.string().min(1).max(120)).max(200), z.string().max(10_000)])
  })
  .strict();

// Stored in plaintext, unlike the API key, and deliberately: dispatch.ts HMACs
// every delivery with it and the SDK verifies with the same shared secret, so
// a digest here would leave nothing able to sign. `secretColumns: ["secret"]`
// on the resource keeps it off every read path and out of audit images.
function mintWebhookSecret(): string {
  const bytes = new Uint8Array(SECRET_BYTES);
  crypto.getRandomValues(bytes);
  return `whsec_${base32Encode(bytes)}`;
}

coreRoutes.post("/webhooks", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "core:webhooks:write", { tenantId: ctx.tenantId, module: "core" });
  const input = await body(c, WebhookBody);

  const secret = mintWebhookSecret();
  const row = {
    id: newId("whk", ctx.now),
    tenantId: ctx.tenantId,
    url: input.url,
    eventTypesJson: typeof input.eventTypesJson === "string" ? input.eventTypesJson : JSON.stringify(input.eventTypesJson),
    secret,
    status: "active",
    createdAt: ctx.now
  };
  await ctx.db.insert(schema.webhooks).values(row);

  // Strip before auditing, not after: the API key could audit its whole row
  // because the row held a hash. This one holds the secret itself.
  const { secret: _secret, ...safe } = row;
  await audit(ctx, { action: "core.webhooks.create", subjectRef: `webhooks:${row.id}`, after: safe });
  // Event types go back as they came, parsed — the read path hydrates the column
  // too, so the mint's shape matches the record the client fetches next.
  return created(c, { ...safe, eventTypesJson: input.eventTypesJson, secret });
});

// docs/10 §6: "webhook secrets rotation UI". Generic CRUD's PATCH already lets
// a tenant set the secret to a value of their own choosing (resources.ts) —
// this is the other case, a fresh CSPRNG secret on demand, same mint the
// create route uses, so a receiver stuck accepting an old leaked secret has a
// one-click way off it without deleting and recreating the endpoint.
coreRoutes.post("/webhooks/:id/rotate", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "core:webhooks:write", { tenantId: ctx.tenantId, module: "core" });
  const rowId = c.req.param("id");
  const before = await must(ctx, schema.webhooks, rowId, "webhooks");
  const secret = mintWebhookSecret();
  await ctx.db
    .update(schema.webhooks)
    .set({ secret })
    .where(and(eq(schema.webhooks.tenantId, ctx.tenantId), eq(schema.webhooks.id, rowId)));
  await audit(ctx, { action: "core.webhooks.rotate", subjectRef: `webhooks:${rowId}` });
  const { secret: _before, ...safe } = before;
  return c.json({ ...safe, secret });
});

// docs/20 developer console "webhook tester". Reuses the real delivery path
// (dispatch.ts `deliver`) with a hand-built envelope rather than a queued
// event, so the receiver gets the exact signature scheme production events
// use, without waiting on the outbox or leaving a fake row behind for it.
coreRoutes.post("/webhooks/:id/test", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "core:webhooks:read", { tenantId: ctx.tenantId, module: "core" });
  const rowId = c.req.param("id");
  const hook = await must(ctx, schema.webhooks, rowId, "webhooks");

  const envelope: Envelope = {
    id: newId("ev", ctx.now),
    ts: ctx.now,
    tenant_id: ctx.tenantId,
    module: "core",
    type: "core.webhooks.test",
    actor: actorRef(ctx),
    data: { message: "This is a test event from the developer console." },
    v: 1
  };
  const result = await deliver(ctx, hook, envelope, 1);
  await audit(ctx, { action: "core.webhooks.test", subjectRef: `webhooks:${rowId}`, after: result });
  return c.json(result);
});

/**
 * docs/25 admin_security ("SSO, sessions, network and rate limits"). Read-only
 * on purpose: MFA is a platform floor — packages/core rbac.ts `requiresMfa`,
 * "the rule is the platform's and no tenant policy switch turns it off" — and
 * session lifetime and the login throttle are estate-wide constants. So there
 * is no tenant policy row to edit here, and inventing one would only offer a
 * way to weaken the floor. What a tenant admin needs instead is the truth
 * about what is enforced and who is currently outside it; the remedies already
 * exist elsewhere (enrol via the MFA flow, revoke via staff suspend/offboard).
 */
coreRoutes.get("/security-posture", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "core:settings:read", { tenantId: ctx.tenantId, module: "core" });
  // Naming an individual as unprotected is user data, not a policy fact, so the
  // list rides on the permission that would show those people anyway. Without
  // it the counts still render — the screen degrades, it does not 403.
  const mayNameUsers = can(ctx.actor, "core:users:read", { tenantId: ctx.tenantId });

  const memberships = await ctx.db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      status: schema.users.status,
      authProvider: schema.users.authProvider,
      mfaEnrolled: schema.users.mfaEnrolled,
      roleKey: schema.roles.key
    })
    .from(schema.users)
    .leftJoin(
      schema.userRoles,
      and(eq(schema.userRoles.userId, schema.users.id), eq(schema.userRoles.tenantId, ctx.tenantId))
    )
    .leftJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(and(eq(schema.users.tenantId, ctx.tenantId), isNull(schema.users.deletedAt)));

  // One row per membership arrives; fold to one entry per person carrying every
  // role key, because `requiresMfa` decides on the whole set (any internal role
  // means the floor applies) and not role by role.
  const people = new Map<
    string,
    { email: string; name: string; status: string; authProvider: string; mfaEnrolled: boolean; roleKeys: string[] }
  >();
  for (const row of memberships) {
    const entry = people.get(row.userId) ?? {
      email: row.email,
      name: row.name,
      status: row.status,
      authProvider: row.authProvider,
      mfaEnrolled: row.mfaEnrolled,
      roleKeys: []
    };
    if (row.roleKey) entry.roleKeys.push(row.roleKey);
    people.set(row.userId, entry);
  }

  let required = 0;
  let enrolled = 0;
  let exempt = 0;
  const gaps: Array<{ userId: string; email: string; name: string; roleKeys: string[]; authProvider: string }> = [];
  for (const [userId, person] of people) {
    // A suspended account cannot sign in, so counting it as a gap would make the
    // number impossible to ever clear.
    if (person.status === "suspended") continue;
    if (!requiresMfa(person.roleKeys)) {
      exempt += 1;
      continue;
    }
    required += 1;
    if (person.mfaEnrolled) {
      enrolled += 1;
      continue;
    }
    if (mayNameUsers) {
      gaps.push({
        userId,
        email: person.email,
        name: person.name,
        roleKeys: person.roleKeys,
        authProvider: person.authProvider
      });
    }
  }

  const live = await ctx.db
    .select({ userId: schema.sessions.userId, createdAt: schema.sessions.createdAt, mfaSatisfied: schema.sessions.mfaSatisfied })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.tenantId, ctx.tenantId),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, ctx.now)
      )
    );

  const providers = await ctx.db
    .select({
      id: schema.identityProviders.id,
      name: schema.identityProviders.name,
      kind: schema.identityProviders.kind,
      emailDomain: schema.identityProviders.emailDomain,
      enabled: schema.identityProviders.enabled,
      mfaAsserted: schema.identityProviders.mfaAsserted,
      defaultRoleKey: schema.identityProviders.defaultRoleKey
    })
    .from(schema.identityProviders)
    .where(eq(schema.identityProviders.tenantId, ctx.tenantId));

  return c.json({
    mfa: {
      // The floor, restated where the admin is looking at it.
      policy: "internal-roles-always",
      tenantConfigurable: false,
      required,
      enrolled,
      exempt,
      gaps,
      gapsWithheld: !mayNameUsers && required > enrolled
    },
    sessions: {
      ttlHours: SESSION_TTL_MS / 3_600_000,
      tenantConfigurable: false,
      live: live.length,
      users: new Set(live.map((s) => s.userId)).size,
      // A live session that never satisfied MFA is a pre-verification stub, not
      // an authenticated seat — worth showing separately rather than hiding.
      unverified: live.filter((s) => !s.mfaSatisfied).length,
      oldestStartedAt: live.reduce<number | null>((min, s) => (min === null || s.createdAt < min ? s.createdAt : min), null)
    },
    limits: {
      // Fixed-window counters in auth.ts, not tenant policy.
      loginMax: LOGIN_MAX,
      loginWindowSec: LOGIN_WINDOW_SEC,
      mfaMax: MFA_MAX,
      tenantConfigurable: false
    },
    sso: {
      providers,
      // PLAT-013 rides on the provider too: an enabled IdP that cannot assert a
      // second factor covers a domain the floor then cannot reach.
      gaps: providers.filter((p) => p.enabled && !p.mfaAsserted)
    },
    // No IP allowlist exists anywhere in the platform, and a screen that showed
    // an empty one would read as "configured to allow everything". Say what is
    // true instead: the control is not offered.
    network: { ipAllowlist: "unsupported" }
  });
});
