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
  if (typeof value === "string" && (kind || hasNestedPath(map, path))) {
    // A JSON column that never went through `hydrate()` — a raw Drizzle row, or
    // text that hydrate() failed to parse and handed back verbatim. Parse it so
    // the declared paths still match, then hand back a string so the column
    // keeps its shape.
    const parsed = parseJsonContainer(value);
    if (parsed !== undefined) return JSON.stringify(walk(parsed, map, path));
    // Paths were declared *inside* this blob and it will not parse: a blob we
    // cannot read is a blob we cannot prove is safe.
    if (!kind) return "[redacted]";
  }
  if (kind && typeof value === "string") return MASKERS[kind](value);
  return value;
}

/** True if any declared path sits inside `path` — i.e. it should be an object. */
function hasNestedPath(map: PiiMap, path: string): boolean {
  if (!path) return false;
  const prefix = `${path}.`;
  // ponytail: linear scan per string field. Maps hold a handful of paths and
  // rows are small; precompute a prefix set if a map ever grows past ~50.
  return Object.keys(map).some((k) => k.startsWith(prefix));
}

/** JSON.parse, but only objects and arrays — `"12"` and `"null"` are values, not blobs. */
function parseJsonContainer(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The customer spine's PII fields — used by every module that reads a customer.
 *
 * Paths are the physical `core_customers` column names, because masking runs on
 * the hydrated row: apps/api/src/crud.ts `view()` calls `hydrate()` (every
 * `*Json` column parsed from TEXT into an object/array) and only then `mask()`.
 * So `nameJson` is `{en, ar}` and `emailsJson` / `phonesJson` are arrays of
 * strings by the time a path is matched.
 *
 * A raw Drizzle row works too — `walk` parses a JSON string when a path points
 * into it — so a hand-written route that skips `hydrate()` is masked as well.
 *
 * ponytail: one map keyed on physical columns, no DTO layer and no parallel
 * raw/hydrated maps. If an endpoint ever reshapes a customer into an API DTO
 * (`{email, phone}`), that DTO needs its own map — mask at the shape you emit.
 * `pii.test.ts` pins every path to a real column so this cannot silently rot.
 */
export const CUSTOMER_PII: PiiMap = {
  "nameJson.en": "name",
  "nameJson.ar": "name",
  emailsJson: "email",
  phonesJson: "phone",
  // A national ID hash is a re-identification vector, not an opaque token: the
  // ID space is small enough to brute-force offline. Masking it is a floor, not
  // a fix — it should not leave the API at all (see the report on resources.ts).
  nationalIdHash: "id"
};
