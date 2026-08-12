/**
 * Machine strings a person ends up reading. Enum values, event names and column
 * keys are minted in code and surface on screens — the web tables, the mobile
 * lists — so the two surfaces have to spell them the same way, which is why
 * this lives in core rather than beside either one.
 */

/**
 * Words this platform never spells in lower case. Lowercasing is what makes
 * `pendingSettlement` and `PENDING_SETTLEMENT` land in the same place, and it
 * cost us "Ai agent pause" on the home timeline and "Dsar" on the compliance
 * queue — the two initialisms a regulator reads most.
 */
const ACRONYMS = new Set([
  "ai",
  "api",
  "crm",
  "dsar",
  "fnol",
  "id",
  "kpi",
  "kyc",
  "llm",
  "mfa",
  "ocr",
  "oidc",
  "pii",
  "pos",
  "psp",
  "qa",
  "saml",
  "sla",
  "sms",
  "sso",
  "url",
  "vat"
]);

/**
 * `pending_settlement` → `Pending settlement`, `core.session.login` → `Core
 * session login`, `ai.agent.pause` → `AI agent pause`. Readable beats faithful.
 */
export function humanise(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim()
    .toLowerCase();
  if (!words) return value;
  const said = words
    .split(" ")
    .map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word))
    .join(" ");
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}`;
}

/**
 * `core:api_keys:revoke` → `Revoke API keys`. A permission is minted as
 * module / resource / action, and the only part of that a person choosing an
 * API key's scopes cares about is the last two — the module is the group they
 * are already reading under. Anything that is not three parts is said as words
 * rather than dropped: a wildcard grant is still something the actor holds.
 */
export function permissionTitle(permission: string): string {
  const [, resource, action] = permission.split(":");
  return resource && action ? humanise(`${action}_${resource}`) : humanise(permission);
}
