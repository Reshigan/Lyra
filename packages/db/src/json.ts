import { z } from "zod";

// Zod shapes for TEXT-as-JSON columns (docs/03). Every JSON column in the schema
// has a shape here; readers parse, writers stringify. Nothing hand-rolls JSON.

/* ------------------------------------------------------------------ brand */

export const BrandJson = z.object({
  name: z.string(),
  shortName: z.string().optional(),
  logo: z.object({ light: z.string(), dark: z.string(), mark: z.string() }).partial().default({}),
  // accentContrast is text/icons placed ON --accent. It completes the five-property
  // tenant override contract in packages/ui/src/tokens.css; without it here, zod
  // stripped the field on write and the settings screen's AA check guarded a value
  // that never survived the round trip.
  palette: z
    .object({ accent: z.string(), accentHover: z.string(), accentContrast: z.string() })
    .partial()
    .default({}),
  font: z.enum(["space-grotesk", "inter", "ibm-plex-sans-arabic"]).optional(),
  domain: z.string().optional(),
  email: z.object({ from: z.string(), replyTo: z.string() }).partial().default({}),
  legal: z.object({ company: z.string(), footer: z.string(), privacyUrl: z.string() }).partial().default({})
});
export type BrandJson = z.infer<typeof BrandJson>;

/* ----------------------------------------------------------------- policy */

export const AutonomyLevel = z.enum(["suggest", "draft", "act_with_approval", "act", "act_and_report"]);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;

export const PolicyJson = z.object({
  autoApprove: z.array(z.string()).default([]),
  aiBudgetDailyTokens: z.number().int().nonnegative().default(2_000_000),
  aiBudgetDailyCostMicro: z.number().int().nonnegative().default(50_000_000),
  locales: z.array(z.string()).default(["en", "ar"]),
  defaultLocale: z.string().default("en"),
  dataResidency: z.enum(["cloud", "in-region", "on-prem"]).default("cloud"),
  autonomyDefault: AutonomyLevel.default("act_with_approval"),
  retention: z
    .object({
      messagesMonths: z.number().int().positive().default(24),
      filesYears: z.number().int().positive().default(7),
      aiAuditYears: z.number().int().positive().default(7)
    })
    .default({ messagesMonths: 24, filesYears: 7, aiAuditYears: 7 }),
  domainPack: z.string().default("insurance-retail"),
  currency: z.string().length(3).default("AED"),
  // docs/modules/signal.md §8: "one-click global pause" for budget autopilot —
  // a tenant-wide kill switch, distinct from a single campaign's own
  // state=paused (packages/db/schema/signal.ts).
  signalAutopilotPaused: z.boolean().default(false)
});
export type PolicyJson = z.infer<typeof PolicyJson>;

/* ----------------------------------------------------- editions (docs/21) */

export const EDITIONS = [
  "core",
  "bots",
  "ops",
  "social",
  "radar",
  "insights",
  "suite"
] as const;
export const Edition = z.enum(EDITIONS);
export type Edition = z.infer<typeof Edition>;

export const EntitlementsJson = z.object({
  edition: Edition.default("core"),
  modules: z.array(z.enum(["axis", "orbit", "signal", "scout", "north"])).default([]),
  features: z.record(z.boolean()).default({}),
  seats: z.number().int().positive().default(5),
  limits: z
    .object({
      casesPerMonth: z.number().int().nonnegative().optional(),
      conversationsPerMonth: z.number().int().nonnegative().optional(),
      aiTokensPerDay: z.number().int().nonnegative().optional()
    })
    .default({})
});
export type EntitlementsJson = z.infer<typeof EntitlementsJson>;

/* ------------------------------------------------------------ names & PII */

export const NameJson = z.object({ en: z.string(), ar: z.string().optional() });
export type NameJson = z.infer<typeof NameJson>;

export const PurposesJson = z.object({
  marketing: z.boolean().default(false),
  profiling: z.boolean().default(false),
  dataSharing: z.boolean().default(false),
  crossBorder: z.boolean().default(false)
});
export type PurposesJson = z.infer<typeof PurposesJson>;

export const ChannelOptinsJson = z.object({
  email: z.boolean().default(false),
  sms: z.boolean().default(false),
  whatsapp: z.boolean().default(false),
  voice: z.boolean().default(false),
  push: z.boolean().default(false)
});
export type ChannelOptinsJson = z.infer<typeof ChannelOptinsJson>;

/* --------------------------------------------------------------- rbac/abac */

export const ScopeJson = z.object({
  teamIds: z.array(z.string()).optional(),
  modules: z.array(z.string()).optional(),
  productLines: z.array(z.string()).optional()
});
export type ScopeJson = z.infer<typeof ScopeJson>;

/* ------------------------------------------------------------ money/ledger */

/** Money is always integer minor units + ISO-4217 currency (docs/04 §1). */
export const Money = z.object({
  amountMinor: z.number().int(),
  currency: z.string().length(3)
});
export type Money = z.infer<typeof Money>;

export const ApprovalJson = z.object({
  policyKey: z.string(),
  requestedBy: z.string(),
  decidedBy: z.string().optional(),
  decision: z.enum(["pending", "approved", "rejected"]),
  reason: z.string().optional(),
  ts: z.number().int()
});
export type ApprovalJson = z.infer<typeof ApprovalJson>;

export const GuardrailsJson = z.object({
  maxAmountMinor: z.number().int().nonnegative().optional(),
  requiresApproval: z.boolean().default(true),
  autoApproveKey: z.string().optional(),
  clientMoney: z.boolean().default(false)
});
export type GuardrailsJson = z.infer<typeof GuardrailsJson>;

/* ------------------------------------------------------------------- lens */

export const LensJson = z.object({
  workspace: z.string(),
  pinned: z.array(z.string()).default([]),
  hidden: z.array(z.string()).default([]),
  density: z.enum(["comfortable", "compact"]).default("comfortable"),
  savedViews: z
    .array(z.object({ id: z.string(), name: z.string(), route: z.string(), query: z.string() }))
    .default([]),
  /** docs/15 §5 learned adaptation: view/filter key -> interaction count, capped
   *  (see MAX_LENS_WEIGHT in packages/core/src/lens.ts) so this stays a small blob. */
  weights: z.record(z.number().int().nonnegative()).default({})
});
export type LensJson = z.infer<typeof LensJson>;

/* ------------------------------------------------------------ helper pair */

/** Parse a TEXT-as-JSON column with its shape; returns the schema default on null. */
export function parseJson<T extends z.ZodTypeAny>(shape: T, raw: string | null | undefined): z.infer<T> {
  if (raw == null || raw === "") return shape.parse(undefined);
  return shape.parse(JSON.parse(raw));
}

/** Validate then stringify for writing. Never write unvalidated JSON. */
export function toJson<T extends z.ZodTypeAny>(shape: T, value: z.input<T>): string {
  return JSON.stringify(shape.parse(value));
}
