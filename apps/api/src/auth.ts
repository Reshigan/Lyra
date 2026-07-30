import { Hono } from "hono";
import { and, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { id as newId, makeDb, schema, EntitlementsJson, PolicyJson, ScopeJson } from "@lyra/db";
import {
  audit,
  badRequest,
  emit,
  forbidden,
  hashPassword,
  needsRehash,
  permissionsForRole,
  randomToken,
  sha256Hex,
  tooManyRequests,
  unauthorized,
  verifyPassword,
  type Actor,
  type Ctx,
  type Grant,
  type Scope
} from "@lyra/core";
import { body } from "./http.js";
import type { App, Env } from "./env.js";

// docs/06 §2. Sessions are opaque tokens hashed at rest; the API never holds a
// value it could leak. API keys authenticate machine callers with the same
// Actor shape, so authorization has exactly one path either way.

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const COOKIE = "lyra_session";

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
  tenantSlug: z.string().min(1).max(64).optional()
});

/** Constant work whether or not the user exists — an unknown email must not be faster. */
const DUMMY_HASH = "$scrypt$n=16384,r=8,p=1$0000000000000000000000$0000000000000000000000000000000000000000000";

export function db(env: Env) {
  return env.DB_CLIENT ?? makeDb(env.DB);
}

/* ------------------------------------------------------------------ actor */

/** Expand a user's role rows into the grants `can()` evaluates. */
export async function grantsFor(
  database: ReturnType<typeof makeDb>,
  tenantId: string,
  userId: string
): Promise<Grant[]> {
  const rows = await database
    .select({
      key: schema.roles.key,
      permissionsJson: schema.roles.permissionsJson,
      scopeJson: schema.userRoles.scopeJson
    })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(and(eq(schema.userRoles.tenantId, tenantId), eq(schema.userRoles.userId, userId)));

  return rows.map((row) => {
    // The stored bundle wins over the compiled ROLES table: a tenant may author
    // a custom role, and a system role's bundle is written at provisioning time.
    const stored = safeJson<string[]>(row.permissionsJson) ?? [];
    const permissions = stored.length ? stored : [...permissionsForRole(row.key)];
    const scope = row.scopeJson ? (ScopeJson.parse(safeJson(row.scopeJson)) as Scope) : undefined;
    return { roleKey: row.key, permissions, ...(scope ? { scope } : {}) };
  });
}

function safeJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export interface Authenticated {
  actor: Actor;
  tenantId: string;
  locale: string;
  policy: PolicyJson;
  entitlements: EntitlementsJson;
}

async function tenantConfig(
  database: ReturnType<typeof makeDb>,
  tenantId: string
): Promise<{ policy: PolicyJson; entitlements: EntitlementsJson }> {
  const rows = await database
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);
  const t = rows[0];
  if (!t) throw unauthorized("tenant not found");
  if (t.status !== "active") throw forbidden(`tenant is ${t.status}`);
  return {
    policy: PolicyJson.parse(safeJson(t.policyJson) ?? {}),
    entitlements: EntitlementsJson.parse(safeJson(t.entitlementsJson) ?? {})
  };
}

/** Session cookie or `Authorization: Bearer <session token>`. */
async function fromSession(
  database: ReturnType<typeof makeDb>,
  token: string,
  now: number
): Promise<Authenticated> {
  const tokenHash = await sha256Hex(token);
  const rows = await database
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, tokenHash), isNull(schema.sessions.revokedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) throw unauthorized("session not found");
  if (row.session.expiresAt <= now) throw unauthorized("session expired");
  if (row.user.status !== "active") throw forbidden(`user is ${row.user.status}`);

  const tenantId = row.session.tenantId;
  const grants = await grantsFor(database, tenantId, row.user.id);
  const config = await tenantConfig(database, tenantId);
  return {
    tenantId,
    locale: row.user.locale,
    actor: { kind: "user", id: row.user.id, tenantId, grants },
    ...config
  };
}

/** `Authorization: Bearer qvk_live_...`. Scopes are permissions, not a second model. */
async function fromApiKey(
  database: ReturnType<typeof makeDb>,
  token: string,
  now: number
): Promise<Authenticated> {
  const prefix = token.slice(0, token.lastIndexOf("_") + 9);
  const rows = await database
    .select()
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.prefix, prefix), isNull(schema.apiKeys.revokedAt)))
    .limit(1);

  const key = rows[0];
  if (!key) throw unauthorized("api key not found");
  if (key.expiresAt !== null && key.expiresAt <= now) throw unauthorized("api key expired");
  const hash = await sha256Hex(token);
  if (hash !== key.keyHash) throw unauthorized("api key not found");

  const scopes = safeJson<string[]>(key.scopesJson) ?? [];
  const config = await tenantConfig(database, key.tenantId);
  // A failed last-used stamp must not fail the call it is only observing.
  try {
    await database.update(schema.apiKeys).set({ lastUsedAt: now }).where(eq(schema.apiKeys.id, key.id));
  } catch {
    /* ignore */
  }

  return {
    tenantId: key.tenantId,
    locale: "en",
    actor: {
      kind: "partner",
      id: key.id,
      tenantId: key.tenantId,
      grants: [{ roleKey: `apikey.${key.mode}`, permissions: scopes }]
    },
    ...config
  };
}

