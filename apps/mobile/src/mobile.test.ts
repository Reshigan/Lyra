import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The keystore is a native module; the contract this test cares about is that
// the token round-trips through it under one key and that a keystore that
// throws reads as "signed out" rather than as a crash.
const store = new Map<string, string>();
const failing = { get: false, set: false, del: false };

vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "whenUnlockedThisDeviceOnly",
  setItemAsync: vi.fn(async (key: string, value: string) => {
    if (failing.set) throw new Error("keystore unavailable");
    store.set(key, value);
  }),
  getItemAsync: vi.fn(async (key: string) => {
    if (failing.get) throw new Error("keystore unavailable");
    return store.get(key) ?? null;
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    if (failing.del) throw new Error("keystore unavailable");
    store.delete(key);
  })
}));

const {
  clearPendingRecoveryCodes,
  clearToken,
  readPendingRecoveryCodes,
  readToken,
  savePendingRecoveryCodes,
  saveToken
} = await import("./token");
const { entriesFor, labelKeyFor, navKeyFor, navTitle, resourceFor, resourceForNavKey, routeFor } =
  await import("./nav");
const { humanize, subtitleOf, titleOf, fieldsOf } = await import("./rows");
const { CATALOGUES, en, dirFor, joinList, resolveLocale, translator } = await import("./i18n");
const { fontFamilyFor, themeFor, productName } = await import("./theme");
const { defaultWorkspaceForRoles, resolvePersona } = await import("./workspace");
const { PERSONA_TABS, tabsFor } = await import("./personas");
const { resolveGate } = await import("./biometric-gate");
const {
  ApiError,
  NetworkError,
  REQUEST_TIMEOUT_MS,
  endsSession,
  listRows,
  mfaStepOf,
  request,
  setOnSessionEnd,
  stepAfterClearing,
  stepAfterLogin,
  verifyThenLoad
} = await import("./api");

describe("token store", () => {
  beforeEach(() => {
    store.clear();
    failing.get = failing.set = failing.del = false;
  });

  it("has nothing before a sign-in", async () => {
    await expect(readToken()).resolves.toBeNull();
  });

  it("round-trips a session token and clears it on sign-out", async () => {
    await saveToken("ses_abc123");
    await expect(readToken()).resolves.toBe("ses_abc123");
    await clearToken();
    await expect(readToken()).resolves.toBeNull();
  });

  it("keeps the token under exactly one key, device-only", async () => {
    const SecureStore = await import("expo-secure-store");
    await saveToken("ses_abc123");
    expect([...store.keys()]).toEqual(["lyra.session.token"]);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "lyra.session.token",
      "ses_abc123",
      expect.objectContaining({ keychainAccessible: "whenUnlockedThisDeviceOnly" })
    );
  });

  it("reads an unreadable keystore as signed out, not as a crash", async () => {
    await saveToken("ses_abc123");
    failing.get = true;
    await expect(readToken()).resolves.toBeNull();
  });

  it("does not throw when clearing a keystore that refuses", async () => {
    failing.del = true;
    await expect(clearToken()).resolves.toBeUndefined();
  });
});

describe("pending recovery codes", () => {
  beforeEach(() => {
    store.clear();
    failing.get = failing.set = failing.del = false;
  });

  it("round-trips codes until the user confirms saving them", async () => {
    await expect(readPendingRecoveryCodes()).resolves.toBeNull();
    await savePendingRecoveryCodes(["AAAA-BBBB", "CCCC-DDDD"]);
    await expect(readPendingRecoveryCodes()).resolves.toEqual(["AAAA-BBBB", "CCCC-DDDD"]);
    await clearPendingRecoveryCodes();
    await expect(readPendingRecoveryCodes()).resolves.toBeNull();
  });

  it("keeps the codes out of the session token's key", async () => {
    await savePendingRecoveryCodes(["AAAA-BBBB"]);
    expect([...store.keys()]).toEqual(["lyra.mfa.pendingRecoveryCodes"]);
  });

  it("reads garbage or an unreadable keystore as no pending codes", async () => {
    store.set("lyra.mfa.pendingRecoveryCodes", "not json");
    await expect(readPendingRecoveryCodes()).resolves.toBeNull();
    store.set("lyra.mfa.pendingRecoveryCodes", JSON.stringify({ nope: true }));
    await expect(readPendingRecoveryCodes()).resolves.toBeNull();
    failing.get = true;
    await expect(readPendingRecoveryCodes()).resolves.toBeNull();
    failing.del = true;
    await expect(clearPendingRecoveryCodes()).resolves.toBeUndefined();
  });
});

