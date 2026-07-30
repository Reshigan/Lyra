import { eq } from "drizzle-orm";
import {
  BrandJson,
  CHART_OF_ACCOUNTS,
  EntitlementsJson,
  PolicyJson,
  id,
  schema
} from "@lyra/db";
import { ROLES, TENANT_ROLE_KEYS, requiresMfa } from "./rbac.js";
import { hashPassword } from "./password.js";
import { splitCommission } from "./commission.js";
import type { CoreDb } from "./context.js";

// GONXT is the reference tenant: an aggregator that distributes other
// underwriters' products, underwrites some of its own, and sells through a b2c
// site and b2b partners. The seed is the demo, the e2e fixture and the
// provisioning template — one dataset, so a bug shows up in all three.

const T0 = Date.UTC(2026, 0, 6, 8, 0, 0); // deterministic ids: same seed, same ULIDs prefix time
const DAY = 86_400_000;

/** Overridable so a real deployment never ships a known password. */
const DEFAULT_PASSWORD = "Gonxt-Demo-2026!";

export interface SeedOptions {
  now?: number;
  password?: string;
  /**
   * Enrol every staff persona on this shared TOTP secret. Only a test or a demo
   * wants this — it is one secret for many people, which is the opposite of what
   * a second factor is for. Leave it unset for a real tenant and PLAT-013 walks
   * each person through enrolment on their first sign-in.
   */
  mfaSecret?: string;
}

export interface SeedResult {
  tenantId: string;
  users: Record<string, string>;
  channels: Record<string, string>;
  providers: Record<string, string>;
  offerings: Record<string, string>;
}

const ROLE_NAMES: Record<string, string> = {
  "tenant.admin": "Tenant administrator",
  "tenant.compliance": "Compliance officer",
  "axis.agent": "Operations agent",
  "axis.lead": "Operations lead",
  "axis.admin": "Operations administrator",
  "orbit.agent": "Customer agent",
  "orbit.lead": "Customer lead",
  "orbit.retention": "Retention specialist",
  "orbit.partners": "Partner manager",
  "orbit.admin": "Customer administrator",
  "signal.marketer": "Marketer",
  "signal.lead": "Growth lead",
  "signal.admin": "Growth administrator",
  "scout.pm": "Product manager",
  "scout.lead": "Product lead",
  "scout.admin": "Product administrator",
  "north.exec": "Executive",
  "north.analyst": "Analyst",
  "north.board": "Board member",
  "north.admin": "Intelligence administrator",
  "finance.analyst": "Finance analyst",
  "finance.controller": "Financial controller",
  "dev.developer": "Developer",
  "dev.admin": "Developer administrator",
  customer: "Customer",
  "partner.developer": "Partner developer",
  "partner.manager": "Partner manager",
  "provider.viewer": "Provider viewer"
};

/** email local part -> role key. One login per persona in the journey tests. */
const PEOPLE: ReadonlyArray<{ local: string; name: string; role: string; locale?: string }> = [
  { local: "amina.saleh", name: "Amina Saleh", role: "tenant.admin" },
  { local: "khalid.rashed", name: "Khalid Al Rashed", role: "tenant.compliance", locale: "ar" },
  { local: "layla.hassan", name: "Layla Hassan", role: "axis.agent" },
  { local: "omar.farouk", name: "Omar Farouk", role: "axis.lead" },
  { local: "sara.nasser", name: "Sara Al Nasser", role: "orbit.agent" },
  { local: "yusuf.karim", name: "Yusuf Karim", role: "orbit.retention" },
  { local: "dana.aziz", name: "Dana Aziz", role: "orbit.partners" },
  { local: "noor.jamal", name: "Noor Jamal", role: "signal.lead" },
  { local: "tariq.mansour", name: "Tariq Mansour", role: "scout.lead" },
  { local: "hala.zayed", name: "Hala Zayed", role: "north.exec" },
  { local: "rana.hadid", name: "Rana Hadid", role: "north.analyst" },
  { local: "faisal.omar", name: "Faisal Omar", role: "finance.controller" },
  // Money out is dual-control and only a controller may decide it, so one
  // controller means no payout, refund or client-money transfer can ever clear.
  { local: "nadia.rahman", name: "Nadia Rahman", role: "finance.controller" },
  { local: "mona.idris", name: "Mona Idris", role: "finance.analyst" },
  { local: "raed.samir", name: "Raed Samir", role: "dev.admin" }
];

