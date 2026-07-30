import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { getTableColumns } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson, schema } from "@lyra/db";
import type { Ctx } from "@lyra/core";
import { crudRouter, type Resource } from "./crud.js";
import { onError } from "./mw.js";
import { BY_MODULE } from "./resources.js";
import type { App } from "./env.js";

// Three classes of registry bug, none of which any other test can see:
//
// 1. A declared `amountField` that names no column is silent: the approval is
//    raised with no amount and a reviewer signs off on a money change without
//    seeing what it is worth (CLAUDE.md §12).
// 2. A `pii` key that names no column masks nothing — `orbit/messages` declared
//    `body` where the column is `content`, so every message body was readable
//    without `core:pii:view`.
// 3. A `secretColumns` entry that names no column strips nothing.
//
// All three fail open and all three look right in review. So the declarations
// are checked against the real Drizzle columns here — and, for the secrets, the
// declaration is not trusted either: the router is driven and the response is
// searched for the column and its value.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const NOW = Date.UTC(2026, 5, 15, 12);

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

const columnsOf = (r: Resource): Record<string, SQLiteColumn> =>
  getTableColumns(r.table) as Record<string, SQLiteColumn>;

const all = (): { module: string; r: Resource }[] =>
  Object.entries(BY_MODULE).flatMap(([module, rs]) => rs.map((r) => ({ module, r })));

