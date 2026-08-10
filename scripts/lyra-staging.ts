import { STAGING_API_ORIGIN, STAGING_WEB_ORIGIN } from "../e2e/sim/env.js";
import { PERSONAS } from "../e2e/env.js";

export interface StagingCheck {
  name: string;
  ok: boolean;
  status?: number;
  detail?: string;
}

export interface StagingSmokeReport {
  checks: StagingCheck[];
}

export interface StagingSmokeOptions {
  fetchImpl?: typeof fetch;
  apiOrigin?: string;
  webOrigin?: string;
}

// One representative, read-only route per module — enough to prove routing +
// RBAC + tenant scoping are wired end to end without mutating staging state.
const MODULE_CHECKS: Array<{ name: string; persona: keyof typeof PERSONAS; path: string }> = [
  { name: "axis:cases", persona: "axisAgent", path: "/v1/axis/cases" },
  { name: "orbit:conversations", persona: "orbitAgent", path: "/v1/orbit/conversations" },
  { name: "signal:campaigns", persona: "signalLead", path: "/v1/signal/campaigns" },
  { name: "scout:clusters", persona: "scoutLead", path: "/v1/scout/clusters" },
  { name: "north:snapshots", persona: "northExec", path: "/v1/north/snapshots" },
  { name: "ledger:txns", persona: "financeController", path: "/v1/ledger/txns" },
  { name: "compliance:dsar-requests", persona: "complianceOfficer", path: "/v1/compliance/dsar-requests" },
  { name: "core:approvals (approval-gate)", persona: "tenantAdmin", path: "/v1/core/approvals" },
  { name: "analytics:exports (export)", persona: "tenantAdmin", path: "/v1/analytics/exports" }
];

async function demoToken(fetchImpl: typeof fetch, apiOrigin: string, email: string): Promise<string> {
  const res = await fetchImpl(`${apiOrigin}/v1/auth/demo/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email })
  });
  if (!res.ok) throw new Error(`demo login failed for ${email}: ${res.status}`);
  const { token } = (await res.json()) as { token: string };
  return token;
}

async function unauthCheck(
  fetchImpl: typeof fetch,
  name: string,
  url: string,
  expectStatus: number,
  init?: RequestInit
): Promise<StagingCheck> {
  try {
    const res = await fetchImpl(url, init);
    return { name, ok: res.status === expectStatus, status: res.status };
  } catch (err) {
    return { name, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function moduleCheck(
  fetchImpl: typeof fetch,
  apiOrigin: string,
  check: (typeof MODULE_CHECKS)[number]
): Promise<StagingCheck> {
  try {
    const token = await demoToken(fetchImpl, apiOrigin, PERSONAS[check.persona].email);
    const res = await fetchImpl(`${apiOrigin}${check.path}`, { headers: { authorization: `Bearer ${token}` } });
    return { name: check.name, ok: res.ok, status: res.status };
  } catch (err) {
    return { name: check.name, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function stagingSmoke(options: StagingSmokeOptions = {}): Promise<StagingSmokeReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiOrigin = options.apiOrigin ?? STAGING_API_ORIGIN;
  const webOrigin = options.webOrigin ?? STAGING_WEB_ORIGIN;

  const checks: StagingCheck[] = [
    await unauthCheck(fetchImpl, "api:health", `${apiOrigin}/health`, 200),
    await unauthCheck(fetchImpl, "web:root-redirect", webOrigin, 302, { redirect: "manual" }),
    await unauthCheck(fetchImpl, "web:login", `${webOrigin}/login`, 200)
  ];

  for (const check of MODULE_CHECKS) {
    checks.push(await moduleCheck(fetchImpl, apiOrigin, check));
  }

  return { checks };
}
