import { beforeAll, describe, it } from "@jest/globals";
import { by, device, element, waitFor } from "detox";
import { SEED_PASSWORD, TENANT_ADMIN, TENANT_SLUG } from "./env.js";
import { saveSecret } from "./secret-cache.js";
import { currentTotp } from "./totp.js";

// Flow 1 of 5 (docs/08-mobile.md §7 names "the five signature flows" as the
// M6-vision Brief/Approvals/Doc-capture/Agent-console/Live-tiles set — none of
// which exist yet per apps/mobile/README.md. These five specs instead cover
// every screen the README says works TODAY: password sign-in, first-time TOTP
// enrolment, recovery codes, list, detail, sign-out and locale. See
// e2e/README.md for the mapping and the reasoning.
//
// Runs first (file-name order — jest's default, and this suite's only cross-
// file dependency): amina.saleh is unenrolled on the fresh seed, so this is
// the one spec that can walk the actual enrolment screen. It leaves her
// signed in; 02 and 03 continue from that session via reloadReactNative.
describe("sign-in and first-time enrolment", () => {
  beforeAll(async () => {
    await device.launchApp({ delete: true });
  });

  it("walks password sign-in, TOTP enrolment and recovery codes to the Home workspace", async () => {
    await element(by.label("Email")).typeText(TENANT_ADMIN.email);
    await element(by.label("Password")).typeText(SEED_PASSWORD);
    await element(by.label("Continue")).tap();

    // The API only asks for a tenant slug when an email resolves to more than
    // one tenant (e2e/login.spec.ts, web). The seed here is single-tenant, so
    // this normally never renders — kept for parity if that ever changes.
    try {
      await waitFor(element(by.label("Workspace"))).toBeVisible().withTimeout(3000);
      await element(by.label("Workspace")).typeText(TENANT_SLUG);
      await element(by.label("Continue")).tap();
    } catch {
      /* single-tenant seed: field never appeared */
    }

    await waitFor(element(by.text("Set up two-step verification"))).toBeVisible().withTimeout(10000);
    // attributes shape differs slightly by platform; `text` covers both RN
    // Text renders (iOS) and TextView renders (Android) for this element.
    const attrs = (await element(by.id("enrol-secret")).getAttributes()) as { text?: string };
    const secret = (attrs.text ?? "").trim();
    saveSecret(secret);

    await element(by.label("Verification code")).typeText(await currentTotp(secret));
    await element(by.label("Confirm")).tap();

    await waitFor(element(by.text("Save your recovery codes"))).toBeVisible().withTimeout(10000);
    await element(by.label("I have saved them")).tap();

    await waitFor(element(by.label("Administration"))).toBeVisible().withTimeout(10000);

    // The codes are held in the keystore, not just component state: a relaunch
    // that still showed the recovery screen here would mean "I have saved
    // them" never actually cleared them, and they'd sit in storage forever.
    await device.launchApp({ newInstance: true });
    await waitFor(element(by.label("Administration"))).toBeVisible().withTimeout(10000);
  });
});
