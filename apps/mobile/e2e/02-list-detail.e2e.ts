import { beforeAll, describe, it } from "@jest/globals";
import { by, device, element, expect } from "detox";

// Flow 2 of 5. Continues 01's session — a JS reload keeps the native
// keychain token (apps/mobile/src/token.ts uses expo-secure-store, untouched
// by reloadReactNative), so this opens straight onto the signed-in Home
// screen without repeating sign-in or enrolment.
describe("navigate Home to a list and a record, then back", () => {
  beforeAll(async () => {
    await device.reloadReactNative();
  });

  it("opens Administration, opens a row, then returns to Home", async () => {
    await expect(element(by.label("Administration"))).toBeVisible();
    await element(by.label("Administration")).tap();

    // core/users is seeded with all 15 demo personas (packages/core/src/seed.ts),
    // so amina.saleh's own row is always present.
    await expect(element(by.text("Amina Saleh"))).toBeVisible();
    await element(by.text("Amina Saleh")).tap();

    await expect(element(by.text("amina.saleh@gonxt.ae"))).toBeVisible();

    await element(by.label("Back")).tap();
    await expect(element(by.text("Amina Saleh"))).toBeVisible();

    await element(by.label("Back")).tap();
    await expect(element(by.label("Administration"))).toBeVisible();
  });
});
