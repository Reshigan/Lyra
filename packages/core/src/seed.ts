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
import { seedAdmin } from "./seed/admin.js";
import { seedAnalytics } from "./seed/analytics.js";
import { seedAxis } from "./seed/axis.js";
import { seedCompliance } from "./seed/compliance.js";
import { seedLedger } from "./seed/ledger.js";
import { seedOrbit } from "./seed/orbit.js";
import { seedPlatform } from "./seed/platform.js";
import { seedScout } from "./seed/scout.js";
import { seedSignal } from "./seed/signal.js";
import type { SeedContext } from "./seed/context.js";

// GONXT is the reference tenant: an aggregator that distributes other
// underwriters' products, underwrites some of its own, and sells through a b2c
// site and b2b partners. The seed is the demo, the e2e fixture and the
// provisioning template — one dataset, so a bug shows up in all three.

const T0 = Date.UTC(2026, 0, 6, 8, 0, 0); // deterministic ids: same seed, same ULIDs prefix time
const DAY = 86_400_000;
const HOUR = 3_600_000;

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
        // accentContrast is explicit because the dark-theme fallback (#412402,
        // cut for vega-500) measures only 4.49:1 on this blue and fails AA for
        // body text. Ink-900 measures 6.22:1 — the same choice, for the same
        // reason, as the light-theme token in packages/ui/src/tokens.css.
        // The hover fill brightens rather than darkens: the label colour does
        // not change on hover, and a darker blue (#3F6FE0) drops it to 4.28:1.
        palette: { accent: "#5B8CFF", accentHover: "#7FA6FF", accentContrast: "#070b14" },
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
  const renewalPolicyId = id("pol", issuedAt + 1);
  await db.insert(schema.axisPolicies).values({
    id: renewalPolicyId,
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

  /* ------------------------------------------------------------------ north */
  // NORTH is a rollup, never a hot-table read (docs/modules/north.md §2.1), so
  // these rows describe the *same* book the panel above describes — five lines
  // from five underwriters, three b2c channels and two b2b channels — one
  // closed accounting period behind the live sale seeded above. Money is minor
  // units (fils); every percent and ratio is basis points, and the scale is
  // carried in `targetJson` because the registry has no scale column.
  //
  // Periods are literal strings for the same reason the case ref above is
  // "GNX-2601-0001": the dataset is a January 2026 demo. Timestamps stay
  // derived from `now` so an overridden clock still lands in order.
  const BPS = "bps";

  const METRICS: ReadonlyArray<{
    key: string;
    en: string;
    ar: string;
    def: string;
    unit: "count" | "money" | "percent" | "ratio" | "duration_ms";
    grain: "day" | "week" | "month";
    direction: "up" | "down";
    owner: string;
    sensitivity?: "public" | "internal" | "restricted";
    target: Record<string, unknown>;
  }> = [
    {
      key: "gwp",
      en: "Gross written premium",
      ar: "إجمالي الأقساط المكتتبة",
      def: "v_exec_daily.premium_minor",
      unit: "money",
      grain: "month",
      direction: "up",
      owner: "faisal.omar",
      target: { value: 230_000_000, scale: "minor", currency: "AED" }
    },
    {
      key: "net_commission",
      en: "Net commission retained",
      ar: "صافي العمولة المحتفظ بها",
      def: "dist_commission_entries.net_commission_minor",
      unit: "money",
      grain: "month",
      direction: "up",
      owner: "faisal.omar",
      target: { value: 21_000_000, scale: "minor", currency: "AED" }
    },
    {
      key: "active_policies",
      en: "Policies in force",
      ar: "الوثائق السارية",
      def: "axis_policies WHERE status = 'active'",
      unit: "count",
      grain: "month",
      direction: "up",
      owner: "omar.farouk",
      target: { value: 4_800, scale: "count" }
    },
    {
      key: "renewal_retention_rate",
      en: "Renewal retention rate",
      ar: "معدل الاحتفاظ عند التجديد",
      def: "v_renewal_book: accepted / (accepted + lost)",
      unit: "percent",
      grain: "month",
      direction: "up",
      owner: "yusuf.karim",
      target: { value: 8_500, scale: BPS }
    },
    {
      key: "cac_per_policy",
      en: "Acquisition cost per policy",
      ar: "تكلفة اكتساب الوثيقة",
      def: "v_cac_ltv.spend_minor / v_cac_ltv.binds",
      unit: "money",
      grain: "month",
      direction: "down",
      owner: "noor.jamal",
      target: { value: 19_000, scale: "minor", currency: "AED" }
    },
    {
      key: "broker_channel_share",
      en: "Share of premium through b2b channels",
      ar: "حصة الأقساط عبر قنوات الأعمال",
      def: "axis_policies JOIN dist_channels ON kind = 'b2b'",
      unit: "percent",
      grain: "month",
      direction: "up",
      owner: "dana.aziz",
      target: { value: 4_000, scale: BPS }
    },
    {
      key: "loss_ratio",
      en: "Loss ratio — own paper",
      ar: "نسبة الخسارة — الاكتتاب الذاتي",
      def: "axis_claims / axis_policies WHERE provider is internal",
      unit: "ratio",
      grain: "month",
      direction: "down",
      owner: "faisal.omar",
      // Only GONXT's own underwriting result, so it is not a number the panel
      // partners or the b2b channels get to see.
      sensitivity: "restricted",
      target: { value: 6_000, scale: BPS }
    },
    {
      key: "ai_cost_per_case",
      en: "AI cost per case",
      ar: "تكلفة الذكاء الاصطناعي لكل ملف",
      def: "v_exec_daily.ai_cost_micro / v_exec_daily.cases_created",
      unit: "money",
      grain: "month",
      direction: "down",
      owner: "raed.samir",
      target: { value: 100, scale: "minor", currency: "AED" }
    },
    {
      key: "policies_issued",
      en: "Policies issued",
      ar: "الوثائق المُصدرة",
      def: "v_exec_daily.policies_issued",
      unit: "count",
      grain: "day",
      direction: "up",
      owner: "omar.farouk",
      target: { value: 55, scale: "count" }
    },
    {
      key: "quote_to_bind_rate",
      en: "Quote to bind rate",
      ar: "معدل التحويل من عرض إلى وثيقة",
      def: "axis_policies / dist_quote_requests WHERE state = 'complete'",
      unit: "percent",
      grain: "day",
      direction: "up",
      owner: "layla.hassan",
      target: { value: 2_400, scale: BPS }
    },
    {
      key: "panel_response_rate",
      en: "Panel response rate",
      ar: "معدل استجابة لوحة المزوّدين",
      def: "dist_quote_requests.responded_count / dist_quote_requests.fanout_count",
      unit: "percent",
      grain: "day",
      direction: "up",
      owner: "dana.aziz",
      target: { value: 9_700, scale: BPS }
    },
    {
      key: "quote_latency_p95",
      en: "Quote latency p95",
      ar: "زمن استجابة التسعير — المئين ٩٥",
      def: "dist_quote_responses.latency_ms, p95",
      unit: "duration_ms",
      grain: "day",
      direction: "down",
      owner: "raed.samir",
      sensitivity: "public",
      target: { value: 2_500, scale: "ms" }
    }
  ];

  let m = 0;
  await db.insert(schema.northMetrics).values(
    METRICS.map((metric) => ({
      id: id("mtr", now + m++),
      tenantId,
      key: metric.key,
      nameJson: JSON.stringify({ en: metric.en, ar: metric.ar }),
      definitionSqlRef: metric.def,
      unit: metric.unit,
      currency: metric.unit === "money" ? "AED" : null,
      grain: metric.grain,
      owner: metric.owner,
      targetJson: JSON.stringify(metric.target),
      sensitivity: metric.sensitivity ?? "internal",
      direction: metric.direction,
      createdAt: now,
      updatedAt: now
    }))
  );

  /* --------------------------------------------------------- snapshots */
  // The nightly rollup runs at 02:00Z: a daily period is written the morning
  // after it closes, a monthly period on the 1st, and the open month is
  // rewritten every night. Both are expressed as an offset from `now`.
  const MONTHS = ["2025-10", "2025-11", "2025-12", "2026-01"] as const;
  const MONTH_ROLLUP_DAYS_AGO: Record<(typeof MONTHS)[number], number> = {
    "2025-10": 66,
    "2025-11": 36,
    "2025-12": 5,
    "2026-01": 0 // month to date, rewritten this morning
  };
  const DAYS = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"] as const;

  const MONTHLY: Record<string, readonly [number, number, number, number]> = {
    gwp: [186_400_000, 201_750_000, 238_900_000, 74_300_000],
    net_commission: [17_708_000, 19_166_000, 22_695_000, 7_058_000],
    active_policies: [4_182, 4_361, 4_608, 4_690],
    renewal_retention_rate: [7_920, 8_050, 8_310, 8_180],
    cac_per_policy: [21_400, 20_150, 18_900, 24_600],
    broker_channel_share: [3_120, 3_380, 3_611, 3_740],
    loss_ratio: [6_140, 5_980, 6_420, 6_050],
    ai_cost_per_case: [118, 104, 96, 91]
  };
  const DAILY: Record<string, readonly [number, number, number, number, number]> = {
    policies_issued: [41, 38, 52, 61, 57],
    quote_to_bind_rate: [2_310, 2_280, 2_405, 2_360, 1_890],
    panel_response_rate: [9_650, 9_720, 9_580, 9_240, 8_810],
    quote_latency_p95: [2_150, 2_080, 2_310, 3_040, 3_620]
  };

  // Readable and unique per dimension set, which is all the unique index needs.
  // ponytail: a digest buys nothing at this cardinality — swap it for one when
  // a dimension value can contain "=" or "&".
  const dimsHash = (dims: Record<string, string>): string =>
    Object.entries(dims)
      .map(([k, v]) => `${k}=${v}`)
      .join("&");

  // December by channel and by underwriter — both sum to the December total,
  // so drilling into the metric never disagrees with the headline.
  const DECEMBER_SPLITS: ReadonlyArray<{ dims: Record<string, string>; value: number }> = [
    { dims: { channel: "gonxt-web" }, value: 96_420_000 },
    { dims: { channel: "gonxt-app" }, value: 41_880_000 },
    { dims: { channel: "gonxt-call" }, value: 14_320_000 },
    { dims: { channel: "alpha-brokers" }, value: 62_190_000 },
    { dims: { channel: "meridian-embed" }, value: 24_090_000 },
    { dims: { provider: "Cedar General Insurance" }, value: 84_500_000 },
    { dims: { provider: "Falcon Insurance" }, value: 61_300_000 },
    { dims: { provider: "Oryx Takaful" }, value: 33_700_000 },
    { dims: { provider: "Gulf Health Assurance" }, value: 28_900_000 },
    { dims: { provider: "GONXT Underwriting" }, value: 30_500_000 }
  ];

  const snapshotRows: (typeof schema.northSnapshots.$inferInsert)[] = [];
  let s = 0;
  const snapshot = (
    metricKey: string,
    grain: "day" | "month",
    period: string,
    value: number,
    ts: number,
    dims?: Record<string, string>
  ): void => {
    snapshotRows.push({
      id: id("snp", now + s++),
      tenantId,
      metricKey,
      grain,
      period,
      dimsJson: dims ? JSON.stringify(dims) : null,
      dimsHash: dims ? dimsHash(dims) : "",
      value,
      ts
    });
  };

  for (const [key, series] of Object.entries(MONTHLY)) {
    MONTHS.forEach((period, i) => {
      snapshot(key, "month", period, series[i]!, now - MONTH_ROLLUP_DAYS_AGO[period] * DAY - 6 * HOUR);
    });
  }
  for (const [key, series] of Object.entries(DAILY)) {
    DAYS.forEach((period, i) => {
      snapshot(key, "day", period, series[i]!, now - (4 - i) * DAY - 6 * HOUR);
    });
  }
  for (const split of DECEMBER_SPLITS) {
    snapshot("gwp", "month", "2025-12", split.value, now - 5 * DAY - 6 * HOUR, split.dims);
  }
  await db.insert(schema.northSnapshots).values(snapshotRows);

  /* --------------------------------------------------------- briefings */
  // Ids are declared up front because an anomaly points at the decision it
  // opened and that decision points back at the briefing that raised it.
  const briefingIds = {
    jan05En: id("brf", now),
    jan05Ar: id("brf", now + 1),
    jan04En: id("brf", now + 2),
    jan02Board: id("brf", now + 3),
    dec31Investor: id("brf", now + 4)
  };
  const anomalyIds = {
    bindRate: id("ano", now),
    panelResponse: id("ano", now + 1),
    cac: id("ano", now + 2),
    december: id("ano", now + 3),
    latency: id("ano", now + 4)
  };
  const boardpackIds = { q4: id("bpk", now), q1: id("bpk", now + 1) };
  const decisionIds = {
    panel: id("dec", now),
    brokerShare: id("dec", now + 1),
    oryxPricing: id("dec", now + 2),
    campaign: id("dec", now + 3),
    ownPaper: id("dec", now + 4),
    callCentre: id("dec", now + 5)
  };

  const briefingRef = (b: string): string => `briefings/${tenantId}/${b}.md`;
  await db.insert(schema.northBriefings).values([
    {
      id: briefingIds.jan05En,
      tenantId,
      // 2026-01-06/exec/en is deliberately left free: J-E1 generates that
      // briefing at runtime and the unique index would reject a second one.
      date: "2026-01-05",
      audience: "exec",
      locale: "en",
      narrativeRef: briefingRef(briefingIds.jan05En),
      highlightsJson: JSON.stringify([
        {
          metricKey: "gwp",
          period: "2025-12",
          value: 238_900_000,
          deltaBps: 1_841,
          note: "December closed above every prior month, led by motor on the web and app channels."
        },
        {
          metricKey: "broker_channel_share",
          period: "2025-12",
          value: 3_611,
          deltaBps: 683,
          note: "Alpha Brokers and the Meridian embed together wrote just over a third of premium."
        },
        {
          metricKey: "quote_to_bind_rate",
          period: "2026-01-05",
          value: 1_890,
          deltaBps: -1_923,
          note: "Yesterday's conversion fell well below the five-day average; see the open anomaly."
        }
      ]),
      anomaliesJson: JSON.stringify([anomalyIds.bindRate, anomalyIds.panelResponse]),
      status: "published",
      generatedBy: "ai",
      approvedBy: "hala.zayed",
      publishedAt: now - DAY - 5 * HOUR,
      createdAt: now - DAY - 6 * HOUR
    },
    {
      id: briefingIds.jan05Ar,
      tenantId,
      date: "2026-01-05",
      audience: "exec",
      locale: "ar",
      narrativeRef: briefingRef(briefingIds.jan05Ar),
      highlightsJson: JSON.stringify([
        {
          metricKey: "gwp",
          period: "2025-12",
          value: 238_900_000,
          deltaBps: 1_841,
          note: "أغلق ديسمبر أعلى من كل الأشهر السابقة، بقيادة تأمين المركبات عبر الموقع والتطبيق."
        },
        {
          metricKey: "renewal_retention_rate",
          period: "2025-12",
          value: 8_310,
          deltaBps: 323,
          note: "تحسّن الاحتفاظ عند التجديد للشهر الثالث على التوالي."
        }
      ]),
      anomaliesJson: JSON.stringify([anomalyIds.bindRate]),
      status: "published",
      generatedBy: "ai",
      approvedBy: "khalid.rashed",
      publishedAt: now - DAY - 5 * HOUR,
      createdAt: now - DAY - 6 * HOUR
    },
    {
      id: briefingIds.jan04En,
      tenantId,
      date: "2026-01-04",
      audience: "exec",
      locale: "en",
      narrativeRef: briefingRef(briefingIds.jan04En),
      highlightsJson: JSON.stringify([
        {
          metricKey: "policies_issued",
          period: "2026-01-04",
          value: 61,
          deltaBps: 1_731,
          note: "Best issuing day of the new year so far, mostly motor renewals coming back."
        },
        {
          metricKey: "quote_latency_p95",
          period: "2026-01-04",
          value: 3_040,
          deltaBps: 3_160,
          note: "Panel latency drifted above target; the manual-priced Oryx row is the slowest leg."
        }
      ]),
      anomaliesJson: JSON.stringify([anomalyIds.latency]),
      status: "published",
      generatedBy: "ai",
      approvedBy: "hala.zayed",
      publishedAt: now - 2 * DAY - 5 * HOUR,
      createdAt: now - 2 * DAY - 6 * HOUR
    },
    {
      id: briefingIds.jan02Board,
      tenantId,
      date: "2026-01-02",
      audience: "board",
      locale: "en",
      narrativeRef: briefingRef(briefingIds.jan02Board),
      highlightsJson: JSON.stringify([
        {
          metricKey: "gwp",
          period: "2025-12",
          value: 238_900_000,
          deltaBps: 1_841,
          note: "Q4 finished ahead of plan on premium and slightly behind on acquisition cost."
        },
        {
          metricKey: "active_policies",
          period: "2025-12",
          value: 4_608,
          deltaBps: 566,
          note: "The book grew every month of the quarter."
        },
        {
          metricKey: "loss_ratio",
          period: "2025-12",
          value: 6_420,
          deltaBps: 736,
          note: "Own-paper loss ratio widened in December and is worth a closer look in Q1."
        }
      ]),
      anomaliesJson: JSON.stringify([anomalyIds.december]),
      status: "review",
      generatedBy: "ai",
      approvedBy: null,
      publishedAt: null,
      createdAt: now - 4 * DAY - 6 * HOUR
    },
    {
      id: briefingIds.dec31Investor,
      tenantId,
      date: "2025-12-31",
      audience: "investor",
      locale: "en",
      narrativeRef: briefingRef(briefingIds.dec31Investor),
      highlightsJson: JSON.stringify([
        {
          metricKey: "net_commission",
          period: "2025-12",
          value: 22_695_000,
          deltaBps: 1_842,
          note: "Retained commission tracked premium; the b2b mix shift did not dilute the margin."
        },
        {
          metricKey: "cac_per_policy",
          period: "2025-12",
          value: 18_900,
          deltaBps: -620,
          note: "Acquisition cost per policy improved for the third month."
        }
      ]),
      anomaliesJson: null,
      status: "draft",
      generatedBy: "ai",
      approvedBy: null,
      publishedAt: null,
      createdAt: now - 6 * DAY - 6 * HOUR
    }
  ]);

  /* --------------------------------------------------------- anomalies */
  // `magnitude` is signed basis points against the expected value, so every
  // row here is round((actual - expected) / expected * 10_000).
  await db.insert(schema.northAnomalies).values([
    {
      id: anomalyIds.bindRate,
      tenantId,
      metricKey: "quote_to_bind_rate",
      window: "2026-01-05",
      magnitude: -1_923,
      expected: 2_340,
      actual: 1_890,
      driverAnalysisJson: JSON.stringify({
        method: "period_over_period",
        baseline: "trailing_4_day",
        drivers: [
          { dimension: "channel", key: "alpha-brokers", contributionBps: -1_180 },
          { dimension: "channel", key: "gonxt-web", contributionBps: -520 },
          { dimension: "line", key: "motor", contributionBps: -1_640 }
        ]
      }),
      state: "explained",
      linkedActionRef: null,
      explainedBy: "rana.hadid",
      detectedAt: now - 6 * HOUR
    },
    {
      id: anomalyIds.panelResponse,
      tenantId,
      metricKey: "panel_response_rate",
      window: "2026-01-01..2026-01-05",
      magnitude: -861,
      expected: 9_640,
      actual: 8_810,
      driverAnalysisJson: JSON.stringify({
        method: "trend",
        baseline: "trailing_30_day",
        drivers: [
          { dimension: "provider", key: "Oryx Takaful", contributionBps: -790 },
          { dimension: "provider", key: "Gulf Health Assurance", contributionBps: -71 }
        ],
        note: "Both are off-API rows: Oryx prices manually and Gulf Health quotes by email."
      }),
      state: "action_created",
      linkedActionRef: `north_decision:${decisionIds.oryxPricing}`,
      explainedBy: "rana.hadid",
      detectedAt: now - 6 * HOUR
    },
    {
      id: anomalyIds.cac,
      tenantId,
      metricKey: "cac_per_policy",
      window: "2026-01",
      magnitude: 2_813,
      expected: 19_200,
      actual: 24_600,
      driverAnalysisJson: JSON.stringify({
        method: "period_over_period",
        baseline: "2025-12",
        drivers: [
          { dimension: "channel", key: "gonxt-web", contributionBps: 1_940 },
          { dimension: "channel", key: "gonxt-app", contributionBps: 873 }
        ]
      }),
      state: "new",
      linkedActionRef: null,
      explainedBy: null,
      detectedAt: now - 6 * HOUR
    },
    {
      id: anomalyIds.december,
      tenantId,
      metricKey: "gwp",
      window: "2025-12",
      magnitude: 1_269,
      expected: 212_000_000,
      actual: 238_900_000,
      driverAnalysisJson: JSON.stringify({
        method: "seasonal",
        baseline: "trailing_12_month_seasonal",
        drivers: [{ dimension: "line", key: "motor", contributionBps: 1_104 }],
        note: "December renewals land in the same week every year."
      }),
      state: "dismissed",
      linkedActionRef: null,
      explainedBy: "rana.hadid",
      detectedAt: now - 5 * DAY - 6 * HOUR
    },
    {
      id: anomalyIds.latency,
      tenantId,
      metricKey: "quote_latency_p95",
      window: "2026-01-04",
      magnitude: 6_606,
      expected: 2_180,
      actual: 3_620,
      driverAnalysisJson: JSON.stringify({
        method: "period_over_period",
        baseline: "trailing_7_day",
        drivers: [{ dimension: "provider", key: "Oryx Takaful", contributionBps: 5_980 }]
      }),
      state: "new",
      linkedActionRef: null,
      explainedBy: null,
      detectedAt: now - DAY - 6 * HOUR
    }
  ]);

  /* --------------------------------------------------------- scenarios */
  // Assumptions are the input the answer can be re-derived from (J-E3); the
  // result is the model's, so it stays a stored object rather than prose.
  // `modelRunRef` is null because this seed writes no ai_audit_log rows —
  // a dangling run id would be worse than an empty column.
  await db.insert(schema.northScenarios).values([
    {
      id: id("scn", now),
      tenantId,
      question: "What if Alpha Brokers' motor share moves from 35% to 45%?",
      assumptionsJson: JSON.stringify({
        channelKey: "alpha-brokers",
        line: "motor",
        channelSharePpm: 450_000,
        currentChannelSharePpm: 350_000,
        volumeUpliftBps: 1_200,
        horizonMonths: 6,
        currency: "AED"
      }),
      modelRunRef: null,
      resultJson: JSON.stringify({
        gwpDeltaMinor: 18_600_000,
        netCommissionDeltaMinor: -1_284_000,
        policiesDelta: 214,
        brokerChannelShareBps: 4_180,
        breakEvenMonths: 4,
        sensitivity: "A volume uplift under 700bps leaves retained commission below today."
      }),
      author: "hala.zayed",
      sharedWithJson: JSON.stringify(["faisal.omar", "dana.aziz"]),
      createdAt: now - 3 * DAY,
      updatedAt: now - 3 * DAY
    },
    {
      id: id("scn", now + 1),
      tenantId,
      question: "What if we add a fifth motor underwriter to the panel?",
      assumptionsJson: JSON.stringify({
        line: "motor",
        currentPanelSize: 4,
        panelSize: 5,
        assumedBaseCommissionPpm: 160_000,
        assumedWinRateBps: 1_400,
        quoteLatencyBudgetMs: 2_500,
        horizonMonths: 12
      }),
      modelRunRef: null,
      resultJson: JSON.stringify({
        gwpDeltaMinor: 26_400_000,
        netCommissionDeltaMinor: 2_910_000,
        quoteToBindRateDeltaBps: 180,
        quoteLatencyP95DeltaMs: 340,
        note: "Upside holds only while the new row answers over the API; a manual row spends the whole latency budget."
      }),
      author: "rana.hadid",
      sharedWithJson: JSON.stringify(["hala.zayed", "omar.farouk"]),
      createdAt: now - 2 * DAY,
      updatedAt: now - 2 * DAY
    },
    {
      id: id("scn", now + 2),
      tenantId,
      question: "What if Oryx motor moves from manual pricing to a rate table?",
      assumptionsJson: JSON.stringify({
        offeringCode: "ORX-MOT-TKF",
        fromPricingMode: "manual",
        toPricingMode: "table",
        currentSlaSeconds: 120,
        targetSlaSeconds: 5,
        horizonMonths: 3
      }),
      modelRunRef: null,
      resultJson: JSON.stringify({
        panelResponseRateDeltaBps: 620,
        quoteLatencyP95DeltaMs: -980,
        quoteToBindRateDeltaBps: 140,
        gwpDeltaMinor: 7_200_000,
        note: "Recovers most of the response-rate drift seen across the first week of January."
      }),
      author: "rana.hadid",
      sharedWithJson: JSON.stringify(["dana.aziz"]),
      createdAt: now - DAY,
      updatedAt: now - DAY
    }
  ]);

  /* -------------------------------------------------------- board packs */
  // No pdfFileId: nothing has rendered a PDF into R2 in a fresh install, and a
  // file id pointing at a missing object would fail on the first download.
  await db.insert(schema.northBoardpacks).values([
    {
      id: boardpackIds.q4,
      tenantId,
      period: "2025-Q4",
      title: "Q4 2025 board pack",
      sectionsJson: JSON.stringify([
        { key: "growth", metricKeys: ["gwp", "policies_issued", "active_policies"] },
        { key: "distribution_mix", metricKeys: ["broker_channel_share"] },
        { key: "retention", metricKeys: ["renewal_retention_rate"] },
        { key: "acquisition_cost", metricKeys: ["cac_per_policy", "net_commission"] },
        { key: "own_paper", metricKeys: ["loss_ratio"] },
        { key: "decisions", decisionRefs: [decisionIds.campaign, decisionIds.ownPaper] }
      ]),
      pdfFileId: null,
      xlsxFileId: null,
      distributionLogJson: JSON.stringify([
        { to: "board@gonxt.ae", medium: "email", ts: now - 4 * DAY },
        { to: "hala.zayed@gonxt.ae", medium: "email", ts: now - 4 * DAY }
      ]),
      status: "distributed",
      approvedBy: "hala.zayed",
      createdAt: now - 6 * DAY,
      updatedAt: now - 4 * DAY
    },
    {
      id: boardpackIds.q1,
      tenantId,
      period: "2026-Q1",
      title: "Q1 2026 board pack",
      sectionsJson: JSON.stringify([
        { key: "growth", metricKeys: ["gwp", "policies_issued", "active_policies"] },
        { key: "panel_health", metricKeys: ["panel_response_rate", "quote_latency_p95"] },
        { key: "conversion", metricKeys: ["quote_to_bind_rate"] },
        { key: "decisions", decisionRefs: [decisionIds.panel, decisionIds.brokerShare] }
      ]),
      pdfFileId: null,
      xlsxFileId: null,
      distributionLogJson: null,
      status: "draft",
      approvedBy: null,
      createdAt: now - DAY,
      updatedAt: now - DAY
    }
  ]);

  /* ---------------------------------------------------------- decisions */
  await db.insert(schema.northDecisions).values([
    {
      id: decisionIds.panel,
      tenantId,
      title: "Add a fifth motor underwriter to the panel",
      contextRef: `north_briefing:${briefingIds.jan02Board}`,
      optionsJson: JSON.stringify([
        { key: "invite_two", label: "Invite two underwriters to quote in Q1", costMinor: 0 },
        { key: "invite_one", label: "Invite one underwriter and review in Q2", costMinor: 0 },
        { key: "hold", label: "Hold the panel at four and revisit after Q1" }
      ]),
      chosen: "invite_two",
      owner: "hala.zayed",
      reviewAt: now + 60 * DAY,
      outcomeReviewJson: null,
      status: "open",
      createdAt: now - 4 * DAY,
      updatedAt: now - 4 * DAY
    },
    {
      id: decisionIds.brokerShare,
      tenantId,
      title: "Raise the Alpha Brokers motor share to 40% for Q1",
      contextRef: `north_briefing:${briefingIds.jan05En}`,
      optionsJson: JSON.stringify([
        { key: "raise_40", label: "Raise the motor share to 40% for Q1 only" },
        { key: "raise_45", label: "Raise the motor share to 45% with a volume floor" },
        { key: "hold_35", label: "Hold at 35% and revisit at renewal" }
      ]),
      chosen: "raise_40",
      owner: "dana.aziz",
      reviewAt: now + 90 * DAY,
      outcomeReviewJson: null,
      status: "open",
      createdAt: now - DAY,
      updatedAt: now - DAY
    },
    {
      id: decisionIds.oryxPricing,
      tenantId,
      title: "Move Oryx motor quotes off manual pricing",
      contextRef: `north_anomaly:${anomalyIds.panelResponse}`,
      optionsJson: JSON.stringify([
        { key: "rate_table", label: "Agree a rate table with Oryx and price in-platform" },
        { key: "tighten_sla", label: "Keep manual pricing and tighten the SLA to 30 seconds" },
        { key: "drop_row", label: "Drop the row from the default panel" }
      ]),
      chosen: "rate_table",
      owner: "omar.farouk",
      reviewAt: now + 30 * DAY,
      outcomeReviewJson: null,
      status: "open",
      createdAt: now - 6 * HOUR,
      updatedAt: now - 6 * HOUR
    },
    {
      id: decisionIds.campaign,
      tenantId,
      title: "Pause the December brand campaign and move the budget to search",
      contextRef: `north_briefing:${briefingIds.dec31Investor}`,
      optionsJson: JSON.stringify([
        { key: "move_to_search", label: "Move the remaining budget to search" },
        { key: "keep", label: "Keep the campaign running to the end of the quarter" }
      ]),
      chosen: "move_to_search",
      owner: "noor.jamal",
      reviewAt: now - 5 * DAY,
      outcomeReviewJson: JSON.stringify({
        reviewedAt: now - 5 * DAY,
        reviewedBy: "hala.zayed",
        metricKey: "cac_per_policy",
        before: 21_400,
        after: 18_900,
        verdict: "worked",
        note: "Acquisition cost per policy fell over the two months after the switch."
      }),
      status: "reviewed",
      createdAt: now - 40 * DAY,
      updatedAt: now - 5 * DAY
    },
    {
      id: decisionIds.ownPaper,
      tenantId,
      title: "Keep GONXT motor on own paper for the 25–39 age band",
      contextRef: `north_boardpack:${boardpackIds.q4}`,
      optionsJson: JSON.stringify([
        { key: "keep", label: "Keep writing the band on own paper" },
        { key: "cede", label: "Cede the band to the panel and keep only travel" }
      ]),
      chosen: "keep",
      owner: "faisal.omar",
      reviewAt: now - 2 * DAY,
      outcomeReviewJson: JSON.stringify({
        reviewedAt: now - 2 * DAY,
        reviewedBy: "faisal.omar",
        metricKey: "loss_ratio",
        before: 5_980,
        after: 6_420,
        verdict: "mixed",
        note: "The band stayed profitable but the December loss ratio is worth watching in Q1."
      }),
      status: "reviewed",
      createdAt: now - 30 * DAY,
      updatedAt: now - 2 * DAY
    },
    {
      id: decisionIds.callCentre,
      tenantId,
      title: "Withdraw Cedar Motor Essential from the call centre",
      contextRef: `north_briefing:${briefingIds.jan04En}`,
      optionsJson: JSON.stringify([
        { key: "withdraw", label: "Withdraw the row from the call centre panel" },
        { key: "keep", label: "Keep the row and script the excess difference" }
      ]),
      chosen: "keep",
      owner: "omar.farouk",
      reviewAt: now + 14 * DAY,
      outcomeReviewJson: JSON.stringify({
        reversedAt: now - 3 * DAY,
        reversedBy: "hala.zayed",
        note: "Withdrawing it removed the cheapest row from the call-centre comparison, so the original decision was undone and the excess is explained in the script instead."
      }),
      status: "reversed",
      createdAt: now - 20 * DAY,
      updatedAt: now - 3 * DAY
    }
  ]);

  /* ------------------------------------------------------ the other workspaces */
  // One file per module rather than one more screenful here: the modules do not
  // share rows, only the context below, and a seeder that owns its own file can
  // be read next to the module it fills.
  const ctx: SeedContext = {
    db,
    now,
    tenantId,
    users,
    teams,
    providers,
    products,
    offerings,
    channels,
    customerId,
    consentId,
    quoteRequestId: requestId,
    caseId,
    policyId,
    renewalPolicyId,
    issuedAt
  };
  await seedAdmin(ctx);
  await seedAxis(ctx);
  await seedLedger(ctx);
  await seedOrbit(ctx);
  await seedSignal(ctx);
  await seedScout(ctx);
  await seedCompliance(ctx);
  await seedAnalytics(ctx);
  // Last, because the audit trail is a record of what the seeders above did:
  // it can only be written once those rows exist.
  await seedPlatform(ctx);

  return { tenantId, users, channels, providers, offerings };
}

/** Referenced by the provisioning path when a new tenant is created from the template. */
export const SEED_TENANT_SLUG = "gonxt";
