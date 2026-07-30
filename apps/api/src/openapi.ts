import { getTableColumns } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { BY_MODULE } from "./resources.js";
import { DATASETS } from "./engines/report.js";
import type { Resource } from "./crud.js";

// The spec is generated from the same resource table the router is built from,
// so it cannot describe an endpoint that does not exist. Hand-written entries
// below cover the module routers, which are not CRUD.

interface Op {
  method: "get" | "post" | "patch" | "delete";
  path: string;
  summary: string;
  /** Omitted when the endpoint is authenticated but scoped to the caller itself. */
  permission?: string;
  /** True only for the handful of endpoints that run before a session exists. */
  public?: boolean;
  tag: string;
  requestBody?: boolean;
}

/** Endpoints that are not generated CRUD. Kept beside the routers they describe. */
const HAND_WRITTEN: Op[] = [
  { method: "post", path: "/v1/auth/login", summary: "Password login, returns a session cookie", tag: "auth", requestBody: true, public: true },
  { method: "post", path: "/v1/auth/logout", summary: "End the current session", tag: "auth", public: true },
  { method: "post", path: "/v1/auth/mfa/verify", summary: "Complete a TOTP challenge", tag: "auth", requestBody: true, public: true },
  { method: "get", path: "/v1/me", summary: "Current actor, tenant, entitlements", tag: "me" },
  { method: "get", path: "/v1/me/nav", summary: "Navigation the actor may see (labelled, never icon-only)", tag: "me" },
  { method: "get", path: "/v1/me/permissions", summary: "Resolved permission strings", tag: "me" },

  { method: "post", path: "/v1/dist/quotes/fan-out", summary: "Send one risk to every eligible provider and collect quotes", permission: "dist:quote_requests:create", tag: "dist", requestBody: true },
  { method: "get", path: "/v1/dist/quotes/{id}/comparison", summary: "Ranked comparison across responses", permission: "dist:quote_requests:read", tag: "dist" },
  { method: "post", path: "/v1/dist/quotes/{id}/share", summary: "Share the comparison with the customer", permission: "dist:quote_requests:share", tag: "dist", requestBody: true },
  { method: "post", path: "/v1/dist/offers/next-best", summary: "Cross-sell and upsell offers for a customer", permission: "dist:offers:surface", tag: "dist", requestBody: true },
  { method: "post", path: "/v1/dist/commissions/calculate", summary: "Commission split between provider, us and the channel", permission: "dist:commissions:read", tag: "dist", requestBody: true },
  { method: "post", path: "/v1/dist/settlements/run", summary: "Build a settlement batch for a counterparty", permission: "dist:commissions:settle", tag: "dist", requestBody: true },

  { method: "post", path: "/v1/ledger/txns/{id}/transition", summary: "Advance a transaction through its state machine", permission: "ledger:txns:authorize", tag: "ledger", requestBody: true },
  { method: "post", path: "/v1/ledger/txns/{id}/reverse", summary: "Post a compensating reversal", permission: "ledger:txns:reverse", tag: "ledger", requestBody: true },
  { method: "post", path: "/v1/ledger/journals/post", summary: "Post a balanced double-entry batch", permission: "ledger:journals:post", tag: "ledger", requestBody: true },
  { method: "get", path: "/v1/ledger/reports/trial-balance", summary: "Trial balance for a period", permission: "ledger:journals:read", tag: "ledger" },
  { method: "get", path: "/v1/ledger/reports/client-money", summary: "Client money sufficiency check", permission: "ledger:client_money:read", tag: "ledger" },
  { method: "post", path: "/v1/ledger/periods/{id}/close", summary: "Close an accounting period (dual control)", permission: "ledger:periods:close", tag: "ledger", requestBody: true },
  { method: "post", path: "/v1/ledger/recon/run", summary: "Match a statement against the ledger", permission: "ledger:recon:run", tag: "ledger", requestBody: true },

  // Invoking an agent is authorised per module, so the scope below is the core
  // module's; an AXIS agent needs axis:ai:invoke, and so on for each module.
  { method: "post", path: "/v1/ai/runs", summary: "Run an agent through the gateway, budgeted and audited (needs the agent module's :ai:invoke)", permission: "core:ai:invoke", tag: "ai", requestBody: true },
  { method: "get", path: "/v1/ai/runs/{id}", summary: "One agent run with its trace", permission: "ai:runs:read", tag: "ai" },
  { method: "get", path: "/v1/ai/budget", summary: "Remaining AI budget for the period", permission: "ai:budgets:read", tag: "ai" },
  { method: "post", path: "/v1/ai/budget/limits", summary: "Set per-module AI spend limits", permission: "ai:budgets:write", tag: "ai", requestBody: true },
  { method: "post", path: "/v1/ai/suggestions", summary: "Record a suggestion shown to the current user", tag: "ai", requestBody: true },
  { method: "post", path: "/v1/ai/suggestions/{id}/outcome", summary: "Record whether the current user accepted, edited or dismissed it", tag: "ai", requestBody: true },
  { method: "get", path: "/v1/ai/suggestions/acceptance", summary: "Acceptance rate by surface and module", permission: "ai:runs:read", tag: "ai" },
  { method: "post", path: "/v1/ai/agents/{key}/pause", summary: "Pause an agent", permission: "ai:agents:write", tag: "ai" },
  { method: "post", path: "/v1/ai/agents/{key}/resume", summary: "Resume a paused agent", permission: "ai:agents:write", tag: "ai" },
  { method: "post", path: "/v1/ai/agents/{key}/autonomy", summary: "Change an agent's autonomy level", permission: "ai:agents:write", tag: "ai", requestBody: true },
  { method: "get", path: "/v1/ai/audit", summary: "Every model call, prompt hash and cost", permission: "ai:audit:read", tag: "ai" },
  { method: "get", path: "/v1/ai/audit/spend", summary: "Spend rolled up by module and purpose", permission: "ai:budgets:read", tag: "ai" },

  { method: "get", path: "/v1/analytics/datasets", summary: "Semantic layer the report builder can offer", permission: "analytics:reports:read", tag: "analytics" },
  { method: "post", path: "/v1/analytics/run", summary: "Run an ad-hoc report definition", permission: "analytics:reports:run", tag: "analytics", requestBody: true },
  { method: "post", path: "/v1/analytics/reports/{id}/run", summary: "Run a saved report", permission: "analytics:reports:run", tag: "analytics", requestBody: true },
  { method: "post", path: "/v1/analytics/exports", summary: "Render a report to xlsx, pdf, csv or json", permission: "analytics:exports:create", tag: "analytics", requestBody: true },
  { method: "get", path: "/v1/analytics/exports/{id}/download", summary: "Download a rendered export", permission: "analytics:exports:download", tag: "analytics" },
  { method: "get", path: "/v1/analytics/dashboards/{id}/data", summary: "Every tile on a dashboard in one call", permission: "analytics:dashboards:read", tag: "analytics" },
  { method: "get", path: "/v1/analytics/unit-economics", summary: "Cost and margin per unit of work", permission: "analytics:reports:read", tag: "analytics" }
];

