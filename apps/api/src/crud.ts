import { Hono, type Context } from "hono";
import { and, asc, desc, eq, getTableColumns, gte, isNotNull, like, lte, or, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { id as newId } from "@lyra/db";
import {
  actorRef,
  assertTenant,
  audit,
  badRequest,
  conflict,
  emit,
  gate,
  mask,
  notFound,
  require_,
  scoped,
  scopedWithDeleted,
  sha256Hex,
  withIdempotency,
  type Ctx,
  type MODULES,
  type PiiMap
} from "@lyra/core";
import { created, decodeCursor, encodeCursor, listParams, parse, type Page } from "./http.js";
import type { App } from "./env.js";

// One CRUD implementation for 120-odd tables. Writing 120 routers by hand would
// mean 120 chances to forget the tenant filter, the audit row or the soft-delete
// check — the generator cannot forget. Anything a resource needs beyond CRUD is
// a hand-written route in its module router, mounted alongside this one.

type Columns = Record<string, SQLiteColumn>;

/** Columns the platform owns; a caller may never set them directly. */
const SYSTEM = new Set(["id", "tenantId", "createdAt", "updatedAt", "deletedAt"]);

export interface CrudPerms {
  read: string;
  create?: string;
  update?: string;
  remove?: string;
}

export interface CrudApproval {
  create?: string;
  update?: string;
  remove?: string;
  /** Column whose value drives threshold-based dual control. */
  amountField?: string;
}

export interface Resource {
  /** URL segment, e.g. "customers" — mounted under the module's base path. */
  path: string;
  table: SQLiteTable;
  /** ULID prefix, e.g. "cus". */
  idPrefix: string;
  module: (typeof MODULES)[number];
  perms: CrudPerms;
  /** Columns matched by `?q=`; text columns only. */
  searchable?: readonly string[];
  /** Masked on read unless the actor holds `core:pii:view`. */
  pii?: PiiMap;
  /**
   * Columns that must never leave the server on any read path — password
   * hashes, TOTP secrets, recovery codes, key hashes, webhook signing secrets.
   * The mirror of the `beforeWrite` strip: refusing them in the body while
   * `select *` hands them back is not a defence. Stripped from every list,
   * record, create, update and restore response, and from the audit before/after
   * images (audit rows are themselves readable with `core:audit:read`).
   *
   * Not `pii`: PII is masked and unmaskable by permission because someone with
   * a reason needs to see it. Nobody needs to see these, ever, at any level.
   */
  secretColumns?: readonly string[];
  /**
   * Row-level visibility, on top of permission and tenant. Permission answers
   * "may this actor read this kind of thing"; this answers "may they read *this
   * one*" — an owner-only dashboard, an export addressed to someone else.
   * Applied to list, record, update and delete alike: a row you cannot see must
   * not be editable or deletable by id either. A hidden row is 404, never 403 —
   * 403 confirms it exists.
   */
  rowVisible?: (ctx: Ctx, row: Record<string, unknown>) => boolean | Promise<boolean>;
  /** Rows may be created and read, never changed (consents, audit, journals). */
  immutable?: boolean;
  approval?: CrudApproval;
  /**
   * Columns that record *who did this* — filled with `actorRef(ctx)` on create
   * and refused in the body, exactly like `id` or `tenantId`. A client that can
   * type this field can attribute a legal hold to someone else, so nobody types
   * it. Columns that are a business assignment ("assigned to") are not this.
   */
  actorColumns?: readonly string[];
  /** Values forced onto every write, after validation. */
  fixed?: (ctx: Ctx, action: "create" | "update") => Record<string, unknown>;
  /** Last chance to validate or derive across fields. Throw to reject. */
  beforeWrite?: (
    ctx: Ctx,
    values: Record<string, unknown>,
    existing: Record<string, unknown> | null
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
  afterWrite?: (
    ctx: Ctx,
    row: Record<string, unknown>,
    action: "create" | "update" | "delete"
  ) => Promise<void>;
}

/* ------------------------------------------------------- shape from table */

function isJsonColumn(key: string): boolean {
  return key.endsWith("Json");
}

/**
 * A zod shape derived from the physical columns. Deriving beats maintaining a
 * parallel hand-written schema per table: the two cannot drift.
 */
function shapeOf(cols: Columns, mode: "create" | "update", owned: ReadonlySet<string>): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, col] of Object.entries(cols)) {
    if (owned.has(key)) continue;
    let leaf: z.ZodTypeAny;
    if (isJsonColumn(key)) {
      // JSON columns are TEXT; the module router validates the inner shape with
      // the zod types in @lyra/db/json where one exists.
      leaf = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown()), z.string()]);
    } else if (col.dataType === "number") {
      leaf = z.number();
    } else if (col.dataType === "boolean") {
      leaf = z.boolean();
    } else {
      leaf = z.string().max(10_000);
    }
    if (!col.notNull) leaf = leaf.nullable();
    const required = mode === "create" && col.notNull && !col.hasDefault;
    shape[key] = required ? leaf : leaf.optional();
  }
  return z.object(shape).strict();
}

