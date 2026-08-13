import { expect, test } from "@playwright/test";
import { PERSONAS } from "../env.js";
import { signIn } from "./sign-in.js";

// Regression check for 5890744 on a real deployment: NORTH's anomaly queue
// shipped a "Show" filter whose trigger read "…" because Select handed Radix a
// raw "" for the selected empty option. Read-only.
test("the anomaly Show filter reads its selected option, not an ellipsis", async ({ page }) => {
  await signIn(page, PERSONAS.northExec);
  await page.goto("/north/anomalies");
  const trigger = page.getByRole("combobox").first();
  await expect(trigger).toBeVisible();
  const label = (await trigger.textContent())?.trim() ?? "";
  expect(label, `Show trigger read ${JSON.stringify(label)}`).not.toBe("…");
  expect(label.length).toBeGreaterThan(1);
});
