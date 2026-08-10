import { Hono } from "hono";
import { and, eq, like } from "drizzle-orm";
import { z } from "zod";
import { id as newId, schema, BrandJson, EntitlementsJson, PolicyJson } from "@lyra/db";
import { audit, emit, notFound, recordConsent, sha256Hex } from "@lyra/core";
import { body } from "../http.js";
import { ctxFor, db as rawDb, throttle } from "../auth.js";
import type { App } from "../env.js";

// The public comparison site (yallacompare-style). No session exists at all —
// same reasoning as routes/onboarding.ts §partner signup — so this router
// builds its own system Ctx and is listed public-by-shape in mw.ts (the
// tenant slug is a dynamic segment, so it cannot be an exact-match PUBLIC entry).

export const portalRoutes = new Hono<App>();

const DIRECT_WEB_CHANNEL_KEY = "direct-web";
// ponytail: AED default (UAE launch market); a real multi-currency portal
// reads this off the tenant/product instead once a second market ships.
const DEFAULT_CURRENCY = "AED";
const LEAD_MAX = 3;
const LEAD_WINDOW_SEC = 24 * 60 * 60;
// An email-keyed throttle alone is free to bypass by rotating the address;
// this second, coarser throttle keys on the connecting IP so the same
// visitor can't just cycle emails.
const LEAD_IP_MAX = 10;

async function activeTenant(database: ReturnType<typeof rawDb>, slug: string) {
  const rows = await database.select().from(schema.tenants).where(eq(schema.tenants.slug, slug)).limit(1);
  const tenant = rows[0];
  if (!tenant || tenant.status !== "active") throw notFound("tenant");
  return tenant;
}

portalRoutes.get("/:tenantSlug/site", async (c) => {
  const database = rawDb(c.env);
  const tenant = await activeTenant(database, c.req.param("tenantSlug"));
  const brand = BrandJson.parse(tenant.brandJson ? JSON.parse(tenant.brandJson) : {});

  const productRows = await database
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.tenantId, tenant.id), eq(schema.products.status, "active")));
  const providerIds = [...new Set(productRows.map((p) => p.providerId).filter((id): id is string => Boolean(id)))];
  const providerRows = providerIds.length
    ? await database.select().from(schema.providers).where(eq(schema.providers.tenantId, tenant.id))
    : [];
  const providerNameById = new Map(providerRows.map((p) => [p.id, p.name]));

  return c.json({
    tenant: { name: tenant.name, brand },
    products: productRows.map((p) => ({
      id: p.id,
      line: p.line,
      name: JSON.parse(p.nameJson).en as string,
      providerName: p.providerId ? (providerNameById.get(p.providerId) ?? null) : null
    }))
  });
});

const LeadBody = z
  .object({
    productId: z.string().min(1),
    name: z.string().min(1).max(200),
    email: z.string().email(),
    phone: z.string().max(40).optional(),
    message: z.string().max(2000).optional(),
    consent: z.literal(true)
  })
  .strict();

async function findOrCreateDirectWebChannel(ctx: Awaited<ReturnType<typeof ctxFor>>, now: number): Promise<string> {
  const existing = await ctx.db
    .select()
    .from(schema.distChannels)
    .where(and(eq(schema.distChannels.tenantId, ctx.tenantId), eq(schema.distChannels.key, DIRECT_WEB_CHANNEL_KEY)))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const channelRow = {
    id: newId("chn", now),
    tenantId: ctx.tenantId,
    key: DIRECT_WEB_CHANNEL_KEY,
    kind: "b2c" as const,
    nameJson: JSON.stringify({ en: "Direct web" }),
    partnerId: null as string | null,
    medium: "web" as const,
    collectsPayment: "us" as const,
    settlementTermsJson: null,
    defaultCommissionPpm: null,
    currency: DEFAULT_CURRENCY,
    status: "active" as const,
    createdAt: now,
    updatedAt: now
  };
  await ctx.db.insert(schema.distChannels).values(channelRow);
  await audit(ctx, { action: "dist.channels.create", subjectRef: `channels:${channelRow.id}`, after: channelRow });
  return channelRow.id;
}

