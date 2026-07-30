import type { NavItem } from "./api";

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
  "/admin": "core/users"
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
}

export function entriesFor(nav: readonly NavItem[]): NavEntry[] {
  return nav
    .filter((item) => item.href !== "/")
    .map((item) => ({
      labelKey: item.labelKey || labelKeyFor(item.href),
      href: item.href,
      route: routeFor(item.href),
      resource: resourceFor(item.href)
    }));
}

/** Reverse of `navKeyFor`, for the `[nav]` route param. */
export function resourceForNavKey(navKey: string): string | undefined {
  return resourceFor(`/${navKey}`);
}
