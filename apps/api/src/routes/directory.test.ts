import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson } from "@lyra/db";
import { notFound, type Ctx } from "@lyra/core";
import { onError } from "../mw.js";
import { directoryRoutes } from "./directory.js";
import type { App } from "../env.js";

// Five screens asked a human to type `user:us_01KE…VNK5` into a text box to
// assign a case, a claim or a handover. Nobody knows their colleague's ULID,
// so those fields were unusable — the assignment either never happened or
// happened to a typo. This is the list the picker on those screens reads.

function router(ctx: Ctx): Hono<App> {
  const app = new Hono<App>();
  app.onError(onError);
  app.notFound((c) => onError(notFound(c.req.path), c));
  app.use("*", async (c, next) => {
    c.set("ctx", ctx);
    await next();
  });
  app.route("/", directoryRoutes);
  return app;
}

function baseCtx(db: Ctx["db"], grants: string[]): Ctx {
  return {
    db,
    tenantId: "t_test",
    actor: { kind: "user", id: "u_test", tenantId: "t_test", grants: [{ roleKey: "test", permissions: grants }] },
    requestId: "req_test",
    now: Date.now(),
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  };
}

const USERS = [
  { id: "us_1", name: "Layla Al Mansouri", email: "layla@gonxt.ae", status: "active", passwordHash: "SECRET-HASH" },
  { id: "us_2", name: "Sara Al Nasser", email: "sara@gonxt.ae", status: "active", passwordHash: "SECRET-HASH" }
];
const TEAMS = [{ id: "tm_1", name: "Motor claims" }];

/** The only db chain directory.ts uses: select().from().where().orderBy().limit(). */
function fakeDb(rowsFor: (table: unknown) => unknown[], seen?: string[]): Ctx["db"] {
  return {
    select: () => ({
      from: (table: unknown) => {
        seen?.push(String((table as { [k: symbol]: unknown })[Symbol.for("drizzle:Name")] ?? ""));
        return {
          where: () => ({ orderBy: () => ({ limit: async () => rowsFor(table) }) })
        };
      }
    })
  } as unknown as Ctx["db"];
}

const rows = (table: unknown): unknown[] => {
  const name = String((table as { [k: symbol]: unknown })[Symbol.for("drizzle:Name")] ?? "");
  if (name === "core_users") return USERS;
  if (name === "core_teams") return TEAMS;
  return [];
};

describe("GET /v1/directory", () => {
  it("lists colleagues and teams as assignable refs for any signed-in actor", async () => {
    // orbit.agent holds no core:users:read — nobody grants staff-admin rights
    // to answer a chat, and yet handing a conversation on is that agent's job.
    const app = router(baseCtx(fakeDb(rows), ["orbit:conversations:read"]));
    const res = await app.fetch(new Request("http://api.test/"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { ref: string; name: string }[] };
    // Refs are in the exact shape the assignment fields take on the wire.
    expect(body.entries).toEqual([
      { ref: "user:us_1", name: "Layla A•• M•••••••" },
      { ref: "user:us_2", name: "Sara A•• N•••••" },
      { ref: "team:tm_1", name: "Motor claims" }
    ]);
  });

  it("shows unmasked names to an actor holding core:pii:view", async () => {
    const app = router(baseCtx(fakeDb(rows), ["core:pii:view"]));
    const res = await app.fetch(new Request("http://api.test/"));
    const body = (await res.json()) as { entries: { ref: string; name: string }[] };
    expect(body.entries[0]).toEqual({ ref: "user:us_1", name: "Layla Al Mansouri" });
  });

  it("never returns a column beyond the ref and the display name", async () => {
    const app = router(baseCtx(fakeDb(rows), ["*:*:*"]));
    const res = await app.fetch(new Request("http://api.test/"));
    const text = await res.text();
    // Email, status and password hash are staff-administration facts; this
    // endpoint answers "who can I assign this to", nothing else (ADR-0047).
    expect(text).not.toContain("SECRET-HASH");
    expect(text).not.toContain("layla@gonxt.ae");
    expect(text).not.toContain("active");
  });

  it("asks for teams only when kind=team", async () => {
    const seen: string[] = [];
    const app = router(baseCtx(fakeDb(rows, seen), ["*:*:*"]));
    const res = await app.fetch(new Request("http://api.test/?kind=team"));
    const body = (await res.json()) as { entries: { ref: string }[] };
    expect(seen).toEqual(["core_teams"]);
    expect(body.entries).toEqual([{ ref: "team:tm_1", name: "Motor claims" }]);
  });
});
