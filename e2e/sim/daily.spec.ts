import { expect, test } from "@playwright/test";
import {
  loginAsAxisAgent,
  loginAsComplianceOfficer,
  loginAsNorthExec,
  loginAsOrbitRetention,
  loginAsScoutLead,
  loginAsSignalLead
} from "../fixtures.js";
import { PERSONAS } from "../env.js";
import { STAGING_API_ORIGIN } from "./env.js";

// docs/24 sim plan §3/§5: one virtual day per Workflow stage. SIM_DAY (1..30)
// picks this run's slot; the day-driver Workflow sets it per stage rather than
// looping in here, so one failing day doesn't hide the rest. Staging's DB
// persists across days, so assertions below check "no error", never a count.
const SIM_DAY = Number(process.env.SIM_DAY ?? 1);
if (!Number.isInteger(SIM_DAY) || SIM_DAY < 1 || SIM_DAY > 30) {
  throw new Error(`SIM_DAY must be an integer 1..30, got ${process.env.SIM_DAY}`);
}

const DAY_MS = 86_400_000;
const dow = ((SIM_DAY - 1) % 7) + 1; // 1..7, treated as a Mon..Sun cadence
const isWeekday = dow <= 5;

async function demoToken(email: string): Promise<string> {
  const res = await fetch(`${STAGING_API_ORIGIN}/v1/auth/demo/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email })
  });
  if (!res.ok) throw new Error(`demo login failed for ${email}: ${res.status}`);
  const { token } = (await res.json()) as { token: string };
  return token;
}

async function runAs(email: string, path: string): Promise<void> {
  const token = await demoToken(email);
  const res = await fetch(`${STAGING_API_ORIGIN}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`${path} as ${email} failed: ${res.status}`);
}

test.beforeAll(async () => {
  // Advance the virtual clock before anything else this day (docs/24 sim
  // plan §1) — every timestamp minted this run reads as "day SIM_DAY".
  const res = await fetch(`${STAGING_API_ORIGIN}/v1/auth/demo/clock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ advanceMs: DAY_MS })
  });
  if (!res.ok) throw new Error(`clock advance failed: ${res.status}`);
});

test(`sim day ${SIM_DAY}: NORTH dashboard and LEDGER load clean`, async ({ page }) => {
  await loginAsNorthExec(page);
  await page.goto("/north");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.goto("/ledger");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test(`sim day ${SIM_DAY}: weekday desk work`, async ({ page }) => {
  test.skip(!isWeekday, "weekend in the compressed calendar");
  await loginAsAxisAgent(page);
  await page.goto("/axis");
  await expect(page.getByRole("alert")).toHaveCount(0);

  await loginAsOrbitRetention(page);
  await page.goto("/orbit");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test(`sim day ${SIM_DAY}: twice-weekly growth check-in`, async ({ page }) => {
  test.skip(dow !== 2 && dow !== 4, "SIGNAL/SCOUT run Tue/Thu in the compressed calendar");
  await loginAsSignalLead(page);
  await page.goto("/signal");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await runAs(PERSONAS.signalLead.email, "/v1/signal/autopilot/run");

  await loginAsScoutLead(page);
  await page.goto("/scout");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test(`sim day ${SIM_DAY}: weekly compliance and queue sweep`, async ({ page }) => {
  test.skip(dow !== 5, "compliance/queue sweeps run Fridays in the compressed calendar");
  await loginAsComplianceOfficer(page);
  await page.goto("/compliance");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await runAs(PERSONAS.orbitRetention.email, "/v1/orbit/renewals/sweep");
  await runAs(PERSONAS.tenantAdmin.email, "/v1/staff/delegations/expire");
});

test(`sim day ${SIM_DAY}: end-of-run NORTH snapshot`, async () => {
  test.skip(SIM_DAY !== 28, "one snapshot near the end is enough");
  await runAs(PERSONAS.northExec.email, "/v1/north/snapshotter/run");
});
