import { schema } from "@lyra/db";
import { and, eq } from "drizzle-orm";
import type { CoreDb } from "../context.js";

// What the core seed has already written by the time a module seeder runs.
// Module seeders reference these rows rather than minting their own customers
// and policies, so the demo tells one story across every workspace instead of
// nine unrelated ones.

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const MINUTE = 60_000;

export interface SeedContext {
  db: CoreDb;
  /** The seed clock. Everything is expressed relative to it, never `Date.now()`. */
  now: number;
  tenantId: string;
  /** Role key (`axis.agent`, `finance.controller`, …) -> user id. */
  users: Record<string, string>;
  teams: { motor: string; health: string; retention: string };
  providers: {
    gonxt: string;
    falcon: string;
    cedar: string;
    oryx: string;
    gulfHealth: string;
    meridian: string;
  };
  products: { motor: string; health: string; travel: string; home: string; life: string };
  offerings: {
    gonxtMotor: string;
    falconMotor: string;
    cedarMotor: string;
    oryxMotor: string;
    cedarMotorPlus: string;
    gulfHealth: string;
    gonxtTravel: string;
    cedarHome: string;
    oryxLife: string;
  };
  channels: { web: string; app: string; callCentre: string; brokerAlpha: string; bankEmbed: string };
  /** Rania Haddad — the customer the whole demo journey follows. */
  customerId: string;
  consentId: string;
  quoteRequestId: string;
  caseId: string;
  /** The motor policy sold on that case. */
  policyId: string;
  /** Last year's cover for the same customer, inside the renewal window. */
  renewalPolicyId: string;
  /** When the policy was issued: `now + 2 * DAY`. */
  issuedAt: number;
}

/**
 * A ledger account's id from its chart code. The core seed mints these ids from
 * a loop, so a module seeder that needs `1100` has to ask rather than guess.
 */
export async function accountByCode(ctx: SeedContext, code: string): Promise<string> {
  const [row] = await ctx.db
    .select({ id: schema.ledgerAccounts.id })
    .from(schema.ledgerAccounts)
    .where(and(eq(schema.ledgerAccounts.tenantId, ctx.tenantId), eq(schema.ledgerAccounts.code, code)))
    .limit(1);
  if (!row) throw new Error(`seed: no ledger account ${code}`);
  return row.id;
}
