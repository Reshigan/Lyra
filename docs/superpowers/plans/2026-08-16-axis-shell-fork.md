# AXIS Shell Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give AXIS its own scoped shell (`AxisShell`), matching the pattern ADR-0061 built for NORTH — own nav rail, own layout route, no Meridian — reusing every shared mechanism unchanged.

**Architecture:** Fork `north-shell.tsx`/`NorthShell` into `axis-shell.tsx`/`AxisShell` with the Meridian scrubber removed and the rail rebuilt from AXIS's 11 destinations. Move the existing 19-route AXIS block in `routes.ts` out of the shared `workspace.tsx` layout into its own `axis-shell.tsx` layout, sibling to NORTH's. Promote the 11 rail routes out of `HIDDEN_ROUTES` (they're no longer "linked from a tools list" — they're on their own rail now), matching NORTH's precedent where none of its 8 rail routes appear in `HIDDEN_ROUTES`.

**Tech Stack:** React Router v7 (framework mode), Cloudflare Workers, Vitest (`environment: "node"`, no DOM), Playwright.

## Global Constraints

- No new ADR — ADR-0061 already names `AxisShell` as deferred-not-reversed and predicts this exact shape.
- No Meridian for AXIS — ADR-0061 is explicit that Meridian is NORTH-only.
- No changes to shared mechanisms (`bootstrapSession`, `availableShellsForRoles`, `LYRA_MODULES`/`shouldInclude`, `ModuleSwitcher`/`ModuleLink`) — reuse as-is.
- `--module-axis` accent already exists at `packages/ui/src/tokens.css:204` (`#e8a33d` light / `#b45309` dark) — no new token.
- Rail order (exact, from the spec): `axis/exceptions`, `axis/board`, `axis/quote-desk`, `axis/doc-intelligence`, `axis/analytics`, `axis/process-map`, `axis/renewals`, `axis/referrals`, `axis/claims/desk`, `axis/admin`, `axis/dev`.
- Non-rail routes (move under the new shell's layout, stay out of the rail): `axis/documents/:id/file`, `axis/cases/:id/evidence-bundles/:bundleId/download`, `axis/policies/:id/detail`, `axis/policies/:id/endorse`, `axis/policies/:id/cancel`, `axis/claims/new`, `axis/claims/:id/detail`, `axis/cases/:id/detail`.
- Unit tests run node-only (`environment: "node"` in `apps/web/vitest.config.ts`) — no DOM assertions in `.test.ts` files; DOM/rendering assertions belong in Playwright specs only.
- Commit after every task.

---

### Task 1: AXIS rail labels — add i18n keys, remove stale HIDDEN_ROUTES entries

**Files:**
- Modify: `apps/web/app/routing.ts:81-89,113,117` (remove 11 `HIDDEN_ROUTES` entries)
- Modify: `apps/web/app/i18n/en.ts:32` (insert 11 keys after `"nav.axis"`)
- Modify: `apps/web/app/i18n/ar.ts:31` (insert 11 keys after `"nav.axis"`)
- Test: `apps/web/app/shell.test.ts` (existing, unmodified — it is the test this task turns green)

**Interfaces:**
- Consumes: `HIDDEN_ROUTES` (`apps/web/app/routing.ts`), `labelKeyFor(path)` → `` `nav.${path.replace(/^\//, "")}` `` (`apps/web/app/routing.ts:203`), `en`/`ar` message catalogues.
- Produces: `nav.axis/exceptions`, `nav.axis/board`, `nav.axis/quote-desk`, `nav.axis/doc-intelligence`, `nav.axis/analytics`, `nav.axis/process-map`, `nav.axis/renewals`, `nav.axis/referrals`, `nav.axis/claims/desk`, `nav.axis/admin`, `nav.axis/dev` — every later task's rail (`AXIS_NAV_ITEMS` in Task 2) reads these keys via `labelKeyFor`.

- [ ] **Step 1: Remove the 11 rail routes' entries from `HIDDEN_ROUTES`, leave the 8 detail routes untouched**

In `apps/web/app/routing.ts`, delete these 11 lines (they currently sit at lines 81-84, 86-89, 113, 117):

```typescript
  "/axis/exceptions": "the cross-resource work queue, linked from the AXIS workspace tools list",
  "/axis/board": "the production board of cases by state, linked from the AXIS workspace tools list",
  "/axis/quote-desk": "the quote desk and group bids, linked from the AXIS workspace tools list",
  "/axis/doc-intelligence": "extraction review over documents, linked from the AXIS workspace tools list",
```
```typescript
  "/axis/analytics": "operations analytics and exports, linked from the AXIS workspace tools list",
  "/axis/process-map": "the case-state flow diagram, linked from the AXIS workspace tools list",
  "/axis/admin": "SOP publish, connector health and operating policy, linked from the AXIS workspace tools list",
  "/axis/dev": "extraction sandbox for testing document parsing, linked from the admin developer tools sandbox card",
```
```typescript
  "/axis/renewals": "the renewal desk over upcoming and offered renewals, linked from the AXIS workspace tools list",
```
```typescript
  "/axis/referrals":
    "the underwriting referral desk over risks outside delegated authority, linked from the AXIS workspace tools list",
```
```typescript
  "/axis/claims/desk": "the claims handling desk, linked from the AXIS workspace tools list",
```

Leave these 8 exactly as they are (genuine detail/action routes, same convention as `/north/board/:id/file`): `"/axis/documents/:id/file"`, `"/axis/cases/:id/evidence-bundles/:bundleId/download"`, `"/axis/policies/:id/detail"`, `"/axis/policies/:id/endorse"`, `"/axis/policies/:id/cancel"`, `"/axis/claims/new"`, `"/axis/claims/:id/detail"`, `"/axis/cases/:id/detail"`.

- [ ] **Step 2: Run the test to see it fail**

Run: `cd apps/web && pnpm vitest run app/shell.test.ts`
Expected: FAIL — "gives every route a nav label or a documented reason to be hidden" reports 11 missing keys (`nav.axis/exceptions`, `nav.axis/board`, `nav.axis/quote-desk`, `nav.axis/doc-intelligence`, `nav.axis/analytics`, `nav.axis/process-map`, `nav.axis/renewals`, `nav.axis/referrals`, `nav.axis/claims/desk`, `nav.axis/admin`, `nav.axis/dev`) not present in `en`.

- [ ] **Step 3: Add the 11 English keys**

In `apps/web/app/i18n/en.ts`, insert immediately after line 32 (`"nav.axis": "Operations",`):

```typescript
  "nav.axis/exceptions": "Exceptions",
  "nav.axis/board": "Board",
  "nav.axis/quote-desk": "Quote desk",
  "nav.axis/doc-intelligence": "Doc intelligence",
  "nav.axis/analytics": "Analytics",
  "nav.axis/process-map": "Process map",
  "nav.axis/renewals": "Renewals",
  "nav.axis/referrals": "Referrals",
  "nav.axis/claims/desk": "Claims desk",
  "nav.axis/admin": "Admin",
  "nav.axis/dev": "Dev",
```

- [ ] **Step 4: Add the 11 Arabic keys**

In `apps/web/app/i18n/ar.ts`, insert immediately after line 31 (`"nav.axis": "العمليات",`):

```typescript
  "nav.axis/exceptions": "الاستثناءات",
  "nav.axis/board": "مجلس المتابعة",
  "nav.axis/quote-desk": "مكتب العروض",
  "nav.axis/doc-intelligence": "ذكاء المستندات",
  "nav.axis/analytics": "التحليلات",
  "nav.axis/process-map": "خريطة العملية",
  "nav.axis/renewals": "التجديدات",
  "nav.axis/referrals": "الإحالات",
  "nav.axis/claims/desk": "مكتب المطالبات",
  "nav.axis/admin": "الإدارة",
  "nav.axis/dev": "أدوات المطوّر",
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && pnpm vitest run app/shell.test.ts`
Expected: PASS — including "keeps en and ar on exactly the same keys" and "has no empty or untranslated ar strings".

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/routing.ts apps/web/app/i18n/en.ts apps/web/app/i18n/ar.ts
git commit -m "feat(axis): promote AXIS rail routes out of HIDDEN_ROUTES with real nav labels"
```

---

### Task 2: `AxisShell` component + `axis-shell.tsx` layout route

**Files:**
- Create: `apps/web/app/components/axis-shell.tsx`
- Create: `apps/web/app/routes/axis-shell.tsx`
- Test: `apps/web/app/routes/axis-shell.test.ts`

**Interfaces:**
- Consumes: `SessionBootstrap` (`apps/web/app/session.server.ts`), `bootstrapSession(env, request)`, `labelKeyFor`/`moduleOf` (`apps/web/app/routing.ts`), `translator`/`Translate` (`apps/web/app/i18n`), `ModuleSwitcher`/`ModuleLink`/`LyraModule`/`Menu`/`Breadcrumbs`/`ToastProvider` (`@lyra/ui`), `shiftFrom` (`apps/web/app/components/shift.ts` — note: no `inboxAsOf`, AXIS has no Meridian), `ShiftRail` (`apps/web/app/components/shift-rail.tsx`), `accountMenuItems`/`brandStyle`/`crumbsFor`/`initialsOf`/`lockupNames`/`PageSkeleton`/`profilesFor`/`useSettledFor` (`apps/web/app/components/shell.tsx`), `ColdOpen`, `ConstellationMark`, `SearchPalette`, `PostureChips`, `ThemeToggle`, `Companion`.
- Produces: `AxisShell({ session, children })` component; `axis-shell.tsx`'s `ROUTE_ID = "routes/axis-shell"`, `loader({ request, context })`, `useAxisSessionData(): SessionBootstrap | undefined` — consumed by Task 4's 15 route-file swaps.

- [ ] **Step 1: Write the failing loader unit test**

Create `apps/web/app/routes/axis-shell.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

vi.mock("../session.server", () => ({
  bootstrapSession: vi.fn()
}));

vi.mock("../context", () => ({
  cloudflare: { toString: () => "cloudflare-context" }
}));

import { bootstrapSession } from "../session.server";
import { loader } from "./axis-shell";

function fakeContext(env: unknown) {
  return { get: () => ({ env }) };
}

describe("axis-shell loader", () => {
  it("returns the session when the actor's roles resolve to axis", async () => {
    vi.mocked(bootstrapSession).mockResolvedValue({
      availableShells: ["axis"]
    } as never);
    const result = await loader({
      request: new Request("https://lyra.test/axis/board"),
      context: fakeContext({})
    } as never);
    expect(result).toEqual({ availableShells: ["axis"] });
  });

  it("throws 403 (not 401) when the actor's roles never resolve to axis", async () => {
    vi.mocked(bootstrapSession).mockResolvedValue({
      availableShells: ["north"]
    } as never);
    await expect(
      loader({
        request: new Request("https://lyra.test/axis/board"),
        context: fakeContext({})
      } as never)
    ).rejects.toMatchObject({ init: { status: 403 } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run app/routes/axis-shell.test.ts`
Expected: FAIL — cannot find module `./axis-shell`.

- [ ] **Step 3: Create the `AxisShell` component**

Create `apps/web/app/components/axis-shell.tsx` — a copy of `north-shell.tsx`'s structure with Meridian removed and the rail rebuilt from AXIS's 11 destinations:

```typescript
import { useState } from "react";
import {
  NavLink,
  useLocation,
  useNavigate,
  useNavigation,
  useSubmit
} from "react-router";
import {
  Breadcrumbs,
  Menu,
  ModuleSwitcher,
  ToastProvider,
  type LyraModule,
  type ModuleLink
} from "@lyra/ui";
import type { NavItem } from "../api.server";
import { translator, type Translate } from "../i18n";
import { labelKeyFor, moduleOf } from "../routing";
import type { SessionBootstrap } from "../session.server";
import { ColdOpen } from "./cold-open";
import { Companion } from "./companion";
import { ConstellationMark } from "./mark";
import { SearchPalette } from "./search";
import { PostureChips } from "./posture";
import { shiftFrom } from "./shift";
import { ShiftRail } from "./shift-rail";
import { ThemeToggle } from "./theme-toggle";
import {
  accountMenuItems,
  brandStyle,
  crumbsFor,
  initialsOf,
  lockupNames,
  PageSkeleton,
  profilesFor,
  useSettledFor
} from "./shell";

const AXIS_ACCENT = "var(--module-axis)";

/**
 * AXIS's own rail, compile-time known — the eleven `axis/*` destinations the
 * design spec gives this shell (docs/superpowers/specs
 * /2026-08-16-axis-shell-fork-design.md §"Rail destinations"). Deliberately
 * NOT derived from `session.nav`: that is WORKSPACE_PATHS-shaped (top-level
 * roots only, routing.ts), so it can never carry a sub-screen. The eight
 * `axis/*` detail/action routes (documents/:id/file, cases/:id/detail, etc.)
 * are opened from a list or another rail page, not rail destinations
 * themselves — same as every other `:id` route in routing.ts's HIDDEN_ROUTES.
 */
const AXIS_NAV_PATHS = [
  "/axis/exceptions",
  "/axis/board",
  "/axis/quote-desk",
  "/axis/doc-intelligence",
  "/axis/analytics",
  "/axis/process-map",
  "/axis/renewals",
  "/axis/referrals",
  "/axis/claims/desk",
  "/axis/admin",
  "/axis/dev"
] as const;

type RailItem = Pick<NavItem, "href" | "labelKey">;

const AXIS_NAV_ITEMS: RailItem[] = AXIS_NAV_PATHS.map((href) => ({
  href,
  labelKey: labelKeyFor(href)
}));

/**
 * AXIS's own shell: a scoped rail (only /axis/* destinations), the same
 * chrome primitives Shell/NorthShell use (brandStyle, lockupNames, crumbsFor,
 * accountMenuItems, PageSkeleton — all imported, not reimplemented), and the
 * multi-role switcher when this actor's roles reach more than one shell. No
 * Meridian — ADR-0061 is explicit that Meridian is NORTH-only.
 */
export function AxisShell({
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
  const [companion, setCompanion] = useState(false);

  const items = AXIS_NAV_ITEMS;

  const { product: productName, tenant: servedName } = lockupNames(session.brand, session.tenantName);
  const logo = session.brand?.logo?.dark ?? session.brand?.logo?.light ?? session.brand?.logo?.mark;
  const crumbs = crumbsFor(pathname, session.nav, t);
  const profiles = profilesFor(session.roles, session.nav, pathname);
  const roleKey = profiles.find((profile) => profile.active)?.role ?? session.roles[0] ?? null;
  const mayCompanion = session.permissions.includes("ai:runs:read");
  const navigation = useNavigation();
  const settling =
    navigation.state === "loading" && (navigation.location?.pathname ?? pathname) !== pathname;
  const slow = useSettledFor(settling, 400);

  // A switcher exists to leave, so the shell you are already in is not a
  // destination. `availableShells` is workspace-shaped, not module-shaped — it
  // can hold "admin"/"ledger"/"settings", none of which are LyraModule — so
  // moduleOf() (routing.ts) both narrows the type and drops the non-modules,
  // instead of an unsound cast.
  const moduleLinks: ModuleLink[] = session.availableShells.flatMap((shell) => {
    if (shell === "axis") return [];
    const id: LyraModule | null = moduleOf(`/${shell}`);
    return id ? [{ id, label: t(`nav.${shell}`), href: `/${shell}` }] : [];
  });

  return (
    // The toast host lives above every workspace so any screen can say what
    // happened after the control that caused it has scrolled away (ADR-0051).
    <ToastProvider dismissLabel={t("common.dismiss")}>
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
              to="/axis/board"
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

        <div className="flex min-h-[calc(100vh-50px)] flex-col md:flex-row">
          {/* ModuleSwitcher renders its own <nav aria-label="Modules">, so it is
              a sibling of the rail rather than a child of it — a <nav> inside a
              <nav> reads as two competing landmarks. Rendered twice for the
              same reason the rail is: the mobile copy is the only way a
              multi-shell actor on a small screen can leave this shell. */}
          {moduleLinks.length ? (
            <ModuleSwitcher
              modules={moduleLinks}
              current="axis"
              label={t("nav.group.modules")}
              className="shrink-0 border-b border-border bg-surface-1 p-2 md:hidden"
            />
          ) : null}
          <nav
            aria-label={t("nav.primary")}
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-surface-1 p-2 md:hidden"
          >
            {items.map((item) => (
              <NavItemLink key={item.href} item={item} t={t} />
            ))}
          </nav>

          <div className="lyra-vt-rail hidden md:sticky md:top-[50px] md:flex md:h-[calc(100vh-50px)] md:w-60 md:shrink-0 md:flex-col md:gap-2 md:overflow-y-auto md:border-e md:border-border md:p-3">
            {moduleLinks.length ? (
              <ModuleSwitcher modules={moduleLinks} current="axis" label={t("nav.group.modules")} />
            ) : null}
            <ShiftRail t={t} shift={shiftFrom(session.inbox, session.names)} />
            <nav aria-label={t("nav.primary")}>
              <ul className="flex flex-col gap-0.5">
                {items.map((item) => (
                  <li key={item.href}>
                    <NavItemLink item={item} t={t} />
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          <main
            key={pathname}
            id="workspace"
            tabIndex={-1}
            className="lyra-vt-workspace lyra-stagger mx-auto flex min-w-0 w-full max-w-[100rem] flex-1 flex-col gap-4 p-4 sm:p-6"
          >
            <span aria-hidden="true" className="h-0.5 w-full shrink-0 rounded-full" style={{ background: AXIS_ACCENT }} />
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
    </ToastProvider>
  );
}

function NavItemLink({ item, t }: { item: RailItem; t: Translate }) {
  return (
    <NavLink
      to={item.href}
      viewTransition
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
            style={{ background: AXIS_ACCENT }}
          />
          <span className="truncate">{t(item.labelKey)}</span>
        </>
      )}
    </NavLink>
  );
}
```

- [ ] **Step 4: Create the layout route**

Create `apps/web/app/routes/axis-shell.tsx`:

```typescript
import { data, Outlet, useLoaderData, useRouteLoaderData, type LoaderFunctionArgs } from "react-router";
import { cloudflare } from "../context";
import { bootstrapSession, type SessionBootstrap } from "../session.server";
import { AxisShell } from "../components/axis-shell";

export const ROUTE_ID = "routes/axis-shell";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const session = await bootstrapSession(context.get(cloudflare).env, request);
  if (!session.availableShells.includes("axis")) throw data("", { status: 403 });
  return session;
}

export function useAxisSessionData(): SessionBootstrap | undefined {
  return useRouteLoaderData<typeof loader>(ROUTE_ID);
}

export default function AxisShellLayout() {
  const session = useLoaderData<typeof loader>();
  return (
    <AxisShell session={session}>
      <Outlet />
    </AxisShell>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run app/routes/axis-shell.test.ts`
Expected: PASS (2/2).

- [ ] **Step 6: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: no new errors (this route isn't in `routes.ts` yet — Task 3 wires it in — so it's checked only as a free-standing file here).

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/components/axis-shell.tsx apps/web/app/routes/axis-shell.tsx apps/web/app/routes/axis-shell.test.ts
git commit -m "feat(axis): add AxisShell component and axis-shell.tsx layout route"
```

---

### Task 3: Move AXIS's route block into its own layout in `routes.ts`

**Files:**
- Modify: `apps/web/app/routes.ts:95-117` (approximate — the whole `shouldInclude("axis") ? [...] : []` block)
- Test: `apps/web/app/routes.test.ts` (existing — run as a smoke check; Task 5 adds AXIS-specific cases)

**Interfaces:**
- Consumes: `shouldInclude("axis")` (`apps/web/app/routing.ts`), `layout`/`route` (`@react-router/dev/routes`), `routes/axis-shell.tsx` (Task 2).
- Produces: every `axis/*` path now renders under `AxisShell` instead of the shared `Shell` — required by Task 4 (the `useAxisSessionData` swap only works once these routes sit under `axis-shell.tsx`'s layout, since `useRouteLoaderData("routes/axis-shell")` returns `undefined` otherwise).

- [ ] **Step 1: Locate and cut the existing AXIS block**

In `apps/web/app/routes.ts`, find this block (currently inside the shared `layout("routes/workspace.tsx", [...])` array):

```typescript
    ...(shouldInclude("axis")
      ? [
          route("axis/exceptions", "routes/axis-exceptions.tsx"),
          route("axis/board", "routes/axis-board.tsx"),
          route("axis/quote-desk", "routes/axis-quote-desk.tsx"),
          route("axis/doc-intelligence", "routes/axis-doc-intel.tsx"),
          route("axis/documents/:id/file", "routes/axis-document-file.tsx"),
          route("axis/analytics", "routes/axis-analytics.tsx"),
          route("axis/admin", "routes/axis-admin.tsx"),
          route("axis/dev", "routes/axis-dev.tsx"),
          route("axis/process-map", "routes/axis-process-map.tsx"),
          route("axis/claims/new", "routes/fnol-intake.tsx"),
          route("axis/claims/desk", "routes/claims-desk.tsx"),
          route("axis/renewals", "routes/renewal-desk.tsx"),
          route("axis/referrals", "routes/referral-desk.tsx"),
          route("axis/policies/:id/detail", "routes/policy-detail.tsx"),
          route("axis/policies/:id/endorse", "routes/policy-endorse.tsx"),
          route("axis/policies/:id/cancel", "routes/policy-cancel.tsx"),
          route("axis/claims/:id/detail", "routes/claim-detail.tsx"),
          route("axis/cases/:id/evidence-bundles/:bundleId/download", "routes/case-evidence-download.tsx"),
          route("axis/cases/:id/detail", "routes/case-detail.tsx")
        ]
      : []),
```

Delete it from inside `workspace.tsx`'s layout array.

- [ ] **Step 2: Add it back as its own sibling layout block**

Add this as a new top-level array entry in the exported routes array, positioned the same way `shouldInclude("north") ? [layout(...)] : []` is placed (as its own entry, not nested inside another layout's children):

```typescript
  ...(shouldInclude("axis")
    ? [
        layout("routes/axis-shell.tsx", [
          route("axis/exceptions", "routes/axis-exceptions.tsx"),
          route("axis/board", "routes/axis-board.tsx"),
          route("axis/quote-desk", "routes/axis-quote-desk.tsx"),
          route("axis/doc-intelligence", "routes/axis-doc-intel.tsx"),
          route("axis/documents/:id/file", "routes/axis-document-file.tsx"),
          route("axis/analytics", "routes/axis-analytics.tsx"),
          route("axis/admin", "routes/axis-admin.tsx"),
          route("axis/dev", "routes/axis-dev.tsx"),
          route("axis/process-map", "routes/axis-process-map.tsx"),
          route("axis/claims/new", "routes/fnol-intake.tsx"),
          route("axis/claims/desk", "routes/claims-desk.tsx"),
          route("axis/renewals", "routes/renewal-desk.tsx"),
          route("axis/referrals", "routes/referral-desk.tsx"),
          route("axis/policies/:id/detail", "routes/policy-detail.tsx"),
          route("axis/policies/:id/endorse", "routes/policy-endorse.tsx"),
          route("axis/policies/:id/cancel", "routes/policy-cancel.tsx"),
          route("axis/claims/:id/detail", "routes/claim-detail.tsx"),
          route("axis/cases/:id/evidence-bundles/:bundleId/download", "routes/case-evidence-download.tsx"),
          route("axis/cases/:id/detail", "routes/case-detail.tsx")
        ])
      ]
    : []),
```

Route paths, files and order are unchanged — only the wrapping layout differs.

- [ ] **Step 3: Run the existing route/shell tests**

Run: `cd apps/web && pnpm vitest run app/routes.test.ts app/shell.test.ts`
Expected: PASS. (`routes.test.ts`'s existing cases don't yet assert on layout structure, only path membership, so they pass unchanged; `shell.test.ts`'s `declaredRoutes()` still finds all 19 `axis/*` `route(...)` calls regardless of which `layout(...)` wraps them.)

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: no new errors. (The 15 route files still importing `useShellData` from `./workspace` continue to resolve — Task 4 handles the swap — since `workspace.tsx` is unchanged and still exports it.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/routes.ts
git commit -m "feat(axis): move AXIS routes under their own axis-shell.tsx layout"
```

---

### Task 4: Swap `useShellData` to `useAxisSessionData` in the 15 AXIS route files

**Files:**
- Modify: `apps/web/app/routes/axis-admin.tsx`
- Modify: `apps/web/app/routes/axis-analytics.tsx`
- Modify: `apps/web/app/routes/axis-board.tsx`
- Modify: `apps/web/app/routes/axis-dev.tsx`
- Modify: `apps/web/app/routes/axis-doc-intel.tsx`
- Modify: `apps/web/app/routes/axis-process-map.tsx`
- Modify: `apps/web/app/routes/axis-exceptions.tsx`
- Modify: `apps/web/app/routes/axis-quote-desk.tsx`
- Modify: `apps/web/app/routes/case-detail.tsx`
- Modify: `apps/web/app/routes/claims-desk.tsx`
- Modify: `apps/web/app/routes/claim-detail.tsx`
- Modify: `apps/web/app/routes/fnol-intake.tsx`
- Modify: `apps/web/app/routes/policy-cancel.tsx`
- Modify: `apps/web/app/routes/policy-detail.tsx`
- Modify: `apps/web/app/routes/policy-endorse.tsx`

**Interfaces:**
- Consumes: `useAxisSessionData` (`apps/web/app/routes/axis-shell.tsx`, Task 2) — same return type (`SessionBootstrap | undefined`) as `useShellData`'s `ShellData | undefined`, since both are `Awaited<ReturnType<typeof bootstrapSession>>` — no downstream `shell.foo` accessor changes needed.
- Produces: nothing new — this task only repoints an existing local binding.

Every one of these 15 files has exactly this pair of lines (only the file differs, the pattern doesn't):

```typescript
import { useShellData } from "./workspace";
```
```typescript
  const shell = useShellData();
```

- [ ] **Step 1: Replace the import and call in all 15 files**

In each of the 15 files listed above, change:

```typescript
import { useShellData } from "./workspace";
```

to:

```typescript
import { useAxisSessionData } from "./axis-shell";
```

and change:

```typescript
  const shell = useShellData();
```

to:

```typescript
  const shell = useAxisSessionData();
```

Every other line in each file (the `shell.foo` accessors downstream) stays exactly as it is — `SessionBootstrap` and `ShellData` are structurally identical.

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS, no errors — confirms `shell.*` usages in all 15 files still type-check against `SessionBootstrap`.

- [ ] **Step 3: Run the full unit suite**

Run: `cd apps/web && pnpm vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/routes/axis-admin.tsx apps/web/app/routes/axis-analytics.tsx apps/web/app/routes/axis-board.tsx apps/web/app/routes/axis-dev.tsx apps/web/app/routes/axis-doc-intel.tsx apps/web/app/routes/axis-process-map.tsx apps/web/app/routes/axis-exceptions.tsx apps/web/app/routes/axis-quote-desk.tsx apps/web/app/routes/case-detail.tsx apps/web/app/routes/claims-desk.tsx apps/web/app/routes/claim-detail.tsx apps/web/app/routes/fnol-intake.tsx apps/web/app/routes/policy-cancel.tsx apps/web/app/routes/policy-detail.tsx apps/web/app/routes/policy-endorse.tsx
git commit -m "feat(axis): read session data via useAxisSessionData in AXIS route files"
```

---

### Task 5: `LYRA_MODULES=axis` contract test coverage

**Files:**
- Modify: `apps/web/app/routes.test.ts`

**Interfaces:**
- Consumes: `loadRoutesUnder(lyraModules)`, `flatPaths(config)`, `loadModulesUnder(lyraModules)` — all already defined in this file.
- Produces: nothing new — test-only.

- [ ] **Step 1: Write the failing test — route gating**

In `apps/web/app/routes.test.ts`, inside `describe("LYRA_MODULES route gating", ...)`, add after the existing `"includes only north's routes when LYRA_MODULES=north"` test:

```typescript
  it("includes only axis's routes when LYRA_MODULES=axis", async () => {
    const paths = flatPaths(await loadRoutesUnder("axis"));
    expect(paths).toContain("axis/exceptions");
    expect(paths).toContain("axis/board");
    expect(paths).toContain("axis/quote-desk");
    expect(paths).toContain("axis/doc-intelligence");
    expect(paths).toContain("axis/analytics");
    expect(paths).toContain("axis/process-map");
    expect(paths).toContain("axis/renewals");
    expect(paths).toContain("axis/referrals");
    expect(paths).toContain("axis/claims/desk");
    expect(paths).toContain("axis/admin");
    expect(paths).toContain("axis/dev");
    expect(paths.some((p) => p.startsWith("north/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("orbit/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("signal/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("scout/"))).toBe(false);
  });
```

- [ ] **Step 2: Write the failing test — workspace gating**

Inside `describe("LYRA_MODULES workspace gating", ...)`, add after the existing `"stops resolving an excluded module's workspace"` test:

```typescript
  it("resolves /axis and stops resolving other modules under LYRA_MODULES=axis", async () => {
    const { workspaceFor } = await loadModulesUnder("axis");
    expect(workspaceFor("/axis")).toBeDefined();
    expect(workspaceFor("/north")).toBeUndefined();
    expect(workspaceFor("/orbit")).toBeUndefined();
    expect(workspaceFor("/signal")).toBeUndefined();
    expect(workspaceFor("/scout")).toBeUndefined();
  });
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd apps/web && pnpm vitest run app/routes.test.ts`
Expected: PASS (6/6 in `"LYRA_MODULES route gating"`, 4/4 in `"LYRA_MODULES workspace gating"`). These should pass immediately — Tasks 3 and the pre-existing `modules/index.ts`/`routing.ts` gating already implement the behavior; this task only adds coverage.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/routes.test.ts
git commit -m "test(axis): cover LYRA_MODULES=axis route and workspace gating"
```

---

### Task 6: Playwright journey spec for `AxisShell`

**Files:**
- Create: `e2e/axis-shell.spec.ts`

**Interfaces:**
- Consumes: `goto`, `loginAsAxisAgent`, `loginAsNorthExec` (`e2e/fixtures.ts`, imported as `./fixtures.js`).
- Produces: nothing new — journey-level coverage only.

- [ ] **Step 1: Write the spec**

Create `e2e/axis-shell.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";
import { goto, loginAsAxisAgent, loginAsNorthExec } from "./fixtures.js";

// @journey:J-AXIS-SHELL (docs/superpowers/specs/2026-08-16-axis-shell-fork-design.md):
// AxisShell is its own scoped shell — an actor with an axis.*-resolving role
// lands in it and sees only AXIS's own rail (never another module's,
// ModuleSwitcher only appears once an actor's roles resolve to more than one
// shell, which axis.agent's single role never does), and an actor without one
// gets 403 (not 401 — bootstrapSession already proved who they are, they are
// just not entitled to this shell: axis-shell.tsx's loader). No Meridian —
// ADR-0061 is explicit that Meridian is NORTH-only.

test("axis.agent lands in AxisShell and sees only AXIS's own rail", async ({ page }) => {
  await loginAsAxisAgent(page);
  await goto(page, "/axis/board");

  // axis-shell.tsx renders two <nav aria-label="Primary"> landmarks (one
  // md:hidden for mobile, one hidden md:flex for desktop); Playwright's
  // default chromium viewport is desktop-sized, so the mobile one is
  // display:none and getByRole already excludes it from the a11y tree —
  // .first() is defensive, matching north-shell.spec.ts's convention.
  const rail = page.getByRole("navigation", { name: /primary/i }).first();

  await expect(rail.getByRole("link", { name: /exceptions/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /board/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /quote desk/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /renewals/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /referrals/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /claims desk/i })).toBeVisible();

  // No other module's destinations leak into this rail.
  await expect(rail.getByRole("link", { name: /^brief$/i })).toHaveCount(0);
  await expect(rail.getByRole("link", { name: /explorer/i })).toHaveCount(0);
});

test("an actor with no axis.*-resolving role gets 403, not 401, on /axis/*", async ({ page }) => {
  await loginAsNorthExec(page);
  const response = await page.goto("/axis/board");
  expect(response?.status()).toBe(403);
});
```

- [ ] **Step 2: Run the spec**

Run: `pnpm e2e -- e2e/axis-shell.spec.ts`
Expected: PASS (2/2).

- [ ] **Step 3: Commit**

```bash
git add e2e/axis-shell.spec.ts
git commit -m "test(axis): add Playwright journey spec for AxisShell"
```

---

### Task 7: Full suite check

**Files:** none (verification only)

- [ ] **Step 1: Run everything**

```bash
pnpm --filter web typecheck
pnpm --filter web test
pnpm e2e -- e2e/axis-shell.spec.ts
```

Expected: all green.

- [ ] **Step 2: Commit (only if something needed fixing in this step)**

If Step 1 is clean, there is nothing to commit — this task is a verification gate, not a code change.
