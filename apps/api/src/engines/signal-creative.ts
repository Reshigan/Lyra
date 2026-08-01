import { id as newId, schema } from "@lyra/db";
import { checkCompliance, type Ctx, type ComplianceFinding, type ComplianceResult } from "@lyra/core";
import type { Gateway } from "@lyra/model-gateway";

// docs/modules/signal.md §2.1 + §8 acceptance: "Brief -> 20 compliant ar/en
// variants -> publish to Meta+Google in < 1 hour with human review only at the
// flag lane." This engine is the generation half only — brief in, N variants
// persisted to `signal_creatives`, each compliance-checked and audited. The
// publish-to-Meta/Google connector is credential-blocked and out of scope; a
// creative lands here at most "review-ready", never "published" (there is no
// `publishedAt` column on this table to even set).
//
// The Compliance Pre-flight check itself (checkCompliance) lives in
// packages/core/src/signal-compliance.ts — pure and DB-free, so
// packages/model-gateway/evals/signal scores the exact same function.

export type CreativeKind = "ad" | "lp" | "email" | "social" | "video_script";
export type CreativeLocale = "en" | "ar";

export interface CreativeBrief {
  /** Null for a creative not yet attached to a campaign (e.g. drafted ahead of launch). */
  campaignId?: string | null;
  kind: CreativeKind;
  /** What the ad is about and the angle to take — the human-authored input. */
  brief: string;
  /** Groups variants that are A/B siblings of the same slot; defaults to none. */
  variantGroup?: string | null;
  /** Defaults to both — CLAUDE.md rule 7, ar/en from day one, native prompts not translation. */
  locales?: CreativeLocale[];
  /** Defaults to 20 per the acceptance criterion, split evenly across locales. */
  count?: number;
}

export { checkCompliance, type ComplianceFinding, type ComplianceResult };

const SYSTEM_PROMPT =
  "You write short marketing creative copy for an insurance brand. One variant per line, no " +
  "numbering, no surrounding quotes. Never claim a guarantee of cover or acceptance, and never " +
  "claim to be the cheapest or best against the whole market without a named source. Write " +
  "natively in the requested language — never a translation of a draft in another language.";

export function buildPrompt(opts: { brief: string; locale: CreativeLocale; count: number }): {
  system: string;
  user: string;
} {
  const language = opts.locale === "ar" ? "Arabic" : "English";
  return {
    system: SYSTEM_PROMPT,
    user: `Brief: ${opts.brief}\n\nWrite ${opts.count} distinct variants in ${language}, one per line.`
  };
}

/** One variant per line — the same "raw prose, not a claim parser" posture as
 *  narrator.ts's extractNumbers. Returns however many lines the model actually
 *  wrote; callers see the real count rather than a padded or truncated one. */
export function parseVariants(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export interface GeneratedVariant {
  id: string;
  locale: CreativeLocale;
  text: string;
  complianceStatus: ComplianceResult["status"];
  complianceFindings: ComplianceFinding[];
  aiAuditId: string;
}

export interface GenerateCreativesResult {
  variants: GeneratedVariant[];
  /** One gateway call per locale, so one audit id per locale — CLAUDE.md rule 3. */
  auditIds: string[];
}

/**
 * Brief -> generate per locale (packages/model-gateway, standard tier, module
 * "signal" — docs §3 "Creative Generator: standard, no (drafts)") -> compliance
 * pre-flight per variant -> persist to `signal_creatives`. A flagged variant is
 * still written (so the queue is inspectable, docs §2.1 "soft-flag lane to
 * human Compliance Reviewer") with `complianceStatus: "flagged"`, never
 * `"passed"` — nothing here sets `"passed"` on a variant that failed the check,
 * so a flagged draft cannot be silently mistaken for one clear to publish.
 */
export async function generateCreatives(
  ctx: Ctx,
  gateway: Gateway,
  brief: CreativeBrief
): Promise<GenerateCreativesResult> {
  const locales = brief.locales ?? (["en", "ar"] as const);
  const total = brief.count ?? 20;
  const base = Math.floor(total / locales.length);
  const remainder = total % locales.length;

  const variants: GeneratedVariant[] = [];
  const auditIds: string[] = [];

  for (let i = 0; i < locales.length; i++) {
    const locale = locales[i]!;
    const n = base + (i < remainder ? 1 : 0);
    if (n === 0) continue;

    const { system, user } = buildPrompt({ brief: brief.brief, locale, count: n });
    const res = await gateway.complete(ctx, {
      module: "signal",
      purpose: "creative.generate",
      tier: "standard",
      ...(brief.campaignId ? { subjectRef: brief.campaignId } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });
    auditIds.push(res.auditId);

    for (const text of parseVariants(res.text)) {
      const compliance = checkCompliance(text);
      const id = newId("crv", ctx.now);

      await ctx.db.insert(schema.signalCreatives).values({
        id,
        tenantId: ctx.tenantId,
        campaignId: brief.campaignId ?? null,
        kind: brief.kind,
        locale,
        // ponytail: contentRef stores the generated text inline, mirroring
        // narrator.ts's narrativeRef — nothing in this codebase uploads real R2
        // bytes yet (see analyticsExports' fileId: null). Swap for a real R2
        // key the day something writes bytes to R2 for real.
        contentRef: text,
        variantGroup: brief.variantGroup ?? null,
        complianceStatus: compliance.status,
        complianceNotesJson: compliance.findings.length
          ? JSON.stringify({ checkedAt: ctx.now, lane: "soft_flag", findings: compliance.findings })
          : null,
        performanceJson: null,
        generatedBy: "ai",
        aiAuditId: res.auditId,
        createdAt: ctx.now,
        updatedAt: ctx.now
      });

      variants.push({
        id,
        locale,
        text,
        complianceStatus: compliance.status,
        complianceFindings: compliance.findings,
        aiAuditId: res.auditId
      });
    }
  }

  return { variants, auditIds };
}
