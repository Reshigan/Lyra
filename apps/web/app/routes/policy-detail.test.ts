import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import type { Env } from "../env";
import { LABELS, PERM, labelsIn, loader, policyLede } from "./policy-detail";

// This screen reads. Its one historic bug (F5) was reading the wrong thing:
// "endorsement history" asked for every other contract the same holder owns,
// which is a different question and leaked one customer's book into another
// contract's page. The versions of an agreement have their own resource.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const POLICY = {
  id: "pol_1",
  customerId: "cus_1",
  providerId: "prv_1",
  policyNo: "POL-1",
  startAt: 1_750_000_000_000,
  endAt: 1_780_000_000_000,
  premiumMinor: 120_000,
  currency: "AED",
  commissionMinor: 12_000,
  status: "active",
  createdAt: 1_750_000_000_000,
  updatedAt: 1_750_000_000_000
};

const VERSION = {
  id: "pvr_2",
  versionSeq: 2,
  endorsementNo: "POL-1/E1",
  reason: "vehicle swapped",
  reasonCode: "endorsement",
  effectiveFrom: 1_760_000_000_000,
  effectiveTo: 1_780_000_000_000,
  premiumMinor: 132_000,
  premiumDeltaMinor: 12_000,
  currency: "AED",
  state: "effective",
  issuedAt: 1_760_000_000_000,
  createdAt: 1_760_000_000_000
};

/** Every request the loader makes, in order, answered by path. */
function stubApi(permissions: string[]) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (input: URL | string) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/v1/me")) return Promise.resolve(json({ permissions }));
    if (url.endsWith("/v1/axis/policies/pol_1")) return Promise.resolve(json(POLICY));
    if (url.endsWith("/v1/axis/policies/pol_1/versions")) {
      return Promise.resolve(json({ data: [VERSION], total: 1 }));
    }
    return Promise.resolve(json({ data: [] }));
  });
  return calls;
}

function args(): LoaderFunctionArgs {
  return {
    request: new Request("https://web.test/axis/policies/pol_1/detail"),
    context: { get: () => ({ env, ctx: null }) },
    params: { id: "pol_1" }
  } as unknown as LoaderFunctionArgs;
}

describe("labelsIn", () => {
  it("answers every key in both languages, and never with the key itself", () => {
    for (const key of Object.keys(LABELS.en!)) {
      expect(LABELS.ar![key], key).toBeTruthy();
      for (const locale of ["en", "ar"]) expect(labelsIn(locale)(key), `${locale}:${key}`).not.toBe(key);
    }
    expect(Object.keys(LABELS.ar!).sort()).toEqual(Object.keys(LABELS.en!).sort());
  });

  it("keeps the Arabic distinct from the English", () => {
    for (const [key, value] of Object.entries(LABELS.en!)) expect(LABELS.ar![key], key).not.toBe(value);
  });

  it("answers the chrome Gate needs, with the rule interpolated", () => {
    expect(labelsIn("en")("approvalBody", { policy: "axis.bind" })).toContain("axis.bind");
    expect(labelsIn("ar")("approvalTitle")).toBeTruthy();
  });

  it("renames the agreement noun for a non-insurance pack", () => {
    expect(labelsIn("en", "retail-ecom")("policies")).not.toBe(labelsIn("en")("policies"));
  });

  it("does not describe the history as the holder's, which is the bug it had", () => {
    for (const locale of ["en", "ar"]) expect(labelsIn(locale)("historyCaption")).not.toContain("holder");
    expect(labelsIn("en")("historyCaption")).toContain("this agreement");
  });
});

describe("policyLede", () => {
  it("states the status and cover term from the loaded record", () => {
    const lede = policyLede(POLICY, labelsIn("en"), "en");
    expect(lede).toContain("Active");
    expect(lede).toContain("2025");
    expect(lede).toContain("2026");
  });

  /**
   * `z.number().int()` is a *safe*-integer check, so before `InstantMs` landed
   * the band (8.64e15, 9.007e15] was an accepted `endAt` — and those rows are
   * still in `axis_policies`. `Intl.DateTimeFormat.format` throws `RangeError`
   * on the Invalid Date such a value makes, this lede is built during the
   * route's own render, and a throw there takes the whole policy page to the
   * error boundary. One unreadable field must not cost the contract.
   */
  it("survives a stored instant no Date can hold", () => {
    const lede = policyLede({ ...POLICY, endAt: 9e15 }, labelsIn("en"), "en");
    expect(lede).toContain("Active");
    expect(lede).toContain("—");
  });
});

describe("loader", () => {
  it("endorsement history shows only versions of this policy", async () => {
    const calls = stubApi(Object.values(PERM));

    const loaded = await loader(args());

    expect(calls).toContain("https://api.test/v1/axis/policies/pol_1/versions");
    // The F5 regression: no request may ask for a holder's other contracts.
    for (const url of calls) expect(url, url).not.toContain("customerId=");
    expect(loaded.versions).toEqual([VERSION]);
  });

  it("degrades the version panel rather than the page when it is refused", async () => {
    vi.stubGlobal("fetch", (input: URL | string) => {
      const url = String(input);
      if (url.endsWith("/v1/me")) return Promise.resolve(json({ permissions: Object.values(PERM) }));
      if (url.endsWith("/v1/axis/policies/pol_1")) return Promise.resolve(json(POLICY));
      if (url.endsWith("/versions")) {
        return Promise.resolve(
          new Response(JSON.stringify({ title: "forbidden", status: 403 }), {
            status: 403,
            headers: { "content-type": "application/json" }
          })
        );
      }
      return Promise.resolve(json({ data: [] }));
    });

    const loaded = await loader(args());

    expect(loaded.policy?.id).toBe("pol_1");
    expect(loaded.versions).toEqual([]);
  });

  it("offers a change only to an actor who may make it", async () => {
    stubApi(["axis:policies:read", "axis:policies:cancel"]);

    const loaded = await loader(args());

    expect(loaded.may).toMatchObject({ read: true, cancel: true, endorse: false, renew: false });
  });
});