/** JSON columns arrive as objects and are stored as TEXT. */
function serialize(cols: Columns, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = isJsonColumn(k) && v !== null && typeof v === "object" ? JSON.stringify(v) : v;
  }
  void cols;
  return out;
}

/** ...and are returned as objects, so a client never parses a string twice. */
function hydrate(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (isJsonColumn(k) && typeof v === "string") {
      try {
        out[k] = JSON.parse(v);
        continue;
      } catch {
        // A malformed JSON column is a data bug, not a request bug: return the
        // raw text rather than 500 an entire list because of one row.
      }
    }
    out[k] = v;
  }
  return out;
}

function column(cols: Columns, key: string | undefined): SQLiteColumn | undefined {
  if (!key) return undefined;
  const col = cols[key];
  return col;
}

/** Exact-match filters, with `a,b` meaning "either" and `!x` meaning "not". */
function filterSql(cols: Columns, filters: Record<string, string>): SQL[] {
  const parts: SQL[] = [];
  for (const [key, raw] of Object.entries(filters)) {
    const col = column(cols, key);
    if (!col) throw badRequest(`unknown filter column ${key}`);
    const values = raw.split(",").map((v) => v.trim()).filter(Boolean);
    if (!values.length) continue;
    const cast = (v: string): unknown => {
      if (col.dataType === "number") {
        const n = Number(v);
        if (!Number.isFinite(n)) throw badRequest(`${key} expects a number`);
        return n;
      }
      if (col.dataType === "boolean") return v === "true" || v === "1";
      return v;
    };
    const clause =
      values.length === 1
        ? eq(col, cast(values[0] as string))
        : (or(...values.map((v) => eq(col, cast(v)))) as SQL);
    parts.push(clause);
  }
  return parts;
}

/* -------------------------------------------------------------- the maker */

