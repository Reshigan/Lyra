import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EntitlementsJson, PolicyJson } from "@lyra/db";
import { permissionsForRole, type Ctx } from "@lyra/core";
import { Gateway } from "../src/gateway.js";
import { EXTRACTION_FIELDS, extractionMessages, extractionSchema, normalizeField, parseExtraction } from "../src/extract.js";
import {
  CX_JUDGE_SAMPLES,
  CX_JUDGE_VERSION,
  aggregateCxScore,
  cxJudgePrompt,
  cxRubricSummary,
  parseCxDimensions
} from "../src/cx-judge.js";
import type { ProviderEnv } from "../src/types.js";
import { loadCases, loadThresholds, metric, type Metric } from "./harness.js";

// docs/27 F10. Every other scorer runs a pure function over a canned string, so
// nothing in the suite notices a prompt edit or a model swap. These tasks call
// a real provider through the real Gateway — same routing, scrubbing,
// guardrails, budget and audit as production (CLAUDE.md §3: never a provider
// SDK). They are opt-in (`LYRA_EVAL_LIVE=1`) because they cost money and need
// network; when the flag is on and credentials are missing the run FAILS, which
// is the difference between a gate and a decoration (docs/13 §3.6: "model
// /provider swaps must pass the full gate before a tier assignment").

const MIGRATIONS = join(import.meta.dirname, "..", "..", "db", "migrations");

function migrationStatements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** In-memory tenant DB so budget/audit writes land somewhere real. */
async function liveCtx(modelOverrides: Record<string, string>): Promise<Ctx> {
  const client = createClient({ url: ":memory:" });
  for (const sql of migrationStatements()) await client.execute(sql);
  return {
    db: drizzle(client) as unknown as Ctx["db"],
    tenantId: "t_eval",
    actor: {
      kind: "user",
      id: "u_eval",
      tenantId: "t_eval",
      grants: [{ roleKey: "axis.agent", permissions: permissionsForRole("axis.agent") }]
    },
    requestId: "req_eval",
    now: Date.now(),
    locale: "en",
    policy: PolicyJson.parse({ modelOverrides }),
    entitlements: EntitlementsJson.parse({})
  };
}

/**
 * `env.AI` is a Worker binding, absent in node. The REST endpoint takes the
 * same (model, input) pair and returns `{ result: { response } }`, which is a
 * shape the workers-ai adapter already reads — so the eval exercises the
 * production adapter and the production model, not a second code path.
 */
function cloudflareRest(accountId: string, token: string): NonNullable<ProviderEnv["AI"]> {
  return {
    async run(model: string, input: unknown): Promise<unknown> {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(input)
      });
      if (!res.ok) throw new Error(`cloudflare ai/run ${model}: ${res.status} ${await res.text()}`);
      return await res.json();
    }
  };
}

interface LiveProvider {
  env: ProviderEnv;
  /** Tier -> catalogue key, applied the production way: via tenant policy. */
  overrides: Record<string, string>;
  label: string;
}

function liveProvider(): LiveProvider {
  const e = process.env;
  if (e["CF_ACCOUNT_ID"] && e["CF_AI_TOKEN"]) {
    // The default route (docs/02 §5). No override: the eval scores the model
    // production actually picks for the tier.
    return {
      env: { AI: cloudflareRest(e["CF_ACCOUNT_ID"], e["CF_AI_TOKEN"]) },
      overrides: {},
      label: "workers-ai (cloudflare rest)"
    };
  }
  if (e["ANTHROPIC_API_KEY"]) {
    return {
      env: {
        ANTHROPIC_API_KEY: e["ANTHROPIC_API_KEY"],
        ...(e["AI_GATEWAY_URL"] ? { AI_GATEWAY_URL: e["AI_GATEWAY_URL"] } : {})
      },
      overrides: { standard: "claude-haiku-4-5" },
      label: "anthropic claude-haiku-4-5 (tenant override)"
    };
  }
  throw new Error(
    "LYRA_EVAL_LIVE=1 but no provider credentials: set CF_ACCOUNT_ID + CF_AI_TOKEN, or ANTHROPIC_API_KEY"
  );
}

interface LiveExtractionCase {
  id: string;
  docType: string;
  locale: string;
  /** Raw OCR text, exactly what POST /axis/documents/:id/extract receives. */
  rawText: string;
  expected: Record<string, string>;
}

interface LiveExtractionThresholds {
  fieldAccuracyMin: number;
}

/**
 * docs/13 §3.3 "extraction field-F1 >= 0.95 (ar+en separately)" — measured
 * against a model, which is what that line has always meant. Scored per locale
 * for the reason the deterministic axis eval is: a pooled number lets a strong
 * English set carry a failing Arabic one. Keep the sets symmetric.
 */
