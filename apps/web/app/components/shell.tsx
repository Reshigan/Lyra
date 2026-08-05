import { Form, NavLink } from "react-router";
import type { Brand, NavItem } from "../api.server";
import type { Translate } from "../i18n";
import { isRouted } from "../routing";
import { SearchPalette } from "./search";

// The frame every workspace renders inside: brand mark and account controls on
// top, a labelled navigation sidebar beside the work.
//
// The sidebar is text-labelled, always. docs/07 §3 describes a rail that
// collapses to icons; that is overridden here by an explicit product decision —
// an icon-only rail costs every user a hover to read the nav and costs a
// screen-reader user the label outright. `item.icon` is carried through as a
// data attribute so a later icon pass can decorate the label without replacing
// it.
//
// Below the md breakpoint the sidebar becomes a horizontally scrollable strip
// under the header rather than an off-canvas drawer: the labels stay on screen,
// nothing has to be opened to find out where you are, and it needs no state.

/**
 * `Brand` (api.server.ts) carries the name, logo and palette; the typeface half
 * of the contract is `brandJson.font`, written by the settings screen and shaped
 * by BrandJson in packages/db/src/json.ts.
 */
export type TenantBrand = Brand & { font?: string };

/**
 * The typeface half of the tenant override contract (tokens.css §TENANT
 * OVERRIDE CONTRACT). `brand.font` is tenant-controlled text on its way into a
 * custom property, so it is never interpolated: it selects a stack from this
 * table or it selects nothing at all, and anything off the list leaves the
 * default token in place.
 *
 * A Map, not an object, so a key like `__proto__` cannot answer with something
 * inherited. Stacks keep the Arabic fallback tokens.css declares — dropping it
 * regresses RTL rendering to a font with no Arabic coverage.
 */
const FONT_STACKS = new Map<string, string>([
  ["archivo", '"Archivo", "IBM Plex Sans Arabic", system-ui, sans-serif'],
  ["instrument-sans", '"Instrument Sans", "IBM Plex Sans Arabic", system-ui, sans-serif'],
  ["space-grotesk", '"Space Grotesk", "IBM Plex Sans Arabic", system-ui, sans-serif'],
  ["inter", '"Inter", "IBM Plex Sans Arabic", system-ui, sans-serif'],
  ["ibm-plex-sans-arabic", '"IBM Plex Sans Arabic", "Instrument Sans", system-ui, sans-serif']
]);

/**
 * The five custom properties a tenant may re-map, and nothing else (docs/01 §6,
 * packages/ui/src/tokens.css). One typeface covers both roles because the
 * settings screen offers one and says so ("Applies to headings and body text
 * alike"). Exported for shell.brand.test.ts.
 */
export function brandStyle(brand: TenantBrand | null): React.CSSProperties {
  const palette = brand?.palette;
  const font = brand?.font === undefined ? undefined : FONT_STACKS.get(brand.font);
  return {
    ...(palette?.accent ? { "--accent": palette.accent } : {}),
    ...(palette?.accentHover ? { "--accent-hover": palette.accentHover } : {}),
    ...(palette?.accentContrast ? { "--accent-contrast": palette.accentContrast } : {}),
    ...(font ? { "--font-display": font, "--font-ui": font } : {})
  } as React.CSSProperties;
}

export interface ShellProps {
  t: Translate;
  nav: NavItem[];
  brand: Brand | null;
  /** Falls back to the tenant's own name; the product name is never a literal. */
  tenantName: string;
  actorName: string | null;
  children: React.ReactNode;
}

/**
 * Product identity, not brand: the five modules own an accent (docs/07 §6), so
 * the marker beside a nav label tells you which workspace you are in before you
 * have read the word. Everything else uses the tenant accent.
 */
const MODULE_ACCENT: Record<string, string> = {
  "/axis": "var(--module-axis)",
  "/orbit": "var(--module-orbit)",
  "/signal": "var(--module-signal)",
  "/scout": "var(--module-scout)",
  "/north": "var(--module-north)"
};

/** Nav is grouped: a heading item carries no link of its own, only labelled
 *  children. Leaves (all in real, non-routed order) drop unrouted destinations
 *  the same way flat items always did. */
function routedLeaves(item: NavItem): NavItem[] {
  if (item.heading) return (item.children ?? []).flatMap(routedLeaves);
  return isRouted(item.href) || item.href === "/" ? [item] : [];
}

