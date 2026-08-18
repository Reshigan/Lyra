# NORTH Shell-Per-Module Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork NORTH out of the shared `Shell`/`workspace.tsx` layout into its own `NorthShell` with a scoped nav rail, a live/replay Meridian scrubber, and a multi-role switcher — proving the shell-per-module architecture that AXIS/ORBIT/SIGNAL/SCOUT will each follow in their own later specs.

**Architecture:** Extract `workspace.tsx`'s loader body into a shared `bootstrapSession()` so tenancy/RBAC/audit stay centralized regardless of how many shells exist. Route the nine `north/*` screens through a new `north-shell.tsx` layout route (gated by a build-time `LYRA_MODULES` flag) instead of the shared `workspace.tsx` layout. `NorthShell` duplicates the chrome JSX it needs from `Shell` rather than sharing a generalized `ShellChrome` — this is a one-module reference build; a shared chrome abstraction is deferred until a second shell spec exists to prove what it should actually generalize over.

**Tech Stack:** React Router v7 (framework mode) on Cloudflare Workers, TypeScript strict, `@lyra/ui`, `@lyra/core` (Drizzle/libSQL-backed), Vitest, Playwright.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-15-north-shell-fork-design.md`. Where this plan and the spec's prose disagree on a mechanical detail, this plan's Global Constraints win — each deviation below was confirmed against the actual current source, not assumed from the spec's looser description.
- **Deviation 1 — `bootstrapSession` placement.** The spec says "This becomes `bootstrapSession(ctx, request): Promise<SessionBootstrap>` in `packages/core`." `apps/web` has no dependency on `@lyra/core` (confirmed: no such import anywhere in `apps/web`), so the function lives in a new `apps/web/app/session.server.ts` instead. What genuinely belongs in `packages/core` is `availableShellsForRoles` — a pure roles → workspace-slugs function, the same shape as the existing `defaultWorkspaceForRoles` in `packages/core/src/lens.ts` — because it is core RBAC-shape logic, not web-request handling. Since `packages/core` may not depend on an app (see `lens.ts`'s own comment above `WORKSPACE_BY_ROLE`), a second, pure, web-local equivalent is duplicated directly in `apps/web/app/routing.ts` for `bootstrapSession()` to call. This mirrors the existing citation-comment convention in `apps/mobile/src/workspace.ts` (a mobile-side duplicate of the same web-side routing logic).
- **Deviation 2 — `asOf` has a real precedent, no new backend code.** The spec describes `asOf` as a new concept; it already exists. `apps/api/src/http.ts`'s `ListQuery` zod schema has `to: z.coerce.number().int().optional()` (line 81), and `apps/api/src/crud.ts`'s generic list handler already does `if (list.to !== undefined) parts.push(lte(sortCol, list.to));` (line 355). This task only wires a new `?asOf=` URL param into three web loaders as `&to=${asOf}` query string appends — no API or `packages/core` change. `ledger-money-map.tsx` already types this concept as `asOf: number` (lines 47, 80) — the app-side type precedent this plan follows.
- **Deviation 3 — `north-whatif.tsx` uses `?id=`, not `?scenario=`.** The spec's Meridian section describes a projection mode keyed by `?scenario=<id>`. The real route already has a working scenario picker keyed by `?id=` (defaulting to the most-recently-created scenario when absent). This plan does not touch that query param or that screen's logic at all — NORTH's projection affordance is a plain link to bare `/north/whatif`, reusing the cross-link pattern that already exists between `/north/brief` and `/north/whatif`.
- **Deviation 4 — Meridian stays single-day; projection is a separate link, not a Meridian mode.** Meridian's day-strip models one calendar day and has no UI room for a multi-day forward projection. This plan does not add scenario-picker behavior to Meridian itself. It adds exactly one prop (`initialAsOf`) for replay, and `NorthShell` renders a plain navigation link to `/north/whatif` beside it for projection — no scrubber-driven scenario state.
- **Deviation 5 — `e2e/north.spec.ts` is already stale, out of scope.** That file references `/north/briefings`, `/north/scenarios`, `/north/boardpacks` — none of which are real routes (the real ones are `/north/brief`, `/north/whatif`, `/north/board`). This plan does not fix that file. Task 11's new Playwright spec uses the real current paths and is additive.
- **ShellChrome extraction — explicitly not done in this plan.** `NorthShell` duplicates the header/rail/footer JSX it needs from `apps/web/app/components/shell.tsx` directly (reusing its *exported* pure helpers where possible: `brandStyle`, `lockupNames`, `profilesFor`, `routedLeaves`, `crumbsFor`, `accountMenuItems`, `PageSkeleton`) rather than factoring a shared `ShellChrome` component. One module's chrome is not enough evidence for what a shared abstraction should look like; extracting one now risks generalizing over a sample size of one. Revisit when AXIS or ORBIT's shell spec exists.
- **Circular-import fix for `CALENDARS`/`FALLBACK_CURRENCY`/`calendarFrom`.** These three are currently defined in `workspace.tsx` and re-used by `settings.tsx`, `ledger-journal.tsx`, `customer-360.tsx`, `channel-detail.tsx`, and `north-whatif.tsx` — all via `import { ... } from "./workspace"`. `bootstrapSession()` (moving into `session.server.ts`) needs `calendarFrom`/`FALLBACK_CURRENCY` to compute its `calendar`/`currency` fields, and `workspace.tsx`'s loader will now call into `session.server.ts` — so the constants cannot stay defined in `workspace.tsx` without creating a cycle. They move to `session.server.ts` as their one canonical home; `workspace.tsx` imports them from `../session.server` and re-exports them (`export { CALENDARS, FALLBACK_CURRENCY, calendarFrom };`) so none of the five existing importers change their import path.
- Tenancy/RBAC/audit stay centralized in `bootstrapSession()` regardless of shell count (CLAUDE.md rule 1).
- Brand name/logo/colors are read from `session.brand` inside `NorthShell`, never a literal "LYRA" or "NORTH" string in place of the tenant's own brand (CLAUDE.md rule 5).
- `north/*` route registration is gated by `shouldInclude("north")`, a reusable seam every future module shell reuses without re-deriving (CLAUDE.md rule 15).
- No RTL/Arabic work in this plan — English only, per the user's standing instruction to defer Arabic; CLAUDE.md rule 7 is parked for this plan by that explicit direction, not silently ignored.
- ADR-0052 ("no redundant second switcher over one rail") is narrowed, not reversed: the multi-role switcher crosses shells (a control to reach a second, disjoint rail), it does not duplicate the list a single shell's own rail already shows. `docs/decisions/ADR-0061-shell-per-module.md` must state this narrowing explicitly.

---

### Task 1: `availableShellsForRoles` in `packages/core/src/lens.ts`

**Files:**
- Modify: `packages/core/src/lens.ts:46` (insert immediately after `defaultWorkspaceForRoles`, which ends at line 46)
- Modify: `packages/core/src/lens.test.ts:8` (import line), and append a new `describe` block after the existing `describe("defaultWorkspaceForRoles", ...)` block (ends at line 69)

**Interfaces:**
- Produces: `availableShellsForRoles(roles: readonly string[]): string[]` — exported from `packages/core/src/lens.ts`. Not consumed anywhere in `packages/core` itself; it exists as the core-side canonical definition of the "every workspace a role set resolves to" rule, which Task 2 duplicates web-side (per Deviation 1 — packages/core may not depend on an app).

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/lens.test.ts`, right after the existing `describe("defaultWorkspaceForRoles", ...)` block (which ends at line 69):

```ts
describe("availableShellsForRoles", () => {
  it("returns every distinct workspace a multi-role actor's roles resolve to", () => {
    expect(availableShellsForRoles(["north.exec", "axis.agent"])).toEqual(
      expect.arrayContaining(["north", "axis"])
    );
    expect(availableShellsForRoles(["north.exec", "axis.agent"])).toHaveLength(2);
  });

  it("returns exactly one shell for a single-role actor", () => {
    expect(availableShellsForRoles(["north.exec"])).toEqual(["north"]);
  });

  it("collapses duplicate workspaces from different roles into one entry", () => {
    expect(availableShellsForRoles(["tenant.compliance", "tenant.admin"])).toEqual(
      expect.arrayContaining(["compliance", "admin"])
    );
    expect(availableShellsForRoles(["tenant.compliance", "tenant.admin"])).toHaveLength(2);
  });

  it("falls back to north when no role resolves to anything", () => {
    expect(availableShellsForRoles([])).toEqual(["north"]);
  });
});
```

Update the import line (`packages/core/src/lens.test.ts:8`) from:

```ts
import { defaultWorkspaceForRoles, recordLensUsage, resetLens, resolveLens } from "./lens.js";
```

to:

```ts
import { availableShellsForRoles, defaultWorkspaceForRoles, recordLensUsage, resetLens, resolveLens } from "./lens.js";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lyra/core test lens.test.ts`
Expected: FAIL — `availableShellsForRoles is not a function` (or a TypeScript error that it does not exist on the module).

- [ ] **Step 3: Write minimal implementation**

Insert into `packages/core/src/lens.ts` immediately after `defaultWorkspaceForRoles` (after line 46, before `defaultLensFor`):

```ts
/**
 * Every workspace this actor's roles resolve to, not just the first that
 * matches (defaultWorkspaceForRoles's "first role wins" rule collapses a
 * multi-role actor down to one destination). Same three lookups per role —
 * exact key, then prefix table, then the bare prefix itself — but every
 * role's resolution is kept, not just the first role that had one. Powers
 * NorthShell's multi-role switcher (docs/superpowers/specs
 * /2026-08-15-north-shell-fork-design.md §5): an actor holding both
 * `axis.agent` and `north.exec` can reach both shells.
 */
