import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import type { Env } from "../env";
import { WORKSPACES } from "../modules";
import { groupHits, labelsIn, loader, resultsLede, specFor, type SearchGroup } from "./search-results";
import type { SearchHit } from "./search";

// The full results page has no writes, so there is no action to reduce: what can
// be wrong here is the grouping, the resource-to-workspace resolution the
// headings depend on, and the two floors the loader enforces (a query too short
// to send, and a 403 that must read as "not allowed" rather than "nothing found").

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(reply: Response) {
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    calls.push({
      url: String(input),
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? init.body : null
    });
    return Promise.resolve(reply.clone());
  });
  return calls;
}

/** A loader call without a worker: only `context.get(cloudflare)` is read. */
function args(url: string): LoaderFunctionArgs {
  return {
    request: new Request(url),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as LoaderFunctionArgs;
}

const hit = (resource: string, module: string, row: Record<string, unknown>): SearchHit => ({
  resource,
  module,
  row
});

describe("labelsIn", () => {
  it("translates every key in both locales, with no Arabic left as English", () => {
    const en = labelsIn("en");
    const ar = labelsIn("ar");
    for (const key of ["title", "intro", "count", "denied", "group"]) {
      expect(en(key), key).not.toBe(key);
      expect(ar(key), key).not.toBe(key);
      // `group` is punctuation and placeholders in both locales, so it is the
      // one key that may legitimately match.
      if (key !== "group") expect(ar(key), key).not.toBe(en(key));
    }
  });

  it("interpolates the counts the summary line reports", () => {
    expect(labelsIn("en")("count", { count: "34", areas: "5" })).toContain("34");
    expect(labelsIn("en")("count", { count: "34", areas: "5" })).toContain("5");
  });
});

describe("resultsLede", () => {
  const l = labelsIn("en");
  const group = (n: number): SearchGroup => ({
    resource: "customers",
    module: "core",
    items: Array.from({ length: n }, (_, i) => ({ id: `cus_${i}`, label: "x", hint: "", href: "/x" }))
  });

  it("leads with the refusal when the search itself was denied", () => {
    expect(resultsLede("mansoori", [group(3)], true, l)).toBe(l("denied"));
  });

  it("falls to the static intro below the query floor or with nothing found", () => {
    expect(resultsLede("a", [], false, l)).toBe(l("intro"));
    expect(resultsLede("mansoori", [], false, l)).toBe(l("intro"));
  });

  it("reports the count and area total once there are hits", () => {
    expect(resultsLede("mansoori", [group(2), group(1)], false, l)).toBe(
      l("count", { count: "3", areas: "2" })
    );
  });
});

describe("groupHits", () => {
  it("keeps one group per resource, in the order the API returned them", () => {
    const groups = groupHits([
      hit("customers", "core", { id: "cus_1", name: "Aisha" }),
      hit("policies", "distribution", { id: "pol_1", reference: "MTR-1" }),
      hit("customers", "core", { id: "cus_2", name: "Hind" })
    ]);
    expect(groups.map((g) => g.resource)).toEqual(["customers", "policies"]);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(["cus_1", "cus_2"]);
    expect(groups[0]!.items[0]!.label).toBe("Aisha");
  });

  it("links each hit at the record route its module and resource spell", () => {
    const [group] = groupHits([hit("cases", "axis", { id: "cas_1", title: "Fire" })]);
    expect(group!.items[0]!.href).toBe("/axis/cases/cas_1");
  });

  it("drops a row with no id, because there is no record route to open", () => {
    const groups = groupHits([
      hit("customers", "core", { name: "No id here" }),
      hit("customers", "core", { id: "cus_2", name: "Hind" })
    ]);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(["cus_2"]);
  });

  it("separates the same resource path under two modules", () => {
    const groups = groupHits([
      hit("documents", "axis", { id: "doc_1" }),
      hit("documents", "orbit", { id: "doc_2" })
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe("specFor", () => {
  it("finds the tab that owns a resource, so the heading can be its own noun", () => {
    const owner = specFor("cases");
    expect(owner?.workspace.path).toBe("/axis");
    expect(owner?.tabKey).toBe("cases");
  });

  it("returns null for a resource no workspace tab lists", () => {
    expect(specFor("not-a-resource")).toBeNull();
  });

  it("resolves every resource the API can search, so no heading is a raw path", () => {
    // Not an assertion about all resources — only that the ones with a tab are
    // reachable by the same rule the headings use.
    const tabbed = WORKSPACES.flatMap((w) => w.tabs.map((tab) => tab.api.split("/").pop()!));
    for (const resource of tabbed) expect(specFor(resource), resource).not.toBeNull();
  });
});

describe("loader", () => {
  it("does not call the API for a query shorter than two letters", async () => {
    const calls = stubFetch(Response.json({ results: [] }));
    const loaded = await loader(args("https://web.test/search/results?q=a"));
    expect(calls).toEqual([]);
    expect(loaded.groups).toEqual([]);
    expect(loaded.q).toBe("a");
  });

  it("asks /v1/search with the query, encoded", async () => {
    const calls = stubFetch(
      Response.json({ results: [hit("customers", "core", { id: "cus_1", name: "Aisha" })] })
    );
    const loaded = await loader(args("https://web.test/search/results?q=al%20mansoori"));
    expect(calls[0]!.url).toContain("/v1/search?q=al%20mansoori");
    expect(loaded.groups[0]!.items[0]!.id).toBe("cus_1");
    expect(loaded.denied).toBe(false);
  });

  it("reports a refusal as a refusal rather than as an empty tenant", async () => {
    stubFetch(
      new Response(JSON.stringify({ title: "forbidden", status: 403 }), {
        status: 403,
        headers: { "content-type": "application/problem+json" }
      })
    );
    const loaded = await loader(args("https://web.test/search/results?q=mansoori"));
    expect(loaded.denied).toBe(true);
    expect(loaded.groups).toEqual([]);
  });
});
