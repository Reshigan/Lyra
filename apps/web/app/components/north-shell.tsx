import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate, useSearchParams, useSubmit } from "react-router";
import { Breadcrumbs, Menu, ModuleSwitcher, type LyraModule, type ModuleLink } from "@lyra/ui";
import type { NavItem } from "../api.server";
import { translator, type Translate } from "../i18n";
import type { SessionBootstrap } from "../session.server";
import { ColdOpen } from "./cold-open";
import { Companion } from "./companion";
import { ConstellationMark } from "./mark";
import { Meridian } from "./meridian";
import { SearchPalette } from "./search";
import { PostureChips } from "./posture";
import { inboxAsOf, shiftFrom } from "./shift";
import { ShiftRail } from "./shift-rail";
import { ThemeToggle } from "./theme-toggle";
import {
  accountMenuItems,
  brandStyle,
  crumbsFor,
  lockupNames,
  PageSkeleton,
  profilesFor,
  routedLeaves
} from "./shell";

const NORTH_ACCENT = "var(--module-north)";

/**
 * NORTH's own shell: a scoped rail (only /north/* destinations), the same
 * chrome primitives Shell uses (brandStyle, lockupNames, crumbsFor,
 * accountMenuItems, PageSkeleton — all imported, not reimplemented), and the
 * multi-role switcher when this actor's roles reach more than one shell.
 * Duplicates Shell's header/rail/footer JSX rather than sharing a ShellChrome
 * component — see this plan's Global Constraints for why that extraction is
 * deferred.
 */
