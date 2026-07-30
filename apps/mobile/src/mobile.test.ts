import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { clearToken, readToken, saveToken } = await import("./token");
const { entriesFor, labelKeyFor, navKeyFor, resourceFor, resourceForNavKey, routeFor } =
  await import("./nav");
const { subtitleOf, titleOf, fieldsOf } = await import("./rows");
const { CATALOGUES, en, dirFor, resolveLocale, translator } = await import("./i18n");
const { themeFor, productName } = await import("./theme");
const { ApiError, mfaStepOf, stepAfterClearing, stepAfterLogin } = await import("./api");

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
      resource: undefined
    });
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
});
