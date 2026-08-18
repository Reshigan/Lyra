# SIGNAL Shell Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give SIGNAL its own scoped shell (`SignalShell` + `signal-shell.tsx` layout route) with its own nav rail, header, and `--module-signal` accent — the third fork of ADR-0061's shell-per-module pattern, after AXIS and ORBIT.

**Architecture:** Copy ORBIT's fork verbatim, renamed: a `signal-shell.tsx` layout route calls `bootstrapSession()`, 403s an actor whose roles don't resolve to `"signal"`, and renders `<SignalShell>`. `SignalShell` is a copy of `OrbitShell`'s structure with SIGNAL's 9-path rail and `--module-signal` accent, no Meridian. SIGNAL's route block moves from `workspace.tsx`'s layout into its own `signal-shell.tsx` layout in `routes.ts`. 9 of the 10 SIGNAL routes call `useShellData` today and need the `useSignalSessionData` swap; `signal-creative-image.tsx` (a raw image-proxy loader, no component, no shell data) needs only the layout move. Unlike ORBIT, SIGNAL has no ADR-0054-style cross-link exception — `lens.ts`'s only hard-coded cross-link is `orbit.retention` → `axis`; nothing references `signal` — so no equivalent regression test is needed.

**Tech Stack:** React Router v7 (framework mode), Cloudflare Workers, `@lyra/ui`, Vitest, Playwright.

## Global Constraints

