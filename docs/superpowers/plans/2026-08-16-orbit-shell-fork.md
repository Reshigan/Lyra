# ORBIT Shell Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ORBIT its own scoped shell (`OrbitShell` + `orbit-shell.tsx` layout route) with its own nav rail, header, and `--module-orbit` accent — the second fork of ADR-0061's shell-per-module pattern, after AXIS.

**Architecture:** Copy AXIS's fork verbatim, renamed: a `orbit-shell.tsx` layout route calls `bootstrapSession()`, 403s an actor whose roles don't resolve to `"orbit"`, and renders `<OrbitShell>`. `OrbitShell` is a copy of `AxisShell`'s structure with ORBIT's 8-path rail and `--module-orbit` accent, no Meridian. ORBIT's route block moves from `workspace.tsx`'s layout into its own `orbit-shell.tsx` layout in `routes.ts`. Only 3 files (`orbit-admin.tsx`, `orbit-dev.tsx`, `conversation.tsx`) call `useShellData` today and need the `useOrbitSessionData` swap — the other 7 ORBIT routes already use their own `useLoaderData()`.

**Tech Stack:** React Router v7 (framework mode), Cloudflare Workers, `@lyra/ui`, Vitest, Playwright.

## Global Constraints

- Rail destinations (8, `routes.ts` declaration order): `orbit/console`, `orbit/supervisor`, `orbit/save`, `orbit/pipeline`, `orbit/quality`, `orbit/analytics`, `orbit/admin`, `orbit/dev`.
- Not on the rail (2, still move under `orbit-shell.tsx`'s layout): `orbit/conversations/:id/thread`, `orbit/journeys/:id/builder`.
- No Meridian on `OrbitShell` — ADR-0061: Meridian is NORTH-only.
- `--module-orbit` accent token already exists in `packages/ui/src/tokens.css:205` (light), `:484` and `:579` (dark) — do not add a new token.
- ADR-0054 (`orbit.retention` → `axis`): the exception lives in `packages/core/src/lens.ts:70` and `apps/web/app/routing.ts:263`, both untouched by this fork. Regression coverage for it already exists in `app/shell.test.ts:88-91` (`"grants orbit.retention the AXIS shell too, per ADR-0054"`) and `packages/core/src/lens.test.ts:94-96` — these must still pass after the `routes.ts` move; no new test needed for it (see Task 3).
- i18n: every rail label needs an `en` + `ar` key, convention `nav.orbit/<segment>` (matches AXIS's `nav.axis/<segment>` keys at `app/i18n/en.ts:33-43`).
- `HIDDEN_ROUTES` (`app/routing.ts`) comments tagged "linked from the ORBIT workspace tools list" (lines 111-119) are the 8 rail routes — remove those 8 entries; keep the 2 detail-route entries (`/orbit/conversations/:id/thread` at line 66, `/orbit/journeys/:id/builder` at line 120) since detail routes stay hidden under every module's convention.

---

### Task 1: i18n keys for ORBIT rail + `HIDDEN_ROUTES` cleanup

**Files:**
- Modify: `apps/web/app/i18n/en.ts` (insert 8 keys before `"nav.orbit": "Conversations",` at line 44)
- Modify: `apps/web/app/i18n/ar.ts` (insert 8 keys before `"nav.orbit": "المحادثات",` at line 43)
- Modify: `apps/web/app/routing.ts` (remove 8 entries from `HIDDEN_ROUTES`, lines 111-119)
- Test: `apps/web/app/shell.test.ts` (existing test, no edit needed — it currently passes because ORBIT's rail routes are hidden; removing them from `HIDDEN_ROUTES` without adding the labels would fail it)

**Interfaces:**
- Consumes: `labelKeyFor(path)` from `app/routing.ts:191-193` (`` `nav.${path.replace(/^\//, "")}` ``) — so `/orbit/console` needs key `"nav.orbit/console"`.
- Produces: nothing new; existing `HIDDEN_ROUTES`, `en`, `ar` exports, now with ORBIT's 8 rail entries moved from "hidden" to "labelled".

- [ ] **Step 1: Run the existing shell test to confirm it currently passes**

Run: `cd apps/web && pnpm vitest run app/shell.test.ts`
Expected: PASS (all ORBIT rail paths are currently in `HIDDEN_ROUTES`, so the "nav label or documented reason" check has nothing to flag yet).

- [ ] **Step 2: Remove the 8 ORBIT rail entries from `HIDDEN_ROUTES`**

In `apps/web/app/routing.ts`, delete these 9 lines (111-119):

```typescript
  "/orbit/console": "the live conversation console, linked from the ORBIT workspace tools list",
  "/orbit/supervisor":
    "the supervisor wall over the whole room, with barge and whisper, linked from the ORBIT workspace tools list",
  "/orbit/save": "the retention save desk, linked from the ORBIT workspace tools list",
  "/orbit/pipeline": "the renewal pipeline, linked from the ORBIT workspace tools list",
  "/orbit/quality": "conversation quality review, linked from the ORBIT workspace tools list",
  "/orbit/analytics": "service and retention analytics, linked from the ORBIT workspace tools list",
  "/orbit/admin": "teams, routing and SLA policy, linked from the ORBIT workspace tools list",
  "/orbit/dev": "the conversation simulator and developer links, linked from the ORBIT workspace tools list",
```

Leave `"/orbit/conversations/:id/thread": "opens from a single conversation record",` (line 66) and `"/orbit/journeys/:id/builder": "opens one journey's steps from the journeys list",` (now the line right after the deleted block) untouched — those two stay hidden.

- [ ] **Step 3: Run the test to see it fail**

Run: `cd apps/web && pnpm vitest run app/shell.test.ts`
Expected: FAIL — `"gives every route a nav label or a documented reason to be hidden"` fails for `/orbit/console` etc. because `en` has no `nav.orbit/console` key yet.

- [ ] **Step 4: Add the 8 keys to `en.ts`**

In `apps/web/app/i18n/en.ts`, insert immediately before `"nav.orbit": "Conversations",` (currently line 44):

```typescript
  "nav.orbit/console": "Console",
  "nav.orbit/supervisor": "Supervisor",
  "nav.orbit/save": "Save desk",
  "nav.orbit/pipeline": "Pipeline",
  "nav.orbit/quality": "Quality",
  "nav.orbit/analytics": "Analytics",
  "nav.orbit/admin": "Admin",
  "nav.orbit/dev": "Dev",
```

- [ ] **Step 5: Add the 8 keys to `ar.ts`**

In `apps/web/app/i18n/ar.ts`, insert immediately before `"nav.orbit": "المحادثات",` (currently line 43):

```typescript
  "nav.orbit/console": "وحدة التحكم",
  "nav.orbit/supervisor": "المشرف",
  "nav.orbit/save": "مكتب الاستبقاء",
  "nav.orbit/pipeline": "خط الأنابيب",
  "nav.orbit/quality": "الجودة",
  "nav.orbit/analytics": "التحليلات",
  "nav.orbit/admin": "الإدارة",
  "nav.orbit/dev": "أدوات المطوّر",
```

- [ ] **Step 6: Run the test to see it pass**

Run: `cd apps/web && pnpm vitest run app/shell.test.ts`
Expected: PASS — including `"keeps en and ar on exactly the same keys"` (both files gained the same 8 keys).

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/i18n/en.ts apps/web/app/i18n/ar.ts apps/web/app/routing.ts
git commit -m "feat(orbit): add rail i18n keys, un-hide ORBIT rail routes"
```

---

### Task 2: `OrbitShell` component + `orbit-shell.tsx` layout route

**Files:**
- Create: `apps/web/app/components/orbit-shell.tsx`
- Create: `apps/web/app/routes/orbit-shell.tsx`
- Test: `apps/web/app/routes/orbit-shell.test.ts`

**Interfaces:**
- Consumes: `SessionBootstrap` from `../session.server`, `bootstrapSession` from `../session.server`, `cloudflare` from `../context`, the shared chrome primitives from `./shell` (`accountMenuItems`, `brandStyle`, `crumbsFor`, `initialsOf`, `lockupNames`, `PageSkeleton`, `profilesFor`, `useSettledFor`), `labelKeyFor`/`moduleOf` from `../routing`, `translator`/`Translate` from `../i18n`, and the same leaf components `AxisShell` uses (`ColdOpen`, `Companion`, `ConstellationMark`, `SearchPalette`, `PostureChips`, `shiftFrom`, `ShiftRail`, `ThemeToggle`) — all already exist, none created by this task.
- Produces: `OrbitShell({ session, children })` component, `orbit-shell.tsx`'s `loader`, `ROUTE_ID = "routes/orbit-shell"`, and `useOrbitSessionData(): SessionBootstrap | undefined` — the hook Task 4's 3 files will import.

- [ ] **Step 1: Write the failing loader test**

Create `apps/web/app/routes/orbit-shell.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

vi.mock("../session.server", () => ({
  bootstrapSession: vi.fn()
}));

vi.mock("../context", () => ({
  cloudflare: { toString: () => "cloudflare-context" }
}));

import { bootstrapSession } from "../session.server";
import { loader } from "./orbit-shell";

function fakeContext(env: unknown) {
  return { get: () => ({ env }) };
}

describe("orbit-shell loader", () => {
  it("returns the session when the actor's roles resolve to orbit", async () => {
    vi.mocked(bootstrapSession).mockResolvedValue({
      availableShells: ["orbit"]
    } as never);
    const result = await loader({
      request: new Request("https://lyra.test/orbit/console"),
      context: fakeContext({})
    } as never);
    expect(result).toEqual({ availableShells: ["orbit"] });
  });

  it("throws 403 (not 401) when the actor's roles never resolve to orbit", async () => {
    vi.mocked(bootstrapSession).mockResolvedValue({
      availableShells: ["north"]
    } as never);
    await expect(
      loader({
        request: new Request("https://lyra.test/orbit/console"),
        context: fakeContext({})
      } as never)
    ).rejects.toMatchObject({ init: { status: 403 } });
  });

  it("still resolves availableShells to include axis for orbit.retention (ADR-0054)", async () => {
    vi.mocked(bootstrapSession).mockResolvedValue({
      availableShells: ["orbit", "axis"]
    } as never);
    const result = await loader({
      request: new Request("https://lyra.test/orbit/console"),
      context: fakeContext({})
    } as never);
    expect(result).toEqual({ availableShells: ["orbit", "axis"] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run app/routes/orbit-shell.test.ts`
Expected: FAIL with "Cannot find module './orbit-shell'" (file doesn't exist yet).

- [ ] **Step 3: Write `orbit-shell.tsx` layout route**

Create `apps/web/app/routes/orbit-shell.tsx`:

```typescript
import { data, Outlet, useLoaderData, useRouteLoaderData, type LoaderFunctionArgs } from "react-router";
import { cloudflare } from "../context";
import { bootstrapSession, type SessionBootstrap } from "../session.server";
import { OrbitShell } from "../components/orbit-shell";

// ORBIT's own layout: same bootstrap every other layout uses, but gated —
// an actor whose roles never resolve to "orbit" is real (bootstrapSession
// already proved that) and simply not entitled to this shell, so this
// throws 403, not 401 (docs/superpowers/specs
// /2026-08-16-orbit-shell-fork-design.md § Architecture).

export const ROUTE_ID = "routes/orbit-shell";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const session = await bootstrapSession(context.get(cloudflare).env, request);
  if (!session.availableShells.includes("orbit")) throw data("", { status: 403 });
  return session;
}

/** Session data for any route rendered inside OrbitShell. */
export function useOrbitSessionData(): SessionBootstrap | undefined {
  return useRouteLoaderData<typeof loader>(ROUTE_ID);
}

export default function OrbitShellLayout() {
  const session = useLoaderData<typeof loader>();
  return (
    <OrbitShell session={session}>
      <Outlet />
    </OrbitShell>
  );
}
```

- [ ] **Step 4: Write `OrbitShell` component**

Create `apps/web/app/components/orbit-shell.tsx`:

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

const ORBIT_ACCENT = "var(--module-orbit)";

/**
 * ORBIT's own rail, compile-time known — the eight `orbit/*` destinations the
 * design spec gives this shell (docs/superpowers/specs
 * /2026-08-16-orbit-shell-fork-design.md §"Rail destinations"). Deliberately
 * NOT derived from `session.nav`: that is WORKSPACE_PATHS-shaped (top-level
 * roots only, routing.ts), so it can never carry a sub-screen. The two
 * `orbit/*` detail routes (conversations/:id/thread, journeys/:id/builder)
 * are opened from a list, not rail destinations themselves — same as every
 * other `:id` route in routing.ts's HIDDEN_ROUTES.
 */
const ORBIT_NAV_PATHS = [
  "/orbit/console",
  "/orbit/supervisor",
  "/orbit/save",
  "/orbit/pipeline",
  "/orbit/quality",
  "/orbit/analytics",
  "/orbit/admin",
  "/orbit/dev"
] as const;

type RailItem = Pick<NavItem, "href" | "labelKey">;

const ORBIT_NAV_ITEMS: RailItem[] = ORBIT_NAV_PATHS.map((href) => ({
  href,
  labelKey: labelKeyFor(href)
}));

/**
 * ORBIT's own shell: a scoped rail (only /orbit/* destinations), the same
 * chrome primitives Shell/NorthShell/AxisShell use (brandStyle, lockupNames,
 * crumbsFor, accountMenuItems, PageSkeleton — all imported, not
 * reimplemented), and the multi-role switcher when this actor's roles reach
 * more than one shell. No Meridian — ADR-0061 is explicit that Meridian is
 * NORTH-only.
 */
export function OrbitShell({
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

  const items = ORBIT_NAV_ITEMS;

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
  // instead of an unsound cast. An orbit.retention actor's availableShells
  // includes "axis" too (ADR-0054), so that link appears here exactly like
  // any other second shell would.
  const moduleLinks: ModuleLink[] = session.availableShells.flatMap((shell) => {
    if (shell === "orbit") return [];
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
              to="/orbit/console"
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
              current="orbit"
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
              <ModuleSwitcher modules={moduleLinks} current="orbit" label={t("nav.group.modules")} />
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
            <span aria-hidden="true" className="h-0.5 w-full shrink-0 rounded-full" style={{ background: ORBIT_ACCENT }} />
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
            style={{ background: ORBIT_ACCENT }}
          />
          <span className="truncate">{t(item.labelKey)}</span>
        </>
      )}
    </NavLink>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run app/routes/orbit-shell.test.ts`
Expected: PASS (3/3).

- [ ] **Step 6: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: no new errors (both new files are unreachable from `routes.ts` until Task 3, but must still typecheck standalone).

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/components/orbit-shell.tsx apps/web/app/routes/orbit-shell.tsx apps/web/app/routes/orbit-shell.test.ts
git commit -m "feat(orbit): add OrbitShell component and orbit-shell layout route"
```

---

### Task 3: Move ORBIT's route block under `orbit-shell.tsx` in `routes.ts`

**Files:**
- Modify: `apps/web/app/routes.ts:66-79` (the `shouldInclude("orbit")` block)
- Test: `apps/web/app/shell.test.ts`, `packages/core/src/lens.test.ts` (existing — this task must not break either)

**Interfaces:**
- Consumes: `OrbitShellLayout` default export and `ROUTE_ID` from `./routes/orbit-shell.tsx` (Task 2).
- Produces: nothing new — same 10 route paths, same target files, only the wrapping layout changes from `workspace.tsx` to `orbit-shell.tsx`.

- [ ] **Step 1: Confirm the ADR-0054 regression tests are green before touching `routes.ts`**

Run: `cd apps/web && pnpm vitest run app/shell.test.ts` and `cd packages/core && pnpm vitest run src/lens.test.ts`
Expected: both PASS, including `"grants orbit.retention the AXIS shell too, per ADR-0054"` in each file. This task's move touches only `routes.ts`'s layout wrapping — it must not change `availableShellsForRoles`' resolution, so these are the regression gate, not a new test (Global Constraints).

- [ ] **Step 2: Move the ORBIT block out of `workspace.tsx`'s layout into its own `orbit-shell.tsx` layout**

In `apps/web/app/routes.ts`, delete the block at lines 66-79 (inside the `layout("routes/workspace.tsx", [...])` array):

```typescript
    ...(shouldInclude("orbit")
      ? [
          route("orbit/conversations/:id/thread", "routes/conversation.tsx"),
          route("orbit/console", "routes/orbit-console.tsx"),
          route("orbit/supervisor", "routes/orbit-supervisor.tsx"),
          route("orbit/save", "routes/orbit-save.tsx"),
          route("orbit/pipeline", "routes/orbit-pipeline.tsx"),
          route("orbit/quality", "routes/orbit-quality.tsx"),
          route("orbit/analytics", "routes/orbit-analytics.tsx"),
          route("orbit/admin", "routes/orbit-admin.tsx"),
          route("orbit/dev", "routes/orbit-dev.tsx"),
          route("orbit/journeys/:id/builder", "routes/orbit-journey.tsx")
        ]
      : []),

```

Add a new top-level block, as a sibling of the existing `shouldInclude("axis")` block (after it, before the `shouldInclude("north")` block):

```typescript
  ...(shouldInclude("orbit")
    ? [
        layout("routes/orbit-shell.tsx", [
          route("orbit/conversations/:id/thread", "routes/conversation.tsx"),
          route("orbit/console", "routes/orbit-console.tsx"),
          route("orbit/supervisor", "routes/orbit-supervisor.tsx"),
          route("orbit/save", "routes/orbit-save.tsx"),
          route("orbit/pipeline", "routes/orbit-pipeline.tsx"),
          route("orbit/quality", "routes/orbit-quality.tsx"),
          route("orbit/analytics", "routes/orbit-analytics.tsx"),
          route("orbit/admin", "routes/orbit-admin.tsx"),
          route("orbit/dev", "routes/orbit-dev.tsx"),
          route("orbit/journeys/:id/builder", "routes/orbit-journey.tsx")
        ])
      ]
    : []),
```

- [ ] **Step 3: Extend the route-gating contract test for ORBIT under its new layout**

In `apps/web/app/routes.test.ts`, add after the `"includes only axis's routes when LYRA_MODULES=axis"` test (after line 79):

```typescript
  it("includes only orbit's routes when LYRA_MODULES=orbit", async () => {
    const paths = flatPaths(await loadRoutesUnder("orbit"));
    expect(paths).toContain("orbit/console");
    expect(paths).toContain("orbit/supervisor");
    expect(paths).toContain("orbit/save");
    expect(paths).toContain("orbit/pipeline");
    expect(paths).toContain("orbit/quality");
    expect(paths).toContain("orbit/analytics");
    expect(paths).toContain("orbit/admin");
    expect(paths).toContain("orbit/dev");
    expect(paths).toContain("orbit/conversations/:id/thread");
    expect(paths).toContain("orbit/journeys/:id/builder");
    expect(paths.some((p) => p.startsWith("north/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("axis/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("signal/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("scout/"))).toBe(false);
  });
```

- [ ] **Step 4: Run the contract test and the app to verify routing still resolves**

Run: `cd apps/web && pnpm vitest run app/routes.test.ts`
Expected: PASS, including the new `LYRA_MODULES=orbit` case.

Run: `cd apps/web && pnpm typecheck`
Expected: no new errors (`routes.ts` now references `routes/orbit-shell.tsx`, which Task 2 created).

- [ ] **Step 5: Re-run the ADR-0054 regression tests to confirm the move didn't break them**

Run: `cd apps/web && pnpm vitest run app/shell.test.ts` and `cd packages/core && pnpm vitest run src/lens.test.ts`
Expected: both still PASS — confirms `orbit.retention`'s `availableShells` still resolves to `["orbit", "axis"]` after the route-block relocation.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/routes.ts apps/web/app/routes.test.ts
git commit -m "feat(orbit): move ORBIT routes under their own orbit-shell layout"
```

---

### Task 4: Swap `useShellData` → `useOrbitSessionData` in the 3 files that use it

**Files:**
- Modify: `apps/web/app/routes/orbit-admin.tsx:9,340`
- Modify: `apps/web/app/routes/orbit-dev.tsx:16,237`
- Modify: `apps/web/app/routes/conversation.tsx:38,569`

**Interfaces:**
- Consumes: `useOrbitSessionData` from `../routes/orbit-shell` (Task 2).
- Produces: nothing new — these 3 files stop calling `workspace.tsx`'s `useShellData` and call ORBIT's own hook instead, matching the layout each now actually renders under (Task 3).

- [ ] **Step 1: Swap the import and call site in `orbit-admin.tsx`**

In `apps/web/app/routes/orbit-admin.tsx`, change line 9:

```typescript
import { useShellData } from "./workspace";
```
to:
```typescript
import { useOrbitSessionData } from "./orbit-shell";
```

Change line 340:
```typescript
  const shell = useShellData();
```
to:
```typescript
  const shell = useOrbitSessionData();
```

- [ ] **Step 2: Swap the import and call site in `orbit-dev.tsx`**

In `apps/web/app/routes/orbit-dev.tsx`, change line 16:

```typescript
import { useShellData } from "./workspace";
```
to:
```typescript
import { useOrbitSessionData } from "./orbit-shell";
```

Change line 237:
```typescript
  const shell = useShellData();
```
to:
```typescript
  const shell = useOrbitSessionData();
```

- [ ] **Step 3: Swap the import and call site in `conversation.tsx`**

In `apps/web/app/routes/conversation.tsx`, change line 38:

```typescript
import { useShellData } from "./workspace";
```
to:
```typescript
import { useOrbitSessionData } from "./orbit-shell";
```

Change line 569:
```typescript
  const shell = useShellData();
```
to:
```typescript
  const shell = useOrbitSessionData();
```

- [ ] **Step 4: Typecheck and run the existing tests for these 3 routes**

Run: `cd apps/web && pnpm typecheck`
Expected: no new errors.

Run: `cd apps/web && pnpm vitest run app/routes/orbit-admin.test.ts app/routes/orbit-dev.test.ts app/routes/conversation.test.ts`
Expected: PASS (these existing tests exercise the route components; if any mocks `useShellData` directly rather than through a rendered `<Outlet>`, update the mock's import path to `./orbit-shell` — same file, same export shape, only the source module name changes).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/routes/orbit-admin.tsx apps/web/app/routes/orbit-dev.tsx apps/web/app/routes/conversation.tsx
git commit -m "feat(orbit): read session data from OrbitShell's own hook"
```

---

### Task 5: Playwright journey spec for `OrbitShell`

**Files:**
- Create: `e2e/orbit-shell.spec.ts`

**Interfaces:**
- Consumes: `goto`, `loginAsOrbitAgent` (`e2e/fixtures.ts:109`), `loginAsNorthExec` (`e2e/fixtures.ts:67`) — both already exist, no fixture changes needed.

- [ ] **Step 1: Write the failing journey spec**

Create `e2e/orbit-shell.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";
import { goto, loginAsOrbitAgent, loginAsNorthExec } from "./fixtures.js";

// @journey:J-ORBIT-SHELL (docs/superpowers/specs/2026-08-16-orbit-shell-fork-design.md):
// OrbitShell is its own scoped shell — an actor with an orbit.*-resolving role
// lands in it and sees only ORBIT's own rail (never another module's,
// ModuleSwitcher only appears once an actor's roles resolve to more than one
// shell, which orbit.agent's single role never does), and an actor without one
// gets 403 (not 401 — bootstrapSession already proved who they are, they are
// just not entitled to this shell: orbit-shell.tsx's loader). No Meridian —
// ADR-0061 is explicit that Meridian is NORTH-only.

test("orbit.agent lands in OrbitShell and sees only ORBIT's own rail", async ({ page }) => {
  await loginAsOrbitAgent(page);
  await goto(page, "/orbit/console");

  // orbit-shell.tsx renders two <nav aria-label="Primary"> landmarks (one
  // md:hidden for mobile, one hidden md:flex for desktop); Playwright's
  // default chromium viewport is desktop-sized, so the mobile one is
  // display:none and getByRole already excludes it from the a11y tree —
  // .first() is defensive, matching axis-shell.spec.ts's convention.
  const rail = page.getByRole("navigation", { name: /primary/i }).first();

  await expect(rail.getByRole("link", { name: /console/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /supervisor/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /save desk/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /pipeline/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /quality/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /analytics/i })).toBeVisible();

  // No other module's destinations leak into this rail.
  await expect(rail.getByRole("link", { name: /^brief$/i })).toHaveCount(0);
  await expect(rail.getByRole("link", { name: /exceptions/i })).toHaveCount(0);
});

test("an actor with no orbit.*-resolving role gets 403, not 401, on /orbit/*", async ({ page }) => {
  await loginAsNorthExec(page);
  const response = await page.goto("/orbit/console");
  expect(response?.status()).toBe(403);
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm e2e e2e/orbit-shell.spec.ts`
Expected: FAIL — `/orbit/console` is currently rendered inside `workspace.tsx`'s generic `<Shell>` at this point in history only if Tasks 2-4 haven't landed yet in this same branch; since this plan executes Tasks 1-4 before Task 5, this spec should already PASS once reached. Run it anyway per TDD discipline for the spec file itself: if it passes immediately, note that in the commit and move to Step 3 without changes.

- [ ] **Step 3: Run the spec to verify it passes**

Run: `pnpm e2e e2e/orbit-shell.spec.ts`
Expected: PASS (2/2) — Tasks 2-4 already put `OrbitShell` in place.

- [ ] **Step 4: Commit**

```bash
git add e2e/orbit-shell.spec.ts
git commit -m "test(orbit): add OrbitShell journey spec (@journey:J-ORBIT-SHELL)"
```

---

### Task 6: Full suite verification gate

**Files:** none (verification only; fix forward in the relevant task's files if something fails).

**Interfaces:** none.

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: 0 errors.

- [ ] **Step 3: Unit + integration tests**

Run: `pnpm test`
Expected: all green, including `app/shell.test.ts`, `app/routes.test.ts`, `app/routes/orbit-shell.test.ts`, `packages/core/src/lens.test.ts`.

- [ ] **Step 4: E2E**

Run: `pnpm e2e`
Expected: all green, including `e2e/orbit-shell.spec.ts` and `e2e/axis-shell.spec.ts` (no regression on AXIS's fork).

- [ ] **Step 5: If anything fails**

Identify which task's files are responsible, fix in place, re-run the specific failing command, then re-run the full gate (Steps 1-4) before proceeding. Do not commit a fix without re-running the suite.

- [ ] **Step 6: No commit for this task**

This task is a verification gate; if all four steps pass with no changes, there is nothing to commit. If a fix was needed, commit it under a message describing the fix, scoped to the file(s) touched.

---

## Self-Review

**Spec coverage:** Every section of `docs/superpowers/specs/2026-08-16-orbit-shell-fork-design.md` maps to a task — Rail destinations → Task 2 (`ORBIT_NAV_PATHS`), Architecture's layout/component/routes.ts/useShellData/roles bullets → Tasks 2-4, Testing's five bullets → journey spec (Task 5), 403 test (Task 2's Step 1 + Task 5), ADR-0054 regression (Task 3's Steps 1 and 5, pointing at the two tests that already exist rather than duplicating them), contract test extension (Task 3's Step 3), loader unit test (Task 2).

**Placeholder scan:** No TBD/TODO; every step shows complete code or an exact command with expected output.

**Type consistency:** `OrbitShell({ session, children })`, `useOrbitSessionData(): SessionBootstrap | undefined`, `ROUTE_ID = "routes/orbit-shell"` are named identically everywhere they're consumed (Tasks 2, 3, 4) — same as `AxisShell`/`useAxisSessionData`/`"routes/axis-shell"` in the AXIS precedent.

**Deviation from spec noted:** the spec's Testing section describes the ADR-0054 regression case as if it were new; investigation (this plan's Task 3, Global Constraints) found it already exists in `app/shell.test.ts:88-91` and `packages/core/src/lens.test.ts:94-96`, untouched by this fork's changes. The plan uses those existing tests as a run-before/run-after gate around the `routes.ts` move (Task 3, Steps 1 and 5) instead of writing a duplicate test — smaller, DRY, and equally effective at catching a regression, since the fork touches only route-layout wrapping, never `lens.ts`/`routing.ts`'s resolution logic itself.
