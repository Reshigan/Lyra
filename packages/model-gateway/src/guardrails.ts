import { id, schema } from "@lyra/db";
import type { Ctx } from "@lyra/core";

// Post-flight checks (docs/02 §4, docs/12 §5). Cheap deterministic rules only —
// a classifier call to police a classifier call is a cost spiral. Anything
// subtler belongs in the offline eval suite (docs/13).

export type Severity = "info" | "warn" | "block";

export interface GuardrailHit {
  rule: string;
  severity: Severity;
  detail?: string;
}

/** Claims we may not let a model make on our behalf without a stored source. */
const REGULATED = [
  /\bguarantee(?:d|s)?\b/i,
  /\bwe (?:will|shall) (?:pay|cover|reimburse)\b/i,
  /\bapproved by (?:the )?(?:central bank|insurance authority|regulator)\b/i,
  /\byou are (?:fully )?covered\b/i,
  /\brisk[- ]free\b/i,
  /\bno (?:exclusions|deductible|excess)\b/i
];

const JAILBREAK = [
  /ignore (?:all )?(?:previous|prior|above) instructions/i,
  /\bdisregard (?:your|the) (?:system )?prompt\b/i,
  /\breveal (?:your )?(?:system )?prompt\b/i,
  /\bpretend you are (?:not|no longer)\b/i,
  /\bdeveloper mode\b/i
];

/** Placeholders the model invented rather than echoed — a sign it is hallucinating PII. */
const PLACEHOLDER = /\[\[[A-Z_]+_\d+\]\]/g;

export interface PostCheckInput {
  text: string;
  /** Placeholders we actually issued, so an invented one is detectable. */
  issued: ReadonlySet<string>;
  /** Purposes where an unsourced regulated claim is a block, not a warning. */
  customerFacing?: boolean;
}

export function checkOutput(input: PostCheckInput): GuardrailHit[] {
  const hits: GuardrailHit[] = [];

  for (const re of REGULATED) {
    const m = input.text.match(re);
    if (m) {
      hits.push({
        rule: "regulated_claim",
        severity: input.customerFacing ? "block" : "warn",
        detail: m[0]
      });
      break;
    }
  }

  for (const token of input.text.match(PLACEHOLDER) ?? []) {
    if (!input.issued.has(token)) {
      hits.push({ rule: "hallucinated_placeholder", severity: "warn", detail: token });
      break;
    }
  }

  // The model repeating a secret back means one reached it despite the scrubber.
  if (/\b(?:sk-ant-|cfat_|AKIA)[A-Za-z0-9_-]{8,}/.test(input.text)) {
    hits.push({ rule: "secret_in_output", severity: "block" });
  }

  return hits;
}

export function checkInput(text: string): GuardrailHit[] {
  for (const re of JAILBREAK) {
    if (re.test(text)) return [{ rule: "prompt_injection", severity: "warn", detail: re.source.slice(0, 40) }];
  }
  return [];
}

export function blocked(hits: readonly GuardrailHit[]): boolean {
  return hits.some((h) => h.severity === "block");
}

/** Persist trips so Compliance can see them without reading model transcripts. */
export async function recordGuardrails(
  ctx: Ctx,
  hits: readonly GuardrailHit[],
  opts: { runId?: string; subjectRef?: string } = {}
): Promise<void> {
  if (!hits.length) return;
  await ctx.db.insert(schema.aiGuardrailEvents).values(
    hits.map((h, i) => ({
      id: id("gre", ctx.now + i),
      tenantId: ctx.tenantId,
      runId: opts.runId ?? null,
      rule: h.rule,
      severity: h.severity,
      detail: h.detail ?? null,
      subjectRef: opts.subjectRef ?? null,
      ts: ctx.now
    }))
  );
}