async function findOrCreateCustomer(
  ctx: Awaited<ReturnType<typeof ctxFor>>,
  now: number,
  input: { name: string; email: string; phone?: string }
): Promise<string> {
  const emailHash = await sha256Hex(input.email);
  const existing = await ctx.db
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.nationalIdHash, emailHash)))
    .limit(1);
  if (existing[0]) return existing[0].id;

  // ponytail: reusing nationalIdHash purely as a "lookup key for this lead
  // source" slot — there is no KYC id yet at anonymous-lead stage. A real
  // customer-matching pass happens when staff work the quote request.
  const customerRow = {
    id: newId("cus", now),
    tenantId: ctx.tenantId,
    type: "person" as const,
    nameJson: JSON.stringify({ en: input.name }),
    emailsJson: JSON.stringify([input.email]),
    phonesJson: input.phone ? JSON.stringify([input.phone]) : null,
    nationalIdHash: emailHash,
    kycStatus: "none" as const,
    consentId: null as string | null,
    tagsJson: JSON.stringify(["portal-lead"]),
    ltvCached: null,
    riskFlagsJson: null,
    locale: "en",
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };
  await ctx.db.insert(schema.customers).values(customerRow);
  await audit(ctx, { action: "core.customers.create", subjectRef: `customers:${customerRow.id}`, after: customerRow });
  return customerRow.id;
}

portalRoutes.post("/:tenantSlug/leads", async (c) => {
  const now = Date.now();
  const input = await body(c, LeadBody);
  const email = input.email.toLowerCase();
  await throttle(c.env, `portal-lead:${email}`, LEAD_MAX, LEAD_WINDOW_SEC);
  const ip = c.req.header("cf-connecting-ip");
  if (ip) await throttle(c.env, `portal-lead-ip:${ip}`, LEAD_IP_MAX, LEAD_WINDOW_SEC);

  const database = rawDb(c.env);
  const tenant = await activeTenant(database, c.req.param("tenantSlug"));

  const productRows = await database
    .select()
    .from(schema.products)
    .where(
      and(
        eq(schema.products.tenantId, tenant.id),
        eq(schema.products.id, input.productId),
        eq(schema.products.status, "active")
      )
    )
    .limit(1);
  if (!productRows[0]) throw notFound("product");

  const ctx = await ctxFor(
    c.env,
    {
      tenantId: tenant.id,
      locale: "en",
      actor: { kind: "system", id: "portal-lead", tenantId: tenant.id, grants: [] },
      policy: PolicyJson.parse({}),
      entitlements: EntitlementsJson.parse({})
    },
    now,
    c.req.header("cf-connecting-ip"),
    c.req.header("user-agent")
  );

  const channelId = await findOrCreateDirectWebChannel(ctx, now);
  const customerId = await findOrCreateCustomer(ctx, now, {
    name: input.name,
    email,
    ...(input.phone ? { phone: input.phone } : {})
  });
  // input.consent is required true by LeadBody's z.literal(true) - this is what
  // makes that checkbox mean something rather than being validated and discarded.
  const consent = await recordConsent(ctx, {
    customerId,
    purposes: { dataSharing: true },
    channels: { email: true, ...(input.phone ? { sms: true } : {}) },
    source: "portal",
    evidenceRef: `quote-request-lead:${tenant.slug}`
  });

  const quoteRequestRow = {
    id: newId("qrq", now),
    tenantId: tenant.id,
    caseId: null as string | null,
    customerId,
    channelId,
    productId: input.productId,
    inputsJson: JSON.stringify({ name: input.name, email, phone: input.phone ?? null, message: input.message ?? null }),
    consentId: consent.id as string | null,
    fanoutCount: 0,
    respondedCount: 0,
    bestOfferingId: null as string | null,
    bestPremiumMinor: null as number | null,
    currency: DEFAULT_CURRENCY,
    sharedWithCustomerAt: null as number | null,
    state: "open" as const,
    expiresAt: null as number | null,
    createdAt: now,
    updatedAt: now
  };
  await ctx.db.insert(schema.distQuoteRequests).values(quoteRequestRow);
  await audit(ctx, {
    action: "dist.quote_requests.create",
    subjectRef: `quote-requests:${quoteRequestRow.id}`,
    after: quoteRequestRow
  });
  await emit(ctx, {
    module: "dist",
    type: "dist.quote_requests.created",
    subject: quoteRequestRow.id,
    data: { id: quoteRequestRow.id, via: "portal" }
  });

  return c.json({ quoteRequestId: quoteRequestRow.id }, 201);
});