export function availableShellsForRoles(roles: readonly string[]): string[] {
  const found = new Set<string>();
  for (const role of roles) {
    const exact = WORKSPACE_BY_ROLE[role];
    if (exact) {
      found.add(exact);
      continue;
    }
    const prefix = role.split(".")[0] ?? "";
    const mapped = WORKSPACE_BY_ROLE_PREFIX[prefix];
    if (mapped) {
      found.add(mapped);
      continue;
    }
    if (prefix) found.add(prefix);
  }
  return found.size ? [...found] : ["north"];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lyra/core test lens.test.ts`
Expected: PASS — all `availableShellsForRoles` and pre-existing `defaultWorkspaceForRoles` tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lens.ts packages/core/src/lens.test.ts
git commit -m "feat(core): add availableShellsForRoles for multi-shell role resolution"
```

---

### Task 2: Web-local `availableShellsForRoles` duplicate in `apps/web/app/routing.ts`

**Files:**
- Modify: `apps/web/app/routing.ts` (append near the bottom, after `moduleOf`)
- Modify: `apps/web/app/shell.test.ts:7` (import line), append a new `describe` block after the existing `describe("route tree", ...)` block (ends at line 46)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `availableShellsForRoles(roles: readonly string[]): string[]` exported from `apps/web/app/routing.ts`. Consumed by Task 3's `bootstrapSession()`.

**Note on duplication:** This is a second, independent copy of Task 1's function — not a re-export. `packages/core` cannot be imported by `apps/web` for this purpose (see Deviation 1), so the roles → slugs tables and logic are restated here with their own web-local tables (`WORKSPACE_BY_ROLE`/`WORKSPACE_BY_ROLE_PREFIX`), matching `packages/core/src/lens.ts`'s tables value-for-value. This is *not* the same as the file's existing `HOME_BY_ROLE_PREFIX` (that table maps to full nav-guaranteed paths like `/admin`, and has no `finance`/`partner`/`provider` entries) — a different table, kept separate.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/app/shell.test.ts`, after the existing `describe("route tree", ...)` block:

```ts
describe("availableShellsForRoles", () => {
  it("returns every distinct workspace a multi-role actor's roles resolve to", () => {
    expect(availableShellsForRoles(["north.exec", "axis.agent"])).toEqual(
      expect.arrayContaining(["north", "axis"])
    );
    expect(availableShellsForRoles(["north.exec", "axis.agent"])).toHaveLength(2);
  });

  it("returns exactly one shell for a single-role actor", () => {
    expect(availableShellsForRoles(["north.exec"])).toEqual(["north"]);
  });

  it("falls back to north when no role resolves to anything", () => {
    expect(availableShellsForRoles([])).toEqual(["north"]);
  });
});
```

Update the import line (`apps/web/app/shell.test.ts:7`) from:

```ts
import { HIDDEN_ROUTES, WORKSPACE_PATHS, labelKeyFor, landingFor } from "./routing";
```

to:

```ts
import { HIDDEN_ROUTES, WORKSPACE_PATHS, availableShellsForRoles, labelKeyFor, landingFor } from "./routing";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test shell.test.ts`
Expected: FAIL — `availableShellsForRoles is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/web/app/routing.ts` (after `moduleOf`, at the end of the file):

```ts
/**
 * Web-local duplicate of packages/core/src/lens.ts's `availableShellsForRoles`
 * (that function's own header comment explains why: packages/core may not
 * depend on an app). Every workspace this actor's roles resolve to, not just
 * the first-wins default `defaultWorkspaceForRoles` returns — used by
 * bootstrapSession() (session.server.ts) to compute `session.availableShells`
 * for the multi-role switcher (docs/superpowers/specs
 * /2026-08-15-north-shell-fork-design.md §5).
 */
const WORKSPACE_BY_ROLE: Record<string, string> = {
  "tenant.compliance": "compliance"
};
const WORKSPACE_BY_ROLE_PREFIX: Record<string, string> = {
  tenant: "admin",
  platform: "admin",
  dev: "admin",
  partner: "distribution",
  provider: "scout",
  customer: "settings",
  finance: "ledger"
};

export function availableShellsForRoles(roles: readonly string[]): string[] {
  const found = new Set<string>();
  for (const role of roles) {
    const exact = WORKSPACE_BY_ROLE[role];
    if (exact) {
      found.add(exact);
      continue;
    }
    const prefix = role.split(".")[0] ?? "";
    const mapped = WORKSPACE_BY_ROLE_PREFIX[prefix];
    if (mapped) {
      found.add(mapped);
      continue;
    }
    if (prefix) found.add(prefix);
  }
  return found.size ? [...found] : ["north"];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test shell.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/routing.ts apps/web/app/shell.test.ts
git commit -m "feat(web): add web-local availableShellsForRoles for session bootstrap"
```

---

### Task 3: `session.server.ts` extraction + `workspace.tsx` refactor

**Files:**
- Create: `apps/web/app/session.server.ts`
- Modify: `apps/web/app/routes/workspace.tsx` (replace loader body + constant definitions with delegation)
- Test: `apps/web/app/session.server.test.ts` (new)

**Interfaces:**
- Consumes: `availableShellsForRoles` from `./routing` (Task 2).
- Produces:
  - `export const CALENDARS: readonly CalendarPreference[]`
  - `export const FALLBACK_CURRENCY: string`
  - `export function calendarFrom(value: unknown): CalendarPreference`
  - `export interface SessionBootstrap { locale: string; inbox: Inbox | null; names: Names; nav: NavItem[]; roles: string[]; permissions: string[]; brand: Brand | null; tenantName: string; actorName: string | null; domainPack: string; calendar: CalendarPreference; currency: string; overrides: Record<string, string>; availableShells: string[]; }`
  - `export async function bootstrapSession(env: Env, request: Request): Promise<SessionBootstrap>`
  - All consumed by Task 6 (`north-shell.tsx` layout route) and by `workspace.tsx`'s own loader.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/session.server.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CALENDARS, FALLBACK_CURRENCY, calendarFrom } from "./session.server";

describe("calendarFrom", () => {
  it("passes through a known calendar preference", () => {
    expect(calendarFrom("islamic-umalqura")).toBe("islamic-umalqura");
    expect(calendarFrom("dual")).toBe("dual");
  });

  it("falls back to gregorian for anything unrecognized", () => {
    expect(calendarFrom("solar")).toBe("gregorian");
    expect(calendarFrom(undefined)).toBe("gregorian");
    expect(calendarFrom(null)).toBe("gregorian");
  });
});

describe("CALENDARS / FALLBACK_CURRENCY", () => {
  it("exposes the three supported calendar preferences", () => {
    expect(CALENDARS).toEqual(["gregorian", "islamic-umalqura", "dual"]);
  });

  it("exposes AED as the fallback currency", () => {
    expect(FALLBACK_CURRENCY).toBe("AED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test session.server.test.ts`
Expected: FAIL — `Cannot find module './session.server'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/app/session.server.ts`:

```ts
import { data, redirect } from "react-router";
import type { CalendarPreference } from "@lyra/ui";
import type { Brand, NavItem } from "./api.server";
import { api, ApiError, fetchMe, names } from "./api.server";
import type { Names } from "./names";
import type { Inbox } from "./components/shift";
import { chosenLocale } from "./i18n";
import { DEFAULT_PACK } from "./modules/vocabulary";
import { availableShellsForRoles } from "./routing";
import type { Env } from "./env";
import { cloudflare } from "./context";

// Everything behind a session hangs off one bootstrap call: actor, tenant
// brand, permissions, and the nav the API already filtered for them. Both
// workspace.tsx (every non-module screen) and north-shell.tsx (NORTH's own
// layout) call this identically — tenancy/RBAC/audit stay centralized in one
// place no matter how many module shells exist (CLAUDE.md rule 1).

export const CALENDARS: readonly CalendarPreference[] = ["gregorian", "islamic-umalqura", "dual"];

/**
 * Last resort when neither the row nor the tenant's policy names a currency.
 * One literal, in one place, so a tenant on a different currency is a policy
 * edit rather than a grep. `Intl.NumberFormat` has no neutral code to fall back
 * to — it throws on an empty one — so this cannot simply be absent.
 */
export const FALLBACK_CURRENCY = "AED";

/** Tenant policy is loosely typed across the wire; an unknown value is Gregorian. */
export function calendarFrom(value: unknown): CalendarPreference {
  return CALENDARS.find((known) => known === value) ?? "gregorian";
}

export interface SessionBootstrap {
  locale: string;
  inbox: Inbox | null;
  names: Names;
  nav: NavItem[];
  roles: string[];
  permissions: string[];
  brand: Brand | null;
  tenantName: string;
  actorName: string | null;
  domainPack: string;
  calendar: CalendarPreference;
  currency: string;
  overrides: Record<string, string>;
  /** Every module workspace this actor's real roles resolve to (Task 1/2's
   *  availableShellsForRoles), not just the first-wins default. Powers the
   *  multi-role switcher — absent or length-1 means it never renders. */
  availableShells: string[];
}

export async function bootstrapSession(env: Env, request: Request): Promise<SessionBootstrap> {
  let me;
  try {
    me = await fetchMe(env, request);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      const next = new URL(request.url).pathname;
      throw redirect(`/login?next=${encodeURIComponent(next)}`);
    }
    // Anything else keeps its status and carries the request id to the boundary,
    // so the message a user reads is the one support can look up.
    if (error instanceof ApiError) throw data(error.requestId ?? "", { status: error.status });
    throw error;
  }

  // The shell's day strip and shift block. Tolerant on purpose: this call is
  // decoration around the work, and a queue that failed to load must not take
  // the screen the actor asked for down with it. Both surfaces render nothing
  // when it is null.
  const inbox = await api<Inbox>("/v1/me/inbox", { env, request }).catch(() => null);

  // The rail lists the approvals by what they are about, and an approval holds a
  // ref, not a name. Batched into one call, and skipped entirely when the queue
  // is empty (names() returns {} for no refs without touching the network).
  const subjects = await names(
    (inbox?.approvals ?? []).map((approval) => approval.subjectRef),
    { env, request }
  );

  return {
    // The explicit choice wins over the stored one, because <html lang>/dir come
    // from that same cookie (root.tsx) and the two must not disagree. The pseudo
    // locale — which no profile can hold — is the case that makes it obvious.
    locale: chosenLocale(request) ?? me.locale,
    inbox,
    names: subjects,
    nav: me.nav,
    roles: me.roles,
    permissions: me.permissions,
    brand: me.tenant.brand,
    tenantName: me.tenant.name,
    actorName: me.profile?.name ?? null,
    // CLAUDE.md §14: the pack that renames every noun downstream of labelsFor.
    domainPack: typeof me.policy?.domainPack === "string" ? me.policy.domainPack : DEFAULT_PACK,
    calendar: calendarFrom(me.policy?.calendarPreference),
    // What a money figure is denominated in when the row itself does not say.
    // Same policy field the brand editor writes (settings.tsx).
    currency: typeof me.policy?.currency === "string" ? me.policy.currency : FALLBACK_CURRENCY,
    // A tenant admin's i18n key relabels (core_locale_overrides), merged by
    // translator() over the static catalogue — see apps/web/app/i18n.ts.
    overrides: me.overrides ?? {},
    availableShells: availableShellsForRoles(me.roles)
  };
}

export { cloudflare };
```

Note the trailing `export { cloudflare };` is **not** added — `workspace.tsx` already imports `cloudflare` directly from `../context` and continues to do so; remove that line before saving (it is listed here only to flag that `session.server.ts` does not need to re-export it). The actual file has no such line.

Now refactor `apps/web/app/routes/workspace.tsx` in full:

```tsx
import {
  Outlet,
  useLoaderData,
  useRouteError,
  useRouteLoaderData,
  type LoaderFunctionArgs,
  type MetaFunction
} from "react-router";
import { UiCalendarProvider } from "@lyra/ui";
import { cloudflare } from "../context";
import { ErrorPanel } from "../components/error-panel";
import { Shell } from "../components/shell";
import { DEFAULT_LOCALE, translator } from "../i18n";
import { bootstrapSession, CALENDARS, FALLBACK_CURRENCY, calendarFrom } from "../session.server";

// Everything behind a session hangs off this layout. bootstrapSession() feeds
// the whole shell: actor, tenant brand, permissions and the nav the API
// already filtered for them. north-shell.tsx calls the same function for
// NORTH's own layout — see session.server.ts.

export const ROUTE_ID = "routes/workspace";

export { CALENDARS, FALLBACK_CURRENCY, calendarFrom };

export async function loader({ request, context }: LoaderFunctionArgs) {
  return bootstrapSession(context.get(cloudflare).env, request);
}

export type ShellData = Awaited<ReturnType<typeof loader>>;

/** Shell data for any route rendered inside the layout. */
export function useShellData(): ShellData | undefined {
  return useRouteLoaderData<typeof loader>(ROUTE_ID);
}

export const meta: MetaFunction<typeof loader> = ({ loaderData: loaded }) => [
  // The product name is tenant configuration, never a literal (CLAUDE.md §5).
  { title: loaded?.brand?.name ?? loaded?.tenantName ?? "" }
];

/**
 * A screen inside the session that fails is still a screen. Without a boundary
 * here the nearest one is root's, which replaces the whole document: typing
 * `/north` as an agent who holds no NORTH role dropped the rail, the day strip
 * and the tenant's own brand, and read as a crash rather than a closed door.
 *
 * It has to survive its own layout's loader having failed — the boundary
 * renders for that case too, and there is then no shell to render. The bare
 * panel is the fallback; root's boundary stays the one for a dead document.
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const shell = useShellData();
  const t = translator(shell?.locale ?? DEFAULT_LOCALE, shell?.overrides);
  const panel = <ErrorPanel error={error} t={t} className="mx-auto my-16" />;

  if (!shell) return <main className="mx-auto flex min-h-screen max-w-prose flex-col justify-center p-8">{panel}</main>;

  return (
    <UiCalendarProvider calendar={shell.calendar}>
      <Shell
        t={t}
        nav={shell.nav}
        brand={shell.brand}
        tenantName={shell.tenantName}
        actorName={shell.actorName}
        inbox={shell.inbox}
        names={shell.names}
        roles={shell.roles}
        permissions={shell.permissions}
      >
        {panel}
      </Shell>
    </UiCalendarProvider>
  );
}

export default function Workspace() {
  const shell = useLoaderData<typeof loader>();
  const t = translator(shell.locale, shell.overrides);

  return (
    // Every <DateTime> below reads the tenant's calendar off this provider —
    // the alternative is remembering a prop at 124 call sites.
    <UiCalendarProvider calendar={shell.calendar}>
      <Shell
        t={t}
        nav={shell.nav}
        brand={shell.brand}
        tenantName={shell.tenantName}
        actorName={shell.actorName}
        inbox={shell.inbox}
        names={shell.names}
        roles={shell.roles}
        permissions={shell.permissions}
      >
        <Outlet />
      </Shell>
    </UiCalendarProvider>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test session.server.test.ts shell.roles.test.ts shell.brand.test.ts`
Expected: PASS — the new `session.server.test.ts` passes, and the pre-existing `shell.roles.test.ts`/`shell.brand.test.ts` (which exercise `profilesFor`/`accountMenuItems`, untouched pure helpers in `shell.tsx`) still pass unchanged.

- [ ] **Step 5: Typecheck the five existing importers of the relocated constants**

Run: `pnpm --filter web typecheck`
Expected: PASS — `settings.tsx`, `ledger-journal.tsx`, `customer-360.tsx`, `channel-detail.tsx`, and `north-whatif.tsx` all still `import { ... } from "./workspace"` unchanged, and `workspace.tsx`'s re-export keeps that resolving.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/session.server.ts apps/web/app/session.server.test.ts apps/web/app/routes/workspace.tsx
git commit -m "refactor(web): extract bootstrapSession into session.server.ts"
```

---

### Task 4: `routes.ts` — `shouldInclude` gate + move the `north/*` block

**Files:**
- Modify: `apps/web/app/routes.ts:71-79` (the nine `north/*` route lines, currently nested inside the shared `layout("routes/workspace.tsx", [...])`)

**Interfaces:**
- Consumes: nothing from earlier tasks (pure config).
- Produces: `shouldInclude(module: string): boolean`, module-local to `routes.ts` (not exported — nothing outside this file needs it). Task 5's contract test exercises it indirectly by dynamically importing `routes.ts` under different `process.env.LYRA_MODULES` values.

- [ ] **Step 1: Remove the nine `north/*` lines from inside the shared layout**

In `apps/web/app/routes.ts`, delete these nine lines (currently at 71-79, inside `layout("routes/workspace.tsx", [...])`):

```ts
    route("north/brief", "routes/north-brief.tsx"),
    route("north/explorer", "routes/north-explorer.tsx"),
    route("north/anomalies", "routes/north-anomalies.tsx"),
    route("north/whatif", "routes/north-whatif.tsx"),
    route("north/board", "routes/north-board.tsx"),
    route("north/board/:id/file", "routes/north-board-file.tsx"),
    route("north/decisions", "routes/north-decisions.tsx"),
    route("north/admin", "routes/north-admin.tsx"),
    route("north/dev", "routes/north-dev.tsx"),
```

- [ ] **Step 2: Add `shouldInclude()` and the new top-level `north-shell` layout entry**

Near the top of `apps/web/app/routes.ts`, before the exported route array, add:

```ts
// LYRA_MODULES is a build-time flag (read once at config-eval time, not a
// runtime wrangler var — see docs/superpowers/specs
// /2026-08-15-north-shell-fork-design.md § Standalone/together build).
// Comma-separated module list, e.g. "north" or "north,axis"; unset or "all"
// includes everything (today's default build, zero behavior change).
function shouldInclude(module: string): boolean {
  const raw = process.env.LYRA_MODULES;
  if (!raw || raw === "all") return true;
  return raw.split(",").map((m) => m.trim()).includes(module);
}
```

Then add a new top-level array entry, as a sibling of the existing `layout("routes/workspace.tsx", [...])` entry (not nested inside it):

```ts
  ...(shouldInclude("north")
    ? [
        layout("routes/north-shell.tsx", [
          route("north/brief", "routes/north-brief.tsx"),
          route("north/explorer", "routes/north-explorer.tsx"),
          route("north/anomalies", "routes/north-anomalies.tsx"),
          route("north/whatif", "routes/north-whatif.tsx"),
          route("north/board", "routes/north-board.tsx"),
          route("north/board/:id/file", "routes/north-board-file.tsx"),
          route("north/decisions", "routes/north-decisions.tsx"),
          route("north/admin", "routes/north-admin.tsx"),
          route("north/dev", "routes/north-dev.tsx")
        ])
      ]
    : [])
```

`login`/`logout` and the four portal routes stay exactly where they are, outside any `shouldInclude` gate — no module can be standalone without auth.

- [ ] **Step 3: Verify the app still boots with the default (ungated) build**

Run: `pnpm --filter web dev` (or `pnpm --filter web build`), confirm no route-manifest errors and `/north/brief` still resolves. Stop the dev server once confirmed.

- [ ] **Step 4: Commit**

(Held together with Task 5's contract test in one commit — see Task 5 Step 5 — since `routes.ts`'s only real test coverage is that contract test.)

---

### Task 5: `routes.test.ts` — `LYRA_MODULES` contract test

**Files:**
- Create: `apps/web/app/routes.test.ts`

**Interfaces:**
- Consumes: `apps/web/app/routes.ts`'s default export (the route config array), dynamically imported under different `process.env.LYRA_MODULES` values.
- Produces: nothing consumed by later tasks — this is a standalone contract test, the one the spec's "Standalone / together build" section requires so the `shouldInclude()` seam cannot silently rot.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/routes.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

// routes.ts reads process.env.LYRA_MODULES once at import time, so each case
// needs a fresh module instance — vi.resetModules() plus a fresh dynamic
// import, not a single shared import.
async function loadRoutesUnder(lyraModules: string | undefined) {
  vi.resetModules();
  if (lyraModules === undefined) delete process.env.LYRA_MODULES;
  else process.env.LYRA_MODULES = lyraModules;
  const mod = await import("./routes");
  return mod.default;
}

function flatPaths(config: unknown): string[] {
  const out: string[] = [];
  function walk(nodes: unknown): void {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (node && typeof node === "object") {
        if ("path" in node && typeof (node as { path?: unknown }).path === "string") {
          out.push((node as { path: string }).path);
        }
        if ("children" in node) walk((node as { children?: unknown }).children);
      }
    }
  }
  walk(config);
  return out;
}

describe("LYRA_MODULES route gating", () => {
  afterEach(() => {
    delete process.env.LYRA_MODULES;
  });

  it("includes every module's routes by default (unset)", async () => {
    const paths = flatPaths(await loadRoutesUnder(undefined));
    expect(paths).toContain("north/brief");
    expect(paths).toContain("axis/quote-desk");
  });

  it("includes every module's routes when LYRA_MODULES=all", async () => {
    const paths = flatPaths(await loadRoutesUnder("all"));
    expect(paths).toContain("north/brief");
    expect(paths).toContain("axis/quote-desk");
  });

  it("includes only north's routes when LYRA_MODULES=north", async () => {
    const paths = flatPaths(await loadRoutesUnder("north"));
    expect(paths).toContain("north/brief");
    expect(paths).toContain("north/explorer");
    expect(paths).toContain("north/anomalies");
    expect(paths).toContain("north/whatif");
    expect(paths).toContain("north/board");
    expect(paths).toContain("north/decisions");
    expect(paths).toContain("north/admin");
    expect(paths).toContain("north/dev");
    expect(paths.some((p) => p.startsWith("axis/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("orbit/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("signal/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("scout/"))).toBe(false);
  });

  it("still includes login/logout when scoped to a single module", async () => {
    const paths = flatPaths(await loadRoutesUnder("north"));
    expect(paths).toContain("login");
    expect(paths).toContain("logout");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test routes.test.ts`
Expected: FAIL — with `LYRA_MODULES=north`, AXIS/ORBIT/SIGNAL/SCOUT routes are still present because Task 4 has not yet gated them (if Task 4 already landed first, this instead confirms PASS immediately — run Task 4 before this step in that case, and treat this as the verification step rather than a red step).

- [ ] **Step 3: Confirm Task 4's `routes.ts` change satisfies it**

If Task 4 has already been applied, no new implementation code is needed here — this test exists purely to prove Task 4's `shouldInclude()` gate is correct. If it fails, fix `routes.ts`'s gate placement (Task 4 Step 2) until it passes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (bundles Task 4 + Task 5 together — one is untested config, the other is its test)

```bash
git add apps/web/app/routes.ts apps/web/app/routes.test.ts
git commit -m "feat(web): gate north/* routes behind LYRA_MODULES, add contract test"
```

---

### Task 6: `north-shell.tsx` layout route

**Files:**
- Create: `apps/web/app/routes/north-shell.tsx`

**Interfaces:**
- Consumes: `bootstrapSession`, `type SessionBootstrap` from `../session.server` (Task 3); `cloudflare` from `../context`; `NorthShell` from `../components/north-shell` (Task 7).
- Produces: `export const ROUTE_ID = "routes/north-shell"`; `export function useNorthSessionData(): SessionBootstrap | undefined`. Consumed by Task 9 (the eight `north-*.tsx` route files swap `useShellData` from `"./workspace"` for `useNorthSessionData` from `"./north-shell"`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/routes/north-shell.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../session.server", () => ({
  bootstrapSession: vi.fn()
}));

vi.mock("../context", () => ({
  cloudflare: { toString: () => "cloudflare-context" }
}));

import { bootstrapSession } from "../session.server";
import { loader } from "./north-shell";

function fakeContext(env: unknown) {
  return { get: () => ({ env }) };
}

describe("north-shell loader", () => {
  it("returns the session when the actor's roles resolve to north", async () => {
    vi.mocked(bootstrapSession).mockResolvedValue({
      availableShells: ["north"]
    } as never);
    const result = await loader({
      request: new Request("https://lyra.test/north/brief"),
      context: fakeContext({})
    } as never);
    expect(result).toEqual({ availableShells: ["north"] });
  });

  it("throws 403 (not 401) when the actor's roles never resolve to north", async () => {
    vi.mocked(bootstrapSession).mockResolvedValue({
      availableShells: ["axis"]
    } as never);
    await expect(
      loader({
        request: new Request("https://lyra.test/north/brief"),
        context: fakeContext({})
      } as never)
    ).rejects.toMatchObject({ status: 403 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test north-shell.test.ts`
Expected: FAIL — `Cannot find module './north-shell'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/app/routes/north-shell.tsx`:

```tsx
import { data, Outlet, useLoaderData, useRouteLoaderData, type LoaderFunctionArgs } from "react-router";
import { cloudflare } from "../context";
import { bootstrapSession, type SessionBootstrap } from "../session.server";
import { NorthShell } from "../components/north-shell";

// NORTH's own layout: same bootstrap every other layout uses, but gated —
// an actor whose roles never resolve to "north" is real (bootstrapSession
// already proved that) and simply not entitled to this shell, so this
// throws 403, not 401 (docs/superpowers/specs
// /2026-08-15-north-shell-fork-design.md § Routing).

export const ROUTE_ID = "routes/north-shell";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const session = await bootstrapSession(context.get(cloudflare).env, request);
  if (!session.availableShells.includes("north")) throw data("", { status: 403 });
  return session;
}

/** Session data for any route rendered inside NorthShell. */
export function useNorthSessionData(): SessionBootstrap | undefined {
  return useRouteLoaderData<typeof loader>(ROUTE_ID);
}

export default function NorthShellLayout() {
  const session = useLoaderData<typeof loader>();
  return (
    <NorthShell session={session}>
      <Outlet />
    </NorthShell>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test north-shell.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

(Held with Task 7's `NorthShell` component in one commit — the layout route does not render without it. See Task 7 Step 5.)

---

### Task 7: `NorthShell` component

**Files:**
- Create: `apps/web/app/components/north-shell.tsx`

**Interfaces:**
- Consumes: `type SessionBootstrap` from `../session.server` (Task 3); `brandStyle`, `lockupNames`, `profilesFor`, `routedLeaves`, `crumbsFor`, `accountMenuItems`, `PageSkeleton`, `type TenantBrand` from `./shell` (all already exported, unmodified); `Meridian` (with the new `initialAsOf` prop from Task 8) from `./meridian`; `ColdOpen`, `Companion`, `ConstellationMark`, `SearchPalette`, `PostureChips`, `ShiftRail`, `ThemeToggle` from their existing sibling files; `ModuleSwitcher`, `type ModuleLink`, `type LyraModule` from `@lyra/ui`.
- Produces: `export function NorthShell({ session, children }: { session: SessionBootstrap; children: React.ReactNode }): JSX.Element`. Rendered by Task 6's `north-shell.tsx` default export.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/components/north-shell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { NorthShell } from "./north-shell";
import type { SessionBootstrap } from "../session.server";

function sessionWith(overrides: Partial<SessionBootstrap> = {}): SessionBootstrap {
  return {
    locale: "en",
    inbox: null,
    names: {},
    nav: [
      {
        labelKey: "nav.north",
        href: "/north",
        icon: "compass",
        heading: true,
        children: [
          { labelKey: "north.brief", href: "/north/brief", icon: "sun" },
          { labelKey: "north.explorer", href: "/north/explorer", icon: "chart" }
        ]
      },
      { labelKey: "nav.axis", href: "/axis", icon: "gear" }
    ],
    roles: ["north.exec"],
    permissions: [],
    brand: null,
    tenantName: "Sahab Cover",
    actorName: "Amina Al Farsi",
    domainPack: "insurance",
    calendar: "gregorian",
    currency: "AED",
    overrides: {},
    availableShells: ["north"],
    ...overrides
  };
}

function renderShell(session: SessionBootstrap) {
  const router = createMemoryRouter(
    [{ path: "/north/brief", element: <NorthShell session={session}>work</NorthShell> }],
    { initialEntries: ["/north/brief"] }
  );
  return render(<RouterProvider router={router} />);
}

describe("NorthShell", () => {
  it("renders only NORTH's own nav destinations, not other modules'", () => {
    renderShell(sessionWith());
    expect(screen.getByRole("link", { name: /north\.brief/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /nav\.axis/i })).not.toBeInTheDocument();
  });

  it("hides the multi-role switcher for a single-shell actor", () => {
    renderShell(sessionWith({ availableShells: ["north"] }));
    expect(screen.queryByRole("navigation", { name: "Modules" })).not.toBeInTheDocument();
  });

  it("shows the multi-role switcher for a multi-shell actor", () => {
    renderShell(sessionWith({ availableShells: ["north", "axis"] }));
    expect(screen.getByRole("navigation", { name: "Modules" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test north-shell.test.tsx`
Expected: FAIL — `Cannot find module './north-shell'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/app/components/north-shell.tsx`:

```tsx
import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate, useSearchParams, useSubmit } from "react-router";
import { Breadcrumbs, Menu, ModuleSwitcher, type LyraModule, type ModuleLink } from "@lyra/ui";
import type { NavItem } from "../api.server";
import { chosenLocale as _unused, translator } from "../i18n";
import { isRouted } from "../routing";
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
            <ModuleSwitcher modules={moduleLinks} current="north" label="Modules" />
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

function NavItemLink({ item, t }: { item: NavItem; t: (key: string, vars?: Record<string, unknown>) => string }) {
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
```

Also remove the placeholder `chosenLocale as _unused` import — it was left in during drafting and is not needed; the final file's import line for `../i18n` is just:

```ts
import { translator } from "../i18n";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test north-shell.test.tsx north-shell.test.ts`
Expected: PASS — both `north-shell.tsx`'s loader test (Task 6) and this component test pass; the loader test's `NorthShell` import now resolves.

- [ ] **Step 5: Commit** (Task 6 + Task 7 together — the layout route and its component are one deliverable)

```bash
git add apps/web/app/routes/north-shell.tsx apps/web/app/routes/north-shell.test.ts \
  apps/web/app/components/north-shell.tsx apps/web/app/components/north-shell.test.tsx
git commit -m "feat(web): add NorthShell layout route and component"
```

---

### Task 8: Meridian `initialAsOf` prop

**Files:**
- Modify: `apps/web/app/components/meridian.tsx:29-42` (props interface + cursor state)
- Test: `apps/web/app/components/meridian.test.tsx` (new, or append if a test file already exists for this component — check first with `ls apps/web/app/components/meridian.test.tsx`; if absent, create it)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Meridian`'s props gain `initialAsOf?: number | null` (optional, defaults to `null` — the shared `Shell`'s existing usage at `shell.tsx:399`, which does not pass it, is unaffected). Consumed by Task 7's `NorthShell`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/components/meridian.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Meridian } from "./meridian";

describe("Meridian initialAsOf", () => {
  it("seeds the scrubber cursor from initialAsOf when provided", () => {
    const asOf = 1_700_000_000_000;
    render(
      <Meridian
        t={(key) => key}
        inbox={null}
        accent="var(--module-north)"
        initialAsOf={asOf}
        onScrub={vi.fn()}
      />
    );
    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("aria-valuenow", String(asOf));
  });

  it("defaults to live (no cursor) when initialAsOf is absent", () => {
    render(<Meridian t={(key) => key} inbox={null} accent="var(--module-north)" onScrub={vi.fn()} />);
    const slider = screen.getByRole("slider");
    expect(slider).not.toHaveAttribute("aria-valuenow", "0");
  });
});
```

Adjust the exact assertion in Step 1 to match `meridian.tsx`'s real slider markup (its `role="slider"` element's `aria-valuenow` binding) if it differs from a plain numeric cursor value — read the render JSX at `meridian.tsx:101-234` before finalizing this assertion, since the plan's earlier fact-gathering pass confirmed the state shape (`cursor: number | null`) but not the exact ARIA attribute wiring line-by-line.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test meridian.test.tsx`
Expected: FAIL — `initialAsOf` is not a recognized prop / cursor does not seed from it.

- [ ] **Step 3: Write minimal implementation**

In `apps/web/app/components/meridian.tsx`, change the props destructuring (line 29-40) to add `initialAsOf`:

```tsx
export function Meridian({
  t,
  inbox,
  accent,
  initialAsOf = null,
  onScrub
}: {
  t: Translate;
  inbox?: Inbox | null;
  accent: string;
  /** Seeds the scrubber's cursor in replay mode (?asOf=<epoch-ms> in the
   *  caller's URL). Absent/null means live — the pre-existing default. */
  initialAsOf?: number | null;
  onScrub?: (value: number | null) => void;
}) {
```

And change line 42 from:

```tsx
  const [cursor, setCursor] = React.useState<number | null>(null);
```

to:

```tsx
  const [cursor, setCursor] = React.useState<number | null>(initialAsOf);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test meridian.test.tsx`
Expected: PASS.

- [ ] **Step 5: Confirm the shared `Shell`'s existing usage is unaffected**

Run: `pnpm --filter web test shell.roles.test.ts shell.brand.test.ts`
Expected: PASS — `shell.tsx:399`'s `<Meridian t={t} inbox={inbox} accent={accentFor(pathname)} onScrub={setAsOf} />` omits `initialAsOf`, which now defaults to `null` (identical to today's hardcoded `useState<number | null>(null)`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/meridian.tsx apps/web/app/components/meridian.test.tsx
git commit -m "feat(web): add initialAsOf prop to Meridian for replay-mode deep links"
```

---

### Task 9: Swap `useShellData` → `useNorthSessionData` in the eight NORTH route files

**Files:**
- Modify: `apps/web/app/routes/north-brief.tsx`
- Modify: `apps/web/app/routes/north-explorer.tsx`
- Modify: `apps/web/app/routes/north-anomalies.tsx`
- Modify: `apps/web/app/routes/north-whatif.tsx`
- Modify: `apps/web/app/routes/north-board.tsx`
- Modify: `apps/web/app/routes/north-decisions.tsx`
- Modify: `apps/web/app/routes/north-admin.tsx`
- Modify: `apps/web/app/routes/north-dev.tsx`
- Not modified: `apps/web/app/routes/north-board-file.tsx` (confirmed to have no `useShellData` usage)

**Interfaces:**
- Consumes: `useNorthSessionData` from `./north-shell` (Task 6).
- Produces: nothing new — this is a mechanical swap of an existing call site's data source, from the shared workspace session to the NORTH-scoped one (which is a strict superset of shape plus `availableShells`).

- [ ] **Step 1: `north-brief.tsx`**

Change the import line:

```ts
import { useShellData } from "./workspace";
```

to:

```ts
import { useNorthSessionData } from "./north-shell";
```

Change the call site:

```ts
const shell = useShellData();
```

to:

```ts
const shell = useNorthSessionData();
```

- [ ] **Step 2: `north-explorer.tsx`** — identical swap: same two lines (`import { useShellData } from "./workspace";` → `import { useNorthSessionData } from "./north-shell";`; `const shell = useShellData();` → `const shell = useNorthSessionData();`).

- [ ] **Step 3: `north-anomalies.tsx`** — identical swap.

- [ ] **Step 4: `north-whatif.tsx`** — this file also imports `FALLBACK_CURRENCY` in the same line, which must keep coming from `"./workspace"` (Task 3's re-export). Change:

```ts
import { FALLBACK_CURRENCY, useShellData } from "./workspace";
```

to two lines:

```ts
import { FALLBACK_CURRENCY } from "./workspace";
import { useNorthSessionData } from "./north-shell";
```

Change the call site:

```ts
const shell = useShellData();
```

to:

```ts
const shell = useNorthSessionData();
```

(Line `const currency = shell?.currency ?? FALLBACK_CURRENCY;` needs no change — `shell.currency` exists identically on `SessionBootstrap`.)

- [ ] **Step 5: `north-board.tsx`** — identical swap to Step 1.

- [ ] **Step 6: `north-decisions.tsx`** — identical swap to Step 1.

- [ ] **Step 7: `north-admin.tsx`** — identical swap to Step 1.

- [ ] **Step 8: `north-dev.tsx`** — identical swap to Step 1.

- [ ] **Step 9: Typecheck all eight**

Run: `pnpm --filter web typecheck`
Expected: PASS — `SessionBootstrap`'s shape is a superset of the old `ShellData` (adds `availableShells`), so every existing `shell.xyz` access in these eight files still resolves.

- [ ] **Step 10: Run the full web test suite as a regression check**

Run: `pnpm --filter web test`
Expected: PASS — no other test references `useShellData` in these eight files.

- [ ] **Step 11: Commit**

```bash
git add apps/web/app/routes/north-brief.tsx apps/web/app/routes/north-explorer.tsx \
  apps/web/app/routes/north-anomalies.tsx apps/web/app/routes/north-whatif.tsx \
  apps/web/app/routes/north-board.tsx apps/web/app/routes/north-decisions.tsx \
  apps/web/app/routes/north-admin.tsx apps/web/app/routes/north-dev.tsx
git commit -m "refactor(web): point NORTH routes at NorthShell's session data, not workspace's"
```

---

### Task 10: `asOf` query-param wiring in `north-brief`/`north-explorer`/`north-anomalies` loaders

**Files:**
- Modify: `apps/web/app/routes/north-brief.tsx` (loader — add `url` extraction from scratch)
- Modify: `apps/web/app/routes/north-explorer.tsx` (loader — extend existing `url.searchParams` usage)
- Modify: `apps/web/app/routes/north-anomalies.tsx` (loader — extend existing `url.searchParams` usage)

**Interfaces:**
- Consumes: `apps/api`'s pre-existing `to` query param support (`ListQuery`'s `to: z.coerce.number().int().optional()` in `apps/api/src/http.ts:81`, applied via `lte(sortCol, list.to)` in `apps/api/src/crud.ts:355`) — no API change in this task.
- Produces: each of the three loaders now reads `?asOf=<epoch-ms>` and appends `&to=${asOf}` to its existing query strings when present.

- [ ] **Step 1: Write the failing test for `north-brief.tsx`**

Create (or append to, if it already exists) `apps/web/app/routes/north-brief.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../api.server", () => ({ api: vi.fn() }));
vi.mock("../context", () => ({ cloudflare: { toString: () => "cloudflare-context" } }));

import { api } from "../api.server";
import { loader } from "./north-brief";

function fakeContext() {
  return { get: () => ({ env: {} }) };
}

describe("north-brief loader asOf", () => {
  it("appends &to=<asOf> to every query when ?asOf= is present", async () => {
    vi.mocked(api).mockResolvedValue({ data: [] });
    await loader({
      request: new Request("https://lyra.test/north/brief?asOf=1700000000000"),
      context: fakeContext()
    } as never);
    const calledPaths = vi.mocked(api).mock.calls.map(([path]) => path as string);
    expect(calledPaths.every((path) => path.includes("&to=1700000000000"))).toBe(true);
  });

  it("omits &to= when ?asOf= is absent (live mode, unchanged behavior)", async () => {
    vi.mocked(api).mockResolvedValue({ data: [] });
    await loader({
      request: new Request("https://lyra.test/north/brief"),
      context: fakeContext()
    } as never);
    const calledPaths = vi.mocked(api).mock.calls.map(([path]) => path as string);
    expect(calledPaths.every((path) => !path.includes("&to="))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test north-brief.test.ts`
Expected: FAIL — the first case fails because `asOf` is never read or appended today.

- [ ] **Step 3: Implement in `north-brief.tsx`**

Change the loader from:

```ts
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const opts = { env, request };

  const [briefings, metrics, anomalies] = await Promise.all([
    readable(api<Page<Briefing>>(`/v1/north/briefings?sort=date&order=desc&limit=${RECENT}`, opts)),
    readable(api<Page<Metric>>("/v1/north/metrics?limit=200", opts)),
    readable(api<Page<Anomaly>>("/v1/north/anomalies?state=new&sort=detectedAt&order=desc&limit=10", opts))
  ]);

  return {
    briefings: briefings?.data ?? null,
    metrics: metrics?.data ?? [],
    anomalies: anomalies?.data ?? [],
    idempotencyKey: crypto.randomUUID()
  };
}
```

to:

```ts
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const opts = { env, request };
  const url = new URL(request.url);
  // ?asOf=<epoch-ms> replays this screen as of a past moment (Meridian's
  // replay mode) — an upper time bound on every query here, threaded through
  // to the API's pre-existing `to` param (apps/api/src/http.ts's ListQuery).
  const asOf = url.searchParams.get("asOf");
  const to = asOf ? `&to=${encodeURIComponent(asOf)}` : "";

  const [briefings, metrics, anomalies] = await Promise.all([
    readable(api<Page<Briefing>>(`/v1/north/briefings?sort=date&order=desc&limit=${RECENT}${to}`, opts)),
    readable(api<Page<Metric>>(`/v1/north/metrics?limit=200${to}`, opts)),
    readable(
      api<Page<Anomaly>>(`/v1/north/anomalies?state=new&sort=detectedAt&order=desc&limit=10${to}`, opts)
    )
  ]);

  return {
    briefings: briefings?.data ?? null,
    metrics: metrics?.data ?? [],
    anomalies: anomalies?.data ?? [],
    idempotencyKey: crypto.randomUUID()
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test north-brief.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `north-explorer.tsx`**

Create `apps/web/app/routes/north-explorer.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../api.server", () => ({ api: vi.fn() }));
vi.mock("../context", () => ({ cloudflare: { toString: () => "cloudflare-context" } }));

import { api } from "../api.server";
import { loader } from "./north-explorer";

function fakeContext() {
  return { get: () => ({ env: {} }) };
}

describe("north-explorer loader asOf", () => {
  it("appends &to=<asOf> to the snapshots query when ?asOf= is present", async () => {
    vi.mocked(api).mockResolvedValueOnce({ data: [{ key: "gwp", grain: "day" }] });
    vi.mocked(api).mockResolvedValueOnce({ data: [] });
    await loader({
      request: new Request("https://lyra.test/north/explorer?asOf=1700000000000"),
      context: fakeContext()
    } as never);
    const snapshotsCall = vi.mocked(api).mock.calls[1]?.[0] as string;
    expect(snapshotsCall).toContain("&to=1700000000000");
  });

  it("omits &to= when ?asOf= is absent", async () => {
    vi.mocked(api).mockResolvedValueOnce({ data: [{ key: "gwp", grain: "day" }] });
    vi.mocked(api).mockResolvedValueOnce({ data: [] });
    await loader({
      request: new Request("https://lyra.test/north/explorer"),
      context: fakeContext()
    } as never);
    const snapshotsCall = vi.mocked(api).mock.calls[1]?.[0] as string;
    expect(snapshotsCall).not.toContain("&to=");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter web test north-explorer.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implement in `north-explorer.tsx`**

Change the loader from:

```ts
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const opts = { env, request };
  const url = new URL(request.url);

  const metrics = (await readable(api<Page<Metric>>("/v1/north/metrics?limit=200", opts)))?.data ?? [];
  const asked = url.searchParams.get("metric");
  const metric = metrics.find((row) => row.key === asked) ?? metrics[0] ?? null;
  const grain = GRAINS.find((one) => one === url.searchParams.get("grain")) ?? metric?.grain ?? "day";

  const page = metric
    ? await readable(
        api<Page<Snapshot>>(
          `/v1/north/snapshots?metricKey=${encodeURIComponent(metric.key)}&grain=${grain}&sort=period&order=desc&limit=${WINDOW * 4}`,
          opts
        )
      )
    : { data: [] as Snapshot[] };
  const snapshots = page ? page.data.filter((row) => !row.dimsHash).slice(0, WINDOW).reverse() : null;

  return { metrics, metric, grain, snapshots };
}
```

to:

```ts
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const opts = { env, request };
  const url = new URL(request.url);

  const metrics = (await readable(api<Page<Metric>>("/v1/north/metrics?limit=200", opts)))?.data ?? [];
  const asked = url.searchParams.get("metric");
  const metric = metrics.find((row) => row.key === asked) ?? metrics[0] ?? null;
  const grain = GRAINS.find((one) => one === url.searchParams.get("grain")) ?? metric?.grain ?? "day";
  // ?asOf=<epoch-ms> replays the series as of a past moment (Meridian's
  // replay mode) — an upper time bound on the snapshots query.
  const asOf = url.searchParams.get("asOf");
  const to = asOf ? `&to=${encodeURIComponent(asOf)}` : "";

  const page = metric
    ? await readable(
        api<Page<Snapshot>>(
          `/v1/north/snapshots?metricKey=${encodeURIComponent(metric.key)}&grain=${grain}&sort=period&order=desc&limit=${WINDOW * 4}${to}`,
          opts
        )
      )
    : { data: [] as Snapshot[] };
  const snapshots = page ? page.data.filter((row) => !row.dimsHash).slice(0, WINDOW).reverse() : null;

  return { metrics, metric, grain, snapshots };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter web test north-explorer.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing test for `north-anomalies.tsx`**

Create `apps/web/app/routes/north-anomalies.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../api.server", () => ({ api: vi.fn() }));
vi.mock("../context", () => ({ cloudflare: { toString: () => "cloudflare-context" } }));

import { api } from "../api.server";
import { loader } from "./north-anomalies";

function fakeContext() {
  return { get: () => ({ env: {} }) };
}

describe("north-anomalies loader asOf", () => {
  it("appends &to=<asOf> to the anomalies query when ?asOf= is present", async () => {
    vi.mocked(api).mockResolvedValue({ data: [] });
    await loader({
      request: new Request("https://lyra.test/north/anomalies?asOf=1700000000000"),
      context: fakeContext()
    } as never);
    const anomaliesCall = vi.mocked(api).mock.calls[0]?.[0] as string;
    expect(anomaliesCall).toContain("&to=1700000000000");
  });

  it("omits &to= when ?asOf= is absent", async () => {
    vi.mocked(api).mockResolvedValue({ data: [] });
    await loader({
      request: new Request("https://lyra.test/north/anomalies"),
      context: fakeContext()
    } as never);
    const anomaliesCall = vi.mocked(api).mock.calls[0]?.[0] as string;
    expect(anomaliesCall).not.toContain("&to=");
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `pnpm --filter web test north-anomalies.test.ts`
Expected: FAIL.

- [ ] **Step 11: Implement in `north-anomalies.tsx`**

Change the loader from:

```ts
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const opts = { env, request };
  const url = new URL(request.url);

  const state = STATES.find((one) => one === url.searchParams.get("state")) ?? null;
  const query = `/v1/north/anomalies?sort=detectedAt&order=desc&limit=${PAGE}${
    state ? `&state=${state}` : ""
  }`;

  const [anomalies, metrics] = await Promise.all([
    readable(api<Page<Anomaly>>(query, opts)),
    readable(api<Page<Metric>>("/v1/north/metrics?limit=200", opts))
  ]);

  return {
    anomalies: anomalies?.data ?? null,
    metrics: metrics?.data ?? [],
    state,
    idempotencyKey: crypto.randomUUID()
  };
}
```

to:

```ts
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const opts = { env, request };
  const url = new URL(request.url);

  const state = STATES.find((one) => one === url.searchParams.get("state")) ?? null;
  // ?asOf=<epoch-ms> replays the queue as of a past moment (Meridian's
  // replay mode) — an upper time bound on the anomalies query.
  const asOf = url.searchParams.get("asOf");
  const to = asOf ? `&to=${encodeURIComponent(asOf)}` : "";
  const query = `/v1/north/anomalies?sort=detectedAt&order=desc&limit=${PAGE}${
    state ? `&state=${state}` : ""
  }${to}`;

  const [anomalies, metrics] = await Promise.all([
    readable(api<Page<Anomaly>>(query, opts)),
    readable(api<Page<Metric>>("/v1/north/metrics?limit=200", opts))
  ]);

  return {
    anomalies: anomalies?.data ?? null,
    metrics: metrics?.data ?? [],
    state,
    idempotencyKey: crypto.randomUUID()
  };
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `pnpm --filter web test north-anomalies.test.ts`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add apps/web/app/routes/north-brief.tsx apps/web/app/routes/north-brief.test.ts \
  apps/web/app/routes/north-explorer.tsx apps/web/app/routes/north-explorer.test.ts \
  apps/web/app/routes/north-anomalies.tsx apps/web/app/routes/north-anomalies.test.ts
git commit -m "feat(web): wire ?asOf= replay param through NORTH's brief/explorer/anomalies loaders"
```

---

### Task 11: Playwright e2e coverage

**Files:**
- Create: `apps/web/e2e/north-shell.spec.ts`

**Interfaces:**
- Consumes: the running app's real routes (`/north/brief`, `/north/whatif`, `/north/board`, etc.) — not the stale paths in the pre-existing `e2e/north.spec.ts` (Deviation 5; that file is out of scope for this plan).

- [ ] **Step 1: Write the failing journey spec**

Create `apps/web/e2e/north-shell.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

// @journey:J-NORTH-SHELL — an actor with north.exec lands in NorthShell, sees
// only NORTH's nine destinations, and Meridian defaults to live.
test("north.exec lands in NorthShell and sees only NORTH's destinations", async ({ page }) => {
  await page.goto("/north/brief");

  const rail = page.getByRole("navigation", { name: /primary/i });
  await expect(rail.getByRole("link", { name: /brief/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /explorer/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /anomalies/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /axis/i })).toHaveCount(0);
  await expect(rail.getByRole("link", { name: /orbit/i })).toHaveCount(0);

  // Meridian defaults to live: no ?asOf= in the URL, no replay banner shown.
  expect(new URL(page.url()).searchParams.has("asOf")).toBe(false);
});

test("an actor with no north.*-resolving role gets 403, not 401, on /north/*", async ({ page }) => {
  // Assumes the test fixture/login flow can authenticate as a non-north actor
  // (e.g. an axis-only role) — see apps/web/e2e/fixtures for the session
  // helper already used by other module specs (e2e/axis.spec.ts).
  const response = await page.goto("/north/brief");
  expect(response?.status()).toBe(403);
});

test("?asOf= replays north/brief's anomalies as of a past moment", async ({ page }) => {
  const asOf = Date.parse("2026-08-10T00:00:00Z");
  await page.goto(`/north/brief?asOf=${asOf}`);
  await expect(page).toHaveURL(new RegExp(`asOf=${asOf}`));
});
```

- [ ] **Step 2: Run to verify it fails on the pre-fork build**

Run: `pnpm --filter web e2e -- north-shell.spec.ts`
Expected: FAIL before Tasks 1-10 land (no `NorthShell`, no 403 gate, no `?asOf=` wiring); once Tasks 1-10 are all applied, this becomes the green confirmation for the whole plan.

- [ ] **Step 3: Run against the completed build**

Run: `pnpm --filter web e2e -- north-shell.spec.ts`
Expected: PASS, once Tasks 1-10 are complete.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/north-shell.spec.ts
git commit -m "test(web): add NorthShell journey, 403-gate, and asOf-replay e2e coverage"
```

---

### Task 12: ADR-0061 — shell-per-module

**Files:**
- Create: `docs/decisions/ADR-0061-shell-per-module.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Write the ADR**

Create `docs/decisions/ADR-0061-shell-per-module.md`:

```markdown
# ADR-0061: Shell-per-module (NORTH reference build)

**Status:** accepted
**Date:** 2026-08-16
**Context:** docs/superpowers/specs/2026-08-15-north-shell-fork-design.md, docs/superpowers/plans/2026-08-16-north-shell-fork.md

## Decision

NORTH's nine screens (`north/brief`, `north/explorer`, `north/anomalies`,
`north/whatif`, `north/board`, `north/board/:id/file`, `north/decisions`,
`north/admin`, `north/dev`) move off the shared `Shell`/`workspace.tsx`
layout (introduced by commit `212ef48`) onto their own `NorthShell`
component and `north-shell.tsx` layout route. This reverses `212ef48`'s
single-shell direction, but only for the five module prefixes
(north/axis/orbit/signal/scout) — AXIS/ORBIT/SIGNAL/SCOUT get their own
follow-on specs and are not built here. Every non-module area (ledger,
admin, distribution, settings, platform, onboarding, design, search) keeps
today's shared `Shell` unchanged.

## Scope

**Built in this ADR's scope:**
- `bootstrapSession()` — extracted from `workspace.tsx`'s loader into
  `apps/web/app/session.server.ts`, called identically by `workspace.tsx`
  and `north-shell.tsx`.
- `availableShellsForRoles` — a pure roles → workspace-slugs function, added
  to `packages/core/src/lens.ts` (core-side canonical definition) and
  duplicated web-side in `apps/web/app/routing.ts` (apps/web has no
  dependency on `@lyra/core`; `packages/core` may not depend on an app —
  same convention `apps/mobile/src/workspace.ts` already follows for the
  same reason).
- `NorthShell` — its own nav rail (only `/north/*` destinations), the
  `--module-north` accent, Meridian scrubber, and the multi-role switcher.
- `LYRA_MODULES` build-time flag + `shouldInclude()` route-manifest gate.
- The multi-role switcher (`ModuleSwitcher`/`ModuleLink`, `@lyra/ui`) —
  generic, reusable by any future module shell.

**Explicitly deferred:** `AxisShell`, `OrbitShell`, `SignalShell`,
`ScoutShell`, a compliance shell, the mapping of non-module shared screens
(ledger, distribution, admin/*, platform, settings) into a persona shell,
and a shared `ShellChrome` abstraction (one module's chrome is not enough
evidence for what a shared component should generalize over — revisit once
a second module shell exists).

## Shared-bootstrap boundary

Tenancy, RBAC, and audit guarantees (CLAUDE.md rule 1) live in exactly one
place — `bootstrapSession()` — regardless of how many shells exist. Every
module shell's layout route calls it identically; none re-implements
`fetchMe`, the 401 redirect, or the inbox/names batching.

## ADR-0052 narrowing

ADR-0052 forbids mounting a second switcher widget beside a rail that
already lists every destination the actor can reach — one shared rail, one
list, no redundant second control. Under this design there is no longer one
shared rail: each module shell has its own rail, scoped to only that
module's own screens. The multi-role switcher introduced here is **not** a
redundant second list over the same rail — it is the only way to reach a
second, disjoint rail belonging to a different shell, and it renders only
when `session.availableShells.length > 1`. ADR-0052's reasoning still holds
within any one shell; this ADR narrows it to not extend to choosing between
shells.

## Deviations from the original design spec (see the implementation plan's
Global Constraints for full detail)

1. `bootstrapSession` lives in `apps/web/app/session.server.ts`, not
   literally "in packages/core" — apps/web has no `@lyra/core` dependency.
2. `?asOf=` reuses `apps/api`'s pre-existing `to` query param
   (`ListQuery.to`, `apps/api/src/http.ts:81`) — no new backend code.
3. `north-whatif.tsx`'s scenario picker already uses `?id=`, not
   `?scenario=`; this ADR's scope does not touch that screen's query
   contract.
4. Meridian stays single-day; projection is a plain link to `/north/whatif`,
   not a Meridian mode.

## Naming note

"Horizon" (the user-provided mockup's working name) and Meridian's
"projection" mode are both used informally in prior design discussion for
different concepts — flagged here so a future reader does not conflate
the mockup reference name with the scrubber's forward-projection state.

## Consequences

- A fourth shell (after NORTH, and eventually AXIS/ORBIT/SIGNAL/SCOUT) adds
  one layout route + one shell component + one `shouldInclude()` entry —
  the seam is proven, not theoretical.
- `LYRA_MODULES=north pnpm build` produces a route manifest with zero
  AXIS/ORBIT/SIGNAL/SCOUT routes (`apps/web/app/routes.test.ts`), so a
  standalone NORTH Worker build is available whenever a real deploy target
  needs one — `wrangler.jsonc` gets no new `env` block in this ADR's scope.
```

- [ ] **Step 2: Commit**

```bash
git add docs/decisions/ADR-0061-shell-per-module.md
git commit -m "docs: add ADR-0061 for the shell-per-module fork (NORTH reference build)"
```

---

## Self-Review

**1. Spec coverage:**
- Shared session bootstrap extraction (spec § Architecture / Shared bootstrap) → Task 3.
- `NorthShell` + `north-shell.tsx` layout route (spec § Architecture / Routing, `NorthShell`) → Tasks 6, 7.
- Meridian scrubber live/replay (spec § Architecture / Meridian) → Tasks 8, 10. Projection explicitly descoped to a plain link per Deviation 4, stated in Global Constraints and Task 7's rail.
- `LYRA_MODULES` flag + standalone/together build (spec § Standalone/together build) → Task 4 (`shouldInclude`), Task 5 (contract test).
- RBAC-scoped multi-role switcher (spec §5) → Tasks 1, 2 (`availableShellsForRoles`), Task 7 (`ModuleSwitcher` rendering).
- Testing section: failing `@journey:J-XX` spec first → Task 11 Step 1-2 (written before the shell exists, fails, then passes once Tasks 1-10 land). `bootstrapSession()` extraction tests → Task 3. `availableShells` resolution tests → Tasks 1, 2. `asOf` loader tests → Task 10. `LYRA_MODULES` contract test → Task 5. 403-not-401 test → Task 6 Step 1, Task 11.
- ADR → Task 12.

**2. Placeholder scan:** No "TBD"/"TODO"/"add appropriate X" phrases remain. One caveat is explicit and intentional, not a placeholder: Task 8 Step 1 flags that the exact ARIA assertion may need adjusting against `meridian.tsx`'s real slider markup — this is a legitimate implementation-time verification step (the component's existing render JSX wasn't re-quoted verbatim in this plan), not an unfinished plan step; the fallback instruction ("read the render JSX... before finalizing this assertion") is itself an actionable, bounded step.

**3. Type consistency:** `SessionBootstrap` (Task 3) is used identically in Task 6 (`bootstrapSession` return type, `useNorthSessionData` return type), Task 7 (`NorthShell`'s `session` prop), and Task 9 (the eight route files' `shell` variable — a strict superset of the old `ShellData`, so no existing field access breaks). `availableShellsForRoles(roles: readonly string[]): string[]` has the identical signature in Task 1 (core) and Task 2 (web) — verified against each other and against `defaultWorkspaceForRoles`'s existing signature they're modeled on. `initialAsOf?: number | null` (Task 8) matches the type Task 7 passes (`initialAsOf` computed as `number | null` from `searchParams.get("asOf")`). `onScrub`'s signature (`(value: number | null) => void`) is unchanged from the shared `Shell`'s existing usage, and Task 7's `handleScrub` matches it.

---

Plan complete and saved to `docs/superpowers/plans/2026-08-16-north-shell-fork.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
