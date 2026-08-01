import { beforeAll, describe, it } from "@jest/globals";
import { by, device, element, expect } from "detox";

// Flow 3 of 5. Continues 01/02's signed-in session, then clears it — the
// thing 04 needs a genuinely signed-out app to test.
describe("sign out clears the session", () => {
  beforeAll(async () => {
    await device.reloadReactNative();
  });

  it("returns to the password screen and stays signed out across a relaunch", async () => {
    await element(by.label("Sign out")).tap();
    await expect(element(by.label("Email"))).toBeVisible();

    // Sign out revokes server-side and clears the keychain token
    // (apps/mobile/src/session.tsx signOut) — a relaunch without `delete`
    // must not silently restore the session it just cleared.
    await device.launchApp({ newInstance: true });
    await expect(element(by.label("Email"))).toBeVisible();
  });
});