describe("request plumbing", () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" }
    });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    setOnSessionEnd(null);
  });

  it("reads a 401 outside /v1/auth as the end of the session", () => {
    expect(endsSession("/v1/axis/cases", 401)).toBe(true);
    expect(endsSession("/v1/me", 401)).toBe(true);
    expect(endsSession("/v1/auth/login", 401)).toBe(false);
    expect(endsSession("/v1/auth/mfa/verify", 401)).toBe(false);
    expect(endsSession("/v1/axis/cases", 403)).toBe(false);
  });

  it("tells the session when an authenticated call answers 401", async () => {
    const ended = vi.fn();
    setOnSessionEnd(ended);
    vi.stubGlobal("fetch", vi.fn(async () => json({ title: "unauthorized", status: 401 }, 401)));
    await expect(request("/v1/axis/cases", { token: "dead" })).rejects.toBeInstanceOf(ApiError);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("does not read a wrong password or code as a dead session", async () => {
    const ended = vi.fn();
    setOnSessionEnd(ended);
    vi.stubGlobal("fetch", vi.fn(async () => json({ title: "unauthorized", status: 401 }, 401)));
    await expect(
      request("/v1/auth/login", { method: "POST", body: { email: "a@b.co" } })
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      request("/v1/auth/mfa/verify", { method: "POST", token: "t", body: { code: "1" } })
    ).rejects.toBeInstanceOf(ApiError);
    expect(ended).not.toHaveBeenCalled();
  });

  it("asks for the next page with the cursor, and the first page without one", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(String(url));
        return json({ data: [] });
      })
    );
    await listRows("t", "axis/cases");
    await listRows("t", "axis/cases", undefined, "cur/+1");
    expect(urls[0]).toContain("limit=50");
    expect(urls[0]).not.toContain("cursor");
    expect(urls[1]).toContain(`cursor=${encodeURIComponent("cur/+1")}`);
  });

  it("aborts a hung request as a NetworkError instead of spinning forever", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError"))
            );
          })
      )
    );
    const pending = request("/v1/axis/cases", { token: "t" });
    const failure = expect(pending).rejects.toBeInstanceOf(NetworkError);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    await failure;
  });
});

