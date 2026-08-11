import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson } from "@lyra/db";
import { notFound, type Ctx } from "@lyra/core";
import { onError } from "../mw.js";
// Side-effect only: REGISTRY is populated by resources.ts's register() calls at
// import time, exactly as index.ts does it. Without this the resolver has no
// prefix table to look a ref up in.
import "../resources.js";
import { nameRoutes } from "./names.js";
import type { App } from "../env.js";

// Screens were rendering machine refs as human copy: the ORBIT console's
// CUSTOMER column read `cu_01KE953TOO94353B2THXBAKPZ1`, its WITH column
// `user:us_…`, a handover's destination `team:tm_…`. Every consumer (web
// console, thread view, mobile) had the same gap, so the resolution belongs
// here once: refs in, display names out, each one gated by the caller's own
// read permission on the resource that ref points at.

function router(ctx: Ctx): Hono<App> {
  const app = new Hono<App>();
  app.onError(onError);
  app.notFound((c) => onError(notFound(c.req.path), c));
  app.use("*", async (c, next) => {
    c.set("ctx", ctx);
    await next();
  });
  app.route("/", nameRoutes);
  return app;
}

function baseCtx(db: Ctx["db"], grants: string[], locale = "en"): Ctx {
  return {
    db,
    tenantId: "t_test",
    actor: { kind: "user", id: "u_test", tenantId: "t_test", grants: [{ roleKey: "test", permissions: grants }] },
    requestId: "req_test",
    now: Date.now(),
    locale,
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  };
}

/** The only db chain names.ts uses: select().from().where().limit(). */
function fakeDb(rowsFor: (table: unknown) => unknown[]): Ctx["db"] {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({ limit: async () => rowsFor(table) })
      })
    })
  } as unknown as Ctx["db"];
}

const CUSTOMER = { id: "cu_1", nameJson: JSON.stringify({ en: "Falcon Freight", ar: "فالكون" }) };
const USER = { id: "us_1", name: "Layla Al Mansouri", email: "layla@gonxt.ae", passwordHash: "SECRET-HASH" };
const TEAM = { id: "tm_1", name: "Motor claims" };

const rows = (table: unknown): unknown[] => {
  const name = String((table as { [k: symbol]: unknown })[Symbol.for("drizzle:Name")] ?? "");
  if (name === "core_customers") return [CUSTOMER];
  if (name === "core_users") return [USER];
  if (name === "core_teams") return [TEAM];
  return [];
};

describe("GET /v1/names", () => {
  it("resolves bare and scoped refs to display names, per locale", async () => {
    const app = router(baseCtx(fakeDb(rows), ["*:*:*"]));
    const res = await app.fetch(new Request("http://api.test/?refs=cu_1,user:us_1,team:tm_1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { names: Record<string, string> };
    // Keyed by the ref the caller asked with, scope prefix and all, so a view
    // can look up exactly the string it holds.
    expect(body.names).toEqual({
      cu_1: "Falcon Freight",
      "user:us_1": "Layla Al Mansouri",
      "team:tm_1": "Motor claims"
    });
  });

  it("reads a localised name in the actor's locale", async () => {
    const app = router(baseCtx(fakeDb(rows), ["*:*:*"], "ar"));
    const res = await app.fetch(new Request("http://api.test/?refs=cu_1"));
    const body = (await res.json()) as { names: Record<string, string> };
    expect(body.names.cu_1).toBe("فالكون");
  });

  it("omits refs the caller may not read, and never queries them", async () => {
    const queried: string[] = [];
    const db = fakeDb((table) => {
      queried.push(String((table as { [k: symbol]: unknown })[Symbol.for("drizzle:Name")] ?? ""));
      return rows(table);
    });
    // core:teams:read only — a customer name is not this actor's to see.
    const app = router(baseCtx(db, ["core:teams:read"]));
    const res = await app.fetch(new Request("http://api.test/?refs=cu_1,team:tm_1"));
    const body = (await res.json()) as { names: Record<string, string> };
    expect(body.names).toEqual({ "team:tm_1": "Motor claims" });
    expect(queried).toEqual(["core_teams"]);
  });

  it("masks a PII display name without core:pii:view, and never leaks a secret column", async () => {
    const app = router(baseCtx(fakeDb(rows), ["core:users:read"]));
    const res = await app.fetch(new Request("http://api.test/?refs=user:us_1"));
    const body = (await res.json()) as { names: Record<string, string> };
    expect(body.names["user:us_1"]).toBe("Layla A•• M•••••••");
    expect(JSON.stringify(body)).not.toContain("SECRET-HASH");
  });

  it("ignores unknown prefixes and malformed refs rather than failing the batch", async () => {
    const app = router(baseCtx(fakeDb(rows), ["*:*:*"]));
    const res = await app.fetch(new Request("http://api.test/?refs=zz_9,notaref,team:tm_1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { names: Record<string, string> };
    expect(body.names).toEqual({ "team:tm_1": "Motor claims" });
  });

  it("400s an empty batch and one over the cap", async () => {
    const app = router(baseCtx(fakeDb(rows), ["*:*:*"]));
    expect((await app.fetch(new Request("http://api.test/?refs=%20"))).status).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => `team:tm_${i}`).join(",");
    expect((await app.fetch(new Request(`http://api.test/?refs=${many}`))).status).toBe(400);
  });
});
