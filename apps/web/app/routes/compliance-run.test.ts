import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { action, loader } from "./compliance-run";

// The compliance run screen. Two things matter here and nothing else does: a run
// the actor cannot start is absent rather than refused later, and the request
// this screen sends carries no value the server is supposed to compute — no
// hash, no cutoff, no row count.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Answers by first matching URL fragment and records what was sent. */
function stubApi(replies: Array<[string, Response]>) {
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? "GET", body: typeof init.body === "string" ? init.body : null });
    const hit = replies.find(([fragment]) => url.includes(fragment));
    return Promise.resolve(hit ? hit[1].clone() : new Response(null, { status: 404 }));
  });
  return calls;
}

function me(...permissions: string[]): Response {
  return json({ id: "usr_01", permissions, roles: [], tenantId: "t1" });
}

/** Loader/action args with just the pieces these handlers read. */
function args(kind: string, form?: Record<string, string>): any {
  const init: RequestInit = form
    ? { method: "POST", body: new URLSearchParams(form) }
    : {};
  return {
    request: new Request("https://web.test/compliance/run/" + kind, init),
    params: { kind },
    context: { get: () => ({ env, ctx: {} }) }
  };
}

describe("who sees a run", () => {
  it("offers only the runs the actor holds the permission for", async () => {
    stubApi([["/v1/me", me("compliance:screenings:run", "compliance:evidence:read")]]);
    const result = await loader(args("screening"));
    expect(result.allowed).toEqual(["screening"]);
    expect(result.denied).toBe(false);
  });

  it("marks a run the actor cannot start as denied — the form is not drawn at all", async () => {
    stubApi([["/v1/me", me("compliance:screenings:read")]]);
    const result = await loader(args("retention"));
    expect(result.allowed).toEqual([]);
    expect(result.denied).toBe(true);
  });

  it("404s an unknown run rather than guessing one", async () => {
    stubApi([["/v1/me", me("compliance:screenings:run")]]);
    await expect(loader(args("nonsense"))).rejects.toMatchObject({ init: { status: 404 } });
  });
});

describe("what the screen sends", () => {
  it("asks the screening question and computes no hash of its own", async () => {
    const calls = stubApi([["/screenings/run", json({ id: "scr_01", result: "clear", hits: [] }, 201)]]);
    await action(args("screening", { subject: " Amina Saleh ", kind: "sanctions", customerId: "" }));

    const sent = JSON.parse(calls.at(-1)!.body!) as Record<string, unknown>;
    expect(sent).toEqual({ kind: "sanctions", name: "Amina Saleh" });
    expect(Object.keys(sent)).not.toContain("queryHash");
  });

  it("sends the export window as epochs and no bundle hash", async () => {
    const calls = stubApi([["/evidence-bundles/export", json({ id: "evb_01", state: "ready" }, 201)]]);
    await action(
      args("evidence", { purpose: "regulator", from: "2026-01-01", to: "2026-01-31", subjectRef: "", deliveredTo: "" })
    );

    const sent = JSON.parse(calls.at(-1)!.body!) as Record<string, number | string>;
    expect(sent.purpose).toBe("regulator");
    expect(sent.from).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    // The window ends at the end of the chosen day: a report "to the 31st" that
    // stops at midnight silently drops a day of evidence.
    expect(sent.to).toBe(Date.parse("2026-01-31T23:59:59.999Z"));
    expect(Object.keys(sent)).not.toContain("bundleHash");
  });

  it("previews a purge by default and deletes only on the second, explicit submit", async () => {
    const calls = stubApi([["/retention/run", json({ policyKey: "messages", rowsAffected: 3 }, 200)]]);
    await action(args("retention", { policyKey: "messages" }));
    expect(JSON.parse(calls.at(-1)!.body!)).toEqual({ policyKey: "messages", dryRun: true });

    await action(args("retention", { policyKey: "messages", confirm: "purge" }));
    const sent = JSON.parse(calls.at(-1)!.body!) as Record<string, unknown>;
    expect(sent.dryRun).toBe(false);
    // The cutoff is the tenant's retention policy against the floor under it.
    // A window chosen in a browser is a purge parameter an attacker would pick.
    expect(Object.keys(sent)).not.toContain("cutoffAt");
  });

  it("shows the API's refusal instead of claiming a run happened", async () => {
    stubApi([
      ["/screenings/run", json({ title: "forbidden", status: 403, detail: "needs compliance:screenings:run" }, 403)]
    ]);
    const result = await action(args("screening", { subject: "Amina Saleh" }));
    expect(result.problem?.status).toBe(403);
    expect(result).not.toHaveProperty("screening");
  });
});
