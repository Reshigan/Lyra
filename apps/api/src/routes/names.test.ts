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
const CASE = { id: "cas_1", ref: "CASE-1042" };
const PROVIDER = { id: "pv_1", name: "Oryx Insurance", code: "ORYX" };

const rows = (table: unknown): unknown[] => {
  const name = String((table as { [k: symbol]: unknown })[Symbol.for("drizzle:Name")] ?? "");
  if (name === "core_customers") return [CUSTOMER];
  // Both mints live in core_users: the registry's `us` and the legacy `usr`.
  if (name === "core_users") return [USER, { ...USER, id: "usr_1" }];
  if (name === "core_teams") return [TEAM];
  if (name === "axis_cases") return [CASE];
  if (name === "core_providers") return [PROVIDER];
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

  it("uses a case's human ref as its display text", async () => {
    // A case has no name column — `ref` is the short reference an operator says
    // out loud, and the exceptions queue listed the ULID instead.
    const app = router(baseCtx(fakeDb(rows), ["*:*:*"]));
    const res = await app.fetch(new Request("http://api.test/?refs=cas_1"));
    const body = (await res.json()) as { names: Record<string, string> };
    expect(body.names.cas_1).toBe("CASE-1042");
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

  it("names colleagues and teams for any signed-in actor, still masking PII", async () => {
    // The ORBIT console's WITH column and its handover FROM/TO read
    // `user:us_01KE…VNK5` at an agent, because orbit.agent holds no
    // core:users:read — nobody grants staff-admin rights to answer a chat.
    // Who is holding your conversation is not an admin fact; the directory is
    // readable to anyone signed in, with the same masking as every other read.
    const app = router(baseCtx(fakeDb(rows), ["orbit:conversations:read"]));
    const res = await app.fetch(new Request("http://api.test/?refs=user:us_1,team:tm_1,cu_1"));
    const body = (await res.json()) as { names: Record<string, string> };
    expect(body.names).toEqual({
      "user:us_1": "Layla A•• M•••••••",
      "team:tm_1": "Motor claims"
    });
  });

  it("names a carrier for an analyst who holds no catalogue rights", async () => {
    // SCOUT's panel table lists one row per carrier under a column headed
    // CARRIER and rendered `pv_01KE…` in it: naming a provider needed
    // core:providers:read, a catalogue-admin grant no analyst holds (ADR-0048).
    const app = router(baseCtx(fakeDb(rows), ["scout:panel_bench:read"]));
    const res = await app.fetch(new Request("http://api.test/?refs=pv_1"));
    const body = (await res.json()) as { names: Record<string, string> };
    expect(body.names.pv_1).toBe("Oryx Insurance");
  });

  it("masks a PII display name without core:pii:view, and never leaks a secret column", async () => {
    const app = router(baseCtx(fakeDb(rows), ["core:users:read"]));
    const res = await app.fetch(new Request("http://api.test/?refs=user:us_1"));
    const body = (await res.json()) as { names: Record<string, string> };
    expect(body.names["user:us_1"]).toBe("Layla A•• M•••••••");
    expect(JSON.stringify(body)).not.toContain("SECRET-HASH");
  });

  it("resolves users minted under the legacy `usr_` prefix", async () => {
    // Users were minted two ways — the registry's `us` and a hand-written
    // `usr` in staff invites and SSO provisioning — so every staff-invited
    // person was permanently unnameable. New ids are `us_`; the alias is what
    // keeps the rows already on disk readable.
    const app = router(baseCtx(fakeDb(rows), ["*:*:*"]));
    const res = await app.fetch(new Request("http://api.test/?refs=users:usr_1"));
    const body = (await res.json()) as { names: Record<string, string> };
    expect(body.names["users:usr_1"]).toBe("Layla Al Mansouri");
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