describe("nav mapping", () => {
  // The hrefs apps/api/src/routes/me.ts can return. If that list grows, this
  // test fails before a nav item can ship as a dead row on mobile.
  const API_HREFS = [
    "/",
    "/axis",
    "/orbit",
    "/signal",
    "/scout",
    "/north",
    "/distribution",
    "/ledger",
    "/analytics",
    "/compliance",
    "/admin"
  ];

  it("maps every workspace href the API serves to a resource path", () => {
    for (const href of API_HREFS.filter((h) => h !== "/")) {
      expect(resourceFor(href), href).toMatch(/^[a-z]+\/[a-z-]+$/);
    }
  });

  it("routes a nav href to its list screen, and home to nowhere", () => {
    expect(routeFor("/axis")).toBe("/m/axis");
    expect(routeFor("/distribution")).toBe("/m/distribution");
    expect(routeFor("/")).toBeUndefined();
  });

  it("resolves the [nav] route param back to the same resource", () => {
    for (const href of API_HREFS.filter((h) => h !== "/")) {
      expect(resourceForNavKey(navKeyFor(href))).toBe(resourceFor(href));
    }
  });

  it("keeps an href it does not know as a labelled, unreachable item", () => {
    expect(resourceFor("/atlas")).toBeUndefined();
    expect(routeFor("/atlas")).toBeUndefined();
    const [entry] = entriesFor([{ labelKey: "nav.atlas", href: "/atlas", icon: "x" }]);
    expect(entry).toEqual({
      labelKey: "nav.atlas",
      href: "/atlas",
      route: undefined,
      resource: undefined,
      depth: 0
    });
  });

  it("flattens nested nav instead of silently dropping the children", () => {
    const entries = entriesFor([
      {
        labelKey: "nav.admin",
        href: "/admin",
        icon: "x",
        children: [{ labelKey: "nav.settings", href: "/settings", icon: "x" }]
      }
    ]);
    expect(entries.map((e) => [e.href, e.depth])).toEqual([
      ["/admin", 0],
      ["/settings", 1]
    ]);
  });

  it("drops home from the workspace list but keeps everything else", () => {
    const entries = entriesFor(
      API_HREFS.map((href) => ({ labelKey: labelKeyFor(href), href, icon: "x" }))
    );
    expect(entries.map((e) => e.href)).toEqual(API_HREFS.filter((h) => h !== "/"));
    expect(entries.every((e) => e.route !== undefined)).toBe(true);
  });

  it("gives every nav item a label the catalogue can translate", () => {
    // The requirement is a visible text label per item — which is impossible if
    // the key resolves to nothing. Both catalogues must carry all of them.
    for (const href of API_HREFS) {
      const key = labelKeyFor(href);
      expect(key in en, key).toBe(true);
      for (const locale of Object.keys(CATALOGUES)) {
        expect(translator(locale)(key), `${locale} ${key}`).not.toBe(key);
      }
    }
  });

  it("falls back to the href-derived key when the API sends no labelKey", () => {
    const [entry] = entriesFor([{ labelKey: "", href: "/ledger", icon: "x" }]);
    expect(entry?.labelKey).toBe("nav.ledger");
  });

  it("titles a screen from the catalogue, or humanizes an unknown segment", () => {
    const t = translator("en");
    expect(navTitle(t, "axis")).toBe("Operations");
    // A garbage deep link (/m/foo) must never render the raw key "nav.foo".
    expect(navTitle(t, "foo")).toBe("Foo");
    expect(navTitle(t, "quote-requests")).toBe("Quote Requests");
    // An API labelKey newer than this app's catalogue falls back the same way.
    expect(navTitle(t, "atlas", "nav.atlas")).toBe("Atlas");
  });
});

describe("row display", () => {
  it("names a row by the field a human would recognise", () => {
    expect(titleOf({ id: "cas_1", reference: "C-9", title: "Windscreen" })).toBe("Windscreen");
    expect(titleOf({ id: "cas_1", reference: "C-9" })).toBe("C-9");
    expect(titleOf({ id: "cas_1" })).toBe("cas_1");
    expect(titleOf({ id: "cas_1", name: "   " })).toBe("cas_1");
  });

  it("does not repeat the title as the subtitle", () => {
    expect(subtitleOf({ id: "u_1", email: "a@b.co" })).toBeUndefined();
    expect(subtitleOf({ id: "u_1", name: "Amina", email: "a@b.co", status: "active" })).toBe(
      "active"
    );
  });

  it("shows structure rather than [object Object]", () => {
    const fields = fieldsOf({ id: "x", meta: { a: 1 }, gone: null });
    expect(fields.find((f) => f.key === "meta")?.value).toContain('"a": 1');
    expect(fields.find((f) => f.key === "gone")?.value).toBe("—");
  });

  it("labels a field as words, never as the raw column name", () => {
    expect(humanize("tenant_id")).toBe("Tenant Id");
    expect(humanize("created_at")).toBe("Created At");
    expect(humanize("status")).toBe("Status");
    expect(humanize("quote-requests")).toBe("Quote Requests");
    const fields = fieldsOf({ id: "x", tenant_id: "ten_1" });
    expect(fields.find((f) => f.key === "tenant_id")?.label).toBe("Tenant Id");
  });
});