export function openapi(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const schemas: Record<string, unknown> = {};

  for (const [module, resources] of Object.entries(BY_MODULE)) {
    for (const res of resources) {
      const name = schemaName(module, res.path);
      schemas[name] = tableSchema(res);
      const base = `/v1/${module}/${res.path}`;
      const ref = { $ref: `#/components/schemas/${name}` };

      put(paths, base, "get", {
        tags: [module],
        summary: `List ${res.path}`,
        parameters: [
          q("limit", "integer", "Page size, max 200"),
          q("cursor", "string", "Opaque keyset cursor from the previous page"),
          q("q", "string", "Free-text search across indexed columns"),
          q("sort", "string", "Column name, prefix with - for descending")
        ],
        security: perm(res.perms.read),
        responses: page(ref)
      });

      if (res.perms.create) {
        put(paths, base, "post", {
          tags: [module],
          summary: `Create a ${singular(res.path)}`,
          security: perm(res.perms.create),
          requestBody: { required: true, content: { "application/json": { schema: ref } } },
          responses: { "201": ok(ref), ...errors(res.approval?.create) }
        });
      }

      const item = `${base}/{id}`;
      put(paths, item, "get", {
        tags: [module],
        summary: `Fetch one ${singular(res.path)}`,
        parameters: [idParam()],
        security: perm(res.perms.read),
        responses: { "200": ok(ref), ...errors() }
      });
      if (res.perms.update && !res.immutable) {
        put(paths, item, "patch", {
          tags: [module],
          summary: `Update a ${singular(res.path)}`,
          parameters: [idParam()],
          security: perm(res.perms.update),
          requestBody: { required: true, content: { "application/json": { schema: ref } } },
          responses: { "200": ok(ref), ...errors(res.approval?.update) }
        });
      }
      if (res.perms.remove && !res.immutable) {
        put(paths, item, "delete", {
          tags: [module],
          summary: `Soft-delete a ${singular(res.path)}`,
          parameters: [idParam()],
          security: perm(res.perms.remove),
          responses: { "204": { description: "Deleted" }, ...errors(res.approval?.remove) }
        });
      }
    }
  }

  for (const op of HAND_WRITTEN) {
    put(paths, op.path, op.method, {
      tags: [op.tag],
      summary: op.summary,
      ...(pathParams(op.path).length ? { parameters: pathParams(op.path) } : {}),
      ...(op.requestBody
        ? { requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } } }
        : {}),
      // An endpoint with no permission is still authenticated — it is scoped to
      // the caller. Only the pre-session auth endpoints carry no security at all.
      ...(op.public ? {} : { security: op.permission ? perm(op.permission) : perm() }),
      responses: { "200": ok({ type: "object" }), ...errors() }
    });
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Lyra API",
      version: "1.0.0",
      description:
        "Aggregator platform API. Every endpoint is tenant-scoped, permission-checked and audited. " +
        "Errors are RFC 9457 problem documents. Money is integer minor units with an ISO-4217 code; " +
        "rates are parts per million."
    },
    servers: [{ url: "https://api.lyra.vantax.co.za" }, { url: "http://localhost:8787" }],
    tags: [
      ...Object.keys(BY_MODULE).map((m) => ({ name: m })),
      { name: "auth" },
      { name: "me" }
    ],
    paths,
    components: {
      securitySchemes: {
        session: { type: "apiKey", in: "cookie", name: "lyra_session" },
        apiKey: { type: "http", scheme: "bearer", description: "Partner API key" }
      },
      schemas: {
        ...schemas,
        Problem: {
          type: "object",
          description: "RFC 9457",
          properties: {
            type: { type: "string" },
            title: { type: "string" },
            status: { type: "integer" },
            detail: { type: "string" },
            instance: { type: "string" },
            code: { type: "string" }
          }
        },
        Dataset: {
          type: "object",
          description: "A reportable dataset in the semantic layer",
          properties: {
            key: { type: "string", enum: Object.keys(DATASETS) },
            module: { type: "string" },
            dimensions: { type: "array", items: { type: "object" } },
            metrics: { type: "array", items: { type: "object" } }
          }
        }
      }
    }
  };
}