describe("resource registry", () => {
  it("every declared amountField names a real column on its table", () => {
    const bad: string[] = [];
    for (const { module, r } of all()) {
      const field = r.approval?.amountField;
      if (field && !columnsOf(r)[field]) bad.push(`${module}/${r.path}: ${field}`);
    }
    expect(bad).toEqual([]);
  });

  it("every declared actorColumn names a real column on its table", () => {
    const bad: string[] = [];
    for (const { module, r } of all()) {
      const cols = columnsOf(r);
      for (const key of r.actorColumns ?? []) if (!cols[key]) bad.push(`${module}/${r.path}: ${key}`);
    }
    expect(bad).toEqual([]);
  });

  it("every declared pii key names a real column on its table", () => {
    const bad: string[] = [];
    for (const { module, r } of all()) {
      const cols = columnsOf(r);
      // A nested key like `nameJson.first` masks inside a JSON column; only the
      // root has to be a column.
      for (const key of Object.keys(r.pii ?? {})) {
        const [root = ""] = key.split(".");
        if (!cols[root]) bad.push(`${module}/${r.path}: ${key}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every declared secretColumn names a real column on its table", () => {
    const bad: string[] = [];
    for (const { module, r } of all()) {
      const cols = columnsOf(r);
      for (const key of r.secretColumns ?? []) if (!cols[key]) bad.push(`${module}/${r.path}: ${key}`);
    }
    expect(bad).toEqual([]);
  });
});

/* --------------------------------------------------- the router, driven */

let ctx: Ctx;

/** The generated router for one resource, with a fixed all-permissions context. */
function router(r: Resource, over: Partial<Ctx> = {}): Hono<App> {
  const app = new Hono<App>();
  app.onError(onError);
  app.use("*", async (c, next) => {
    c.set("ctx", { ...ctx, ...over });
    await next();
  });
  app.route("/", crudRouter(r));
  return app;
}

const send = async (app: Hono<App>, method: string, path: string, payload?: unknown) => {
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
    })
  );
  const text = await res.text();
  return { status: res.status, text, body: text ? (JSON.parse(text) as any) : null };
};

/**
 * A row that satisfies the table's NOT NULLs and nothing more. Hand-writing one
 * per resource would mean the loop below stops covering new resources the day
 * someone adds one, which is precisely when it is needed.
 */
function fillerRow(r: Resource, id: string, marker: string): Record<string, unknown> {
  const row: Record<string, unknown> = { id, tenantId: ctx.tenantId };
  for (const [key, col] of Object.entries(columnsOf(r))) {
    if (key === "id" || key === "tenantId" || (!col.notNull && !(r.secretColumns ?? []).includes(key))) continue;
    if (col.hasDefault && !(r.secretColumns ?? []).includes(key)) continue;
    row[key] =
      col.dataType === "number"
        ? NOW
        : col.dataType === "boolean"
          ? false
          : (r.secretColumns ?? []).includes(key)
            ? marker
            : key.endsWith("Json")
              ? "{}"
              : `x_${key}`;
  }
  return row;
}

beforeAll(async () => {
  const client = createClient({ url: ":memory:" });
  for (const stmt of statements()) await client.execute(stmt);
  ctx = {
    db: drizzle(client) as unknown as Ctx["db"],
    tenantId: "t_test",
    actor: { kind: "user", id: "u_test", tenantId: "t_test", grants: [{ roleKey: "test", permissions: ["*:*:*"] }] },
    requestId: "req_test",
    now: NOW,
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  };
}, 120_000);

describe("secret columns never reach a read response", () => {
  // Not "is it declared" — a declaration checked against a broken map passes.
  // The row is written with a known value and every read surface is searched for
  // the column name and for the value itself.
  const declaring = () => all().filter(({ r }) => (r.secretColumns ?? []).length);

  it("covers the credential tables", () => {
    expect(declaring().map(({ module, r }) => `${module}/${r.path}`).sort()).toEqual([
      "core/api-keys",
      "core/users",
      "core/webhooks"
    ]);
  });

  for (const { module, r } of Object.entries(BY_MODULE).flatMap(([m, rs]) =>
    rs.filter((x) => (x.secretColumns ?? []).length).map((x) => ({ module: m, r: x }))
  )) {
    it(`${module}/${r.path}: list and record hide ${(r.secretColumns ?? []).join(", ")}`, async () => {
      // No "secret"/"hash" in the id: the assertions below are substring checks.
      const rowId = `${r.idPrefix}_leakcheck`;
      const marker = "SECRET-MARKER-DO-NOT-LEAK";
      await ctx.db.insert(r.table).values(fillerRow(r, rowId, marker) as never);

      const app = router(r);
      for (const path of ["/", `/${rowId}`]) {
        const res = await send(app, "GET", path);
        expect(res.status).toBe(200);
        expect(res.text).not.toContain(marker);
        for (const key of r.secretColumns ?? []) expect(res.text).not.toContain(key);
      }

      // ...and the audit before/after images, which are themselves readable
      // through `core/audit-log`.
      const editable = Object.entries(columnsOf(r)).find(
        ([key, col]) =>
          col.dataType === "string" &&
          !key.endsWith("Json") &&
          !["id", "tenantId"].includes(key) &&
          !(r.secretColumns ?? []).includes(key)
      );
      if (r.perms.update && !r.immutable && editable) {
        const patched = await send(app, "PATCH", `/${rowId}`, { [editable[0]]: "x_patched" });
        expect(patched.status).toBe(200);
        expect(patched.text).not.toContain(marker);
        const audits = await ctx.db.select().from(schema.auditLog);
        expect(JSON.stringify(audits)).not.toContain(marker);
      }
    });
  }
});

describe("rowVisible", () => {
  // No production resource declares one yet (the analytics predicates are not
  // exported — see the report), so the seam is proved on a synthetic resource:
  // what matters is that all four generated paths agree about one hidden row.
  const teams: Resource = {
    path: "visible-teams",
    table: schema.teams,
    idPrefix: "tm",
    module: "core",
    perms: { read: "core:teams:read", create: "core:teams:write", update: "core:teams:write", remove: "core:teams:write" },
    rowVisible: (_ctx, row) => row.name !== "hidden"
  };

  beforeAll(async () => {
    await ctx.db.insert(schema.teams).values([
      { id: "tm_seen", tenantId: "t_test", name: "seen", createdAt: NOW },
      { id: "tm_hidden", tenantId: "t_test", name: "hidden", createdAt: NOW }
    ]);
  });

  it("hides the row from the list", async () => {
    const res = await send(router(teams), "GET", "/");
    expect(res.status).toBe(200);
    expect((res.body.data as { id: string }[]).map((t) => t.id)).toEqual(["tm_seen"]);
  });

  it("answers 404 — not 403 — on the row's id, so the list and the record agree", async () => {
    const app = router(teams);
    expect((await send(app, "GET", "/tm_seen")).status).toBe(200);
    expect((await send(app, "GET", "/tm_hidden")).status).toBe(404);
  });

  it("refuses to update or delete a row the caller cannot see", async () => {
    const app = router(teams);
    expect((await send(app, "PATCH", "/tm_hidden", { name: "mine now" })).status).toBe(404);
    expect((await send(app, "DELETE", "/tm_hidden")).status).toBe(404);
    const rows = await ctx.db.select().from(schema.teams);
    expect(rows.find((t) => t.id === "tm_hidden")?.name).toBe("hidden");
  });
});