describe("sign-in step machine", () => {
  // The same four steps apps/web/app/routes/login.tsx walks. The contract lives
  // in apps/api/src/auth.ts: `mfaStep` on the login response, and a `step` on
  // the 403 problem every later call returns until the factor is cleared.
  const problem = (over: Record<string, unknown>) =>
    new ApiError(
      {
        type: "https://lyra.app/problems/mfa_required",
        title: "Second factor required",
        status: 403,
        ...over
      },
      null
    );

  it("sends a customer with no second factor straight into the app", () => {
    expect(stepAfterLogin({ mfaRequired: false })).toBe("app");
  });

  it("sends an enrolled account to the code screen", () => {
    expect(stepAfterLogin({ mfaRequired: true, mfaStep: "verify" })).toBe("totp");
    // mfaStep is the API's own instruction, but mfaRequired alone still means
    // "there is a code to type" rather than "carry on".
    expect(stepAfterLogin({ mfaRequired: true })).toBe("totp");
  });

  it("sends a staff account that never enrolled to enrolment, not to a code box", () => {
    expect(stepAfterLogin({ mfaRequired: true, mfaStep: "enrol" })).toBe("enrol");
  });

  it("owes a freshly enrolled account its recovery codes before the app", () => {
    expect(stepAfterClearing("enrol")).toBe("recovery");
    expect(stepAfterClearing("totp")).toBe("app");
    expect(stepAfterClearing("recovery")).toBe("app");
  });

  it("reads the outstanding step off a 403 so a restored session is not signed out", () => {
    expect(mfaStepOf(problem({ step: "verify", detail: "verify" }))).toBe("totp");
    expect(mfaStepOf(problem({ step: "enrol", detail: "enrol" }))).toBe("enrol");
    // `step` is an RFC 9457 extension; `detail` carries the same word, so an
    // intermediary that strips unknown members still lands the right screen.
    expect(mfaStepOf(problem({ detail: "enrol" }))).toBe("enrol");
  });

  it("does not re-spend a one-time code when only the follow-up load failed", async () => {
    const verify = vi.fn().mockResolvedValue({ mfaSatisfied: true });
    const load = vi.fn().mockRejectedValueOnce(new NetworkError("offline")).mockResolvedValue(null);
    const flow = verifyThenLoad(verify, load);
    await expect(flow("123456")).rejects.toBeInstanceOf(NetworkError);
    // Retrying must only retry the load: the code was consumed server-side, and
    // re-verifying it would read back as "wrong code".
    await flow("123456");
    expect(verify).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("re-verifies after a rejected code, and on the next sign-in cycle", async () => {
    const verify = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ title: "unauthorized", status: 401 }, null))
      .mockResolvedValue({ mfaSatisfied: true });
    const load = vi.fn().mockResolvedValue(null);
    const flow = verifyThenLoad(verify, load);
    await expect(flow("000000")).rejects.toBeInstanceOf(ApiError);
    await flow("123456");
    await flow("654321");
    expect(verify).toHaveBeenCalledTimes(3);
  });

  it("does not read an ordinary refusal as an MFA prompt", () => {
    expect(
      mfaStepOf(problem({ type: "https://lyra.app/problems/forbidden", title: "Not permitted" }))
    ).toBeNull();
    // An expired session is a sign-out, not a second-factor screen.
    expect(mfaStepOf(problem({ status: 401, type: "https://lyra.app/problems/unauthorized" })))
      .toBeNull();
    expect(mfaStepOf(new Error("offline"))).toBeNull();
  });
});

