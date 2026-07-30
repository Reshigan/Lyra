// Pre-flight redaction (docs/02 §4, docs/12 §3). Two jobs, different severities:
//
//   secrets  -> never leave the process. A hit is a bug; we redact and flag hard.
//   PII      -> replaced with stable placeholders so the model can still reason
//               ("[[EMAIL_1]] asked about [[PHONE_1]]"), and rehydrated on the
//               way out. The provider never sees the real value.

export interface ScrubResult {
  text: string;
  /** placeholder -> original. Never logged, never persisted. */
  map: Map<string, string>;
  flags: string[];
}

interface Rule {
  kind: string;
  re: RegExp;
  /** Secrets are destroyed, not placeheld — there is nothing to rehydrate. */
  secret?: true;
}

const RULES: Rule[] = [
  // Secrets first: a token that also looks like a word must lose.
  { kind: "SECRET_CF", re: /\bcfat_[A-Za-z0-9_-]{20,}\b/g, secret: true },
  { kind: "SECRET_ANTHROPIC", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, secret: true },
  { kind: "SECRET_OPENAI", re: /\bsk-[A-Za-z0-9]{32,}\b/g, secret: true },
  { kind: "SECRET_AWS", re: /\bAKIA[0-9A-Z]{16}\b/g, secret: true },
  { kind: "SECRET_BEARER", re: /\bBearer\s+[A-Za-z0-9._-]{20,}/g, secret: true },
  { kind: "SECRET_PK", re: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g, secret: true },
  { kind: "SECRET_JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, secret: true },

  // PII.
  { kind: "EMAIL", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: "IBAN", re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g },
  { kind: "CARD", re: /\b(?:\d[ -]?){13,19}\b/g },
  { kind: "EMIRATES_ID", re: /\b784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d\b/g },
  { kind: "PHONE", re: /\+\d[\d\s().-]{7,17}\d/g },
  { kind: "IP", re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g }
];

/** Luhn — keeps order numbers and long ids from being redacted as card numbers. */
function luhn(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** Shared across the messages of one request so the same value keeps one placeholder. */
export interface ScrubState {
  /** original -> placeholder */
  seen: Map<string, string>;
  /** placeholder -> original */
  map: Map<string, string>;
  flags: Set<string>;
}

export function newScrubState(): ScrubState {
  return { seen: new Map(), map: new Map(), flags: new Set() };
}

export function scrub(input: string, state: ScrubState = newScrubState()): ScrubResult {
  let text = input;

  for (const rule of RULES) {
    text = text.replace(rule.re, (hit) => {
      if (rule.kind === "CARD" && !luhn(hit)) return hit;
      if (rule.secret) {
        state.flags.add("secret_in_prompt");
        return "[[REDACTED]]";
      }
      const existing = state.seen.get(hit);
      if (existing) return existing;
      const token = `[[${rule.kind}_${countOf(state, rule.kind) + 1}]]`;
      state.seen.set(hit, token);
      state.map.set(token, hit);
      state.flags.add(`pii_${rule.kind.toLowerCase()}`);
      return token;
    });
  }

  return { text, map: state.map, flags: [...state.flags] };
}

function countOf(state: ScrubState, kind: string): number {
  let n = 0;
  for (const token of state.seen.values()) if (token.startsWith(`[[${kind}_`)) n++;
  return n;
}

/** Put the real values back before the answer reaches the user who owns them. */
export function rehydrate(text: string, map: Map<string, string>): string {
  if (!map.size) return text;
  return text.replace(/\[\[[A-Z_]+_\d+\]\]/g, (token) => map.get(token) ?? token);
}

export interface ScrubbedMessages<T> {
  messages: T[];
  map: Map<string, string>;
  flags: string[];
}

export function scrubMessages<T extends { content: string }>(messages: readonly T[]): ScrubbedMessages<T> {
  const state = newScrubState();
  const out = messages.map((m) => ({ ...m, content: scrub(m.content, state).text }));
  return { messages: out, map: state.map, flags: [...state.flags] };
}
