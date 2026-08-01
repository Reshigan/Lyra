import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
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
  sha256Hex,
  type Ctx
} from "@lyra/core";
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
