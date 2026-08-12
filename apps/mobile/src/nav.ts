import type { NavItem } from "./api";
import type { Translate } from "./i18n";
import { humanize } from "./rows";

// /v1/me returns nav items as `{ labelKey, href, icon }` — a *workspace* href
// like "/axis", not a resource path. The web shell renders a workspace screen
// per href; mobile has no workspace screens yet, so each href resolves to the
// one collection that workspace is about. That collection is exactly the table
// the API gates the nav item on (apps/api/src/routes/me.ts NAV permissions:
// "axis:cases:read" → axis/cases), which is why this table can be short and why
// it is the only place mobile encodes knowledge of the API's resource layout.
//
// An href with no entry is not an error: it renders as an item that says so,
// rather than a dead row or a hidden one.

const RESOURCE_BY_HREF: Record<string, string> = {
  "/axis": "axis/cases",
  "/orbit": "orbit/conversations",
  "/signal": "signal/campaigns",
  "/scout": "scout/signals",
  "/north": "north/metrics",
  "/distribution": "dist/quote-requests",
  "/ledger": "ledger/txns",
  "/analytics": "analytics/reports",
  "/compliance": "compliance/dsar-requests",
  "/admin": "core/users",
  // Not a nav href — `/v1/me` never sends this one. It is here so a journey
  // screen can open a record the generic detail view can still render:
  // /m/orbit-renewals/{id} (app/j/renewals.tsx). A renewal is not a
  // conversation, so it cannot ride the "/orbit" entry.
  "/orbit-renewals": "orbit/renewals",
  // Same again for SCOUT: a cluster and a whitespace are neither of them the
  // signals the "/scout" nav entry points at (app/j/clusters.tsx,
  // app/j/whitespace.tsx).
  "/scout-clusters": "scout/clusters",
  "/scout-whitespaces": "scout/whitespaces",
  // And NORTH: a decision and a board pack are neither of them the metrics the
  // "/north" nav entry points at (app/j/decisions.tsx, app/j/boardpack.tsx).
  "/north-decisions": "north/decisions",
  "/north-boardpacks": "north/boardpacks",
  // And admin: the audit log is not the users the "/admin" nav entry points at
  // (app/j/audit.tsx).
  "/admin-audit": "core/audit-log",
  // And the ledger: a reconciliation run is not a transaction, and it is the
  // controller's third tab (personas.ts) — the one answer to "do the two
  // ledgers still agree?".
  "/ledger-recon": "ledger/recon-runs"
};

/** `/v1/{module}/{resource}` for a nav href, or `undefined` if mobile has no
 *  screen for it yet ("/" is the home screen itself, not a collection). */
export function resourceFor(href: string): string | undefined {
  return RESOURCE_BY_HREF[href];
}

/** The `[nav]` route segment for an href: "/axis" → "axis". */
export function navKeyFor(href: string): string {
  return href.replace(/^\/+/, "");
}

/** `/axis` → `nav.axis`, matching the catalogue keys the API's labelKey uses. */
export function labelKeyFor(href: string): string {
  return `nav.${navKeyFor(href) || "home"}`;
}

/** Where tapping a nav item goes. Home stays home; everything else opens its
 *  collection. */
export function routeFor(href: string): string | undefined {
  if (href === "/") return undefined;
  return resourceFor(href) ? `/m/${navKeyFor(href)}` : undefined;
}

/** Nav as the home screen renders it: every item keeps its label, and the ones
 *  with nowhere to go are marked rather than dropped. */
export interface NavEntry {
  labelKey: string;
  href: string;
  route: string | undefined;
  resource: string | undefined;
  /** Nesting level: children render indented under their parent. */
  depth: number;
}

export function entriesFor(nav: readonly NavItem[]): NavEntry[] {
  // Children are flattened in place, indented — the home screen is one flat
  // list, and a child silently dropped is a workspace nobody can reach.
  const entries: NavEntry[] = [];
  const walk = (items: readonly NavItem[], depth: number) => {
    for (const item of items) {
      if (item.href !== "/") {
        entries.push({
          labelKey: item.labelKey || labelKeyFor(item.href),
          href: item.href,
          route: routeFor(item.href),
          resource: resourceFor(item.href),
          depth
        });
      }
      if (item.children?.length) walk(item.children, item.href === "/" ? depth : depth + 1);
    }
  };
  walk(nav, 0);
  return entries;
}

/** The title for a nav segment: the catalogue string when the key is known,
 *  else the segment humanized — a garbage deep link (/m/foo) or an API href
 *  newer than this app must never render the raw key "nav.foo". */
export function navTitle(t: Translate, navKey: string, labelKey?: string): string {
  const key = labelKey || labelKeyFor(`/${navKey}`);
  const label = t(key);
  return label === key ? humanize(navKey) : label;
}

/** Reverse of `navKeyFor`, for the `[nav]` route param. */
export function resourceForNavKey(navKey: string): string | undefined {
  return resourceFor(`/${navKey}`);
}
