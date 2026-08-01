import { beforeAll, describe, it } from "@jest/globals";
import { by, device, element, expect } from "detox";
import { SEED_PASSWORD, TENANT_ADMIN } from "./env.js";
import { loadSecret } from "./secret-cache.js";
import { currentTotp } from "./totp.js";

// Flow 4 of 5. amina.saleh is enrolled server-side by now (01 confirmed it),
// so a fresh password sign-in hits the "totp" verify screen, not "enrol" —
// the one branch 01 never exercises. Reuses the secret 01 captured (the
// server keeps the same TOTP secret across sign-ins; only the recovery-codes
// display is one-time, not the secret itself).
describe("returning sign-in asks for a TOTP code, not enrolment", () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  it("verifies with a freshly-computed code and reaches Home", async () => {
    await element(by.label("Email")).typeText(TENANT_ADMIN.email);
    await element(by.label("Password")).typeText(SEED_PASSWORD);
    await element(by.label("Continue")).tap();

    await expect(element(by.text("Two-step verification"))).toBeVisible();
    const code = await currentTotp(loadSecret());
    await element(by.label("Verification code")).typeText(code);
    await element(by.label("Verify")).tap();

    await expect(element(by.label("Administration"))).toBeVisible();
  });
});