/* ------------------------------------------------------------------ helpers */

function tableSchema(res: Resource): Record<string, unknown> {
  const cols = getTableColumns(res.table) as Record<string, SQLiteColumn>;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, col] of Object.entries(cols)) {
    properties[key] = columnSchema(key, col, res);
    if (col.notNull && !col.hasDefault && !SYSTEM.has(key)) required.push(key);
  }
  return { type: "object", properties, required };
}

const SYSTEM = new Set(["id", "tenantId", "createdAt", "updatedAt", "deletedAt"]);

function columnSchema(key: string, col: SQLiteColumn, res: Resource): Record<string, unknown> {
  const pii = res.pii && key in res.pii ? { description: "PII — masked unless the actor holds core:pii:view" } : {};
  if (key.endsWith("Json")) return { type: "string", description: "JSON document, stored as text", ...pii };
  if (key.endsWith("Minor")) return { type: "integer", description: "Minor units of the row's currency", ...pii };
  if (key.endsWith("Ppm")) return { type: "integer", description: "Parts per million; 12.5% = 125000", ...pii };
  if (key.endsWith("At") || key === "ts") return { type: "integer", description: "Epoch milliseconds", ...pii };
  const enumValues = (col as { enumValues?: readonly string[] }).enumValues;
  switch (col.dataType) {
    case "number":
      return { type: "integer", ...pii };
    case "boolean":
      return { type: "boolean", ...pii };
    default:
      return { type: "string", ...(enumValues?.length ? { enum: [...enumValues] } : {}), ...pii };
  }
}

function put(paths: Record<string, Record<string, unknown>>, path: string, method: string, op: unknown): void {
  (paths[path] ??= {})[method] = op;
}

function perm(permission?: string): { session: string[] }[] {
  // OpenAPI has no field for "which permission" — the scope list is where an
  // integrator looks, so the permission string goes there verbatim.
  const scopes = permission ? [permission] : [];
  return [{ session: scopes }, { apiKey: scopes } as unknown as { session: string[] }];
}

/** Every `{name}` in a hand-written path becomes a required string parameter. */
function pathParams(path: string): Record<string, unknown>[] {
  return [...path.matchAll(/\{(\w+)\}/g)].map(([, name]) =>
    name === "id"
      ? idParam()
      : { name, in: "path", required: true, schema: { type: "string" }, description: "Key" }
  );
}

function q(name: string, type: string, description: string): Record<string, unknown> {
  return { name, in: "query", required: false, schema: { type }, description };
}

function idParam(): Record<string, unknown> {
  return { name: "id", in: "path", required: true, schema: { type: "string" }, description: "ULID" };
}

function ok(schema: unknown): Record<string, unknown> {
  return { description: "Success", content: { "application/json": { schema } } };
}

function page(ref: unknown): Record<string, unknown> {
  return {
    "200": {
      description: "A page of rows",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { data: { type: "array", items: ref }, nextCursor: { type: "string", nullable: true } }
          }
        }
      }
    },
    ...errors()
  };
}

function errors(approvalPolicy?: string): Record<string, unknown> {
  const problem = { content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } };
  return {
    "400": { description: "Invalid request", ...problem },
    "401": { description: "No valid session", ...problem },
    "403": {
      description: approvalPolicy ? `Forbidden, or approval required (${approvalPolicy})` : "Forbidden",
      ...problem
    },
    "404": { description: "Not found, or not in this tenant", ...problem },
    "409": { description: "Conflict", ...problem },
    "429": { description: "Rate limited", ...problem }
  };
}

function schemaName(module: string, path: string): string {
  const pascal = path.split("-").map((p) => p[0]!.toUpperCase() + p.slice(1)).join("");
  return `${module[0]!.toUpperCase()}${module.slice(1)}${pascal}`;
}

function singular(path: string): string {
  const word = path.replace(/-/g, " ");
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ses")) return word.slice(0, -2);
  return word.endsWith("s") ? word.slice(0, -1) : word;
}
