import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq, getTableColumns } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson, schema } from "@lyra/db";
import { decide, notFound, type Ctx } from "@lyra/core";
import { crudRouter, type Resource } from "./crud.js";
import { onError } from "./mw.js";
import { BY_MODULE } from "./resources.js";
import { scoutRoutes } from "./routes/scout.js";
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
  // Mirrors index.ts: an unmatched route is a JSON 404 in prod, not Hono's
  // default plain-text fallback — a bare test router without this returns
  // "404 Not Found" text, which crashes send()'s JSON.parse before a status
  // assertion is ever reached.
  app.notFound((c) => onError(notFound(c.req.path), c));
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

/* --------------------------------------------- ledger money tables (docs/19) */

const ledgerResource = (path: string): Resource => {
  const r = BY_MODULE.ledger?.find((x) => x.path === path);
  if (!r) throw new Error(`no ledger/${path} resource`);
  return r;
};

describe("ledger txns and payments are read-only through generic CRUD", () => {
  // CLAUDE.md §12: money moves through POST /v1/ledger/txn/:type — a state
  // machine, idempotency key and balanced journal. A generated create that
  // accepts client-supplied `state` and `grossMinor` is a second, unguarded
  // mint for money rows.
  it("txns declares no write permission", () => {
    const r = ledgerResource("txns");
    expect(r.perms.create).toBeUndefined();
    expect(r.perms.update).toBeUndefined();
    expect(r.perms.remove).toBeUndefined();
  });

  it("payments declares no write permission", () => {
    const r = ledgerResource("payments");
    expect(r.perms.create).toBeUndefined();
    expect(r.perms.update).toBeUndefined();
    expect(r.perms.remove).toBeUndefined();
  });

  it("POST /txns and POST /payments do not exist as routes", async () => {
    const txn = await send(router(ledgerResource("txns")), "POST", "/", {
      type: "BIND",
      idempotencyKey: "raw-mint",
      state: "settled",
      actorKind: "user",
      actorId: "u_test",
      currency: "AED",
      baseCurrency: "AED",
      grossMinor: 1_000_00
    });
    expect(txn.status).toBe(404);
    const pay = await send(router(ledgerResource("payments")), "POST", "/", {
      direction: "in",
      method: "bank",
      amountMinor: 1_000_00,
      currency: "AED",
      state: "settled"
    });
    expect(pay.status).toBe(404);
  });
});

describe("money columns in the generated shape", () => {
  const invoices = () => router(ledgerResource("invoices"));
  const invoice = (n: number, over: Record<string, unknown> = {}) => ({
    number: `INV-SHAPE-${n}`,
    customerRef: "cus_shape",
    subtotalMinor: 1000,
    totalMinor: 1000,
    currency: "AED",
    linesJson: {},
    ...over
  });

  it("refuses a negative minor amount", async () => {
    const res = await send(invoices(), "POST", "/", invoice(1, { subtotalMinor: -1000, totalMinor: -1000 }));
    expect(res.status).toBe(400);
  });

  it("refuses a fractional minor amount", async () => {
    const res = await send(invoices(), "POST", "/", invoice(2, { totalMinor: 10.5 }));
    expect(res.status).toBe(400);
  });

  it("still accepts a negative value on a declared signed column (recon delta)", async () => {
    await ctx.db.insert(schema.ledgerReconMatches).values({
      id: "rcm_signed",
      tenantId: ctx.tenantId,
      runId: "rcr_x",
      amountMinor: 5000,
      currency: "AED",
      method: "tolerance",
      createdAt: NOW
    });
    const res = await send(router(ledgerResource("recon-matches")), "PATCH", "/rcm_signed", { deltaMinor: -180 });
    expect(res.status).toBe(200);
    expect(res.body.deltaMinor).toBe(-180);
  });
});