// ---------------------------------------------------------------------------
// J-C4 privacy rights (docs/06 §J-C4, docs/12 §Rights). ADR-0042 supersedes
// ADR-0041's staff-mediated intake: the data subject starts their own clock.
//
// What deliberately does NOT happen here: verification. docs/12 states no
// verification method and `IdentityVerifier` (packages/core/src/seams.ts, H5)
// has no implementation, so the row lands unverified — `verificationRef: null`,
// state `received` — and `tenant.compliance` staff verify before anything is
// packaged or erased. An intake that verified nothing but claimed it had would
// be worse than one that is honest about the gap.

const DSAR_MAX = 3;
const DSAR_IP_MAX = 10;
// The tenant's own service target, matching packages/core/src/seed/compliance.ts:
// docs/12 does not state a statutory period, so this does not invent one.
const DSAR_DUE_DAYS = 30;

const PrivacyRequestBody = z
  .object({
    type: z.enum(["access", "erasure", "rectification", "portability", "objection", "restriction"]),
    email: z.string().email(),
    name: z.string().max(200).optional(),
    details: z.string().max(2000).optional()
  })
  .strict();

// Best-effort link to an existing record. A miss is not an error and not
// disclosed: an unmatched request is still a request, and the response must
// look identical either way or the portal becomes a customer-enumeration oracle.
async function customerIdForEmail(
  database: ReturnType<typeof rawDb>,
  tenantId: string,
  email: string
): Promise<string | null> {
  const candidates = await database
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.tenantId, tenantId), like(schema.customers.emailsJson, `%${email}%`)))
    .limit(20);
  // `_` is a legal email character and a LIKE wildcard, so the SQL narrows and
  // this exact-matches.
  const hit = candidates.find((row) => {
    if (!row.emailsJson) return false;
    const parsed: unknown = JSON.parse(row.emailsJson);
    return Array.isArray(parsed) && parsed.some((e) => typeof e === "string" && e.toLowerCase() === email);
  });
  return hit?.id ?? null;
}

portalRoutes.post("/:tenantSlug/privacy-requests", async (c) => {
  const now = Date.now();
  const input = await body(c, PrivacyRequestBody);
  const email = input.email.toLowerCase();
  await throttle(c.env, `portal-dsar:${email}`, DSAR_MAX, LEAD_WINDOW_SEC);
  const ip = c.req.header("cf-connecting-ip");
  if (ip) await throttle(c.env, `portal-dsar-ip:${ip}`, DSAR_IP_MAX, LEAD_WINDOW_SEC);

  const database = rawDb(c.env);
  const tenant = await activeTenant(database, c.req.param("tenantSlug"));
  const customerId = await customerIdForEmail(database, tenant.id, email);

  const ctx = await ctxFor(
    c.env,
    {
      tenantId: tenant.id,
      locale: "en",
      actor: { kind: "system", id: "portal-dsar", tenantId: tenant.id, grants: [] },
      policy: PolicyJson.parse({}),
      entitlements: EntitlementsJson.parse({})
    },
    now,
    ip,
    c.req.header("user-agent")
  );

  const dueAt = now + DSAR_DUE_DAYS * 24 * 60 * 60 * 1000;
  const requestRow = {
    id: newId("dsr", now),
    tenantId: tenant.id,
    customerId,
    subjectIdentifier: email,
    type: input.type,
    channel: "portal" as const,
    verificationRef: null as string | null,
    subjectNote: [input.name ? `Name given: ${input.name}` : null, input.details ?? null]
      .filter(Boolean)
      .join("\n") || null,
    state: "received" as const,
    dueAt,
    fulfilledAt: null as number | null,
    refusalReason: null as string | null,
    bundleFileId: null as string | null,
    completenessProofJson: null as string | null,
    handledBy: null as string | null,
    createdAt: now,
    updatedAt: now
  };
  await ctx.db.insert(schema.dsarRequests).values(requestRow);
  await audit(ctx, {
    action: "compliance.dsar-requests.create",
    subjectRef: `dsar-requests:${requestRow.id}`,
    after: requestRow
  });
  await emit(ctx, {
    module: "compliance",
    type: "compliance.dsar-requests.created",
    subject: requestRow.id,
    data: { id: requestRow.id, type: requestRow.type, via: "portal" }
  });

  // 202, not 201: what was accepted is the request, not the outcome — nothing
  // is packaged or erased until a human verifies the subject.
  return c.json({ reference: requestRow.id, dueAt }, 202);
});
