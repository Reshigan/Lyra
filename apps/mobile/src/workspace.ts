// Mirrors packages/core/src/lens.ts's `defaultWorkspaceForRoles` (the
// mechanism `resolveLens` uses for the web app's default workspace)
// duplicated rather than imported: that file's package.json has no subpath
// export for lens.ts alone, only the barrel root (which pulls in
// drizzle-orm and @lyra/db) — and lens.ts's own header comment already
// documents duplicating this table for the web app's HOME_BY_ROLE_PREFIX
// for the identical reason ("packages/core may not depend on an app").
// Keep this table's precedence in sync with lens.ts by hand if either
// changes; the two tables have not needed to diverge in practice.

export type Workspace =
  | "axis"
  | "orbit"
  | "signal"
  | "scout"
  | "north"
  | "admin"
  | "distribution"
  | "ledger"
  | "compliance"
  | "settings";

export type PersonaVariant = "default" | "board";

export interface Persona {
  workspace: Workspace;
  variant: PersonaVariant;
}

const WORKSPACES: readonly Workspace[] = [
  "axis",
  "orbit",
  "signal",
  "scout",
  "north",
  "admin",
  "distribution",
  "ledger",
  "compliance",
  "settings"
];

export function isWorkspace(value: string): value is Workspace {
  return (WORKSPACES as readonly string[]).includes(value);
}

const WORKSPACE_BY_ROLE: Record<string, string> = {
  "tenant.compliance": "compliance"
};

const WORKSPACE_BY_ROLE_PREFIX: Record<string, string> = {
  tenant: "admin",
  platform: "admin",
  dev: "admin",
  partner: "distribution",
  provider: "scout",
  customer: "settings",
  finance: "ledger"
};

/**
 * Unlike lens.ts, an unrecognized bare prefix does NOT fall through as a
 * workspace: mobile's persona table (personas.ts) is a closed set of 10
 * workspaces, while the web lens can route to any dynamically-registered
 * workspace slug.
 */
export function defaultWorkspaceForRoles(roles: readonly string[]): Workspace {
  for (const role of roles) {
    const exact = WORKSPACE_BY_ROLE[role];
    if (exact && isWorkspace(exact)) return exact;
    const prefix = role.split(".")[0] ?? "";
    const mapped = WORKSPACE_BY_ROLE_PREFIX[prefix];
    if (mapped && isWorkspace(mapped)) return mapped;
    if (prefix && isWorkspace(prefix)) return prefix;
  }
  return "north";
}

/** `north.board` swaps one tab (Decisions -> Governance) but is still the
 *  `north` workspace — an exact-role check, resolved once at bootstrap,
 *  same staleness contract as the workspace itself. */
export function resolvePersona(roles: readonly string[]): Persona {
  const workspace = defaultWorkspaceForRoles(roles);
  const variant: PersonaVariant = workspace === "north" && roles.includes("north.board") ? "board" : "default";
  return { workspace, variant };
}
