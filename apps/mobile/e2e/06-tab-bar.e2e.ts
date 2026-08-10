import { beforeAll, describe, it } from "@jest/globals";
import { by, device, element, expect } from "detox";

// Flow 6. Continues the shared session (see e2e/README.md) — the only
// seeded persona is tenant.admin (e2e/env.ts TENANT_ADMIN), which resolves
// to the `admin` workspace (workspace.ts) and PERSONA_TABS.admin
// (personas.ts): Approvals, Staff, Settings, More.
describe("tab bar matches the signed-in persona", () => {
  beforeAll(async () => {
    await device.reloadReactNative();
  });

  it("shows exactly the admin workspace's 3 tabs plus More", async () => {
    await expect(element(by.label("Approvals"))).toBeVisible();
    await expect(element(by.label("Staff"))).toBeVisible();
    await expect(element(by.label("Settings"))).toBeVisible();
    await expect(element(by.label("More"))).toBeVisible();
  });

  it("switches tabs without losing the signed-in session", async () => {
    await element(by.label("Staff")).tap();
    await expect(element(by.label("Administration"))).toBeVisible();
    await element(by.label("More")).tap();
    await expect(element(by.text("Amina Saleh"))).toBeVisible();
  });
});