- Rail destinations (9, `routes.ts` declaration order): `signal/cockpit`, `signal/studio`, `signal/audience-value`, `signal/answer-engines`, `signal/experiments`, `signal/budget`, `signal/analytics`, `signal/admin`, `signal/dev`.
- Not on the rail (1, still moves under `signal-shell.tsx`'s layout): `signal/creatives/:id/image` — a raw image-proxy loader with no page and no shell/session data. No `useShellData` swap for this file.
- No Meridian on `SignalShell` — ADR-0061: Meridian is NORTH-only.
- `--module-signal` accent token already exists in `packages/ui/src/tokens.css:206` (light), `:485`/`:580` (dark), `:613` (`--color-module-signal`) — do not add a new token.
- No ADR-0054-style exception exists for SIGNAL: confirmed by reading `packages/core/src/lens.ts` in full — the only hard-coded cross-link is `if (role === "orbit.retention") found.add("axis");` (line 254). SIGNAL roles resolve purely via the generic prefix rule (`role.split(".")[0]`). No regression test to preserve, unlike ORBIT's Task 3.
- i18n: every rail label needs an `en` + `ar` key, convention `nav.signal/<segment>` (matches ORBIT's `nav.orbit/<segment>` keys at `app/i18n/en.ts:44-51`).
- `HIDDEN_ROUTES` (`app/routing.ts`) currently hides all 10 SIGNAL paths (lines 84-99), each commented "linked from the signal workspace tools list" — remove the 9 rail entries; keep `"/signal/creatives/:id/image": "streams one generated creative's image, opened from the studio's creative list"` (line 87) since detail routes stay hidden under every module's convention.
- The 403-not-401 test precedent is each module's own `<module>-shell.test.ts` loader test (e.g. `orbit-shell.test.ts`'s `"throws 403 (not 401) when the actor's roles never resolve to orbit"`) — not `app/components/shell.roles.test.ts`, which tests unrelated `profilesFor`/`accountMenuItems` role-switcher logic.

---

### Task 1: i18n keys for SIGNAL rail + `HIDDEN_ROUTES` cleanup

**Files:**
- Modify: `apps/web/app/i18n/en.ts` (insert 9 keys before `"nav.signal": "Marketing",` at line 53)
- Modify: `apps/web/app/i18n/ar.ts` (insert 9 keys before `"nav.signal": "التسويق",` at line 52)
- Modify: `apps/web/app/routing.ts` (remove 9 rail entries from `HIDDEN_ROUTES`, lines 84-86 and 88-99; keep line 87)
- Test: `apps/web/app/shell.test.ts` (existing test, no edit needed — currently passes because SIGNAL's rail routes are hidden; removing them from `HIDDEN_ROUTES` without adding the labels would fail it)

**Interfaces:**
- Consumes: `labelKeyFor(path)` from `app/routing.ts` (`` `nav.${path.replace(/^\//, "")}` ``) — so `/signal/cockpit` needs key `"nav.signal/cockpit"`.
- Produces: nothing new; existing `HIDDEN_ROUTES`, `en`, `ar` exports, now with SIGNAL's 9 rail entries moved from "hidden" to "labelled".

- [ ] **Step 1: Run the existing shell test to confirm it currently passes**

Run: `cd apps/web && pnpm vitest run app/shell.test.ts`
Expected: PASS (all SIGNAL rail paths are currently in `HIDDEN_ROUTES`, so the "nav label or documented reason" check has nothing to flag yet).

- [ ] **Step 2: Remove the 9 SIGNAL rail entries from `HIDDEN_ROUTES`**

In `apps/web/app/routing.ts`, delete these lines (currently 84-86 and 88-99 — leave line 87 untouched):

```typescript
  "/signal/cockpit": "the growth read across the SIGNAL ledgers, linked from the signal workspace tools list",
  "/signal/studio":
    "creates a campaign and drafts its content, linked from the signal workspace tools list and from the cockpit when nothing is running",
```
(these two precede the line to keep)
```typescript
  "/signal/audience-value": "value against cost per audience, linked from the signal workspace tools list",
  "/signal/answer-engines": "answer-engine coverage and citation share, linked from the signal workspace tools list",
  "/signal/experiments":
    "the experiment registry and the reading each test stopped on, linked from the signal workspace tools list",
  "/signal/budget":
    "the spend ceiling and the autopilot's bounds, linked from the signal workspace tools list and from the cockpit's autopilot panel",
  "/signal/analytics":
    "CAC, LTV and cohort retention with the spend export, linked from the signal workspace tools list and from the cockpit",
  "/signal/admin":
    "the brand kit, guardrails, budget bounds, approval thresholds and suppression lists everything sent from SIGNAL is checked against, linked from the signal workspace tools list",
  "/signal/dev":
    "the SIGNAL read console, webhook tester and sandbox spend tick, linked from the signal workspace tools list",
```

Leave `"/signal/creatives/:id/image": "streams one generated creative's image, opened from the studio's creative list",` untouched — it stays hidden.

- [ ] **Step 3: Run the test to see it fail**

Run: `cd apps/web && pnpm vitest run app/shell.test.ts`
Expected: FAIL — `"gives every route a nav label or a documented reason to be hidden"` fails for `/signal/cockpit` etc. because `en` has no `nav.signal/cockpit` key yet.

- [ ] **Step 4: Add the 9 keys to `en.ts`**

In `apps/web/app/i18n/en.ts`, insert immediately before `"nav.signal": "Marketing",` (currently line 53):

```typescript
  "nav.signal/cockpit": "Cockpit",
  "nav.signal/studio": "Studio",
  "nav.signal/audience-value": "Audiences",
  "nav.signal/answer-engines": "AEO",
  "nav.signal/experiments": "Experiments",
  "nav.signal/budget": "Budget",
  "nav.signal/analytics": "Analytics",
  "nav.signal/admin": "Admin",
  "nav.signal/dev": "Dev",
```

- [ ] **Step 5: Add the 9 keys to `ar.ts`**

In `apps/web/app/i18n/ar.ts`, insert immediately before `"nav.signal": "التسويق",` (currently line 52):

```typescript
  "nav.signal/cockpit": "لوحة القيادة",
  "nav.signal/studio": "الاستوديو",
  "nav.signal/audience-value": "الجمهور",
  "nav.signal/answer-engines": "محركات الإجابة",
  "nav.signal/experiments": "التجارب",
  "nav.signal/budget": "الميزانية",
  "nav.signal/analytics": "التحليلات",
  "nav.signal/admin": "الإدارة",
  "nav.signal/dev": "أدوات المطوّر",
```

- [ ] **Step 6: Run the test to see it pass**

Run: `cd apps/web && pnpm vitest run app/shell.test.ts`
Expected: PASS — including `"keeps en and ar on exactly the same keys"` (both files gained the same 9 keys).

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/i18n/en.ts apps/web/app/i18n/ar.ts apps/web/app/routing.ts
git commit -m "feat(signal): add rail i18n keys, un-hide SIGNAL rail routes"
```

---

### Task 2: `SignalShell` component + `signal-shell.tsx` layout route

**Files:**
- Create: `apps/web/app/components/signal-shell.tsx`
- Create: `apps/web/app/routes/signal-shell.tsx`
- Test: `apps/web/app/routes/signal-shell.test.ts`

**Interfaces:**
- Consumes: `SessionBootstrap` from `../session.server`, `bootstrapSession` from `../session.server`, `cloudflare` from `../context`, the shared chrome primitives from `./shell` (`accountMenuItems`, `brandStyle`, `crumbsFor`, `initialsOf`, `lockupNames`, `PageSkeleton`, `profilesFor`, `useSettledFor`), `labelKeyFor`/`moduleOf` from `../routing`, `translator`/`Translate` from `../i18n`, and the same leaf components `OrbitShell` uses (`ColdOpen`, `Companion`, `ConstellationMark`, `SearchPalette`, `PostureChips`, `shiftFrom`, `ShiftRail`, `ThemeToggle`) — all already exist, none created by this task.
- Produces: `SignalShell({ session, children })` component, `signal-shell.tsx`'s `loader`, `ROUTE_ID = "routes/signal-shell"`, and `useSignalSessionData(): SessionBootstrap | undefined` — the hook Task 4's 9 files will import.

- [ ] **Step 1: Write the failing loader test**

Create `apps/web/app/routes/signal-shell.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

vi.mock("../session.server", () => ({
  bootstrapSession: vi.fn()
}));

vi.mock("../context", () => ({
  cloudflare: { toString: () => "cloudflare-context" }
}));

import { bootstrapSession } from "../session.server";
import { loader } from "./signal-shell";

function fakeContext(env: unknown) {
  return { get: () => ({ env }) };
}

describe("signal-shell loader", () => {
  it("returns the session when the actor's roles resolve to signal", async () => {
    vi.mocked(bootstrapSession).mockResolvedValue({
      availableShells: ["signal"]
    } as never);
    const result = await loader({
      request: new Request("https://lyra.test/signal/cockpit"),
      context: fakeContext({})
    } as never);
    expect(result).toEqual({ availableShells: ["signal"] });
  });

  it("throws 403 (not 401) when the actor's roles never resolve to signal", async () => {
    vi.mocked(bootstrapSession).mockResolvedValue({
      availableShells: ["north"]
    } as never);
    await expect(
      loader({
        request: new Request("https://lyra.test/signal/cockpit"),
        context: fakeContext({})
      } as never)
    ).rejects.toMatchObject({ init: { status: 403 } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run app/routes/signal-shell.test.ts`
Expected: FAIL with "Cannot find module './signal-shell'" (file doesn't exist yet).

- [ ] **Step 3: Write `signal-shell.tsx` layout route**

Create `apps/web/app/routes/signal-shell.tsx`:

```typescript
import { data, Outlet, useLoaderData, useRouteLoaderData, type LoaderFunctionArgs } from "react-router";
import { cloudflare } from "../context";
import { bootstrapSession, type SessionBootstrap } from "../session.server";
import { SignalShell } from "../components/signal-shell";

// SIGNAL's own layout: same bootstrap every other layout uses, but gated —
// an actor whose roles never resolve to "signal" is real (bootstrapSession
// already proved that) and simply not entitled to this shell, so this
// throws 403, not 401 (docs/superpowers/specs
// /2026-08-16-signal-shell-fork-design.md § Architecture).

export const ROUTE_ID = "routes/signal-shell";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const session = await bootstrapSession(context.get(cloudflare).env, request);
  if (!session.availableShells.includes("signal")) throw data("", { status: 403 });
  return session;
}

/** Session data for any route rendered inside SignalShell. */
export function useSignalSessionData(): SessionBootstrap | undefined {
  return useRouteLoaderData<typeof loader>(ROUTE_ID);
}

export default function SignalShellLayout() {
  const session = useLoaderData<typeof loader>();
  return (
    <SignalShell session={session}>
      <Outlet />
    </SignalShell>
  );
}
```

- [ ] **Step 4: Write `SignalShell` component**

Create `apps/web/app/components/signal-shell.tsx`:

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

const SIGNAL_ACCENT = "var(--module-signal)";

/**
 * SIGNAL's own rail, compile-time known — the nine `signal/*` destinations the
 * design spec gives this shell (docs/superpowers/specs
 * /2026-08-16-signal-shell-fork-design.md §"Rail destinations"). Deliberately
 * NOT derived from `session.nav`: that is WORKSPACE_PATHS-shaped (top-level
 * roots only, routing.ts), so it can never carry a sub-screen. The
 * `signal/creatives/:id/image` detail route is opened from the studio's
 * creative list, not a rail destination itself — same as every other `:id`
 * route in routing.ts's HIDDEN_ROUTES.
 */
const SIGNAL_NAV_PATHS = [
  "/signal/cockpit",
  "/signal/studio",
  "/signal/audience-value",
  "/signal/answer-engines",
  "/signal/experiments",
  "/signal/budget",
  "/signal/analytics",
  "/signal/admin",
  "/signal/dev"
] as const;

type RailItem = Pick<NavItem, "href" | "labelKey">;

const SIGNAL_NAV_ITEMS: RailItem[] = SIGNAL_NAV_PATHS.map((href) => ({
  href,
  labelKey: labelKeyFor(href)
}));

/**
 * SIGNAL's own shell: a scoped rail (only /signal/* destinations), the same
 * chrome primitives Shell/NorthShell/OrbitShell use (brandStyle, lockupNames,
 * crumbsFor, accountMenuItems, PageSkeleton — all imported, not
 * reimplemented), and the multi-role switcher when this actor's roles reach
 * more than one shell. No Meridian — ADR-0061 is explicit that Meridian is
 * NORTH-only.
 */
export function SignalShell({
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

  const items = SIGNAL_NAV_ITEMS;

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
    if (shell === "signal") return [];
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
              to="/signal/cockpit"
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
              current="signal"
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
              <ModuleSwitcher modules={moduleLinks} current="signal" label={t("nav.group.modules")} />
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
            <span aria-hidden="true" className="h-0.5 w-full shrink-0 rounded-full" style={{ background: SIGNAL_ACCENT }} />
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
            style={{ background: SIGNAL_ACCENT }}
          />
          <span className="truncate">{t(item.labelKey)}</span>
        </>
      )}
    </NavLink>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run app/routes/signal-shell.test.ts`
Expected: PASS (2/2).

- [ ] **Step 6: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: no new errors (both new files are unreachable from `routes.ts` until Task 3, but must still typecheck standalone).

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/components/signal-shell.tsx apps/web/app/routes/signal-shell.tsx apps/web/app/routes/signal-shell.test.ts
git commit -m "feat(signal): add SignalShell component and signal-shell layout route"
```

---

### Task 3: Move SIGNAL's route block under `signal-shell.tsx` in `routes.ts`

**Files:**
- Modify: `apps/web/app/routes.ts:80-93` (the `shouldInclude("signal")` block)
- Test: `apps/web/app/routes.test.ts`

**Interfaces:**
- Consumes: `SignalShellLayout` default export from `./routes/signal-shell.tsx` (Task 2).
- Produces: nothing new — same 10 route paths, same target files, only the wrapping layout changes from `workspace.tsx` to `signal-shell.tsx`.

- [ ] **Step 1: Move the SIGNAL block out of `workspace.tsx`'s layout into its own `signal-shell.tsx` layout**

In `apps/web/app/routes.ts`, delete the block at lines 80-93 (inside the `layout("routes/workspace.tsx", [...])` array):

```typescript
    ...(shouldInclude("signal")
      ? [
          route("signal/cockpit", "routes/signal-cockpit.tsx"),
          route("signal/studio", "routes/signal-studio.tsx"),
          route("signal/creatives/:id/image", "routes/signal-creative-image.tsx"),
          route("signal/audience-value", "routes/signal-audience-value.tsx"),
          route("signal/answer-engines", "routes/signal-answer-engines.tsx"),
          route("signal/experiments", "routes/signal-experiments.tsx"),
          route("signal/budget", "routes/signal-budget.tsx"),
          route("signal/analytics", "routes/signal-analytics.tsx"),
          route("signal/admin", "routes/signal-admin.tsx"),
          route("signal/dev", "routes/signal-dev.tsx")
        ]
      : []),
```

Add a new top-level block, as a sibling of the existing `shouldInclude("orbit")` block (after it, before the `shouldInclude("north")` block):

```typescript
  ...(shouldInclude("signal")
    ? [
        layout("routes/signal-shell.tsx", [
          route("signal/cockpit", "routes/signal-cockpit.tsx"),
          route("signal/studio", "routes/signal-studio.tsx"),
          route("signal/creatives/:id/image", "routes/signal-creative-image.tsx"),
          route("signal/audience-value", "routes/signal-audience-value.tsx"),
          route("signal/answer-engines", "routes/signal-answer-engines.tsx"),
          route("signal/experiments", "routes/signal-experiments.tsx"),
          route("signal/budget", "routes/signal-budget.tsx"),
          route("signal/analytics", "routes/signal-analytics.tsx"),
          route("signal/admin", "routes/signal-admin.tsx"),
          route("signal/dev", "routes/signal-dev.tsx")
        ])
      ]
    : []),
```

- [ ] **Step 2: Extend the route-gating contract test for SIGNAL under its new layout**

In `apps/web/app/routes.test.ts`, add after the `"includes only orbit's routes when LYRA_MODULES=orbit"` test (after line 99):

```typescript
  it("includes only signal's routes when LYRA_MODULES=signal", async () => {
    const paths = flatPaths(await loadRoutesUnder("signal"));
    expect(paths).toContain("signal/cockpit");
    expect(paths).toContain("signal/studio");
    expect(paths).toContain("signal/creatives/:id/image");
    expect(paths).toContain("signal/audience-value");
    expect(paths).toContain("signal/answer-engines");
    expect(paths).toContain("signal/experiments");
    expect(paths).toContain("signal/budget");
    expect(paths).toContain("signal/analytics");
    expect(paths).toContain("signal/admin");
    expect(paths).toContain("signal/dev");
    expect(paths.some((p) => p.startsWith("north/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("axis/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("orbit/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("scout/"))).toBe(false);
  });
```

- [ ] **Step 3: Run the contract test and the app to verify routing still resolves**

Run: `cd apps/web && pnpm vitest run app/routes.test.ts`
Expected: PASS, including the new `LYRA_MODULES=signal` case.

Run: `cd apps/web && pnpm typecheck`
Expected: no new errors (`routes.ts` now references `routes/signal-shell.tsx`, which Task 2 created).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/routes.ts apps/web/app/routes.test.ts
git commit -m "feat(signal): move SIGNAL routes under their own signal-shell layout"
```

---

### Task 4: Swap `useShellData` → `useSignalSessionData` in the 9 files that use it

**Files:**
- Modify: `apps/web/app/routes/signal-cockpit.tsx:31,157`
- Modify: `apps/web/app/routes/signal-studio.tsx:40,437`
- Modify: `apps/web/app/routes/signal-audience-value.tsx:5,74`
- Modify: `apps/web/app/routes/signal-answer-engines.tsx:25,109`
- Modify: `apps/web/app/routes/signal-experiments.tsx:29,201`
- Modify: `apps/web/app/routes/signal-budget.tsx:32,194`
- Modify: `apps/web/app/routes/signal-analytics.tsx:27,176`
- Modify: `apps/web/app/routes/signal-admin.tsx:6,144`
- Modify: `apps/web/app/routes/signal-dev.tsx:14,188`

**Interfaces:**
- Consumes: `useSignalSessionData` from `../routes/signal-shell` (Task 2).
- Produces: nothing new — these 9 files stop calling `workspace.tsx`'s `useShellData` and call SIGNAL's own hook instead, matching the layout each now actually renders under (Task 3).

- [ ] **Step 1: Swap the import and call site in each of the 9 files**

Every file's import line reads exactly:

```typescript
import { useShellData } from "./workspace";
```

Change to:

```typescript
import { useSignalSessionData } from "./signal-shell";
```

Every file's usage line reads exactly:

```typescript
  const shell = useShellData();
```

Change to:

```typescript
  const shell = useSignalSessionData();
```

Apply this exact swap at the confirmed line numbers in each of the 9 files listed above (`signal-cockpit.tsx` import line 31 / usage line 157, `signal-studio.tsx` line 40/437, `signal-audience-value.tsx` line 5/74, `signal-answer-engines.tsx` line 25/109, `signal-experiments.tsx` line 29/201, `signal-budget.tsx` line 32/194, `signal-analytics.tsx` line 27/176, `signal-admin.tsx` line 6/144, `signal-dev.tsx` line 14/188). Do not touch `signal-creative-image.tsx` — it has no `useShellData` call.

- [ ] **Step 2: Typecheck and run the existing tests for these routes**

Run: `cd apps/web && pnpm typecheck`
Expected: no new errors.

Run: `cd apps/web && pnpm vitest run app/routes/signal-admin.test.ts app/routes/signal-dev.test.ts app/routes/signal-experiments.test.ts app/routes/signal-screens.test.ts`
Expected: PASS (none of these existing test files mock `useShellData` or import `./workspace` directly — confirmed by grep — so no mock-path updates are needed).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/routes/signal-cockpit.tsx apps/web/app/routes/signal-studio.tsx apps/web/app/routes/signal-audience-value.tsx apps/web/app/routes/signal-answer-engines.tsx apps/web/app/routes/signal-experiments.tsx apps/web/app/routes/signal-budget.tsx apps/web/app/routes/signal-analytics.tsx apps/web/app/routes/signal-admin.tsx apps/web/app/routes/signal-dev.tsx
git commit -m "feat(signal): read session data from SignalShell's own hook"
```

---

### Task 5: Playwright journey spec for `SignalShell`

**Files:**
- Create: `e2e/signal-shell.spec.ts`

**Interfaces:**
- Consumes: `goto`, `loginAsSignalLead` (`e2e/fixtures.ts:94-99`), `loginAsNorthExec` (`e2e/fixtures.ts:67`) — both already exist, no fixture changes needed.

- [ ] **Step 1: Write the failing journey spec**

Create `e2e/signal-shell.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";
import { goto, loginAsSignalLead, loginAsNorthExec } from "./fixtures.js";

// @journey:J-SIGNAL-SHELL (docs/superpowers/specs/2026-08-16-signal-shell-fork-design.md):
// SignalShell is its own scoped shell — an actor with a signal.*-resolving
// role lands in it and sees only SIGNAL's own rail (never another module's,
// ModuleSwitcher only appears once an actor's roles resolve to more than one
// shell, which signal.lead's single role never does), and an actor without one
// gets 403 (not 401 — bootstrapSession already proved who they are, they are
// just not entitled to this shell: signal-shell.tsx's loader). No Meridian —
// ADR-0061 is explicit that Meridian is NORTH-only.

test("signal.lead lands in SignalShell and sees only SIGNAL's own rail", async ({ page }) => {
  await loginAsSignalLead(page);
  await goto(page, "/signal/cockpit");

  // signal-shell.tsx renders two <nav aria-label="Primary"> landmarks (one
  // md:hidden for mobile, one hidden md:flex for desktop); Playwright's
  // default chromium viewport is desktop-sized, so the mobile one is
  // display:none and getByRole already excludes it from the a11y tree —
  // .first() is defensive, matching orbit-shell.spec.ts's convention.
  const rail = page.getByRole("navigation", { name: /primary/i }).first();

  await expect(rail.getByRole("link", { name: /cockpit/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /studio/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /audiences/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /aeo/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /experiments/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /budget/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /analytics/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /admin/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /dev/i })).toBeVisible();

  // No other module's destinations leak into this rail.
  await expect(rail.getByRole("link", { name: /^brief$/i })).toHaveCount(0);
  await expect(rail.getByRole("link", { name: /console/i })).toHaveCount(0);
});

test("an actor with no signal.*-resolving role gets 403, not 401, on /signal/*", async ({ page }) => {
  await loginAsNorthExec(page);
  const response = await page.goto("/signal/cockpit");
  expect(response?.status()).toBe(403);
});
```

- [ ] **Step 2: Run the spec to verify it passes**

Run: `pnpm e2e e2e/signal-shell.spec.ts`
Expected: PASS (2/2) — Tasks 2-4 already put `SignalShell` in place.

- [ ] **Step 3: Commit**

```bash
git add e2e/signal-shell.spec.ts
git commit -m "test(signal): add SignalShell journey spec (@journey:J-SIGNAL-SHELL)"
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
Expected: all green, including `app/shell.test.ts`, `app/routes.test.ts`, `app/routes/signal-shell.test.ts`.

- [ ] **Step 4: E2E**

Run: `pnpm e2e`
Expected: all green, including `e2e/signal-shell.spec.ts` and `e2e/orbit-shell.spec.ts`/`e2e/axis-shell.spec.ts` (no regression on the earlier forks).

- [ ] **Step 5: If anything fails**

Identify which task's files are responsible, fix in place, re-run the specific failing command, then re-run the full gate (Steps 1-4) before proceeding. Do not commit a fix without re-running the suite.

- [ ] **Step 6: No commit for this task**

This task is a verification gate; if all four steps pass with no changes, there is nothing to commit. If a fix was needed, commit it under a message describing the fix, scoped to the file(s) touched.

---

## Self-Review

**Spec coverage:** Every section of `docs/superpowers/specs/2026-08-16-signal-shell-fork-design.md` maps to a task — Rail destinations → Task 2 (`SIGNAL_NAV_PATHS`), Architecture's layout/component/routes.ts/useShellData/roles bullets → Tasks 2-4, Testing's journey spec bullet → Task 5, 403 test → Task 2's Step 1 + Task 5, contract test extension → Task 3's Step 2, loader unit test → Task 2, `signal-creative-image.tsx` regression → Task 3 (route moves, no data-hook swap) covered implicitly by the contract test asserting the path still resolves and by Task 6's e2e gate.

**Placeholder scan:** No TBD/TODO; every step shows complete code or an exact command with expected output.

**Type consistency:** `SignalShell({ session, children })`, `useSignalSessionData(): SessionBootstrap | undefined`, `ROUTE_ID = "routes/signal-shell"` are named identically everywhere they're consumed (Tasks 2, 3, 4) — same as `OrbitShell`/`useOrbitSessionData`/`"routes/orbit-shell"` in the ORBIT precedent.

**Deviation from spec noted:** the spec's Testing section describes the 403 test as "port of AXIS/ORBIT's `shell.roles.test.ts` case" — investigation (this plan's Global Constraints) found that file (`app/components/shell.roles.test.ts`) actually tests unrelated `profilesFor`/`accountMenuItems` role-switcher logic. The real precedent is each module's own `<module>-shell.test.ts` loader test. This plan's Task 2 points at the correct file; the spec's wording is imprecise but the plan's tasks are accurate, so no spec edit was made.

**Deviation from ORBIT's plan noted:** ORBIT's Task 3 included a run-before/run-after gate around the two existing ADR-0054 regression tests (`app/shell.test.ts`, `packages/core/src/lens.test.ts`). No equivalent exists for SIGNAL — confirmed no `signal.`-specific branch in `lens.ts` — so this plan's Task 3 has no such gate; nothing to protect.