describe("i18n and brand", () => {
  it("keeps the ar catalogue in step with en", () => {
    expect(Object.keys(CATALOGUES.ar!).sort()).toEqual(Object.keys(en).sort());
  });

  it("lays ar out right-to-left and en left-to-right", () => {
    expect(dirFor("ar")).toBe("rtl");
    expect(dirFor("ar-AE")).toBe("rtl");
    expect(dirFor("en-GB")).toBe("ltr");
  });

  it("picks the first supported device locale", () => {
    expect(resolveLocale(["fr-FR", "ar-AE", "en"])).toBe("ar");
    expect(resolveLocale(["fr-FR"])).toBe("en");
  });

  it("interpolates rather than dropping the variable", () => {
    expect(translator("en")("home.signedInAs", { name: "Amina" })).toBe("Signed in as Amina");
  });

  it("joins display fragments with the locale's own comma", () => {
    expect(joinList("en", ["Windscreen", "open"])).toBe("Windscreen, open");
    expect(joinList("ar-AE", ["أمينة", "نشط"])).toBe("أمينة، نشط");
    expect(joinList("ar", ["واحد"])).toBe("واحد");
  });

  it("reads the palette and the product name from tenant brand, never a literal", () => {
    const theme = themeFor({ name: "Northwind", palette: { accent: "#00aaff" } });
    expect(theme.accent).toBe("#00aaff");
    expect(productName({ name: "Northwind" }, "Northwind Ltd")).toBe("Northwind");
    expect(productName(null, "Northwind Ltd")).toBe("Northwind Ltd");
    // A tenant that overrides nothing still gets a usable palette, and a value
    // that is not a colour never reaches a style.
    expect(themeFor(null).accent).toBe("#ffb020");
    expect(themeFor({ palette: { accent: "red; drop table" } }).accent).toBe("#ffb020");
  });

  it("maps all three accent tokens the web contract defines", () => {
    // apps/web/app/components/shell.tsx brandStyle re-maps exactly --accent,
    // --accent-hover and --accent-contrast; mobile must honour the same three or
    // a tenant's button text ends up unreadable on its own accent.
    const theme = themeFor({
      palette: { accent: "#123456", accentHover: "#0a1a2b", accentContrast: "#ffffff" }
    });
    expect([theme.accent, theme.accentHover, theme.accentContrast]).toEqual([
      "#123456",
      "#0a1a2b",
      "#ffffff"
    ]);
    // A partial override leaves the rest of the default skin intact rather than
    // producing a half-branded palette.
    const partial = themeFor({ palette: { accent: "#123456" } });
    expect(partial.accentHover).toBe("#d98e0b");
    expect(partial.accentContrast).toBe("#412402");
  });

  it("maps only the approved typefaces, and nothing else, to a font family", () => {
    // The same enum BrandJson.font validates (packages/db/src/json.ts) and the
    // same set apps/web FONT_STACKS maps.
    expect(fontFamilyFor("space-grotesk")).toBe("Space Grotesk");
    expect(fontFamilyFor("inter")).toBe("Inter");
    expect(fontFamilyFor("ibm-plex-sans-arabic")).toBe("IBM Plex Sans Arabic");
  });

  it("never lets an unapproved or hostile font value reach a style", () => {
    expect(fontFamilyFor(undefined)).toBeUndefined();
    expect(fontFamilyFor("")).toBeUndefined();
    expect(fontFamilyFor("Comic Sans")).toBeUndefined();
    // The reason this is a Map and not an object literal: an object literal
    // answers these from the prototype and hands a function to fontFamily.
    for (const hostile of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(fontFamilyFor(hostile), hostile).toBeUndefined();
    }
    expect(themeFor({ font: "__proto__" }).font).toBeUndefined();
  });

  it("reads the tenant typeface off the brand payload, and defaults to none", () => {
    expect(themeFor({ font: "inter" }).font).toBe("Inter");
    // No brand, or a brand that never chose one: the platform typeface, which is
    // what `fontFamily: undefined` means to React Native.
    expect(themeFor(null).font).toBeUndefined();
    expect(themeFor({ name: "Northwind" }).font).toBeUndefined();
  });
});

describe("defaultWorkspaceForRoles", () => {
  it("matches an exact role before any prefix", () => {
    expect(defaultWorkspaceForRoles(["tenant.compliance"])).toBe("compliance");
  });

  it("falls back to the role's prefix mapping", () => {
    expect(defaultWorkspaceForRoles(["tenant.admin"])).toBe("admin");
    expect(defaultWorkspaceForRoles(["platform.engineer"])).toBe("admin");
    expect(defaultWorkspaceForRoles(["dev.developer"])).toBe("admin");
    expect(defaultWorkspaceForRoles(["partner.manager"])).toBe("distribution");
    expect(defaultWorkspaceForRoles(["provider.viewer"])).toBe("scout");
    expect(defaultWorkspaceForRoles(["customer"])).toBe("settings");
    expect(defaultWorkspaceForRoles(["finance.controller"])).toBe("ledger");
  });

  it("falls back to the bare prefix when it is itself a workspace", () => {
    expect(defaultWorkspaceForRoles(["axis.agent"])).toBe("axis");
    expect(defaultWorkspaceForRoles(["orbit.lead"])).toBe("orbit");
    expect(defaultWorkspaceForRoles(["signal.marketer"])).toBe("signal");
    expect(defaultWorkspaceForRoles(["scout.pm"])).toBe("scout");
    expect(defaultWorkspaceForRoles(["north.exec"])).toBe("north");
  });

  it("tries every role in order until one resolves", () => {
    expect(defaultWorkspaceForRoles(["unknown.role", "axis.lead"])).toBe("axis");
  });

  it("returns north for a roleless actor", () => {
    expect(defaultWorkspaceForRoles([])).toBe("north");
  });
});

