// The URL map. This file says which paths exist and where an actor lands; it
// says nothing about what a person may see — visibility and labels come from
// /v1/me, so a role change takes effect on the next request (docs/07 §3).

/** Module workspaces, in rail order. */
export const WORKSPACE_PATHS = [
  "/axis",
  "/orbit",
  "/signal",
  "/scout",
  "/north",
  "/admin",
  "/settings"
] as const;

export type WorkspacePath = (typeof WORKSPACE_PATHS)[number];

/**
 * Routes that will never appear in the nav, and why. The test asserts every
 * other route has a `nav.*` label key, so a new workspace cannot ship unlabelled.
 */
export const HIDDEN_ROUTES: Record<string, string> = {
  "/login": "pre-session: renders outside the shell, so there is no nav to be in",
  "/logout": "action only, no UI",
  "/settings": "reached from the account menu in the header, not the module rail"
};

/**
 * docs/07 §3: home per role is that role's primary workspace. Role keys are
 * `<prefix>.<level>`, and for module roles the prefix is the module — so
 * `axis.lead` lands on /axis without a table to maintain. Only the prefixes
 * that are not module names need an entry.
 */
const HOME_BY_ROLE_PREFIX: Record<string, string> = {
  tenant: "/admin",
  platform: "/admin",
  dev: "/admin",
  customer: "/settings"
};

/**
 * Where "/" sends this actor. Never sends them somewhere their nav does not
 * offer — a landing redirect into a 403 is a worse first paint than a list.
 */
export function landingFor(roles: readonly string[], nav: readonly { href: string }[]): string {
  const offered = new Set(nav.map((item) => item.href));
  for (const role of roles) {
    const prefix = role.split(".")[0] ?? "";
    const path = HOME_BY_ROLE_PREFIX[prefix] ?? `/${prefix}`;
    if (offered.has(path) && isRouted(path)) return path;
  }
  // No role matched: the first thing they are allowed to open, or their own
  // settings, which every actor can always reach.
  return nav.map((item) => item.href).find((href) => href !== "/" && isRouted(href)) ?? "/settings";
}

export function isRouted(path: string): boolean {
  return (WORKSPACE_PATHS as readonly string[]).includes(path);
}

/** `/axis` → `nav.axis`. The label itself comes from the catalogue. */
export function labelKeyFor(path: string): string {
  return `nav.${path.replace(/^\//, "") || "home"}`;
}
