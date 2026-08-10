import { Hono, type Context } from "hono";
import { and, eq, inArray, like } from "drizzle-orm";
import { z } from "zod";
import { id as newId, schema, BrandJson, EntitlementsJson, PolicyJson } from "@lyra/db";
import { audit, badRequest, conflict, emit, notFound, recordConsent, sha256Hex } from "@lyra/core";
import { body } from "../http.js";
import { ctxFor, db as rawDb, throttle } from "../auth.js";
import { panelFor } from "../engines/rating.js";
import { runShop } from "../engines/shop.js";
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
    consent: z.literal(true),
    /**
     * The risk, in the product's rating inputs (J-C1's "3-field quick quote").
     * Absent means the visitor only asked to be contacted, which is the older
     * lead-capture behaviour and still valid — a product whose panel prices by
     * referral has nothing to show in the browser.
     */
    inputs: z.record(z.string(), z.unknown()).optional()
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

  // The contact details are what the customer typed; the risk (if any) is what
  // gets priced. Both belong on the request — staff working the lead need the
  // former, the panel needs the latter.
  const contact = { name: input.name, email, phone: input.phone ?? null, message: input.message ?? null };
  const inputs = input.inputs ?? null;

  // A shop only makes sense if something on the panel can answer in-session.
  // An empty panel is not an error for a lead — it means "a human will call" —
  // so it falls back rather than 409ing a member of the public.
  const panel = inputs
    ? await panelFor(ctx, { productId: input.productId, channelKey: DIRECT_WEB_CHANNEL_KEY, at: now })
    : [];

  const baseRow = {
    id: newId("qrq", now),
    tenantId: tenant.id,
    caseId: null as string | null,
    customerId,
    channelId,
    productId: input.productId,
    inputsJson: JSON.stringify(inputs ? { ...contact, ...inputs } : contact),
    consentId: consent.id as string | null,
    currency: DEFAULT_CURRENCY,
    sharedWithCustomerAt: null as number | null,
    expiresAt: inputs && panel.length ? now + QUOTE_TTL_MS : null,
    createdAt: now,
    updatedAt: now
  };

  if (!inputs || !panel.length) {
    const leadRow = {
      ...baseRow,
      fanoutCount: 0,
      respondedCount: 0,
      bestOfferingId: null as string | null,
      bestPremiumMinor: null as number | null,
      portalTokenHash: null as string | null,
      state: "open" as const
    };
    await ctx.db.insert(schema.distQuoteRequests).values(leadRow);
    await audit(ctx, {
      action: "dist.quote_requests.create",
      subjectRef: `quote-requests:${leadRow.id}`,
      after: leadRow
    });
    await emit(ctx, {
      module: "dist",
      type: "dist.quote_requests.created",
      subject: leadRow.id,
      data: { id: leadRow.id, via: "portal" }
    });
    return c.json({ quoteRequestId: leadRow.id }, 201);
  }

  // The visitor has no session, so the token in the response is the only thing
  // that will let them come back to this comparison. Stored as a hash: a leaked
  // database row must not re-open somebody's quote.
  const token = portalToken();
  const shopped = await runShop(ctx, {
    request: { ...baseRow, portalTokenHash: await sha256Hex(token) },
    channelKey: DIRECT_WEB_CHANNEL_KEY,
    inputs
  });
  await audit(ctx, {
    action: "dist.quote_requests.create",
    subjectRef: `quote-requests:${shopped.request.id}`,
    after: { ...shopped.request, portalTokenHash: "[redacted]" }
  });
  await emit(ctx, {
    module: "dist",
    type: "dist.quote_requests.created",
    subject: shopped.request.id,
    data: { id: shopped.request.id, via: "portal", fanout: shopped.request.fanoutCount }
  });

  return c.json(
    {
      quoteRequestId: shopped.request.id,
      token,
      ...(await comparison(ctx, shopped.request, shopped.responses))
    },
    201
  );
});

// ---------------------------------------------------------------------------
// J-C1 "Get covered" (docs/06 §J-C1): quick quote -> ranked offers -> docs ->
// pay -> policy. Everything up to `pay` is here. Payment is not: no PSP
// connector exists in the repo (engines/settlement.ts says the same), and
// issuance is `consequential` (CLAUDE.md §4) so a human approves it. ADR-0043.

const QUOTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_IP_MAX = 20;
const UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/heic", "image/webp", "application/pdf"]);