describe("invoice state machine through generic CRUD", () => {
  const invoices = () => router(ledgerResource("invoices"));
  const create = async (n: number, over: Record<string, unknown> = {}) => {
    const res = await send(invoices(), "POST", "/", {
      number: `INV-FLOW-${n}`,
      customerRef: "cus_flow",
      subtotalMinor: 1000,
      totalMinor: 1000,
      currency: "AED",
      linesJson: {},
      ...over
    });
    expect(res.status).toBe(201);
    return res.body as { id: string; state: string };
  };

  it("a client cannot mint an already-paid invoice", async () => {
    const row = await create(1, { state: "paid" });
    expect(row.state).toBe("draft");
  });

  it("draft cannot jump straight to paid", async () => {
    const row = await create(2);
    const res = await send(invoices(), "PATCH", `/${row.id}`, { state: "paid" });
    expect(res.status).toBe(400);
  });

  it("draft -> issued -> paid walks the legal path", async () => {
    const row = await create(3);
    const issued = await send(invoices(), "PATCH", `/${row.id}`, { state: "issued" });
    expect(issued.status).toBe(200);
    expect(issued.body.state).toBe("issued");
    const paid = await send(invoices(), "PATCH", `/${row.id}`, { state: "paid" });
    expect(paid.status).toBe(200);
    expect(paid.body.state).toBe("paid");
  });

  it("a paid invoice cannot be reopened to draft, and void is terminal", async () => {
    const paidRow = await create(4);
    await send(invoices(), "PATCH", `/${paidRow.id}`, { state: "issued" });
    await send(invoices(), "PATCH", `/${paidRow.id}`, { state: "paid" });
    expect((await send(invoices(), "PATCH", `/${paidRow.id}`, { state: "draft" })).status).toBe(400);

    const voidRow = await create(5);
    expect((await send(invoices(), "PATCH", `/${voidRow.id}`, { state: "void" })).status).toBe(200);
    expect((await send(invoices(), "PATCH", `/${voidRow.id}`, { state: "issued" })).status).toBe(400);
  });
});

/* ------------------------------------------------------------ notifications */

