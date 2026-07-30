import { can, type Actor } from "./rbac.js";

// docs/06 §1: "sensitive data (PII) requires core:pii:view regardless of role."
// Masking happens on the way out, at the serialiser — not per handler.

export function maskEmail(value: string): string {
  const at = value.indexOf("@");
  if (at <= 0) return "•••";
  const local = value.slice(0, at);
  const head = local.slice(0, 1);
  return `${head}${"•".repeat(Math.max(local.length - 1, 2))}${value.slice(at)}`;
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "•••";
  return `${value.startsWith("+") ? "+" : ""}${"•".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

/** Keeps the first word so a queue stays readable: "Layla A•••". */
export function maskName(value: string): string {
  const [first = "", ...rest] = value.split(" ");
  if (!rest.length) return first;
  return `${first} ${rest.map((w) => `${w.slice(0, 1)}${"•".repeat(Math.max(w.length - 1, 2))}`).join(" ")}`;
}

export function maskId(value: string): string {
  return value.length <= 4 ? "•••" : `${"•".repeat(value.length - 4)}${value.slice(-4)}`;
}

export type PiiKind = "email" | "phone" | "name" | "id" | "text";

const MASKERS: Record<PiiKind, (v: string) => string> = {
  email: maskEmail,
  phone: maskPhone,
  name: maskName,
  id: maskId,
  // Free text can hold anything a customer typed, so it is redacted whole
  // rather than partially — there is no safe prefix of a message body.
  text: () => "[redacted]"
};

/** Field path (dot notation) to the kind of PII it holds. */
export type PiiMap = Readonly<Record<string, PiiKind>>;

export function canSeePii(actor: Actor, tenantId?: string): boolean {
  return can(actor, "core:pii:view", tenantId ? { tenantId } : undefined);
}

/**
 * Return a copy with PII masked unless the actor holds `core:pii:view`.
 * Arrays and nested objects are walked; anything not in `map` is untouched.
 */
export function mask<T>(actor: Actor, value: T, map: PiiMap, tenantId?: string): T {
  if (canSeePii(actor, tenantId)) return value;
  return walk(value, map, "") as T;
}

function walk(value: unknown, map: PiiMap, path: string): unknown {
  if (Array.isArray(value)) return value.map((v) => walk(v, map, path));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        walk(v, map, path ? `${path}.${k}` : k)
      ])
    );
  }
  const kind = map[path];
  if (kind && typeof value === "string") return MASKERS[kind](value);
  return value;
}

/** The customer spine's PII fields — used by every module that reads a customer. */
export const CUSTOMER_PII: PiiMap = {
  "name.en": "name",
  "name.ar": "name",
  email: "email",
  phone: "phone",
  emails: "email",
  phones: "phone",
  nationalId: "id",
  iban: "id"
};
