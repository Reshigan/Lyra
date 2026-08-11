import type { MessageKey } from "./i18n";
import type { PersonaVariant, Workspace } from "./workspace";

export interface TabConfig {
  labelKey: MessageKey;
  icon: string;
  /** A `RESOURCE_BY_HREF` value from nav.ts — the tab's Redirect target is `/m/${screen}`. */
  screen: string;
  /** A purpose-built journey screen under `app/j/`, used instead of the generic
   *  list when one exists. `screen` stays as the fallback it replaces. */
  route?: string;
}

const HOME_TAB: TabConfig = { labelKey: "nav.home", icon: "home", screen: "core/users" };

export const PERSONA_TABS: Record<Workspace, TabConfig[]> = {
  axis: [
    { labelKey: "tab.queue", icon: "list", screen: "axis/cases", route: "/j/queue" },
    // Same screen, deadline-only: the SLA tab is the queue with everything a
    // clock is not pressing on filtered out (app/j/queue.tsx).
    { labelKey: "tab.sla", icon: "time", screen: "axis/cases", route: "/j/queue?filter=sla" },
    { labelKey: "tab.capture", icon: "camera", screen: "axis/cases", route: "/j/capture" }
  ],
  orbit: [
    { labelKey: "tab.inbox", icon: "chatbubbles", screen: "orbit/conversations", route: "/j/threads" },
    { labelKey: "tab.renewals", icon: "refresh", screen: "orbit/conversations", route: "/j/renewals" },
    { labelKey: "tab.approvals", icon: "checkmark-circle", screen: "orbit/conversations", route: "/j/approvals" }
  ],
  signal: [
    { labelKey: "tab.campaigns", icon: "megaphone", screen: "signal/campaigns", route: "/j/campaigns" },
    // Same screen, budgeted campaigns only: the budget tab is the cockpit with
    // everything nobody set a ceiling on dropped (app/j/campaigns.tsx).
    { labelKey: "tab.budget", icon: "cash", screen: "signal/campaigns", route: "/j/campaigns?view=budget" },
    { labelKey: "tab.attribution", icon: "trending-up", screen: "signal/campaigns" }
  ],
  scout: [
    { labelKey: "tab.clusters", icon: "layers", screen: "scout/signals" },
    { labelKey: "tab.whitespace", icon: "search", screen: "scout/signals" },
    { labelKey: "tab.panel", icon: "people", screen: "scout/signals" }
  ],
  north: [
    { labelKey: "tab.brief", icon: "sunny", screen: "north/metrics", route: "/j/brief" },
    { labelKey: "tab.decisions", icon: "git-branch", screen: "north/metrics" },
    { labelKey: "tab.boardpack", icon: "bar-chart", screen: "north/metrics" }
  ],
  admin: [
    { labelKey: "tab.approvals", icon: "checkmark-done", screen: "core/users", route: "/j/approvals" },
    { labelKey: "tab.staff", icon: "people", screen: "core/users" },
    { labelKey: "nav.settings", icon: "settings", screen: "core/users" }
  ],
  distribution: [{ ...HOME_TAB, screen: "dist/quote-requests" }],
  ledger: [{ ...HOME_TAB, screen: "ledger/txns" }],
  compliance: [{ ...HOME_TAB, screen: "compliance/dsar-requests" }],
  settings: [{ ...HOME_TAB, screen: "core/users" }]
};

/** `north.board` keeps the same 3-tab slots, swapping the 2nd tab's label —
 *  exact-role precedence resolved once by `resolvePersona` (workspace.ts). */
export function tabsFor(workspace: Workspace, variant: PersonaVariant): TabConfig[] {
  const tabs = PERSONA_TABS[workspace];
  if (workspace !== "north" || variant !== "board") return tabs;
  return tabs.map((tab) => (tab.labelKey === "tab.decisions" ? { ...tab, labelKey: "tab.governance" } : tab));
}