describe("notifications are visible to their addressee only", () => {
  // The hand-written inbox (routes/me.ts) filters on userId = actor; the CRUD
  // list must agree or any reader lists every user's notifications tenant-wide.
  const resource = (): Resource => {
    const r = BY_MODULE.core?.find((x) => x.path === "notifications");
    if (!r) throw new Error("no core/notifications resource");
    return r;
  };

  beforeAll(async () => {
    await ctx.db.insert(schema.notifications).values([
      { id: "ntf_mine", tenantId: ctx.tenantId, userId: "u_test", kind: "chip", titleKey: "t.mine", createdAt: NOW },
      { id: "ntf_theirs", tenantId: ctx.tenantId, userId: "u_other", kind: "chip", titleKey: "t.theirs", createdAt: NOW }
    ]);
  });

  it("lists only the acting user's notifications", async () => {
    const res = await send(router(resource()), "GET", "/");
    expect(res.status).toBe(200);
    const ids = (res.body.data as { id: string }[]).map((n) => n.id);
    expect(ids).toContain("ntf_mine");
    expect(ids).not.toContain("ntf_theirs");
  });

  it("404s another user's notification by id", async () => {
    const app = router(resource());
    expect((await send(app, "GET", "/ntf_mine")).status).toBe(200);
    expect((await send(app, "GET", "/ntf_theirs")).status).toBe(404);
  });
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

describe("scout/data-products: ROLE-028 hides drafts and suspended products from read-only viewers", () => {
  const resource = () => {
    const r = BY_MODULE.scout?.find((x) => x.path === "data-products");
    if (!r) throw new Error("no scout/data-products resource");
    return r;
  };
  // provider.viewer: scout:data_products:read only, no :publish.
  const viewer: Ctx["actor"] = {
    kind: "user",
    id: "u_provider_viewer",
    tenantId: "t_test",
    grants: [{ roleKey: "provider.viewer", permissions: ["scout:data_products:read", "scout:panel_bench:read"] }]
  };

  beforeAll(async () => {
    await ctx.db.insert(schema.scoutDataProducts).values([
      {
        id: "dtp_draft",
        tenantId: "t_test",
        name: "draft product",
        definitionJson: "{}",
        consentBasis: "contract",
        status: "draft",
        createdAt: NOW,
        updatedAt: NOW
      },
      {
        id: "dtp_published",
        tenantId: "t_test",
        name: "published product",
        definitionJson: "{}",
        consentBasis: "contract",
        status: "published",
        createdAt: NOW,
        updatedAt: NOW
      },
      {
        id: "dtp_suspended",
        tenantId: "t_test",
        name: "suspended product",
        definitionJson: "{}",
        consentBasis: "contract",
        status: "suspended",
        createdAt: NOW,
        updatedAt: NOW
      }
    ]);
  });

  it("a provider.viewer only sees the published product in the list", async () => {
    const app = router(resource(), { actor: viewer });
    const res = await send(app, "GET", "/");
    expect(res.status).toBe(200);
    expect((res.body.data as { id: string }[]).map((p) => p.id)).toEqual(["dtp_published"]);
  });

  it("a provider.viewer gets 404, not the row, for a draft or suspended product by id", async () => {
    const app = router(resource(), { actor: viewer });
    expect((await send(app, "GET", "/dtp_published")).status).toBe(200);
    expect((await send(app, "GET", "/dtp_draft")).status).toBe(404);
    expect((await send(app, "GET", "/dtp_suspended")).status).toBe(404);
  });

  it("a publisher (scout:data_products:publish) still sees drafts — they author them", async () => {
    const publisher: Ctx["actor"] = {
      kind: "user",
      id: "u_scout_lead",
      tenantId: "t_test",
      grants: [{ roleKey: "scout.admin", permissions: ["scout:*:*"] }]
    };
    const res = await send(router(resource(), { actor: publisher }), "GET", "/dtp_draft");
    expect(res.status).toBe(200);
  });
});

describe("scout negotiation pack: provider.viewer cannot download LYRA's own negotiation prep", () => {
  // scout:panel_bench:read is held by provider.viewer too (rbac.ts), and the
  // pack bakes every provider's price index/win-rate into one PDF — so the
  // route must gate on a permission provider.viewer does not hold, not on
  // panel_bench:read. See routes/scout.ts's negotiation-pack handler.
  const scoutApp = (over: Partial<Ctx> = {}): Hono<App> => {
    const app = new Hono<App>();
    app.onError(onError);
    app.notFound((c) => onError(notFound(c.req.path), c));
    app.use("*", async (c, next) => {
      c.set("ctx", { ...ctx, ...over });
      await next();
    });
    app.route("/", scoutRoutes);
    return app;
  };

  it("a provider.viewer (panel_bench:read, no whitespaces:promote) is refused", async () => {
    const viewer: Ctx["actor"] = {
      kind: "user",
      id: "u_provider_viewer",
      tenantId: "t_test",
      grants: [{ roleKey: "provider.viewer", permissions: ["scout:data_products:read", "scout:panel_bench:read"] }]
    };
    const res = await send(scoutApp({ actor: viewer }), "GET", "/panel-bench/negotiation-pack");
    expect(res.status).toBe(403);
  });

  it("scout.lead (scout:whitespaces:promote) still gets the PDF", async () => {
    const lead: Ctx["actor"] = {
      kind: "user",
      id: "u_scout_lead",
      tenantId: "t_test",
      grants: [{ roleKey: "scout.lead", permissions: ["scout:panel_bench:read", "scout:whitespaces:promote"] }]
    };
    // A PDF response, not JSON — send()'s JSON.parse would choke on it.
    const res = await scoutApp({ actor: lead }).fetch(
      new Request("http://api.test/panel-bench/negotiation-pack")
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });
});

describe("scout whitespace promotion goes through the approval engine, not a bare PATCH", () => {
  // docs/modules/scout.md §4: "whitespace approvals (promote/park)" — a PATCH
  // to status must raise (and require deciding) a scout.whitespace_promote
  // approval, same as offerings' publish gate.
  const resource = () => {
    const r = BY_MODULE.scout?.find((x) => x.path === "whitespaces");
    if (!r) throw new Error("no scout/whitespaces resource");
    return r;
  };

  beforeAll(async () => {
    await ctx.db.insert(schema.scoutWhitespaces).values({
      id: "wsp_gate",
      tenantId: "t_test",
      description: "underinsured fleets, 20-49 vehicles",
      status: "candidate",
      createdAt: NOW,
      updatedAt: NOW
    });
  });

  it("refuses the first PATCH with approval_required and leaves the row unchanged", async () => {
    const res = await send(router(resource()), "PATCH", "/wsp_gate", { status: "validated" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("approval_required");
    expect(res.body.policy_key).toBe("scout.whitespace_promote");
    expect(res.body.approval_id).toBeTruthy();

    const [row] = await ctx.db.select().from(schema.scoutWhitespaces).where(eq(schema.scoutWhitespaces.id, "wsp_gate"));
    expect(row?.status).toBe("candidate");
  });

  it("promotes once the approval is decided", async () => {
    const first = await send(router(resource()), "PATCH", "/wsp_gate", { status: "validated" });
    const approvalId = first.body.approval_id as string;
    await decide(ctx, approvalId, "approved");

    const res = await send(router(resource()), "PATCH", "/wsp_gate", { status: "validated" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("validated");
  });
});

describe("north briefings are not generically creatable", () => {
  // docs/modules/north.md §2.2: every numeric claim in a briefing is machine-
  // verified against the metric layer inside engines/narrator.ts's
  // generateBriefing(). A generic create would let anyone holding
  // north:briefings:generate POST an arbitrary narrativeRef straight to
  // "review" with no verification behind it — the real path is POST
  // /v1/north/briefings/generate (routes/north.ts).
  const resource = () => {
    const r = BY_MODULE.north?.find((x) => x.path === "briefings");
    if (!r) throw new Error("no north/briefings resource");
    return r;
  };

  it("declares no create permission", () => {
    expect(resource().perms.create).toBeUndefined();
  });

  it("POST /briefings does not exist as a route", async () => {
    const res = await send(router(resource()), "POST", "/", {
      date: "2026-01-06",
      audience: "exec",
      locale: "en",
      narrativeRef: "everything is fine, trust me",
      status: "review",
      generatedBy: "ai",
      approvedBy: "u_test"
    });
    expect(res.status).toBe(404);
  });
});