describe("resolvePersona", () => {
  it("resolves the default variant for a plain north role", () => {
    expect(resolvePersona(["north.exec"])).toEqual({ workspace: "north", variant: "default" });
  });

  it("resolves the board variant only for north.board", () => {
    expect(resolvePersona(["north.board"])).toEqual({ workspace: "north", variant: "board" });
  });

  it("never applies the board variant outside the north workspace", () => {
    expect(resolvePersona(["tenant.admin"])).toEqual({ workspace: "admin", variant: "default" });
  });
});

describe("persona tab config", () => {
  const workspaces = Object.keys(PERSONA_TABS) as Array<keyof typeof PERSONA_TABS>;

  it("covers every workspace with 1 to 3 tabs", () => {
    expect(workspaces.sort()).toEqual(
      ["admin", "axis", "compliance", "distribution", "ledger", "north", "orbit", "scout", "settings", "signal"].sort()
    );
    for (const workspace of workspaces) {
      expect(PERSONA_TABS[workspace].length).toBeGreaterThan(0);
      expect(PERSONA_TABS[workspace].length).toBeLessThanOrEqual(3);
    }
  });

  it("gives axis the docs/08 Ops tabs", () => {
    expect(tabsFor("axis", "default").map((tab) => tab.labelKey)).toEqual([
      "tab.queue",
      "tab.sla",
      "tab.cases"
    ]);
  });

  it("swaps Decisions for Governance only for the north board variant", () => {
    expect(tabsFor("north", "default").map((tab) => tab.labelKey)).toContain("tab.decisions");
    expect(tabsFor("north", "board").map((tab) => tab.labelKey)).toContain("tab.governance");
    expect(tabsFor("north", "board").map((tab) => tab.labelKey)).not.toContain("tab.decisions");
  });

  it("leaves every other workspace's tabs unaffected by variant", () => {
    expect(tabsFor("axis", "board")).toEqual(tabsFor("axis", "default"));
  });

  it("gives every single-tab workspace a Home tab pointing at its own resource", () => {
    for (const workspace of ["distribution", "ledger", "compliance", "settings"] as const) {
      const tabs = tabsFor(workspace, "default");
      expect(tabs).toHaveLength(1);
      expect(tabs[0]?.labelKey).toBe("nav.home");
    }
  });
});

describe("biometric gate", () => {
  function probe(overrides: Partial<{ hardware: boolean; enrolled: boolean; success: boolean }> = {}) {
    const { hardware = true, enrolled = true, success = true } = overrides;
    return {
      hasHardware: async () => hardware,
      isEnrolled: async () => enrolled,
      authenticate: async () => success
    };
  }

  it("opens immediately when the device has no biometric hardware", async () => {
    expect(await resolveGate(probe({ hardware: false }))).toBe("open");
  });

  it("opens immediately when hardware exists but nothing is enrolled", async () => {
    expect(await resolveGate(probe({ enrolled: false }))).toBe("open");
  });

  it("opens after a successful challenge when enrolled", async () => {
    expect(await resolveGate(probe({ success: true }))).toBe("open");
  });

  it("locks after a failed challenge when enrolled", async () => {
    expect(await resolveGate(probe({ success: false }))).toBe("locked");
  });

  it("never calls authenticate when nothing is enrolled", async () => {
    const authenticate = vi.fn(async () => true);
    await resolveGate({ hasHardware: async () => true, isEnrolled: async () => false, authenticate });
    expect(authenticate).not.toHaveBeenCalled();
  });
});