export function NorthShell({
  session,
  children
}: {
  session: SessionBootstrap;
  children: React.ReactNode;
}) {
  const t = translator(session.locale, session.overrides);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const submit = useSubmit();
  const [searchParams, setSearchParams] = useSearchParams();
  const [companion, setCompanion] = useState(false);

  // NORTH's own destinations only: routedLeaves already drops anything the
  // nav lists that has no real route, so this just narrows further to /north.
  const items: NavItem[] = session.nav
    .flatMap(routedLeaves)
    .filter((item) => item.href === "/north" || item.href.startsWith("/north/"));

  const { product: productName, tenant: servedName } = lockupNames(session.brand, session.tenantName);
  const logo = session.brand?.logo?.dark ?? session.brand?.logo?.light ?? session.brand?.logo?.mark;
  const crumbs = crumbsFor(pathname, session.nav, t);
  const profiles = profilesFor(session.roles, session.nav, pathname);
  const roleKey = profiles.find((profile) => profile.active)?.role ?? session.roles[0] ?? null;
  const mayCompanion = session.permissions.includes("ai:runs:read");
  const settling = false;
  const slow = useSettledFor(settling, 400);

  // Meridian is fully URL-driven here (docs/superpowers/specs
  // /2026-08-15-north-shell-fork-design.md § Meridian): ?asOf=<epoch-ms> is
  // the entire replay state, no client-only scrub state. Dragging updates the
  // param via history replace so back/forward and shareable links both work.
  const asOfParam = searchParams.get("asOf");
  const initialAsOf = asOfParam ? Number(asOfParam) : null;
  function handleScrub(value: number | null) {
    const next = new URLSearchParams(searchParams);
    if (value === null) next.delete("asOf");
    else next.set("asOf", String(value));
    setSearchParams(next, { replace: true });
  }

  const moduleLinks: ModuleLink[] = session.availableShells.map((shell) => ({
    id: shell as LyraModule,
    label: t(`nav.${shell}`),
    href: `/${shell}`
  }));

  return (
    <div className="lyra-field min-h-screen bg-bg text-text" style={brandStyle(session.brand)}>
      <ColdOpen name={productName} />
      <a
        href="#workspace"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-surface-2 focus:px-3 focus:py-2 focus:text-13"
      >
        {t("app.skipToContent")}
      </a>

      <header className="lyra-vt-chrome sticky top-0 z-30 flex h-[50px] items-center gap-2 border-b border-border bg-surface-1 px-3 sm:gap-3 sm:px-4">
        <div className="flex shrink-0 items-center gap-2">
          <NavLink
            to="/north"
            className="flex shrink-0 items-center gap-[9px] rounded-md px-1 py-1 font-display text-13 text-text hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {logo ? (
              <img src={logo} alt={productName} className="h-6 w-auto" />
            ) : (
              <>
                <ConstellationMark className="shrink-0" />
                <span className="truncate font-semibold ltr:tracking-[0.15em]">{productName}</span>
              </>
            )}
          </NavLink>
          {servedName ? (
            <>
              <span aria-hidden="true" className="h-[15px] w-px shrink-0 bg-border-strong" />
              <span className="hidden max-w-[16ch] truncate font-ui text-12 text-muted sm:inline">
                {servedName}
              </span>
            </>
          ) : null}
        </div>

        <SearchPalette
          t={t}
          destinations={items.map((item) => ({ href: item.href, label: t(item.labelKey) }))}
        />

        <div className="ms-auto flex shrink-0 items-center gap-1">
          <PostureChips posture={session.inbox?.posture} t={t} />
          <ThemeToggle t={t} />
          {mayCompanion ? (
            <button
              type="button"
              aria-expanded={companion}
              aria-label={t(companion ? "companion.close" : "companion.open")}
              title={t(companion ? "companion.close" : "companion.open")}
              onClick={() => setCompanion((open) => !open)}
              className="hidden size-8 shrink-0 place-items-center rounded-md text-13 text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-expanded:text-accent lg:grid"
            >
              <span aria-hidden="true">&#10022;</span>
            </button>
          ) : null}
          <Menu
            label={t("header.account")}
            items={accountMenuItems(
              t,
              (href) => void navigate(href),
              () => void submit(null, { method: "post", action: "/logout" }),
              profiles
            )}
            trigger={
              <button
                type="button"
                className="ms-1 flex items-center gap-2 rounded-orbit border border-border py-0.5 pe-2.5 ps-0.5 transition-colors duration-150 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                title={
                  session.actorName
                    ? t("header.signedInAs", { name: session.actorName })
                    : t("header.account")
                }
              >
                <span
                  aria-hidden="true"
                  className="grid size-6 shrink-0 place-items-center rounded-orbit bg-accent font-mono text-12 font-medium text-accent-contrast"
                >
                  {session.actorName ? initialsOf(session.actorName) : "•"}
                </span>
                <span className="hidden max-w-40 truncate font-mono text-12 text-muted sm:inline">
                  {roleKey ?? session.actorName ?? t("header.account")}
                </span>
                <span aria-hidden="true" className="text-11 text-subtle">
                  &#9662;
                </span>
              </button>
            }
          />
        </div>
      </header>

      <Meridian
        t={t}
        inbox={session.inbox}
        accent={NORTH_ACCENT}
        initialAsOf={initialAsOf}
        onScrub={handleScrub}
      />

      <div className="flex min-h-[calc(100vh-50px)] flex-col md:flex-row">
        <nav
          aria-label={t("nav.primary")}
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-surface-1 p-2 md:hidden"
        >
          {items.map((item) => (
            <NavItemLink key={item.href} item={item} t={t} />
          ))}
        </nav>

        <nav
          aria-label={t("nav.primary")}
          className="lyra-vt-rail hidden md:sticky md:top-[50px] md:flex md:h-[calc(100vh-50px)] md:w-60 md:shrink-0 md:flex-col md:gap-2 md:overflow-y-auto md:border-e md:border-border md:p-3"
        >
          {moduleLinks.length > 1 ? (
            <ModuleSwitcher modules={moduleLinks} current="north" label={t("nav.group.modules")} />
          ) : null}
          <ShiftRail
            t={t}
            shift={shiftFrom(
              initialAsOf === null ? session.inbox : inboxAsOf(session.inbox, initialAsOf),
              session.names
            )}
          />
          <ul className="flex flex-col gap-0.5">
            {items.map((item) => (
              <li key={item.href}>
                <NavItemLink item={item} t={t} />
              </li>
            ))}
          </ul>
          {/* Projection is a separate navigation affordance, not a Meridian
              mode (this plan's Global Constraints, Deviation 4) — reuses the
              existing /north/brief <-> /north/whatif cross-link pattern. */}
          <NavLink
            to="/north/whatif"
            className="mt-2 rounded-md px-3 py-2 text-start font-ui text-12 text-muted hover:bg-surface-2 hover:text-text"
          >
            {t("north.whatif.title")}
          </NavLink>
        </nav>

        <main
          key={pathname}
          id="workspace"
          tabIndex={-1}
          className="lyra-vt-workspace lyra-stagger mx-auto flex min-w-0 w-full max-w-[100rem] flex-1 flex-col gap-4 p-4 sm:p-6"
        >
          <span aria-hidden="true" className="h-0.5 w-full shrink-0 rounded-full" style={{ background: NORTH_ACCENT }} />
          {crumbs.length ? <Breadcrumbs items={crumbs} label={t("nav.breadcrumb")} /> : null}
          {slow ? <PageSkeleton label={t("common.loading")} /> : children}
        </main>

        {mayCompanion && companion ? <Companion t={t} /> : null}
      </div>

      <footer className="lyra-vt-status sticky bottom-0 z-20 hidden h-7 items-center gap-2 border-t border-border bg-surface-1 px-4 font-mono text-12 text-subtle sm:flex">
        <span aria-hidden="true" className="truncate">
          {productName}
        </span>
        <NavLink to="/design" className="ms-auto shrink-0 hover:text-text aria-[current=page]:text-text">
          {t("nav.doctrine")}
        </NavLink>
      </footer>
    </div>
  );
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const first = [...(words[0] ?? "")][0] ?? "";
  const last = words.length > 1 ? ([...(words.at(-1) ?? "")][0] ?? "") : "";
  return (first + last).toLocaleUpperCase();
}

function NavItemLink({ item, t }: { item: NavItem; t: Translate }) {
  return (
    <NavLink
      to={item.href}
      end={item.href === "/north"}
      viewTransition
      data-icon={item.icon}
      className={({ isActive }) =>
        [
          "group flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-start font-ui text-13 transition-colors duration-150",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          isActive ? "bg-surface-2 font-medium text-text" : "text-muted hover:bg-surface-2 hover:text-text"
        ].join(" ")
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden="true"
            className={[
              "h-4 w-0.5 shrink-0 rounded-orbit transition-opacity duration-150",
              isActive ? "opacity-100" : "opacity-0 group-hover:opacity-50"
            ].join(" ")}
            style={{ background: NORTH_ACCENT }}
          />
          <span className="truncate">{t(item.labelKey)}</span>
        </>
      )}
    </NavLink>
  );
}

function useSettledFor(active: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!active) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return late;
}
