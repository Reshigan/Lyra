import type { MessageKey } from "./i18n";
import type { PersonaVariant, Workspace } from "./workspace";

export interface TabConfig {
  labelKey: MessageKey;
  icon: string;
  /** A nav key from nav.ts (`resourceForNavKey`) — the tab's Redirect target is
   *  `/m/${screen}`, which is the generic list for that workspace. It was a
   *  resource path ("core/users") until that shipped: `/m/core/users` matches
   *  `[nav]/[id]`, so every routeless tab asked the API for a record whose id
   *  was the word "users" and rendered a 404 at the person whose tab it is. */
  screen: string;
  /** A purpose-built journey screen under `app/j/`, used instead of the generic
   *  list when one exists. `screen` stays as the fallback it replaces. */
  route?: string;
}

const HOME_TAB: TabConfig = { labelKey: "nav.home", icon: "home", screen: "admin" };

export const PERSONA_TABS: Record<Workspace, TabConfig[]> = {
  axis: [
    { labelKey: "tab.queue", icon: "list", screen: "axis", route: "/j/queue" },
    // Same screen, deadline-only: the SLA tab is the queue with everything a
    // clock is not pressing on filtered out (app/j/queue.tsx).
    { labelKey: "tab.sla", icon: "time", screen: "axis", route: "/j/queue?filter=sla" },
    { labelKey: "tab.capture", icon: "camera", screen: "axis", route: "/j/capture" }
  ],
  orbit: [
    { labelKey: "tab.inbox", icon: "chatbubbles", screen: "orbit", route: "/j/threads" },
    { labelKey: "tab.renewals", icon: "refresh", screen: "orbit", route: "/j/renewals" },
    { labelKey: "tab.approvals", icon: "checkmark-circle", screen: "orbit", route: "/j/approvals" }
  ],
  signal: [
    { labelKey: "tab.campaigns", icon: "megaphone", screen: "signal", route: "/j/campaigns" },
    // Same screen, budgeted campaigns only: the budget tab is the cockpit with
    // everything nobody set a ceiling on dropped (app/j/campaigns.tsx).
    { labelKey: "tab.budget", icon: "cash", screen: "signal", route: "/j/campaigns?view=budget" },
    { labelKey: "tab.attribution", icon: "trending-up", screen: "signal", route: "/j/attribution" }
  ],
  scout: [
    { labelKey: "tab.clusters", icon: "layers", screen: "scout", route: "/j/clusters" },
    { labelKey: "tab.whitespace", icon: "search", screen: "scout", route: "/j/whitespace" },
    { labelKey: "tab.panel", icon: "people", screen: "scout", route: "/j/panel" }
  ],
  north: [
    { labelKey: "tab.brief", icon: "sunny", screen: "north", route: "/j/brief" },
    { labelKey: "tab.decisions", icon: "git-branch", screen: "north", route: "/j/decisions" },
    { labelKey: "tab.boardpack", icon: "bar-chart", screen: "north", route: "/j/boardpack" }
  ],
  admin: [
    { labelKey: "tab.approvals", icon: "checkmark-done", screen: "admin", route: "/j/approvals" },
    { labelKey: "tab.staff", icon: "people", screen: "admin" },
    // Not settings: a phone admin checks what happened, and a settings tab
    // pointed at the same user list as tab.staff was a tab that said nothing.
    { labelKey: "tab.audit", icon: "shield-checkmark", screen: "admin", route: "/j/audit" }
  ],
  distribution: [{ ...HOME_TAB, screen: "distribution" }],
  // docs/08 §2 has no finance row, so this is read off the doc's thesis: the
  // phone is where decisions happen. A controller's decisions are the money
  // that stopped moving, the approvals waiting on them, and the reconciliation
  // that says whether the two ledgers still agree.
  ledger: [
    { labelKey: "tab.money", icon: "wallet", screen: "ledger", route: "/j/money" },
    { labelKey: "tab.approvals", icon: "checkmark-circle", screen: "ledger", route: "/j/approvals" },
    { labelKey: "tab.recon", icon: "git-compare", screen: "ledger-recon" }
  ],
  compliance: [
    { labelKey: "tab.requests", icon: "document-text", screen: "compliance", route: "/j/requests" },
    { labelKey: "tab.approvals", icon: "checkmark-circle", screen: "compliance", route: "/j/approvals" },
    // The officer's own instrument: `core:audit:read` is what the role is for,
    // and a DSAR refusal is defended out of the log (docs/12).
    { labelKey: "tab.audit", icon: "shield-checkmark", screen: "compliance", route: "/j/audit" }
  ],
  settings: [{ ...HOME_TAB, screen: "admin" }]
};

/** `north.board` keeps the same 3-tab slots, swapping the 2nd tab's label —
 *  exact-role precedence resolved once by `resolvePersona` (workspace.ts). */
export function tabsFor(workspace: Workspace, variant: PersonaVariant): TabConfig[] {
  const tabs = PERSONA_TABS[workspace];
  if (workspace !== "north" || variant !== "board") return tabs;
  return tabs.map((tab) => (tab.labelKey === "tab.decisions" ? { ...tab, labelKey: "tab.governance" } : tab));
}
