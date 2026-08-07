import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EntitlementsJson, PolicyJson } from "@lyra/db";
import { permissionsForRole, type Ctx } from "@lyra/core";
import { Gateway } from "../src/gateway.js";
import { EXTRACTION_FIELDS, extractionMessages, extractionSchema, normalizeField, parseExtraction } from "../src/extract.js";
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
        const wrong = fields.filter((f) => normalizeField(values[f] ?? null) !== normalizeField(c.expected[f] ?? null));
        console.log(`  ${c.id}: missed ${wrong.join(", ")} (model ${res.model})`);
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

export const LIVE_SCORERS: Record<string, (dir: string) => Promise<Metric[]>> = {
  "live-extraction": scoreLiveExtraction
};
