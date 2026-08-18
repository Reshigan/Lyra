import { admin } from "./admin";
import { analytics } from "./analytics";
import { axis } from "./axis";
import { compliance } from "./compliance";
import { distribution } from "./distribution";
import { ledger } from "./ledger";
import { north } from "./north";
import { orbit } from "./orbit";
import { scout } from "./scout";
import { signal } from "./signal";
import type { WorkspaceSpec } from "./spec";
import { moduleOf, shouldInclude } from "../routing";

// Every declarative workspace, keyed by the nav href /v1/me hands out. Adding a
// module is adding a file here — the routes, the tabs, the forms and the RBAC
// gating all follow from the spec. Rail order, matching WORKSPACE_PATHS.
//
// Gated by the same LYRA_MODULES flag routes.ts uses: without this a
// `LYRA_MODULES=north` build still answered /axis through the generic
// `:module` catch-all, even though axis's own routes were never registered.
// Non-module workspaces (ledger, admin, analytics…) are never gated —
// moduleOf() returns null for them.

export const WORKSPACES: readonly WorkspaceSpec[] = [
  axis,
  orbit,
  signal,
  scout,
  north,
  distribution,
  ledger,
  analytics,
  compliance,
  admin
].filter((spec) => {
  const module = moduleOf(spec.path);
  return !module || shouldInclude(module);
});

export function workspaceFor(path: string): WorkspaceSpec | undefined {
  return WORKSPACES.find((spec) => spec.path === path);
}