export function crudRouter(r: Resource): Hono<App> {
  const app = new Hono<App>();
  const cols = getTableColumns(r.table) as Columns;
  const actorColumns = r.actorColumns ?? [];
  // Same category as id/tenantId: the platform owns the value, so `.strict()`
  // turns a client that sends one into a 400 rather than a silent lie.
  const owned = new Set([...SYSTEM, ...actorColumns]);
  const createShape = shapeOf(cols, "create", owned);
  const updateShape = shapeOf(cols, "update", owned);
  const idCol = cols.id;
  const sortDefault = cols.createdAt ?? cols.id;
  if (!idCol) throw new Error(`${r.path}: table has no id column`);
  for (const key of actorColumns) if (!cols[key]) throw new Error(`${r.path}: no column ${key}`);
  const secretColumns = r.secretColumns ?? [];
  for (const key of secretColumns) if (!cols[key]) throw new Error(`${r.path}: no column ${key}`);
  const hasSoftDelete = Boolean(cols.deletedAt);
  const auditName = `${r.module}.${r.path.replace(/\//g, ".")}`;

  /** Drop the never-readable columns. Every path out of here goes through it. */
  const strip = (row: Record<string, unknown>): Record<string, unknown> => {
    if (!secretColumns.length) return row;
    const out = { ...row };
    for (const key of secretColumns) delete out[key];
    return out;
  };

  const view = (ctx: Ctx, row: Record<string, unknown>): Record<string, unknown> => {
    const h = strip(hydrate(row));
    return r.pii ? mask(ctx.actor, h, r.pii, ctx.tenantId) : h;
  };

  const load = async (ctx: Ctx, rowId: string, withDeleted = false): Promise<Record<string, unknown>> => {
    const where = withDeleted
      ? scopedWithDeleted(ctx, r.table as never, eq(idCol, rowId))
      : scoped(ctx, r.table as never, eq(idCol, rowId));
    const rows = (await ctx.db.select().from(r.table).where(where).limit(1)) as Record<string, unknown>[];
    const row = assertTenant(ctx, rows[0] as never, r.path) as Record<string, unknown>;
    // Every by-id path — read, update, delete, restore — comes through here, so
    // the predicate cannot be honoured on one verb and forgotten on the next.
    if (r.rowVisible && !(await r.rowVisible(ctx, row))) throw notFound(r.path);
    return row;
  };

  /* ------------------------------------------------------------- list */

  app.get("/", async (c) => {
    const ctx = c.get("ctx");
    require_(ctx.actor, r.perms.read, { tenantId: ctx.tenantId, module: r.module });
    const { list, filters } = listParams(c);

    if (list.deleted && !hasSoftDelete) throw badRequest(`${r.path} has no soft delete`);
    if (list.deleted) require_(ctx.actor, r.perms.remove ?? r.perms.read, { tenantId: ctx.tenantId });

    const sortCol = column(cols, list.sort) ?? sortDefault;
    if (!sortCol) throw badRequest("this resource cannot be sorted");
    const sortKey = list.sort && cols[list.sort] ? list.sort : sortColKey(cols, sortCol);
    const dir = list.order === "asc" ? asc : desc;

    const parts: (SQL | undefined)[] = filterSql(cols, filters);

    if (list.q && r.searchable?.length) {
      const term = `%${list.q.replace(/[%_]/g, "")}%`;
      const searches = r.searchable
        .map((k) => column(cols, k))
        .filter((col): col is SQLiteColumn => Boolean(col))
        .map((col) => like(col, term));
      if (searches.length) parts.push(or(...searches) as SQL);
    } else if (list.q) {
      throw badRequest(`${r.path} is not searchable`);
    }

    if (list.from !== undefined) parts.push(gte(sortCol, list.from));
    if (list.to !== undefined) parts.push(lte(sortCol, list.to));
    if (list.deleted) parts.push(isNotNull(cols.deletedAt as SQLiteColumn));

    if (list.cursor) {
      const { value, id } = decodeCursor(list.cursor);
      // Row-value comparison keeps the keyset a single index seek.
      parts.push(
        list.order === "asc"
          ? sql`(${sortCol}, ${idCol}) > (${value}, ${id})`
          : sql`(${sortCol}, ${idCol}) < (${value}, ${id})`
      );
    }

    const where = list.deleted
      ? scopedWithDeleted(ctx, r.table as never, ...parts)
      : scoped(ctx, r.table as never, ...parts);

    const rows = (await ctx.db
      .select()
      .from(r.table)
      .where(where)
      .orderBy(dir(sortCol), dir(idCol))
      .limit(list.limit + 1)) as Record<string, unknown>[];

    const window = rows.slice(0, list.limit);
    // The cursor advances over the rows the query returned, not the ones the
    // caller may see: hiding a row must shorten a page, never end the list early.
    const last = window[window.length - 1];
    const page = r.rowVisible
      ? (await Promise.all(window.map(async (row) => ((await r.rowVisible!(ctx, row)) ? row : null)))).filter(
          (row): row is Record<string, unknown> => row !== null
        )
      : window;
    const out: Page<Record<string, unknown>> = { data: page.map((row) => view(ctx, row)) };
    if (rows.length > list.limit && last) {
      out.cursor = encodeCursor((last[sortKey] ?? null) as string | number | null, last.id as string);
    }
    if (list.count) {
      // ponytail: counts what the WHERE matched, before rowVisible. A resource
      // with a predicate reports a total no smaller than the rows it hands back;
      // push the rule into SQL if a caller ever needs the count to be exact.
      const counted = (await ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(r.table)
        .where(where)) as { n: number }[];
      out.total = counted[0]?.n ?? 0;
    }
    return c.json(out);
  });

  /* -------------------------------------------------------------- read */

  app.get("/:id", async (c) => {
    const ctx = c.get("ctx");
    require_(ctx.actor, r.perms.read, { tenantId: ctx.tenantId, module: r.module });
    return c.json(view(ctx, await load(ctx, c.req.param("id"))));
  });

  /* ------------------------------------------------------------ create */

  if (r.perms.create) {
    const perm = r.perms.create;
    app.post("/", async (c) => {
      const ctx = c.get("ctx");
      require_(ctx.actor, perm, { tenantId: ctx.tenantId, module: r.module });
      const raw = await c.req.json().catch(() => {
        throw badRequest("request body is not valid JSON");
      });
      const input = parse(createShape, raw) as Record<string, unknown>;

      return withIdempotency(ctx, c.req.header("idempotency-key"), `POST ${c.req.path}`, input, async () => {
        let values: Record<string, unknown> = {
          ...input,
          ...Object.fromEntries(actorColumns.map((k) => [k, actorRef(ctx)])),
          ...(r.fixed?.(ctx, "create") ?? {})
        };
        if (r.beforeWrite) values = await r.beforeWrite(ctx, values, null);

        const rowId = newId(r.idPrefix, ctx.now);
        if (r.approval?.create) {
          await gate(ctx, {
            // The row does not exist yet, so the subject is the request, not the
            // id: a fresh id per attempt would raise a new approval every retry
            // and the approved one could never be spent.
            subjectRef: `${r.path}:new:${await sha256Hex(JSON.stringify(input))}`,
            policyKey: r.approval.create,
            ...(r.approval.amountField && typeof values[r.approval.amountField] === "number"
              ? { amountMinor: values[r.approval.amountField] as number }
              : {})
          });
        }

        const row: Record<string, unknown> = {
          ...serialize(cols, values),
          id: rowId,
          tenantId: ctx.tenantId,
          ...(cols.createdAt ? { createdAt: ctx.now } : {}),
          ...(cols.updatedAt ? { updatedAt: ctx.now } : {})
        };

        try {
          await ctx.db.insert(r.table).values(row as never);
        } catch (e) {
          // The unique indexes are the real constraint; surfacing them as 409
          // keeps "already exists" out of the 500 bucket.
          if (String(e).includes("UNIQUE")) throw conflict(`${r.path} already exists`);
          throw e;
        }

        await audit(ctx, { action: `${auditName}.create`, subjectRef: rowId, after: strip(values) });
        await emit(ctx, { module: r.module, type: `${auditName}.created`, subject: rowId, data: { id: rowId } });
        await r.afterWrite?.(ctx, row, "create");
        return created(c, { ...view(ctx, row), id: rowId });
      });
    });
  }

  /* ------------------------------------------------------------ update */

  if (r.perms.update && !r.immutable) {
    const perm = r.perms.update;
    const patch = async (c: Context<App>) => {
      const ctx = c.get("ctx");
      require_(ctx.actor, perm, { tenantId: ctx.tenantId, module: r.module });
      const rowId = c.req.param("id") as string;
      const before = await load(ctx, rowId);

      const raw = await c.req.json().catch(() => {
        throw badRequest("request body is not valid JSON");
      });
      let values = parse(updateShape, raw) as Record<string, unknown>;
      values = { ...values, ...(r.fixed?.(ctx, "update") ?? {}) };
      if (r.beforeWrite) values = await r.beforeWrite(ctx, values, before);
      if (!Object.keys(values).length) throw badRequest("no fields to update");

      if (r.approval?.update) {
        await gate(ctx, {
          policyKey: r.approval.update,
          subjectRef: `${r.path}:${rowId}`,
          ...(r.approval.amountField && typeof values[r.approval.amountField] === "number"
            ? { amountMinor: values[r.approval.amountField] as number }
            : {})
        });
      }

      await ctx.db
        .update(r.table)
        .set({ ...serialize(cols, values), ...(cols.updatedAt ? { updatedAt: ctx.now } : {}) } as never)
        .where(scoped(ctx, r.table as never, eq(idCol, rowId)));

      const after = await load(ctx, rowId);
      await audit(ctx, {
        action: `${auditName}.update`,
        subjectRef: rowId,
        // An audit row is readable with `core:audit:read`; a before-image
        // carrying a password hash would put the credential back on a read path.
        before: strip(hydrate(before)),
        after: strip(hydrate(after))
      });
      await emit(ctx, { module: r.module, type: `${auditName}.updated`, subject: rowId, data: { id: rowId } });
      await r.afterWrite?.(ctx, after, "update");
      return c.json(view(ctx, after));
    };
    app.patch("/:id", patch as never);
    // PUT is accepted as a full-body PATCH: partial-update semantics are the
    // only ones that are safe against a concurrent editor.
    app.put("/:id", patch as never);
  }

  /* ------------------------------------------------------------ delete */

  if (r.perms.remove && !r.immutable) {
    const perm = r.perms.remove;
    app.delete("/:id", async (c) => {
      const ctx = c.get("ctx");
      require_(ctx.actor, perm, { tenantId: ctx.tenantId, module: r.module });
      const rowId = c.req.param("id");
      const before = await load(ctx, rowId);

      if (r.approval?.remove) await gate(ctx, { policyKey: r.approval.remove, subjectRef: `${r.path}:${rowId}` });

      if (hasSoftDelete) {
        await ctx.db
          .update(r.table)
          .set({ deletedAt: ctx.now, ...(cols.updatedAt ? { updatedAt: ctx.now } : {}) } as never)
          .where(scoped(ctx, r.table as never, eq(idCol, rowId)));
      } else {
        await ctx.db.delete(r.table).where(scoped(ctx, r.table as never, eq(idCol, rowId)));
      }

      await audit(ctx, { action: `${auditName}.delete`, subjectRef: rowId, before: strip(hydrate(before)) });
      await emit(ctx, { module: r.module, type: `${auditName}.deleted`, subject: rowId, data: { id: rowId } });
      await r.afterWrite?.(ctx, before, "delete");
      return c.body(null, 204);
    });

    if (hasSoftDelete) {
      app.post("/:id/restore", async (c) => {
        const ctx = c.get("ctx");
        require_(ctx.actor, perm, { tenantId: ctx.tenantId, module: r.module });
        const rowId = c.req.param("id");
        const before = await load(ctx, rowId, true);
        if (before.deletedAt === null) throw conflict(`${r.path} is not deleted`);
        await ctx.db
          .update(r.table)
          .set({ deletedAt: null, ...(cols.updatedAt ? { updatedAt: ctx.now } : {}) } as never)
          .where(scopedWithDeleted(ctx, r.table as never, eq(idCol, rowId)));
        await audit(ctx, { action: `${auditName}.restore`, subjectRef: rowId, before: strip(hydrate(before)) });
        return c.json(view(ctx, await load(ctx, rowId)));
      });
    }
  }

  return app;
}

/** Reverse the column map to find the property name for a column instance. */
function sortColKey(cols: Columns, col: SQLiteColumn): string {
  for (const [k, v] of Object.entries(cols)) if (v === col) return k;
  throw notFound("sort column");
}

/** Mount a list of resources on a router under their own paths. */
export function mountAll(app: Hono<App>, resources: readonly Resource[]): Hono<App> {
  for (const r of resources) app.route(`/${r.path}`, crudRouter(r));
  return app;
}

/** Every resource the API exposes — the OpenAPI generator walks this. */
export const REGISTRY: Resource[] = [];

export function register(...resources: Resource[]): Resource[] {
  REGISTRY.push(...resources);
  return resources;
}

export { and, eq };
