import { beforeAll, describe, it } from "@jest/globals";
import { by, device, element, expect } from "detox";

// Flow 7. The admin persona's first tab is the cross-module approvals queue
// (personas.ts routes it at /j/approvals), so this is the one journey screen
// the shared tenant.admin session can reach. The brief, thread and capture
// screens belong to north/orbit/axis personas, which this suite does not sign
// in as — see e2e/README.md.
describe("approvals queue", () => {
  beforeAll(async () => {
    await device.reloadReactNative();
  });

  it("opens the queue and offers a reasoned rejection", async () => {
    await element(by.label("Approvals")).tap();
    await expect(element(by.text("Waiting on you"))).toBeVisible();

    // A fresh seed has nothing pending, so the queue states that plainly
    // rather than showing an empty screen with no explanation.
    await expect(element(by.text("Nothing is waiting on your decision."))).toBeVisible();
  });
});