interface UploadedFile {
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function portalToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The request behind a portal link, or 404. Wrong token and unknown id answer
 * identically on purpose: the id is in the visitor's own URL, so a distinct
 * "token invalid" would confirm that someone else's quote exists.
 */
async function requestForToken(
  database: ReturnType<typeof rawDb>,
  tenantId: string,
  requestId: string,
  token: string | undefined
): Promise<typeof schema.distQuoteRequests.$inferSelect> {
  const rows = await database
    .select()
    .from(schema.distQuoteRequests)
    .where(and(eq(schema.distQuoteRequests.tenantId, tenantId), eq(schema.distQuoteRequests.id, requestId)))
    .limit(1);
  const row = rows[0];
  if (!row?.portalTokenHash || !token || row.portalTokenHash !== (await sha256Hex(token))) {
    throw notFound("quote request");
  }
  return row;
}

/**
 * The comparison as a member of the public may see it: quotes only, ranked, with
 * the ranking criterion stated (docs/12 — the customer is told what "best" means
 * here). Commission, provider scores and decline reasons stay internal.
 */
async function comparison(
  ctx: Awaited<ReturnType<typeof ctxFor>>,
  request: typeof schema.distQuoteRequests.$inferSelect,
  responses?: (typeof schema.distQuoteResponses.$inferSelect)[]
) {
  const rows =
    responses ??
    (await ctx.db
      .select()
      .from(schema.distQuoteResponses)
      .where(
        and(
          eq(schema.distQuoteResponses.tenantId, ctx.tenantId),
          eq(schema.distQuoteResponses.requestId, request.id)
        )
      ));

  const quoted = rows.filter((r) => r.state === "quoted" && r.premiumMinor !== null);
  const offeringIds = quoted.map((r) => r.offeringId);
  const offerings = offeringIds.length
    ? await ctx.db
        .select()
        .from(schema.distOfferings)
        .where(
          and(eq(schema.distOfferings.tenantId, ctx.tenantId), inArray(schema.distOfferings.id, offeringIds))
        )
    : [];
  const offeringById = new Map(offerings.map((o) => [o.id, o]));
  const providers = offerings.length
    ? await ctx.db.select().from(schema.providers).where(eq(schema.providers.tenantId, ctx.tenantId))
    : [];
  const providerNameById = new Map(providers.map((p) => [p.id, p.name]));

  return {
    state: request.state,
    currency: request.currency,
    // Declared ranking criteria: J-C1 says "ranked offers (declared criteria
    // visible)", and a comparison that hides how it sorted is the thing the
    // journey is written against.
    rankedBy: "total_price" as const,
    acceptedOfferingId: request.state === "converted" ? request.bestOfferingId : null,
    referredCount: rows.filter((r) => r.state === "referred").length,
    offers: quoted
      .sort((a, b) => (a.priceRank ?? 99) - (b.priceRank ?? 99))
      .map((r) => {
        const offering = offeringById.get(r.offeringId);
        return {
          offeringId: r.offeringId,
          name: offering ? (JSON.parse(offering.nameJson).en as string) : r.offeringId,
          providerName: providerNameById.get(r.providerId) ?? null,
          premiumMinor: r.premiumMinor as number,
          taxMinor: r.taxMinor,
          feesMinor: r.feesMinor,
          totalMinor: (r.premiumMinor as number) + r.taxMinor + r.feesMinor,
          currency: r.currency,
          coverage: r.coverageJson ? (JSON.parse(r.coverageJson) as Record<string, unknown>) : null,
          rank: r.priceRank,
          validUntil: r.validUntil
        };
      })
  };
}

async function portalCtx(c: Context<App>, tenantId: string, now: number, who: string) {
  return ctxFor(
    c.env,
    {
      tenantId,
      locale: "en",
      actor: { kind: "system", id: who, tenantId, grants: [] },
      policy: PolicyJson.parse({}),
      entitlements: EntitlementsJson.parse({})
    },
    now,
    c.req.header("cf-connecting-ip"),
    c.req.header("user-agent")
  );
}

portalRoutes.get("/:tenantSlug/quote-requests/:id", async (c) => {
  const now = Date.now();
  const database = rawDb(c.env);
  const tenant = await activeTenant(database, c.req.param("tenantSlug"));
  const request = await requestForToken(database, tenant.id, c.req.param("id"), c.req.query("token"));
  const ctx = await portalCtx(c, tenant.id, now, "portal-quote");
  return c.json(await comparison(ctx, request));
});

const AcceptBody = z.object({ token: z.string().min(1), offeringId: z.string().min(1) }).strict();

portalRoutes.post("/:tenantSlug/quote-requests/:id/accept", async (c) => {
  const now = Date.now();
  const input = await body(c, AcceptBody);
  const database = rawDb(c.env);
  const tenant = await activeTenant(database, c.req.param("tenantSlug"));
  const request = await requestForToken(database, tenant.id, c.req.param("id"), input.token);
  if (request.expiresAt !== null && request.expiresAt < now) throw conflict("quote has expired");

  const ctx = await portalCtx(c, tenant.id, now, "portal-quote-accept");
  const responses = await ctx.db
    .select()
    .from(schema.distQuoteResponses)
    .where(
      and(eq(schema.distQuoteResponses.tenantId, tenant.id), eq(schema.distQuoteResponses.requestId, request.id))
    );
  const chosen = responses.find((r) => r.offeringId === input.offeringId && r.state === "quoted");
  if (!chosen) throw notFound("offer");

  // Accepting is the customer saying which quote they want. It is not issuance:
  // binding cover is `consequential: true` (CLAUDE.md §4), so a human approves
  // it from the case this converts into. Re-accepting a different offer before
  // that happens is allowed — nothing has been bound yet.
  await ctx.db
    .update(schema.distQuoteRequests)
    .set({
      bestOfferingId: chosen.offeringId,
      bestPremiumMinor: chosen.premiumMinor,
      state: "converted",
      sharedWithCustomerAt: request.sharedWithCustomerAt ?? now,
      updatedAt: now
    })
    .where(and(eq(schema.distQuoteRequests.tenantId, tenant.id), eq(schema.distQuoteRequests.id, request.id)));

  await audit(ctx, {
    action: "dist.quote_requests.accept",
    subjectRef: `quote-requests:${request.id}`,
    before: { bestOfferingId: request.bestOfferingId, state: request.state },
    after: { bestOfferingId: chosen.offeringId, state: "converted", via: "portal" }
  });
  await emit(ctx, {
    module: "dist",
    type: "dist.quote_requests.accepted",
    subject: request.id,
    data: { id: request.id, offeringId: chosen.offeringId, premiumMinor: chosen.premiumMinor, via: "portal" }
  });

  // No payment step: no PSP connector exists (engines/settlement.ts §7), so what
  // the customer is told next is "send your documents", and a human takes it
  // from there. ADR-0043.
  return c.json({ acceptedOfferingId: chosen.offeringId, nextStep: "documents" });
});

portalRoutes.post("/:tenantSlug/quote-requests/:id/documents", async (c) => {
  const now = Date.now();
  const database = rawDb(c.env);
  const tenant = await activeTenant(database, c.req.param("tenantSlug"));
  const form = await c.req.formData();
  const token = form.get("token");
  const request = await requestForToken(
    database,
    tenant.id,
    c.req.param("id"),
    typeof token === "string" ? token : undefined
  );

  const ip = c.req.header("cf-connecting-ip");
  if (ip) await throttle(c.env, `portal-upload-ip:${ip}`, UPLOAD_IP_MAX, LEAD_WINDOW_SEC);

  // Hono types a form entry as `string | null` (the Workers `File` global is not
  // in this project's lib), so the upload is narrowed structurally instead.
  const file = form.get("file") as unknown as UploadedFile | string | null;
  if (!file || typeof file === "string") throw badRequest("file is required");
  if (file.size > UPLOAD_MAX_BYTES) throw badRequest("file is larger than 10MB");
  const contentType = file.type || "application/octet-stream";
  if (!UPLOAD_TYPES.has(contentType)) throw badRequest(`${contentType} is not an accepted document type`);

  const bucket = c.env.FILES;
  if (!bucket) throw conflict("document storage is not configured");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const ctx = await portalCtx(c, tenant.id, now, "portal-quote-documents");
  const fileId = newId("file", now);
  const r2Key = `portal/${tenant.id}/${request.id}/${fileId}`;
  await bucket.put(r2Key, bytes, { httpMetadata: { contentType } });
  await ctx.db.insert(schema.files).values({
    id: fileId,
    tenantId: tenant.id,
    r2Key,
    kind: "customer_document",
    subjectRef: `quote-requests:${request.id}`,
    sha256: await sha256Hex(bytes),
    sizeBytes: bytes.length,
    contentType,
    // An ID photo or a licence disc is as sensitive as the platform holds, and
    // nobody verified who uploaded it.
    piiLevel: "high",
    createdAt: now,
    deletedAt: null
  });
  await audit(ctx, {
    action: "core.files.create",
    subjectRef: `files:${fileId}`,
    after: { id: fileId, kind: "customer_document", subjectRef: `quote-requests:${request.id}`, via: "portal" }
  });

  return c.json({ fileId }, 201);
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