export async function seed(db: CoreDb, opts: SeedOptions = {}): Promise<SeedResult> {
  const now = opts.now ?? T0;
  const existing = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, "gonxt"))
    .limit(1);
  if (existing[0]) throw new Error("gonxt tenant already seeded — drop the database first");

  const tenantId = id("tn", now);

  await db.insert(schema.tenants).values({
    id: tenantId,
    slug: "gonxt",
    name: "GONXT",
    plan: "enterprise",
    region: "auto",
    status: "active",
    brandJson: JSON.stringify(
      BrandJson.parse({
        name: "GONXT",
        shortName: "GONXT",
        domain: "gonxt.ae",
        palette: { accent: "#5B8CFF", accentHover: "#3F6FE0" },
        font: "space-grotesk",
        email: { from: "hello@gonxt.ae", replyTo: "support@gonxt.ae" },
        legal: { company: "GONXT Insurance Services LLC", privacyUrl: "https://gonxt.ae/privacy" }
      })
    ),
    policyJson: JSON.stringify(
      PolicyJson.parse({
        locales: ["en", "ar"],
        defaultLocale: "en",
        currency: "AED",
        domainPack: "insurance-retail",
        autonomyDefault: "act_with_approval",
        autoApprove: ["signal.campaign_launch"]
      })
    ),
    entitlementsJson: JSON.stringify(
      EntitlementsJson.parse({
        edition: "suite",
        modules: ["axis", "orbit", "signal", "scout", "north"],
        seats: 250,
        features: { comparativeQuotes: true, aggregator: true, onPrem: false }
      })
    ),
    createdAt: now,
    updatedAt: now
  });

  /* -------------------------------------------------------------- roles */
  const roleIds: Record<string, string> = {};
  let n = 0;
  for (const key of TENANT_ROLE_KEYS) {
    const rid = id("rl", now + n++);
    roleIds[key] = rid;
    await db.insert(schema.roles).values({
      id: rid,
      tenantId,
      key,
      name: ROLE_NAMES[key] ?? key,
      permissionsJson: JSON.stringify(ROLES[key] ?? []),
      system: true,
      createdAt: now
    });
  }

  /* -------------------------------------------------------------- teams */
  const teams = {
    motor: id("tm", now),
    health: id("tm", now + 1),
    retention: id("tm", now + 2)
  };
  await db.insert(schema.teams).values([
    { id: teams.motor, tenantId, name: "Motor desk", moduleScope: "axis", createdAt: now },
    { id: teams.health, tenantId, name: "Health desk", moduleScope: "axis", createdAt: now },
    { id: teams.retention, tenantId, name: "Retention", moduleScope: "orbit", createdAt: now }
  ]);

  /* -------------------------------------------------------------- users */
  const passwordHash = await hashPassword(opts.password ?? DEFAULT_PASSWORD);
  const users: Record<string, string> = {};
  let u = 0;
  for (const person of PEOPLE) {
    const uid = id("us", now + u++);
    users[person.role] = uid;
    await db.insert(schema.users).values({
      id: uid,
      tenantId,
      email: `${person.local}@gonxt.ae`,
      name: person.name,
      locale: person.locale ?? "en",
      status: "active",
      authProvider: "password",
      passwordHash,
      // PLAT-013 covers staff only, so an external persona stays on a password
      // even when the demo secret is supplied.
      mfaEnrolled: Boolean(opts.mfaSecret) && requiresMfa([person.role]),
      mfaSecret: opts.mfaSecret && requiresMfa([person.role]) ? opts.mfaSecret : null,
      createdAt: now,
      updatedAt: now
    });
    await db.insert(schema.userRoles).values({
      id: id("ur", now + u),
      tenantId,
      userId: uid,
      roleId: roleIds[person.role]!,
      // The motor desk agent is team-scoped, so ABAC has something real to bite on.
      scopeJson: person.role === "axis.agent" ? JSON.stringify({ teamIds: [teams.motor] }) : null,
      createdAt: now
    });
  }

  /* --------------------------------------------------- ledger accounts */
  let a = 0;
  for (const acc of CHART_OF_ACCOUNTS) {
    await db.insert(schema.ledgerAccounts).values({
      id: id("acc", now + a++),
      tenantId,
      code: acc.code,
      nameJson: JSON.stringify({ en: acc.en, ar: acc.ar }),
      type: acc.type,
      normalSide: acc.normalSide,
      clientMoney: acc.clientMoney ?? false,
      currency: "AED",
      status: "active",
      createdAt: now
    });
  }

  /* ------------------------------------------------------------ panel */
  const providers = {
    gonxt: id("pv", now),
    falcon: id("pv", now + 1),
    cedar: id("pv", now + 2),
    oryx: id("pv", now + 3),
    gulfHealth: id("pv", now + 4),
    meridian: id("pv", now + 5)
  };
  await db.insert(schema.providers).values([
    {
      id: providers.gonxt,
      tenantId,
      name: "GONXT Underwriting",
      kind: "insurer",
      isInternal: true,
      linesJson: JSON.stringify(["motor", "travel"]),
      integrationJson: JSON.stringify({ mode: "internal" }),
      currency: "AED",
      panelStatus: "active",
      createdAt: now,
      updatedAt: now
    },
    {
      id: providers.falcon,
      tenantId,
      name: "Falcon Insurance",
      kind: "insurer",
      linesJson: JSON.stringify(["motor", "home"]),
      integrationJson: JSON.stringify({ mode: "api" }),
      quoteEndpointJson: JSON.stringify({ url: "https://api.falcon.example/quote", authRef: "FALCON_API_KEY" }),
      settlementTermsJson: JSON.stringify({ frequency: "monthly", netDays: 30 }),
      currency: "AED",
      panelStatus: "active",
      createdAt: now,
      updatedAt: now
    },
    {
      id: providers.cedar,
      tenantId,
      name: "Cedar General Insurance",
      kind: "insurer",
      linesJson: JSON.stringify(["motor", "home", "travel"]),
      integrationJson: JSON.stringify({ mode: "api" }),
      quoteEndpointJson: JSON.stringify({ url: "https://api.cedar.example/rate", authRef: "CEDAR_API_KEY" }),
      settlementTermsJson: JSON.stringify({ frequency: "monthly", netDays: 45 }),
      currency: "AED",
      panelStatus: "active",
      createdAt: now,
      updatedAt: now
    },
    {
      id: providers.oryx,
      tenantId,
      name: "Oryx Takaful",
      kind: "insurer",
      linesJson: JSON.stringify(["motor", "life"]),
      integrationJson: JSON.stringify({ mode: "portal" }),
      settlementTermsJson: JSON.stringify({ frequency: "monthly", netDays: 60 }),
      currency: "AED",
      panelStatus: "active",
      createdAt: now,
      updatedAt: now
    },
    {
      id: providers.gulfHealth,
      tenantId,
      name: "Gulf Health Assurance",
      kind: "insurer",
      linesJson: JSON.stringify(["health"]),
      integrationJson: JSON.stringify({ mode: "email" }),
      settlementTermsJson: JSON.stringify({ frequency: "monthly", netDays: 30 }),
      currency: "AED",
      panelStatus: "active",
      createdAt: now,
      updatedAt: now
    },
    {
      id: providers.meridian,
      tenantId,
      name: "Meridian Bank",
      kind: "financier",
      linesJson: JSON.stringify(["loan"]),
      integrationJson: JSON.stringify({ mode: "api" }),
      currency: "AED",
      panelStatus: "active",
      createdAt: now,
      updatedAt: now
    }
  ]);

  /* --------------------------------------------------------- products */
  const products = {
    motor: id("pr", now),
    health: id("pr", now + 1),
    travel: id("pr", now + 2),
    home: id("pr", now + 3),
    life: id("pr", now + 4)
  };
  await db.insert(schema.products).values([
    {
      id: products.motor,
      tenantId,
      line: "motor",
      nameJson: JSON.stringify({ en: "Motor comprehensive", ar: "تأمين شامل للمركبات" }),
      status: "active",
      createdAt: now,
      updatedAt: now
    },
    {
      id: products.health,
      tenantId,
      line: "health",
      nameJson: JSON.stringify({ en: "Health – individual", ar: "تأمين صحي – فردي" }),
      status: "active",
      createdAt: now,
      updatedAt: now
    },
    {
      id: products.travel,
      tenantId,
      line: "travel",
      nameJson: JSON.stringify({ en: "Travel", ar: "تأمين السفر" }),
      status: "active",
      createdAt: now,
      updatedAt: now
    },
    {
      id: products.home,
      tenantId,
      line: "home",
      nameJson: JSON.stringify({ en: "Home contents", ar: "تأمين محتويات المنزل" }),
      status: "active",
      createdAt: now,
      updatedAt: now
    },
    {
      id: products.life,
      tenantId,
      line: "life",
      nameJson: JSON.stringify({ en: "Term life", ar: "تأمين على الحياة" }),
      structure: "takaful",
      status: "active",
      createdAt: now,
      updatedAt: now
    }
  ]);

  /* -------------------------------------------------------- offerings */
  const offerings = {
    gonxtMotor: id("of", now),
    falconMotor: id("of", now + 1),
    cedarMotor: id("of", now + 2),
    oryxMotor: id("of", now + 3),
    cedarMotorPlus: id("of", now + 4),
    gulfHealth: id("of", now + 5),
    gonxtTravel: id("of", now + 6),
    cedarHome: id("of", now + 7),
    oryxLife: id("of", now + 8)
  };
  const offering = (
    key: keyof typeof offerings,
    providerId: string,
    productId: string,
    code: string,
    en: string,
    ar: string,
    baseCommissionPpm: number,
    extra: Partial<typeof schema.distOfferings.$inferInsert> = {}
  ): typeof schema.distOfferings.$inferInsert => ({
    id: offerings[key],
    tenantId,
    productId,
    providerId,
    code,
    nameJson: JSON.stringify({ en, ar }),
    currency: "AED",
    pricingMode: "api",
    baseCommissionPpm,
    effectiveFrom: now,
    status: "active",
    createdAt: now,
    updatedAt: now,
    ...extra
  });

  // Rate tables, not live underwriter APIs. A seeded panel has to price for
  // real — the comparison is the product — and there is no third-party endpoint
  // to call from a demo, an e2e run or an on-prem box. `pricingMode: "api"` is
  // exercised by the adapter tests instead, where a stub quoter stands in.
  const motorTable = (base: number, ratePpm: number, minPremiumMinor: number): string =>
    JSON.stringify({
      base,
      bands: [
        { field: "age", min: 18, max: 24, factorPpm: 1_450_000 },
        { field: "age", min: 25, max: 39, factorPpm: 1_050_000 },
        { field: "age", min: 40, max: 120, factorPpm: 900_000 }
      ],
      rates: [{ field: "sumInsuredMinor", ratePpm }],
      loadings: [{ field: "priorClaims", whenTrue: 30_000 }],
      minPremiumMinor,
      taxPpm: 50_000 // 5% VAT
    });

  await db.insert(schema.distOfferings).values([
    // Our own paper: no external commission, the whole margin is underwriting result.
    offering(
      "gonxtMotor",
      providers.gonxt,
      products.motor,
      "GNX-MOT-STD",
      "GONXT Motor Standard",
      "جي أو إن إكس تي – تأمين مركبات قياسي",
      0,
      {
        pricingMode: "table",
        ratingTableJson: motorTable(60_000, 7_800, 95_000),
        coverageJson: JSON.stringify({ excessMinor: 100_000, agencyRepair: false, roadside: true }),
        crossSellTagsJson: JSON.stringify(["motor_owner"])
      }
    ),
    offering("falconMotor", providers.falcon, products.motor, "FAL-MOT-COMP", "Falcon Motor Comprehensive", "فالكون – شامل للمركبات", 150_000, {
      pricingMode: "table",
      ratingTableJson: motorTable(80_000, 9_100, 120_000),
      eligibilityJson: JSON.stringify({ minAge: 21, markets: ["AE"], requires: { vehicleUse: "private" } }),
      coverageJson: JSON.stringify({ excessMinor: 50_000, agencyRepair: true, roadside: true }),
      crossSellTagsJson: JSON.stringify(["motor_owner"])
    }),
    offering("cedarMotor", providers.cedar, products.motor, "CDR-MOT-ESS", "Cedar Motor Essential", "سيدار – أساسي للمركبات", 125_000, {
      pricingMode: "table",
      ratingTableJson: motorTable(52_000, 7_200, 85_000),
      coverageJson: JSON.stringify({ excessMinor: 150_000, agencyRepair: false, roadside: false })
    }),
    offering("cedarMotorPlus", providers.cedar, products.motor, "CDR-MOT-PLUS", "Cedar Motor Plus", "سيدار – بلس للمركبات", 175_000, {
      pricingMode: "table",
      ratingTableJson: motorTable(96_000, 10_400, 150_000),
      // Priced for higher-value vehicles: a small risk is declined, and the
      // comparison shows why rather than quietly returning a shorter panel.
      eligibilityJson: JSON.stringify({ minSumInsuredMinor: 5_000_000 }),
      coverageJson: JSON.stringify({ excessMinor: 0, agencyRepair: true, roadside: true }),
      upsellOfOfferingId: offerings.cedarMotor
    }),
    offering("oryxMotor", providers.oryx, products.motor, "ORX-MOT-TKF", "Oryx Motor Takaful", "أوريكس – تكافل المركبات", 140_000, {
      pricingMode: "manual",
      slaSeconds: 120
    }),
    offering("gulfHealth", providers.gulfHealth, products.health, "GHA-IND-SILVER", "Gulf Health Individual Silver", "الخليج الصحي – فضي فردي", 100_000, {
      pricingMode: "referral",
      slaSeconds: 300,
      crossSellTagsJson: JSON.stringify(["family", "new_parent"])
    }),
    offering("gonxtTravel", providers.gonxt, products.travel, "GNX-TRV-ANN", "GONXT Travel Annual", "جي أو إن إكس تي – سفر سنوي", 0, {
      pricingMode: "table",
      ratingTableJson: JSON.stringify({
        base: 18_000,
        bands: [
          { field: "tripDays", min: 1, max: 14, factorPpm: 1_000_000 },
          { field: "tripDays", min: 15, max: 60, factorPpm: 1_600_000 },
          { field: "tripDays", min: 61, max: 365, factorPpm: 2_400_000 }
        ],
        loadings: [{ field: "winterSports", whenTrue: 12_000 }],
        minPremiumMinor: 15_000,
        taxPpm: 50_000
      }),
      crossSellTagsJson: JSON.stringify(["traveller", "motor_owner"])
    }),
    offering("cedarHome", providers.cedar, products.home, "CDR-HOM-CONT", "Cedar Home Contents", "سيدار – محتويات المنزل", 200_000, {
      pricingMode: "table",
      ratingTableJson: JSON.stringify({
        base: 24_000,
        rates: [{ field: "sumInsuredMinor", ratePpm: 3_400 }],
        loadings: [{ field: "priorClaims", whenTrue: 20_000 }],
        minPremiumMinor: 40_000,
        taxPpm: 50_000
      }),
      crossSellTagsJson: JSON.stringify(["homeowner", "motor_owner"])
    }),
    offering("oryxLife", providers.oryx, products.life, "ORX-LIF-TERM", "Oryx Term Takaful", "أوريكس – تكافل الحياة", 300_000, {
      pricingMode: "manual",
      crossSellTagsJson: JSON.stringify(["new_parent"])
    })
  ]);

  /* --------------------------------------------------------- channels */
  const channels = {
    web: id("ch", now),
    app: id("ch", now + 1),
    callCentre: id("ch", now + 2),
    brokerAlpha: id("ch", now + 3),
    bankEmbed: id("ch", now + 4)
  };
  await db.insert(schema.distChannels).values([
    {
      id: channels.web,
      tenantId,
      key: "gonxt-web",
      kind: "b2c",
      nameJson: JSON.stringify({ en: "gonxt.ae", ar: "gonxt.ae" }),
      medium: "web",
      collectsPayment: "us",
      currency: "AED",
      createdAt: now,
      updatedAt: now
    },
    {
      id: channels.app,
      tenantId,
      key: "gonxt-app",
      kind: "b2c",
      nameJson: JSON.stringify({ en: "GONXT app", ar: "تطبيق GONXT" }),
      medium: "app",
      collectsPayment: "us",
      currency: "AED",
      createdAt: now,
      updatedAt: now
    },
    {
      id: channels.callCentre,
      tenantId,
      key: "gonxt-call",
      kind: "b2c",
      nameJson: JSON.stringify({ en: "Call centre", ar: "مركز الاتصال" }),
      medium: "call_centre",
      collectsPayment: "us",
      currency: "AED",
      createdAt: now,
      updatedAt: now
    },
    {
      id: channels.brokerAlpha,
      tenantId,
      key: "alpha-brokers",
      kind: "b2b",
      nameJson: JSON.stringify({ en: "Alpha Brokers", ar: "ألفا للوساطة" }),
      medium: "portal",
      collectsPayment: "us",
      defaultCommissionPpm: 300_000,
      settlementTermsJson: JSON.stringify({ frequency: "monthly", dayOfMonth: 10, netDays: 15, minPayoutMinor: 50_000 }),
      currency: "AED",
      createdAt: now,
      updatedAt: now
    },
    {
      id: channels.bankEmbed,
      tenantId,
      key: "meridian-embed",
      kind: "b2b",
      nameJson: JSON.stringify({ en: "Meridian Bank embed", ar: "تضمين بنك ميريديان" }),
      medium: "embed",
      collectsPayment: "partner",
      defaultCommissionPpm: 400_000,
      settlementTermsJson: JSON.stringify({ frequency: "monthly", dayOfMonth: 5, netDays: 30 }),
      currency: "AED",
      createdAt: now,
      updatedAt: now
    }
  ]);

  /* -------------------------------------------------- commission rates */
  await db.insert(schema.distCommissionRates).values([
    {
      id: id("cr", now),
      tenantId,
      channelId: channels.brokerAlpha,
      productId: products.motor,
      channelSharePpm: 350_000,
      earnedOn: "collection",
      clawbackDays: 30,
      effectiveFrom: now,
      createdBy: `user:${users["tenant.admin"]}`,
      createdAt: now
    },
    {
      id: id("cr", now + 1),
      tenantId,
      channelId: channels.brokerAlpha,
      offeringId: offerings.cedarMotorPlus,
      channelSharePpm: 450_000,
      earnedOn: "collection",
      clawbackDays: 30,
      effectiveFrom: now,
      createdBy: `user:${users["tenant.admin"]}`,
      createdAt: now
    },
    {
      id: id("cr", now + 2),
      tenantId,
      channelId: channels.brokerAlpha,
      productId: products.health,
      channelSharePpm: 250_000,
      flatFeeMinor: 2_500,
      earnedOn: "collection",
      effectiveFrom: now,
      createdBy: `user:${users["tenant.admin"]}`,
      createdAt: now
    },
    {
      id: id("cr", now + 3),
      tenantId,
      channelId: channels.bankEmbed,
      line: "motor",
      channelSharePpm: 400_000,
      earnedOn: "issue",
      clawbackDays: 45,
      effectiveFrom: now,
      createdBy: `user:${users["tenant.admin"]}`,
      createdAt: now
    }
  ]);

  /* ----------------------------------------------- a live comparative shop */
  const customerId = id("cu", now);
  const consentId = id("cn", now);
  await db.insert(schema.customers).values({
    id: customerId,
    tenantId,
    type: "person",
    nameJson: JSON.stringify({ en: "Rania Haddad", ar: "رانيا حداد" }),
    emailsJson: JSON.stringify(["rania.haddad@example.ae"]),
    phonesJson: JSON.stringify(["+971501234567"]),
    kycStatus: "verified",
    consentId,
    locale: "en",
    createdAt: now,
    updatedAt: now
  });
  await db.insert(schema.consents).values({
    id: consentId,
    tenantId,
    customerId,
    // dataSharing is what licenses the fan-out to the panel.
    purposesJson: JSON.stringify({ marketing: true, profiling: true, dataSharing: true, crossBorder: false }),
    channelOptinsJson: JSON.stringify({ email: true, sms: false, whatsapp: true, voice: false, push: true }),
    source: "web",
    ts: now,
    version: 1
  });

  const requestId = id("qr", now);
  await db.insert(schema.distQuoteRequests).values({
    id: requestId,
    tenantId,
    customerId,
    channelId: channels.web,
    productId: products.motor,
    inputsJson: JSON.stringify({
      vehicle: { make: "Toyota", model: "Land Cruiser", year: 2023, valueMinor: 28_000_000 },
      driver: { age: 34, licenceYears: 9, claimsLast3y: 0 },
      emirate: "Dubai"
    }),
    consentId,
    fanoutCount: 4,
    respondedCount: 4,
    bestOfferingId: offerings.cedarMotor,
    bestPremiumMinor: 412_500,
    currency: "AED",
    sharedWithCustomerAt: now + 40_000,
    state: "complete",
    expiresAt: now + 14 * DAY,
    createdAt: now,
    updatedAt: now + 40_000
  });

  interface FanoutRow {
    key: keyof typeof offerings;
    providerId: string;
    premiumMinor: number;
    basePpm: number;
    rank: number;
    valueScore: number;
    rationaleKey: string;
  }
  const responses: readonly FanoutRow[] = [
    { key: "cedarMotor", providerId: providers.cedar, premiumMinor: 412_500, basePpm: 125_000, rank: 1, valueScore: 78, rationaleKey: "rationale.cheapest" },
    { key: "falconMotor", providerId: providers.falcon, premiumMinor: 448_000, basePpm: 150_000, rank: 2, valueScore: 86, rationaleKey: "rationale.best_value" },
    { key: "cedarMotorPlus", providerId: providers.cedar, premiumMinor: 521_000, basePpm: 175_000, rank: 3, valueScore: 91, rationaleKey: "rationale.widest_cover" },
    { key: "gonxtMotor", providerId: providers.gonxt, premiumMinor: 465_000, basePpm: 0, rank: 4, valueScore: 74, rationaleKey: "rationale.own_paper" }
  ];
  const responseIds: Partial<Record<keyof typeof offerings, string>> = {};
  let r = 0;
  for (const row of responses) {
    // b2c web channel: no channel share, so gross === net before tax.
    const split = splitCommission({ premiumMinor: row.premiumMinor, baseCommissionPpm: row.basePpm });
    const responseId = id("qs", now + r);
    responseIds[row.key] = responseId;
    await db.insert(schema.distQuoteResponses).values({
      id: responseId,
      tenantId,
      requestId,
      offeringId: offerings[row.key],
      providerId: row.providerId,
      state: "quoted",
      premiumMinor: row.premiumMinor,
      taxMinor: Math.round(row.premiumMinor * 0.05),
      currency: "AED",
      commissionPpm: row.basePpm,
      commissionMinor: split.grossMinor,
      channelCommissionMinor: 0,
      coverageJson: JSON.stringify({ excessMinor: 100_000, agencyRepair: row.rank <= 2, roadside: true }),
      priceRank: row.rank,
      valueScore: row.valueScore,
      rationaleKey: row.rationaleKey,
      latencyMs: 900 + r * 350,
      validUntil: now + 14 * DAY,
      createdAt: now + 1_000 * (r + 1),
      updatedAt: now + 1_000 * (r + 1)
    });
    r++;
  }

  /* ------------------------------------ the sale: case -> quote -> policy -> money */
  const won = responses[0]!; // the customer took the cheapest
  const caseId = id("cs", now);
  const issuedAt = now + 2 * DAY;
  await db.insert(schema.axisCases).values({
    id: caseId,
    tenantId,
    ref: "GNX-2601-0001",
    kind: "bind",
    customerId,
    productLine: "motor",
    channelId: channels.web,
    quoteRequestId: requestId,
    status: "issued",
    ownerRef: `user:${users["axis.agent"]}`,
    teamId: teams.motor,
    source: "web",
    valueMinor: won.premiumMinor,
    currency: "AED",
    closedAt: issuedAt,
    createdAt: now,
    updatedAt: issuedAt
  });
  await db.insert(schema.axisQuotes).values({
    id: id("qt", now),
    tenantId,
    caseId,
    providerId: won.providerId,
    offeringId: offerings[won.key],
    responseId: responseIds[won.key]!,
    premiumMinor: won.premiumMinor,
    currency: "AED",
    validUntil: now + 14 * DAY,
    winFlag: true,
    source: "api",
    createdAt: now + 1_000,
    updatedAt: issuedAt
  });

  const sale = splitCommission({ premiumMinor: won.premiumMinor, baseCommissionPpm: won.basePpm });
  const policyId = id("pol", issuedAt);
  await db.insert(schema.axisPolicies).values({
    id: policyId,
    tenantId,
    caseId,
    customerId,
    providerId: won.providerId,
    productId: products.motor,
    offeringId: offerings[won.key],
    channelId: channels.web,
    policyNo: "CDR-MOT-2601-778201",
    startAt: issuedAt,
    endAt: issuedAt + 365 * DAY,
    premiumMinor: won.premiumMinor,
    currency: "AED",
    commissionMinor: sale.grossMinor,
    status: "active",
    createdAt: issuedAt,
    updatedAt: issuedAt
  });
  // Last year's cover for the same customer, ending inside the renewal window.
  // The sweep on the scheduled tick raises it, so the retention desk opens on a
  // real queue instead of an empty one (docs/05 J-C3).
  await db.insert(schema.axisPolicies).values({
    id: id("pol", issuedAt + 1),
    tenantId,
    customerId,
    providerId: won.providerId,
    productId: products.motor,
    offeringId: offerings[won.key],
    channelId: channels.web,
    policyNo: "CDR-MOT-2501-664118",
    startAt: now - 345 * DAY,
    endAt: now + 20 * DAY,
    premiumMinor: won.premiumMinor,
    currency: "AED",
    commissionMinor: sale.grossMinor,
    status: "active",
    createdAt: now - 345 * DAY,
    updatedAt: now - 345 * DAY
  });
  await db.insert(schema.distCommissionEntries).values({
    id: id("ce", issuedAt),
    tenantId,
    policyId,
    offeringId: offerings[won.key],
    providerId: won.providerId,
    channelId: channels.web,
    kind: "new_business",
    premiumMinor: won.premiumMinor,
    grossCommissionMinor: sale.grossMinor,
    channelCommissionMinor: sale.channelMinor,
    netCommissionMinor: sale.netMinor,
    taxMinor: sale.taxMinor,
    currency: "AED",
    earnedOn: "issue",
    earnedAt: issuedAt,
    state: "accrued",
    createdAt: issuedAt,
    updatedAt: issuedAt
  });

  // The AI's next best offer on this journey: a motor buyer with a villa address.
  await db.insert(schema.distNextBestOffers).values({
    id: id("nb", now),
    tenantId,
    customerId,
    kind: "cross_sell",
    offeringId: offerings.cedarHome,
    anchorRef: `quote_request:${requestId}`,
    channelId: channels.web,
    score: 72,
    expectedValueMinor: 96_000,
    currency: "AED",
    reasonKey: "nbo.reason.motor_to_home",
    reasonJson: JSON.stringify({ signals: ["villa_address", "high_vehicle_value", "no_home_policy"] }),
    state: "proposed",
    expiresAt: now + 30 * DAY,
    createdAt: now,
    updatedAt: now
  });

  /* --------------------------------------------------------------- ai */
  // One agent per module, each pointing at a versioned prompt row. Without
  // these `POST /v1/ai/runs` 404s on every key, so the demo tenant would ship
  // with no AI at all — and an inline prompt in code cannot be diffed against
  // the version that produced a bad answer (docs/15).
  const agents: { key: string; module: string; tier: string; autonomy: string; en: string; ar: string; desc: string; tools: string[]; prompt: string }[] = [
    {
      key: "quoting",
      module: "dist",
      tier: "standard",
      autonomy: "suggest_only",
      en: "Quote adviser",
      ar: "مستشار التسعير",
      desc: "Explains a comparison panel in plain language and flags the cross-sell worth raising.",
      tools: ["dist.quote_requests.read", "dist.offerings.read", "dist.next_best_offers.propose"],
      prompt:
        "You compare insurance offerings for a customer of an aggregator. You are given the ranked panel " +
        "as JSON: premium, cover differences, excess, and any declined or referred rows. Explain in at most " +
        "five sentences why the best-value row won, what the cheapest row gives up, and why any row was " +
        "declined. Name a cross-sell only when a signal in the input supports it. Never invent a price, a " +
        "cover term or a provider that is not in the input. Answer in the customer's locale."
    },
    {
      key: "copilot",
      module: "axis",
      tier: "standard",
      autonomy: "act_with_approval",
      en: "Case copilot",
      ar: "مساعد الملفات",
      desc: "Summarises a case, drafts the next action, and prepares the quote comparison for the agent.",
      tools: ["axis.cases.read", "axis.quotes.compare", "core.customers.read", "axis.tasks.write"],
      prompt:
        "You assist a licensed insurance agent working a case. Summarise the case state, then propose the " +
        "single next action with the reason. Draft customer-facing text only as a draft for the agent to " +
        "send — never claim it has been sent. You may not give regulated advice, quote a price that is not " +
        "in the input, or promise cover. If a required document is missing, say which one."
    },
    {
      key: "renewal",
      module: "orbit",
      tier: "fast",
      autonomy: "suggest_only",
      en: "Renewal agent",
      ar: "وكيل التجديد",
      desc: "Ranks the renewal book by churn risk and drafts the retention offer.",
      tools: ["orbit.renewals.read", "orbit.conversations.reply", "dist.next_best_offers.propose"],
      prompt:
        "You triage a renewal book. For each policy in the input, give a churn risk of low, medium or high " +
        "with the one signal that drove it, and a retention action. Use only the premium history, claims " +
        "and contact history given. Do not offer a discount that is not in the allowed list."
    },
    {
      key: "creative",
      module: "signal",
      tier: "standard",
      autonomy: "suggest_only",
      en: "Creative studio",
      ar: "استوديو المحتوى",
      desc: "Drafts campaign copy and variants for human approval before anything is published.",
      tools: ["signal.campaigns.read", "signal.creatives.write"],
      prompt:
        "You draft marketing copy for a regulated insurance distributor. Every draft is a proposal for a " +
        "human to approve; nothing you write is published directly. Do not state a price, a guarantee, a " +
        "regulatory status or a comparison claim unless it is in the input. No urgency pressure, no " +
        "invented testimonials, no likeness of a real person."
    },
    {
      key: "discovery",
      module: "scout",
      tier: "reasoning",
      autonomy: "suggest_only",
      en: "Market scout",
      ar: "كشّاف السوق",
      desc: "Reads market signals and proposes experiments in underserved segments.",
      tools: ["scout.signals.read", "scout.whitespaces.read", "scout.experiments.create"],
      prompt:
        "You look for gaps in an insurance distributor's product coverage. From the segment and signal " +
        "data given, propose at most three testable experiments, each with a hypothesis, the metric that " +
        "would settle it, and the smallest version worth running. Say when the data is too thin to support " +
        "a proposal rather than proposing anyway."
    },
    {
      key: "briefing",
      module: "north",
      tier: "reasoning",
      autonomy: "suggest_only",
      en: "Executive briefing",
      ar: "الإحاطة التنفيذية",
      desc: "Turns the metric set into a short briefing with the anomalies called out first.",
      tools: ["north.metrics.read", "north.anomalies.read", "analytics.reports.run"],
      prompt:
        "You write an executive briefing from the metrics given. Lead with what changed and by how much, " +
        "then what is likely driving it, then the decision it calls for. Every number must come from the " +
        "input. Where a movement has no explanation in the data, say so instead of guessing."
    },
    {
      key: "recon",
      module: "ledger",
      tier: "fast",
      autonomy: "suggest_only",
      en: "Reconciliation agent",
      ar: "وكيل التسوية",
      desc: "Matches statement lines to ledger entries and explains what is left unmatched.",
      tools: ["ledger.recon.run", "ledger.journals.read", "ledger.settlements.read"],
      prompt:
        "You reconcile a provider or bank statement against ledger entries. Propose matches with the " +
        "amount, date and reference that justify each one. Never propose a match on amount alone when the " +
        "reference disagrees. List the unmatched lines with the reason they could not be matched. You " +
        "propose only — no posting is made by you."
    },
    {
      key: "qa",
      module: "core",
      tier: "standard",
      autonomy: "suggest_only",
      en: "Quality reviewer",
      ar: "مراجع الجودة",
      desc: "Reviews AI output and agent conversations against the guardrails before they reach a customer.",
      tools: ["ai.runs.read", "core.audit.read"],
      prompt:
        "You review a draft that is about to reach a customer. Check it against these rules: no regulated " +
        "advice, no price or cover term absent from the source data, no regulatory or comparison claim " +
        "without a source, no personal data beyond what the recipient may see. Return pass or fail with " +
        "the specific offending sentence."
    }
  ];

  const promptRows: (typeof schema.aiPrompts.$inferInsert)[] = [];
  const agentRows: (typeof schema.aiAgents.$inferInsert)[] = [];
  let a2 = 0;
  for (const agent of agents) {
    const promptKey = `prompt.${agent.key}.system`;
    promptRows.push({
      id: id("pmt", now + a2),
      tenantId,
      key: promptKey,
      version: 1,
      locale: "en",
      body: agent.prompt,
      status: "active",
      createdBy: users["dev.admin"]!,
      createdAt: now
    });
    agentRows.push({
      id: id("agt", now + a2),
      tenantId,
      key: agent.key,
      module: agent.module,
      nameJson: JSON.stringify({ en: agent.en, ar: agent.ar }),
      descriptionJson: JSON.stringify({ en: agent.desc }),
      autonomyLevel: agent.autonomy,
      tier: agent.tier,
      toolsJson: JSON.stringify(agent.tools),
      // Budget and PII rules are enforced in the gateway; this is what the
      // console shows an operator and what an eval asserts against.
      guardrailsJson: JSON.stringify({
        maxTokens: 2_000,
        piiRedaction: true,
        requiresConsent: agent.module === "dist" || agent.module === "orbit",
        humanApproval: agent.autonomy === "act_with_approval"
      }),
      promptRef: promptKey,
      status: "active",
      createdAt: now,
      updatedAt: now
    });
    a2++;
  }
  // Arabic is a first-class locale, not a translation layer: the resolver picks
  // the prompt for the actor's locale, so at least one has to exist to prove it.
  promptRows.push({
    id: id("pmt", now + a2),
    tenantId,
    key: "prompt.quoting.system",
    version: 1,
    locale: "ar",
    body:
      "أنت تقارن عروض التأمين لعميل لدى وسيط مقارنة. تحصل على لوحة المقارنة المرتبة بصيغة JSON: القسط، " +
      "فروق التغطية، التحمّل، وأي عرض مرفوض أو محال. اشرح في خمس جمل كحد أقصى سبب فوز العرض الأفضل قيمة، " +
      "وما الذي يتنازل عنه العرض الأرخص، وسبب رفض أي عرض. لا تذكر منتجاً إضافياً إلا إذا دعمته بيانات " +
      "المدخلات. لا تخترع سعراً أو شرط تغطية أو مزوّداً غير وارد في المدخلات.",
    status: "active",
    createdBy: users["dev.admin"]!,
    createdAt: now
  });

  await db.insert(schema.aiPrompts).values(promptRows);
  await db.insert(schema.aiAgents).values(agentRows);

  return { tenantId, users, channels, providers, offerings };
}

/** Referenced by the provisioning path when a new tenant is created from the template. */
export const SEED_TENANT_SLUG = "gonxt";