export function Shell({ t, nav, brand, tenantName, actorName, children }: ShellProps) {
  const productName = brand?.name ?? tenantName;
  // The API returns every item this actor may open, including modules whose
  // screens have not shipped yet (and headings whose one real destination
  // hasn't). Linking to an unrouted path would hand them a 404, so the shell
  // shows what it can actually open — headings with nothing left are dropped.
  const groups: { heading: NavItem | null; items: NavItem[] }[] = [];
  for (const item of nav) {
    if (item.heading) {
      const items = routedLeaves(item);
      if (items.length) groups.push({ heading: item, items });
    } else if (item.href === "/" || isRouted(item.href)) {
      groups.push({ heading: null, items: [item] });
    }
  }
  const items = groups.flatMap((g) => g.items);
  const logo = brand?.logo?.dark ?? brand?.logo?.light ?? brand?.logo?.mark;

  return (
    <div className="min-h-screen bg-bg text-text" style={brandStyle(brand)}>
      <a
        href="#workspace"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-surface-2 focus:px-3 focus:py-2 focus:text-13"
      >
        {t("app.skipToContent")}
      </a>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface-1/95 px-4 backdrop-blur-sm">
        <NavLink
          to="/"
          end
          className="flex items-center gap-2 rounded-md px-1 py-1 font-display text-14 tracking-wide text-text hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {logo ? <img src={logo} alt={productName} className="h-6 w-auto" /> : productName}
        </NavLink>

        <div className="ms-auto flex items-center gap-1">
          <SearchPalette t={t} />
          {actorName ? (
            <span className="me-2 hidden font-ui text-12 text-muted sm:inline">
              {t("header.signedInAs", { name: actorName })}
            </span>
          ) : null}
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              [
                "rounded-md px-2.5 py-1.5 font-ui text-12 transition-colors duration-150",
                isActive ? "bg-surface-2 text-text" : "text-muted hover:bg-surface-2 hover:text-text"
              ].join(" ")
            }
          >
            {t("header.settings")}
          </NavLink>
          <Form method="post" action="/logout">
            <button
              type="submit"
              className="rounded-md px-2.5 py-1.5 font-ui text-12 text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-text"
            >
              {t("header.signOut")}
            </button>
          </Form>
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-3.5rem)] flex-col md:flex-row">
        <nav
          aria-label={t("nav.primary")}
          className={[
            // Small screens: one scrollable row under the header, labels intact,
            // group headings dropped — there is no room for them in a strip.
            "flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-surface-1 p-2 md:hidden"
          ].join(" ")}
        >
          {items.map((item) => (
            <NavItemLink key={item.href} item={item} t={t} />
          ))}
        </nav>

        <nav
          aria-label={t("nav.primary")}
          className="hidden md:sticky md:top-14 md:flex md:h-[calc(100vh-3.5rem)] md:w-60 md:shrink-0 md:flex-col md:gap-0.5 md:overflow-y-auto md:border-e md:border-border md:p-3"
        >
          {groups.map((group, i) => (
            <div key={group.heading?.href ?? group.items[0]?.href ?? i} className="mb-1">
              {group.heading ? (
                <h2 className="mb-1 mt-3 px-3 font-ui text-11 font-medium uppercase tracking-wide text-subtle first:mt-0">
                  {t(group.heading.labelKey)}
                </h2>
              ) : null}
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <NavItemLink item={item} t={t} nested={Boolean(group.heading)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <main
          id="workspace"
          tabIndex={-1}
          className="mx-auto min-w-0 w-full max-w-[100rem] flex-1 p-4 sm:p-6"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

function NavItemLink({ item, t, nested }: { item: NavItem; t: Translate; nested?: boolean }) {
  const accent = MODULE_ACCENT[item.href] ?? "var(--accent)";
  return (
    <NavLink
      to={item.href}
      end={item.href === "/"}
      data-icon={item.icon}
      className={({ isActive }) =>
        [
          "group flex shrink-0 items-center gap-2 rounded-md px-3 text-start font-ui transition-colors duration-150",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          nested ? "py-1.5 text-12" : "py-2 text-13",
          isActive
            ? "bg-surface-2 font-medium text-text"
            : "text-muted hover:bg-surface-2 hover:text-text"
        ].join(" ")
      }
    >
      {({ isActive }) => (
        <>
          {/* Which workspace, before the word is read. Decoration only — the
              label is the item, never an icon or a dot on its own. */}
          <span
            aria-hidden="true"
            className={[
              "size-1.5 shrink-0 rounded-full transition-opacity duration-150",
              nested ? "opacity-0" : isActive ? "opacity-100" : "opacity-30 group-hover:opacity-60"
            ].join(" ")}
            style={{ background: accent }}
          />
          <span className="truncate">{t(item.labelKey)}</span>
        </>
      )}
    </NavLink>
  );
}