export async function scoreLiveExtraction(dir: string): Promise<Metric[]> {
  const cases = await loadCases<LiveExtractionCase>(dir);
  const thresholds = await loadThresholds<LiveExtractionThresholds>(dir);
  const provider = liveProvider();
  const ctx = await liveCtx(provider.overrides);
  const gateway = new Gateway({ env: provider.env });
  console.log(`  provider: ${provider.label}`);

  const scored = await Promise.all(
    cases.map(async (c) => {
      const fields = EXTRACTION_FIELDS[c.docType] ?? Object.keys(c.expected);
      const res = await gateway.complete(ctx, {
        module: "axis",
        purpose: "axis.document.extract",
        tier: "standard",
        subjectRef: c.id,
        locale: c.locale,
        responseSchema: extractionSchema(fields),
        messages: extractionMessages({
          docType: c.docType,
          fields,
          locale: c.locale,
          rawText: c.rawText
        })
      });
      const { values } = parseExtraction(res.text, fields);
      const correct = fields.filter(
        (f) => normalizeField(values[f] ?? null) === normalizeField(c.expected[f] ?? null)
      ).length;
      if (correct < fields.length) {
        // Print what came back, not only which field lost. A bare "missed
        // idNumber" cannot tell a model that returned the card serial from one
        // that returned nothing, and those two want opposite prompt fixes.
        const wrong = fields
          .filter((f) => normalizeField(values[f] ?? null) !== normalizeField(c.expected[f] ?? null))
          .map((f) => `${f} (got ${JSON.stringify(values[f])}, want ${JSON.stringify(c.expected[f] ?? null)})`);
        console.log(`  ${c.id}: missed ${wrong.join("; ")} (model ${res.model})`);
      }
      return { locale: c.locale, correct, total: fields.length };
    })
  );

  const tally = new Map<string, { correct: number; total: number }>();
  for (const s of scored) {
    const t = tally.get(s.locale) ?? { correct: 0, total: 0 };
    t.correct += s.correct;
    t.total += s.total;
    tally.set(s.locale, t);
  }

  return [...tally.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([locale, t]) =>
      metric(`fieldAccuracy.${locale}`, t.total ? t.correct / t.total : 0, { min: thresholds.fieldAccuracyMin })
    );
}

interface LiveCxCase {
  id: string;
  locale: string;
  context: string[];
  reply: string;
  /** false for a reply the rubric must mark down — see `reject` below. */
  expectPass: boolean;
}

interface LiveCxThresholds {
  rubricMin: number;
  parityGapMax: number;
  scoredMin: number;
  /** Ceiling the bad replies must stay under. */
  rejectMax: number;
}

/**
 * docs/13 §3.3's CX rubric measured against a real judge. The deterministic
 * `cx-quality` task next door scores canned `judgeReplies`, which gates the
 * parse and the aggregate and nothing else: it cannot notice a prompt edit, a
 * model swap or a judge that has started rating everything a 5. This task runs
 * `cxJudgePrompt` through the real Gateway `CX_JUDGE_SAMPLES` times per case and
 * medians them, exactly as `sweepQaScores` does in apps/api/src/engines/orbit-qa.ts
 * — same module, same purpose, so a routing or guardrail change shows up here.
 *
 * The set is two-sided on purpose. Good replies must clear `rubricMin`; the
 * `expectPass: false` cases invent a settlement figure the conversation never
 * gave, and must land under `rejectMax`. A one-sided set passes just as well
 * with a judge that has stopped reading.
 */
export async function scoreLiveCxQuality(dir: string): Promise<Metric[]> {
  const cases = await loadCases<LiveCxCase>(dir);
  const thresholds = await loadThresholds<LiveCxThresholds>(dir);
  const provider = liveProvider();
  const ctx = await liveCtx(provider.overrides);
  const gateway = new Gateway({ env: provider.env });
  console.log(`  provider: ${provider.label}, judge ${CX_JUDGE_VERSION}, n=${CX_JUDGE_SAMPLES}`);

  const scored = await Promise.all(
    cases.map(async (c) => {
      const prompt = cxJudgePrompt({ locale: c.locale, context: c.context, reply: c.reply });
      const replies = await Promise.all(
        Array.from({ length: CX_JUDGE_SAMPLES }, async () => {
          const res = await gateway.complete(ctx, {
            module: "orbit",
            purpose: "output.review",
            tier: "standard",
            subjectRef: c.id,
            locale: c.locale,
            messages: [{ role: "user", content: prompt }]
          });
          return res.text;
        })
      );
      const score = aggregateCxScore(replies);
      if (score === null) console.log(`  ${c.id}: no parseable judge run out of ${CX_JUDGE_SAMPLES}`);
      // ADR-0074 §2. A bare "reject = 4.000" cannot tell a judge that scored
      // accuracy 1 and was outvoted by the other three dimensions from one that
      // rated the fabrication accurate — and those want opposite fixes. Print
      // the breakdown whenever a case lands on the wrong side of its threshold.
      const missed = c.expectPass
        ? score !== null && score < thresholds.rubricMin
        : score === null || score > thresholds.rejectMax;
      if (missed) {
        for (const r of replies) {
          const parsed = parseCxDimensions(r);
          if (parsed) console.log(`  ${c.id}: ${JSON.stringify(parsed.dimensions)}${parsed.why ? ` — ${parsed.why}` : ""}`);
        }
      }
      return { ...c, score };
    })
  );

  const summary = cxRubricSummary(scored);
  const metrics: Metric[] = summary.perLocale.map(([locale, value]) =>
    metric(`rubric.${locale}`, value, { min: thresholds.rubricMin })
  );
  if (summary.parityGap) {
    const [a, b, gap] = summary.parityGap;
    metrics.push(metric(`parityGap.${a}-${b}`, gap, { max: thresholds.parityGapMax }));
  }
  if (summary.worstReject !== null) {
    metrics.push(metric("reject", summary.worstReject, { max: thresholds.rejectMax }));
  }
  metrics.push(metric("scoredRate", summary.scoredRate, { min: thresholds.scoredMin }));
  return metrics;
}

export const LIVE_SCORERS: Record<string, (dir: string) => Promise<Metric[]>> = {
  "live-extraction": scoreLiveExtraction,
  "live-cx-quality": scoreLiveCxQuality
};
