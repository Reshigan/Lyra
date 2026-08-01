import { beforeAll, describe, it } from "@jest/globals";
import { by, device, element, expect } from "detox";

// Flow 5 of 5. `delete: true` guarantees a signed-out Login screen regardless
// of what 01-04 left behind, so this spec has no ordering dependency on them.
//
// apps/mobile/src/session.tsx resolves locale from the device's own locale
// (expo-localization) until a session exists to override it with the
// account's — so the password screen is the one place device locale shows up
// with no sign-in required at all.
//
// ponytail: `languageAndLocale` on `launchApp` is an iOS-only Detox device
// config (no Android equivalent without extra emulator setup); this spec
// only runs the ios.sim.debug configuration.
describe("device locale renders the login screen in Arabic", () => {
  beforeAll(async () => {
    await device.launchApp({ delete: true, languageAndLocale: { language: "ar", locale: "ar" } });
  });

  it("shows the Arabic sign-in copy", async () => {
    await expect(element(by.text("تسجيل الدخول"))).toBeVisible();
    await expect(element(by.text("أدخل بريد العمل وكلمة المرور للمتابعة."))).toBeVisible();
  });
});
