import { Form, NavLink } from "react-router";
import type { Brand, NavItem } from "../api.server";
import type { Translate } from "../i18n";
import { isRouted } from "../routing";

// The frame every workspace renders inside: brand mark and account controls on
// top, a labelled navigation sidebar beside the work.
//
// The sidebar is text-labelled, always. docs/07 §3 describes a rail that
// collapses to icons; that is overridden here by an explicit product decision —
// an icon-only rail costs every user a hover to read the nav and costs a
// screen-reader user the label outright. `item.icon` is carried through as a
// data attribute so a later icon pass can decorate the label without replacing
// it.

export interface ShellProps {
  t: Translate;
  nav: NavItem[];
  brand: Brand | null;
  /** Falls back to the tenant's own name; the product name is never a literal. */
  tenantName: string;
  actorName: string | null;
  children: React.ReactNode;
}

export function Shell({ t, nav, brand, tenantName, actorName, children }: ShellProps) {
  const productName = brand?.name ?? tenantName;
  // The API returns every item this actor may open, including modules whose
  // screens have not shipped yet. Linking to an unrouted path would hand them a
  // 404, so the shell shows what it can actually open.
  const items = nav.filter((item) => item.href === "/" || isRouted(item.href));
  // The only five properties a tenant may re-map (docs/01 §6, tokens.css).
  const palette = brand?.palette;
  const logo = brand?.logo?.dark ?? brand?.logo?.light ?? brand?.logo?.mark;

  return (
    <div
      className="min-h-screen bg-bg text-text"
      style={
        {
          ...(palette?.accent ? { "--accent": palette.accent } : {}),
          ...(palette?.accentHover ? { "--accent-hover": palette.accentHover } : {}),
          ...(palette?.accentContrast ? { "--accent-contrast": palette.accentContrast } : {})
        } as React.CSSProperties
      }
    >
      <a
        href="#workspace"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-surface-2 focus:px-3 focus:py-2"
      >
        {t("app.skipToContent")}
      </a>

      <header className="flex h-14 items-center gap-3 border-b border-border bg-surface-1 px-4">
        <span className="flex items-center gap-2 font-display text-14 tracking-wide">
          {logo ? (
            <img src={logo} alt={productName} className="h-6 w-auto" />
          ) : (
            productName
          )}
        </span>

        <div className="ms-auto flex items-center gap-3">
          {actorName ? (
            <span className="hidden text-12 text-muted sm:inline">
              {t("header.signedInAs", { name: actorName })}
            </span>
          ) : null}
          <NavLink
            to="/settings"
            className="rounded-md px-2 py-1 text-12 text-muted hover:bg-surface-2 hover:text-text"
          >
            {t("header.settings")}
          </NavLink>
          <Form method="post" action="/logout">
            <button
              type="submit"
              className="rounded-md px-2 py-1 text-12 text-muted hover:bg-surface-2 hover:text-text"
            >
              {t("header.signOut")}
            </button>
          </Form>
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-3.5rem)]">
        <nav
          aria-label={t("nav.primary")}
          className="w-60 shrink-0 border-e border-border bg-surface-1 p-3"
        >
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.href}>
                <NavItemLink item={item} t={t} />
                {item.children?.length ? (
                  <ul className="mt-1 flex flex-col gap-1 ps-3">
                    {item.children.filter((child) => isRouted(child.href)).map((child) => (
                      <li key={child.href}>
                        <NavItemLink item={child} t={t} nested />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </nav>

        <main id="workspace" tabIndex={-1} className="min-w-0 flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

function NavItemLink({ item, t, nested }: { item: NavItem; t: Translate; nested?: boolean }) {
  return (
    <NavLink
      to={item.href}
      end={item.href === "/"}
      data-icon={item.icon}
      className={({ isActive }) =>
        [
          "block rounded-md px-3 py-2 text-start transition-colors duration-150",
          nested ? "text-12" : "text-13",
          isActive
            ? "border-s-2 border-accent bg-surface-2 font-medium text-text"
            : "text-muted hover:bg-surface-2 hover:text-text"
        ].join(" ")
      }
    >
      {/* The label is the item. Never an icon on its own. */}
      {t(item.labelKey)}
    </NavLink>
  );
}