export async function authenticate(env: Env, req: Request, now: number): Promise<Authenticated> {
  const database = db(env);
  const header = req.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
  const cookie = readCookie(req.headers.get("cookie"), env.SESSION_COOKIE ?? COOKIE);
  const token = bearer ?? cookie;
  if (!token) throw unauthorized("no credentials");
  return token.startsWith("qvk_") ? fromApiKey(database, token, now) : fromSession(database, token, now);
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/* ----------------------------------------------------------------- routes */

/**
 * Fixed-window throttle keyed by email. KV when it is bound; otherwise the
 * attempt counter is skipped rather than faked, and the app still refuses on
 * a bad password.
 *
 * ponytail: fixed window, not a sliding one. Upgrade path is a Durable Object
 * if credential stuffing volume ever justifies the round trip.
 */
const LOGIN_MAX = 8;
const LOGIN_WINDOW_SEC = 300;

async function throttle(env: Env, key: string): Promise<void> {
  if (!env.KV) return;
  const k = `login:${key}`;
  const n = Number((await env.KV.get(k)) ?? "0") + 1;
  await env.KV.put(k, String(n), { expirationTtl: LOGIN_WINDOW_SEC });
  if (n > LOGIN_MAX) throw tooManyRequests(LOGIN_WINDOW_SEC);
}

export const authRoutes = new Hono<App>();

authRoutes.post("/login", async (c) => {
  const now = Date.now();
  const input = await body(c, LoginBody);
  await throttle(c.env, input.email.toLowerCase());

  const database = db(c.env);
  const found = await database
    .select({ user: schema.users, tenantSlug: schema.tenants.slug })
    .from(schema.users)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.users.tenantId))
    .where(and(eq(schema.users.email, input.email.toLowerCase()), isNull(schema.users.deletedAt)))
    .limit(20);

  const match = input.tenantSlug
    ? found.find((r) => r.tenantSlug === input.tenantSlug)
    : found.length === 1
      ? found[0]
      : undefined;

  const user = match?.user;
  const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    if (found.length > 1 && !input.tenantSlug) throw badRequest("tenantSlug is required for this email");
    throw unauthorized("email or password is incorrect");
  }
  if (user.status !== "active") throw forbidden(`user is ${user.status}`);

  if (needsRehash(user.passwordHash ?? "")) {
    await database
      .update(schema.users)
      .set({ passwordHash: await hashPassword(input.password), updatedAt: now })
      .where(eq(schema.users.id, user.id));
  }

  const token = randomToken();
  const sessionId = newId("ses", now);
  await database.insert(schema.sessions).values({
    id: sessionId,
    tenantId: user.tenantId,
    userId: user.id,
    tokenHash: await sha256Hex(token),
    ip: c.req.header("cf-connecting-ip") ?? null,
    ua: c.req.header("user-agent") ?? null,
    mfaSatisfied: !user.mfaEnrolled,
    expiresAt: now + SESSION_TTL_MS,
    createdAt: now,
    revokedAt: null
  });
  await database.update(schema.users).set({ lastSeenAt: now }).where(eq(schema.users.id, user.id));

  const grants = await grantsFor(database, user.tenantId, user.id);
  const ctx = await ctxFor(c.env, {
    tenantId: user.tenantId,
    locale: user.locale,
    actor: { kind: "user", id: user.id, tenantId: user.tenantId, grants },
    ...(await tenantConfig(database, user.tenantId))
  }, now, c.req.header("cf-connecting-ip"), c.req.header("user-agent"));
  await audit(ctx, { action: "core.session.login", subjectRef: sessionId });
  await emit(ctx, { module: "core", type: "core.session.login", subject: user.id, data: { sessionId } });

  const secure = (c.env.ENVIRONMENT ?? "production") !== "development";
  c.header(
    "set-cookie",
    `${c.env.SESSION_COOKIE ?? COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure ? "; Secure" : ""}`
  );
  return c.json({
    token,
    expiresAt: now + SESSION_TTL_MS,
    mfaRequired: Boolean(user.mfaEnrolled),
    user: { id: user.id, name: user.name, email: user.email, locale: user.locale, tenantId: user.tenantId },
    roles: grants.map((g) => g.roleKey)
  });
});

authRoutes.post("/logout", async (c) => {
  const now = Date.now();
  const header = c.req.header("authorization");
  const token =
    (header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined) ??
    readCookie(c.req.header("cookie") ?? null, c.env.SESSION_COOKIE ?? COOKIE);
  if (token) {
    await db(c.env)
      .update(schema.sessions)
      .set({ revokedAt: now })
      .where(eq(schema.sessions.tokenHash, await sha256Hex(token)));
  }
  c.header("set-cookie", `${c.env.SESSION_COOKIE ?? COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
  return c.body(null, 204);
});

/** Session sweep for the scheduled handler. Expired rows carry no value. */
export async function pruneSessions(env: Env, now: number): Promise<void> {
  await db(env).delete(schema.sessions).where(lt(schema.sessions.expiresAt, now));
}

/* -------------------------------------------------------------- ctx build */

export async function ctxFor(
  env: Env,
  auth: Authenticated,
  now: number,
  ip?: string,
  ua?: string
): Promise<Ctx> {
  return {
    db: db(env) as unknown as Ctx["db"],
    tenantId: auth.tenantId,
    actor: auth.actor,
    requestId: newId("req", now),
    now,
    locale: auth.locale,
    policy: auth.policy,
    entitlements: auth.entitlements,
    ...(ip ? { ip } : {}),
    ...(ua ? { ua } : {})
  };
}
