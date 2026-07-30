import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openapi } from "../../../apps/api/src/openapi.js";

// The SDK's types are derived from the OpenAPI document, which is itself derived
// from the resource table the router is built from — so a type here cannot
// describe an endpoint that does not exist. Imported, never fetched: generation
// must work with nothing running.
//
// ponytail: a relative import instead of a `@lyra/api` dependency. The published
// SDK has no runtime dependency on the API app and must not gain one; this file
// is a dev-time script and src/sdk.test.ts is the only other importer.

/* --------------------------------------------------------------- doc shape */

interface Schema {
  $ref?: string;
  type?: string;
  enum?: string[];
  nullable?: boolean;
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
}

interface Parameter {
  name: string;
  in: "path" | "query";
  schema: Schema;
}

interface Operation {
  tags?: string[];
  summary?: string;
  parameters?: Parameter[];
  security?: Record<string, string[]>[];
  requestBody?: { content: Record<string, { schema: Schema }> };
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
}

interface Doc {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
}

const METHODS = ["get", "post", "patch", "put", "delete"] as const;

/* ------------------------------------------------------------- type emitter */

/** A property name that is not a bare identifier has to be quoted. */
function key(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function refName(ref: string): string {
  return ref.slice(ref.lastIndexOf("/") + 1);
}

/**
 * The one shape the CRUD lister returns. Recognised rather than inlined so the
 * generated file reads as `Page<CoreCustomers>` instead of an anonymous object
 * repeated 119 times.
 */
function pageItem(s: Schema): string | null {
  const props = s.properties;
  if (!props || !("data" in props) || !("nextCursor" in props)) return null;
  const items = props.data?.items;
  return items?.$ref ? refName(items.$ref) : null;
}

function typeOf(s: Schema): string {
  if (s.$ref) return refName(s.$ref);
  const page = s.type === "object" ? pageItem(s) : null;
  if (page) return `Page<${page}>`;
  let out: string;
  switch (s.type) {
    case "integer":
    case "number":
      out = "number";
      break;
    case "boolean":
      out = "boolean";
      break;
    case "array":
      out = `${s.items ? typeOf(s.items) : "unknown"}[]`;
      break;
    case "object":
      out = s.properties ? objectType(s) : "Record<string, unknown>";
      break;
    default:
      out = s.enum?.length ? s.enum.map((v) => JSON.stringify(v)).join(" | ") : "string";
  }
  return s.nullable ? `${out} | null` : out;
}

function objectType(s: Schema): string {
  const required = new Set(s.required ?? []);
  const props = Object.entries(s.properties ?? {}).map(
    ([name, prop]) => `${key(name)}${required.has(name) ? "" : "?"}: ${typeOf(prop)}`
  );
  return props.length ? `{ ${props.join("; ")} }` : "Record<string, never>";
}

function interfaceOf(name: string, s: Schema): string {
  const required = new Set(s.required ?? []);
  const lines = Object.entries(s.properties ?? {}).map(
    ([prop, sub]) => `  ${key(prop)}${required.has(prop) ? "" : "?"}: ${typeOf(sub)};`
  );
  return `export interface ${name} {\n${lines.join("\n")}\n}`;
}

/* ------------------------------------------------------------- ops emitter */

function paramsType(params: Parameter[], where: "path" | "query"): string {
  const picked = params.filter((p) => p.in === where);
  if (!picked.length) return "never";
  return `{ ${picked
    .map((p) => `${key(p.name)}${where === "path" ? "" : "?"}: ${typeOf(p.schema)}`)
    .join("; ")} }`;
}

function bodyType(op: Operation): string {
  const schema = op.requestBody?.content["application/json"]?.schema;
  return schema ? typeOf(schema) : "never";
}

function resultType(op: Operation): string {
  for (const status of ["200", "201"]) {
    const schema = op.responses[status]?.content?.["application/json"]?.schema;
    if (schema) return typeOf(schema);
  }
  // 204, and any endpoint that answers with headers only.
  return "void";
}

/** The permission an integrator has to hold; the scope list carries it verbatim. */
function permissionOf(op: Operation): string | null {
  return op.security?.[0]?.session?.[0] ?? null;
}

export function emit(document: unknown): string {
  const doc = document as Doc;

  const schemas = Object.entries(doc.components.schemas)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, schema]) => interfaceOf(name, schema));

  const operations: string[] = [];
  const meta: string[] = [];

  for (const [path, item] of Object.entries(doc.paths).sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const id = `${method.toUpperCase()} ${path}`;
      const params = op.parameters ?? [];
      operations.push(
        `  ${JSON.stringify(id)}: Op<${paramsType(params, "path")}, ${paramsType(params, "query")}, ${bodyType(op)}, ${resultType(op)}>;`
      );
      const permission = permissionOf(op);
      meta.push(
        `  ${JSON.stringify(id)}: { tag: ${JSON.stringify(op.tags?.[0] ?? "")}, summary: ${JSON.stringify(op.summary ?? "")}, permission: ${permission === null ? "null" : JSON.stringify(permission)}, public: ${op.security === undefined} },`
      );
    }
  }

  return `${PREAMBLE}
/* ------------------------------------------------------------------ schemas */

${schemas.join("\n\n")}

/* --------------------------------------------------------------- operations */

export interface Operations {
${operations.join("\n")}
}

export type OperationId = keyof Operations;

/** Runtime side of \`Operations\`: what a caller needs before making the call. */
export const OPERATIONS: Record<OperationId, OperationMeta> = {
${meta.join("\n")}
};
`;
}

const PREAMBLE = `// GENERATED FILE — do not edit. Run \`pnpm generate\` (packages/sdk/scripts/generate.ts).
// Source of truth: apps/api/src/openapi.ts. src/sdk.test.ts fails if this file
// and that document disagree, so a contract break cannot land silently.

/** A page of rows from a list endpoint. Pass \`nextCursor\` back as \`cursor\`. */
export interface Page<T> {
  data: T[];
  nextCursor?: string | null;
}

/** One endpoint's shapes. \`never\` means the endpoint takes none of that kind. */
export interface Op<Params, Query, Body, Result> {
  params: Params;
  query: Query;
  body: Body;
  result: Result;
}

export interface OperationMeta {
  tag: string;
  summary: string;
  /** Permission the caller must hold, or null when the endpoint is self-scoped. */
  permission: string | null;
  /** Reachable without a session (the pre-session auth endpoints only). */
  public: boolean;
}
`;

/* --------------------------------------------------------------------- cli */

export const OUTPUT = fileURLToPath(new URL("../src/generated.ts", import.meta.url));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(OUTPUT, emit(openapi()));
  console.log(`wrote ${OUTPUT}`);
}
