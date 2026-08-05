import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { id as newId, schema, BrandJson, EntitlementsJson, PolicyJson } from "@lyra/db";
import { audit, emit, notFound, sha256Hex } from "@lyra/core";
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

  const quoteRequestRow = {
    id: newId("qrq", now),
    tenantId: tenant.id,
    caseId: null as string | null,
    customerId,
    channelId,
    productId: input.productId,
    inputsJson: JSON.stringify({ name: input.name, email, phone: input.phone ?? null, message: input.message ?? null }),
    consentId: null as string | null,
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
