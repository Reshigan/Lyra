# Mobile Foundation Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `apps/mobile`'s flat permission-gated nav list with a role-adaptive tab shell (max 3 tabs + More, per docs/08) sitting behind a biometric re-auth gate, with zero new screen content — every tab still renders the existing `ModuleList`/`ModuleDetail` pair.

**Architecture:** A pure `workspace.ts` module resolves `me.roles` to one of ten workspaces (mirroring the web lens's precedence table). A static `personas.ts` table maps each workspace to its tab list. `session.tsx` resolves the persona once at bootstrap and exposes it. A new Expo Router `(tabs)` group reads the persona and renders up to 3 `Redirect`-to-`/m/<resource>` tabs plus a fixed More tab (the old flat nav list, unchanged). A `biometric-gate.tsx` component wraps the signed-in tree, challenging Face/Touch ID on cold start and foreground resume.

**Tech Stack:** Expo Router (file-based tabs), `expo-local-authentication` (new), `@expo/vector-icons` (new, tab icons), Vitest (Node environment, no native render).

## Global Constraints

- Max 4 tabs total (3 content tabs + always-present More), per docs/08.
- No new styling dependency — reuse `apps/mobile/src/theme.ts` tokens only.
- RTL + i18n: every new user-facing string is an i18n key added to both `en` and `ar` in `apps/mobile/src/i18n.ts` — no literal strings in JSX.
- WCAG 2.2 AA: nothing tappable smaller than `TOUCH_TARGET = 44` (already the default for Tab bar icons/labels; do not override).
- `@lyra/core` stays a devDependency (Node-only e2e tooling) — do NOT move it to `dependencies` or import it from any file under `app/` or `src/`. (Correction against the approved spec's Task 1 text — see Task 1's note.)
- Never hard-code a role string that isn't in `packages/core/src/rbac.ts`'s catalog. The bare role `"customer"` has no dot suffix — do not invent `"customer.self"` or similar.
- Interim tab content is always the existing `app/m/[nav]/index.tsx` / `[id].tsx` pair, reached via `Redirect`. Do not write new screen content in this plan.

---

## Task 1: `workspace.ts` — role → persona resolution

**Files:**
- Create: `apps/mobile/src/workspace.ts`
- Test: `apps/mobile/src/mobile.test.ts` (append import + new `describe` blocks)

**Interfaces:**
- Produces: `type Workspace = "axis" | "orbit" | "signal" | "scout" | "north" | "admin" | "distribution" | "ledger" | "compliance" | "settings"`; `type PersonaVariant = "default" | "board"`; `interface Persona { workspace: Workspace; variant: PersonaVariant }`; `function defaultWorkspaceForRoles(roles: readonly string[]): Workspace`; `function resolvePersona(roles: readonly string[]): Persona`; `function isWorkspace(value: string): value is Workspace`.
- Consumed by: Task 2 (`personas.ts`'s `Record<Workspace, TabConfig[]>` and `tabsFor`), Task 4 (`session.tsx` calls `resolvePersona(me.roles)`), Task 5 (tab layout reads `persona.workspace`/`persona.variant`).

**Note on the approved spec:** `docs/superpowers/specs/2026-08-10-mobile-foundation-shell-design.md` says to import `defaultWorkspaceForRoles` "verbatim" from `packages/core/src/lens.ts` and move `@lyra/core` to a runtime dependency. That file's root export (`packages/core/src/index.ts`) barrels in `drizzle-orm` and `@lyra/db` alongside the function — there is no package.json subpath that exports `lens.ts` alone (only `.`, `./rbac`, `./seed`, `./totp` exist), and Metro has never resolved a `@lyra/*` import in this app (`grep -rn "@lyra/" apps/mobile/app apps/mobile/src` is empty; no `metro.config.js` exists). `lens.ts`'s own header comment already documents this exact tradeoff for the web app's `HOME_BY_ROLE_PREFIX` — it duplicates rather than imports "because packages/core may not depend on an app." This task follows that precedent: duplicate the small precedence table locally. `@lyra/core` stays a devDependency; no `package.json` change in this task.

One deliberate divergence from `lens.ts`'s behavior: `lens.ts` falls back to returning the bare role-prefix string even when it isn't a known workspace (the web lens can route to any dynamically-registered workspace slug). Mobile's tab table (Task 2) is a closed, static set of 10 workspaces per docs/08's role ceiling — an unrecognized prefix must not produce a `Workspace` value the table doesn't have an entry for. `isWorkspace` guards every candidate; an unrecognized prefix falls through to the next role, and `"north"` is the final fallback, exactly as `lens.ts` falls back to `"north"` when `roles` is empty.

- [ ] **Step 1: Write the failing test**

Add this import near the other dynamic imports at the top of `apps/mobile/src/mobile.test.ts` (after the `themeFor` import block):

```ts
const { defaultWorkspaceForRoles, resolvePersona } = await import("./workspace");
```

Append these `describe` blocks at the end of the file:

```ts
describe("defaultWorkspaceForRoles", () => {
  it("matches an exact role before any prefix", () => {
    expect(defaultWorkspaceForRoles(["tenant.compliance"])).toBe("compliance");
  });

  it("falls back to the role's prefix mapping", () => {
    expect(defaultWorkspaceForRoles(["tenant.admin"])).toBe("admin");
    expect(defaultWorkspaceForRoles(["platform.engineer"])).toBe("admin");
    expect(defaultWorkspaceForRoles(["dev.developer"])).toBe("admin");
    expect(defaultWorkspaceForRoles(["partner.manager"])).toBe("distribution");
    expect(defaultWorkspaceForRoles(["provider.viewer"])).toBe("scout");
    expect(defaultWorkspaceForRoles(["customer"])).toBe("settings");
    expect(defaultWorkspaceForRoles(["finance.controller"])).toBe("ledger");
  });

  it("falls back to the bare prefix when it is itself a workspace", () => {
    expect(defaultWorkspaceForRoles(["axis.agent"])).toBe("axis");
    expect(defaultWorkspaceForRoles(["orbit.lead"])).toBe("orbit");
    expect(defaultWorkspaceForRoles(["signal.marketer"])).toBe("signal");
    expect(defaultWorkspaceForRoles(["scout.pm"])).toBe("scout");
    expect(defaultWorkspaceForRoles(["north.exec"])).toBe("north");
  });

  it("tries every role in order until one resolves", () => {
    expect(defaultWorkspaceForRoles(["unknown.role", "axis.lead"])).toBe("axis");
  });

  it("returns north for a roleless actor", () => {
    expect(defaultWorkspaceForRoles([])).toBe("north");
  });
});

describe("resolvePersona", () => {
  it("resolves the default variant for a plain north role", () => {
    expect(resolvePersona(["north.exec"])).toEqual({ workspace: "north", variant: "default" });
  });

  it("resolves the board variant only for north.board", () => {
    expect(resolvePersona(["north.board"])).toEqual({ workspace: "north", variant: "board" });
  });

  it("never applies the board variant outside the north workspace", () => {
    expect(resolvePersona(["tenant.admin"])).toEqual({ workspace: "admin", variant: "default" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && pnpm test`
Expected: FAIL — `Failed to resolve import "./workspace"`

- [ ] **Step 3: Write minimal implementation**

Create `apps/mobile/src/workspace.ts`:

```ts
// Mirrors packages/core/src/lens.ts's `defaultWorkspaceForRoles` (the
// mechanism `resolveLens` uses for the web app's default workspace)
// duplicated rather than imported: that file's package.json has no subpath
// export for lens.ts alone, only the barrel root (which pulls in
// drizzle-orm and @lyra/db) — and lens.ts's own header comment already
// documents duplicating this table for the web app's HOME_BY_ROLE_PREFIX
// for the identical reason ("packages/core may not depend on an app").
// Keep this table's precedence in sync with lens.ts by hand if either
// changes; the two tables have not needed to diverge in practice.

export type Workspace =
  | "axis"
  | "orbit"
  | "signal"
  | "scout"
  | "north"
  | "admin"
  | "distribution"
  | "ledger"
  | "compliance"
  | "settings";

export type PersonaVariant = "default" | "board";

export interface Persona {
  workspace: Workspace;
  variant: PersonaVariant;
}

const WORKSPACES: readonly Workspace[] = [
  "axis",
  "orbit",
  "signal",
  "scout",
  "north",
  "admin",
  "distribution",
  "ledger",
  "compliance",
  "settings"
];

export function isWorkspace(value: string): value is Workspace {
  return (WORKSPACES as readonly string[]).includes(value);
}

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

/**
 * Unlike lens.ts, an unrecognized bare prefix does NOT fall through as a
 * workspace: mobile's persona table (personas.ts) is a closed set of 10
 * workspaces, while the web lens can route to any dynamically-registered
 * workspace slug.
 */
export function defaultWorkspaceForRoles(roles: readonly string[]): Workspace {
  for (const role of roles) {
    const exact = WORKSPACE_BY_ROLE[role];
    if (exact && isWorkspace(exact)) return exact;
    const prefix = role.split(".")[0] ?? "";
    const mapped = WORKSPACE_BY_ROLE_PREFIX[prefix];
    if (mapped && isWorkspace(mapped)) return mapped;
    if (prefix && isWorkspace(prefix)) return prefix;
  }
  return "north";
}

/** `north.board` swaps one tab (Decisions -> Governance) but is still the
 *  `north` workspace — an exact-role check, resolved once at bootstrap,
 *  same staleness contract as the workspace itself. */
export function resolvePersona(roles: readonly string[]): Persona {
  const workspace = defaultWorkspaceForRoles(roles);
  const variant: PersonaVariant = workspace === "north" && roles.includes("north.board") ? "board" : "default";
  return { workspace, variant };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && pnpm test`
Expected: PASS (all new `describe` blocks green)

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/workspace.ts apps/mobile/src/mobile.test.ts
git commit -m "feat(mobile): add workspace/persona resolution from roles"
```

---

## Task 2: `personas.ts` — persona → tabs table

**Files:**
- Create: `apps/mobile/src/personas.ts`
- Modify: `apps/mobile/src/i18n.ts`
- Test: `apps/mobile/src/mobile.test.ts` (append import + new `describe` block)

**Interfaces:**
- Consumes: `type Workspace`, `type PersonaVariant` from `./workspace` (Task 1).
- Produces: `interface TabConfig { labelKey: MessageKey; icon: string; screen: string }`; `const PERSONA_TABS: Record<Workspace, TabConfig[]>`; `function tabsFor(workspace: Workspace, variant: PersonaVariant): TabConfig[]`.
- Consumed by: Task 5 (`(tabs)/_layout.tsx` and the three tab-slot files call `tabsFor(persona.workspace, persona.variant)`).

`TabConfig.screen` is a `nav.ts` `RESOURCE_BY_HREF` value (e.g. `"axis/cases"`) — Task 5's `Redirect` targets `` `/m/${tab.screen}` ``. `TabConfig.icon` is an [Ionicons](https://icons.expo.fyi/Index/Ionicons) glyph name, consumed by Task 5's `@expo/vector-icons` import.

- [ ] **Step 1: Add the new i18n keys**

In `apps/mobile/src/i18n.ts`, in the `en` object, immediately after the line `"nav.back": "Back",` insert:

```ts
  "nav.more": "More",

  "tab.queue": "Queue",
  "tab.sla": "SLA",
  "tab.cases": "Cases",
  "tab.inbox": "Inbox",
  "tab.renewals": "Renewals",
  "tab.approvals": "Approvals",
  "tab.campaigns": "Campaigns",
  "tab.budget": "Budget",
  "tab.attribution": "Attribution",
  "tab.clusters": "Clusters",
  "tab.whitespace": "Whitespace",
  "tab.panel": "Panel",
  "tab.brief": "Brief",
  "tab.decisions": "Decisions",
  "tab.boardpack": "Boardpack",
  "tab.governance": "Governance",
  "tab.staff": "Staff",
```

In the `ar` object, immediately after the line `"nav.back": "رجوع",` insert:

```ts
  "nav.more": "المزيد",

  "tab.queue": "قائمة الانتظار",
  "tab.sla": "اتفاقية مستوى الخدمة",
  "tab.cases": "الحالات",
  "tab.inbox": "الوارد",
  "tab.renewals": "التجديدات",
  "tab.approvals": "الموافقات",
  "tab.campaigns": "الحملات",
  "tab.budget": "الميزانية",
  "tab.attribution": "الإسناد",
  "tab.clusters": "المجموعات",
  "tab.whitespace": "الفرص غير المستغلة",
  "tab.panel": "اللجنة",
  "tab.brief": "الموجز",
  "tab.decisions": "القرارات",
  "tab.boardpack": "حزمة مجلس الإدارة",
  "tab.governance": "الحوكمة",
  "tab.staff": "الموظفون",
```

Two more tabs reuse existing keys — no new key needed: admin's third tab uses `"nav.settings"`, and every single-tab workspace's Home tab uses `"nav.home"` (both already present in `en`/`ar`).

- [ ] **Step 2: Run the i18n parity check to verify it still passes**

Run: `cd apps/mobile && pnpm test`
Expected: PASS — `mobile.test.ts`'s existing `describe("i18n", ...)` block already asserts `en`/`ar` have identical key sets; this confirms the paired inserts above didn't drift.

- [ ] **Step 3: Write the failing test**

Add this import near the other dynamic imports at the top of `apps/mobile/src/mobile.test.ts`:

```ts
const { PERSONA_TABS, tabsFor } = await import("./personas");
```

Append this `describe` block:

```ts
describe("persona tab config", () => {
  const workspaces = Object.keys(PERSONA_TABS) as Array<keyof typeof PERSONA_TABS>;

  it("covers every workspace with 1 to 3 tabs", () => {
    expect(workspaces.sort()).toEqual(
      ["admin", "axis", "compliance", "distribution", "ledger", "north", "orbit", "scout", "settings", "signal"].sort()
    );
    for (const workspace of workspaces) {
      expect(PERSONA_TABS[workspace].length).toBeGreaterThan(0);
      expect(PERSONA_TABS[workspace].length).toBeLessThanOrEqual(3);
    }
  });

  it("gives axis the docs/08 Ops tabs", () => {
    expect(tabsFor("axis", "default").map((tab) => tab.labelKey)).toEqual([
      "tab.queue",
      "tab.sla",
      "tab.cases"
    ]);
  });

  it("swaps Decisions for Governance only for the north board variant", () => {
    expect(tabsFor("north", "default").map((tab) => tab.labelKey)).toContain("tab.decisions");
    expect(tabsFor("north", "board").map((tab) => tab.labelKey)).toContain("tab.governance");
    expect(tabsFor("north", "board").map((tab) => tab.labelKey)).not.toContain("tab.decisions");
  });

  it("leaves every other workspace's tabs unaffected by variant", () => {
    expect(tabsFor("axis", "board")).toEqual(tabsFor("axis", "default"));
  });

  it("gives every single-tab workspace a Home tab pointing at its own resource", () => {
    for (const workspace of ["distribution", "ledger", "compliance", "settings"] as const) {
      const tabs = tabsFor(workspace, "default");
      expect(tabs).toHaveLength(1);
      expect(tabs[0]?.labelKey).toBe("nav.home");
    }
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/mobile && pnpm test`
Expected: FAIL — `Failed to resolve import "./personas"`

- [ ] **Step 5: Write minimal implementation**

Create `apps/mobile/src/personas.ts`:

```ts
import type { MessageKey } from "./i18n";
import type { PersonaVariant, Workspace } from "./workspace";

export interface TabConfig {
  labelKey: MessageKey;
  icon: string;
  /** A `RESOURCE_BY_HREF` value from nav.ts — the tab's Redirect target is `/m/${screen}`. */
  screen: string;
}

const HOME_TAB: TabConfig = { labelKey: "nav.home", icon: "home", screen: "core/users" };

export const PERSONA_TABS: Record<Workspace, TabConfig[]> = {
  axis: [
    { labelKey: "tab.queue", icon: "list", screen: "axis/cases" },
    { labelKey: "tab.sla", icon: "time", screen: "axis/cases" },
    { labelKey: "tab.cases", icon: "briefcase", screen: "axis/cases" }
  ],
  orbit: [
    { labelKey: "tab.inbox", icon: "chatbubbles", screen: "orbit/conversations" },
    { labelKey: "tab.renewals", icon: "refresh", screen: "orbit/conversations" },
    { labelKey: "tab.approvals", icon: "checkmark-circle", screen: "orbit/conversations" }
  ],
  signal: [
    { labelKey: "tab.campaigns", icon: "megaphone", screen: "signal/campaigns" },
    { labelKey: "tab.budget", icon: "cash", screen: "signal/campaigns" },
    { labelKey: "tab.attribution", icon: "trending-up", screen: "signal/campaigns" }
  ],
  scout: [
    { labelKey: "tab.clusters", icon: "layers", screen: "scout/signals" },
    { labelKey: "tab.whitespace", icon: "search", screen: "scout/signals" },
    { labelKey: "tab.panel", icon: "people", screen: "scout/signals" }
  ],
  north: [
    { labelKey: "tab.brief", icon: "sunny", screen: "north/metrics" },
    { labelKey: "tab.decisions", icon: "git-branch", screen: "north/metrics" },
    { labelKey: "tab.boardpack", icon: "bar-chart", screen: "north/metrics" }
  ],
  admin: [
    { labelKey: "tab.approvals", icon: "checkmark-done", screen: "core/users" },
    { labelKey: "tab.staff", icon: "people", screen: "core/users" },
    { labelKey: "nav.settings", icon: "settings", screen: "core/users" }
  ],
  distribution: [{ ...HOME_TAB, screen: "dist/quote-requests" }],
  ledger: [{ ...HOME_TAB, screen: "ledger/txns" }],
  compliance: [{ ...HOME_TAB, screen: "compliance/dsar-requests" }],
  settings: [{ ...HOME_TAB, screen: "core/users" }]
};

/** `north.board` keeps the same 3-tab slots, swapping the 2nd tab's label —
 *  exact-role precedence resolved once by `resolvePersona` (workspace.ts). */
export function tabsFor(workspace: Workspace, variant: PersonaVariant): TabConfig[] {
  const tabs = PERSONA_TABS[workspace];
  if (workspace !== "north" || variant !== "board") return tabs;
  return tabs.map((tab) => (tab.labelKey === "tab.decisions" ? { ...tab, labelKey: "tab.governance" } : tab));
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/mobile && pnpm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/personas.ts apps/mobile/src/i18n.ts apps/mobile/src/mobile.test.ts
git commit -m "feat(mobile): add persona-to-tabs config table"
```

---

## Task 3: `biometric-gate.tsx` — cold-start and foreground-resume challenge

**Files:**
- Modify: `apps/mobile/package.json` (add `expo-local-authentication` to `dependencies`)
- Modify: `apps/mobile/src/i18n.ts`
- Create: `apps/mobile/src/biometric-gate.tsx`
- Test: `apps/mobile/src/mobile.test.ts` (append import + new `describe` block)

**Interfaces:**
- Consumes: `Chrome`, `Body`, `Button`, `Loading` from `./ui` (exact signatures already in the codebase: `Chrome { theme: Theme, t: Translate, dir: "ltr" | "rtl" }`; `Body({chrome, style?, selectable?, testID?, children})`; `Button({chrome, label, onPress, variant?, busy?, disabled?})`; `Loading({chrome})`).
- Produces: `interface BiometricProbe { hasHardware(): Promise<boolean>; isEnrolled(): Promise<boolean>; authenticate(): Promise<boolean> }`; `type GateState = "checking" | "open" | "locked"`; `function resolveGate(probe: BiometricProbe): Promise<GateState>` (pure, dependency-injected — the unit-testable core); `function BiometricGate({ chrome, children }: { chrome: Chrome; children: React.ReactNode }): JSX.Element` (the real component, wired to live `expo-local-authentication` + `AppState`).
- Consumed by: Task 5 (`(tabs)/_layout.tsx` wraps its return value in `<BiometricGate>`).

**Why no native-render test:** `apps/mobile/vitest.config.ts`'s own comment frames `jest-expo`/`react-test-renderer` as "a cost worth paying when there is a component whose logic is not already covered here." `resolveGate` carries every branch the spec's testing bullets require (no hardware → open; not enrolled → open; enrolled + success → open; enrolled + fail → locked) as a pure async function taking an injected probe — fully covered without a new test transform. `BiometricGate` itself is a thin wrapper: state machine (`checking`/`open`/`locked`) driven by `resolveGate`, plus an `AppState` listener that re-runs it on `"active"`.

- [ ] **Step 1: Add the dependency and i18n keys**

In `apps/mobile/package.json`, add to `dependencies` (alphabetical, after `expo-linking`):

```json
    "expo-local-authentication": "~55.0.10",
```

Run: `cd apps/mobile && pnpm install`

In `apps/mobile/src/i18n.ts`, in the `en` object, immediately after the line `"auth.error.code": ...,` (find the last `auth.error.*` key) insert:

```ts
  "auth.biometric.locked": "Verification did not succeed.",
  "auth.biometric.retry": "Try again",
```

In the `ar` object, at the matching position, insert:

```ts
  "auth.biometric.locked": "تعذّر التحقق.",
  "auth.biometric.retry": "أعد المحاولة",
```

Run: `cd apps/mobile && pnpm test` — expect PASS (i18n parity check).

- [ ] **Step 2: Write the failing test**

Add this import near the other dynamic imports at the top of `apps/mobile/src/mobile.test.ts`:

```ts
const { resolveGate } = await import("./biometric-gate");
```

Append this `describe` block:

```ts
describe("biometric gate", () => {
  function probe(overrides: Partial<{ hardware: boolean; enrolled: boolean; success: boolean }> = {}) {
    const { hardware = true, enrolled = true, success = true } = overrides;
    return {
      hasHardware: async () => hardware,
      isEnrolled: async () => enrolled,
      authenticate: async () => success
    };
  }

  it("opens immediately when the device has no biometric hardware", async () => {
    expect(await resolveGate(probe({ hardware: false }))).toBe("open");
  });

  it("opens immediately when hardware exists but nothing is enrolled", async () => {
    expect(await resolveGate(probe({ enrolled: false }))).toBe("open");
  });

  it("opens after a successful challenge when enrolled", async () => {
    expect(await resolveGate(probe({ success: true }))).toBe("open");
  });

  it("locks after a failed challenge when enrolled", async () => {
    expect(await resolveGate(probe({ success: false }))).toBe("locked");
  });

  it("never calls authenticate when nothing is enrolled", async () => {
    const authenticate = vi.fn(async () => true);
    await resolveGate({ hasHardware: async () => true, isEnrolled: async () => false, authenticate });
    expect(authenticate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/mobile && pnpm test`
Expected: FAIL — `Failed to resolve import "./biometric-gate"`

- [ ] **Step 4: Write minimal implementation**

Create `apps/mobile/src/biometric-gate.tsx`:

```tsx
import * as LocalAuthentication from "expo-local-authentication";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, View } from "react-native";
import { Body, Button, Loading, type Chrome } from "./ui";
import { SPACE } from "./theme";

export interface BiometricProbe {
  hasHardware(): Promise<boolean>;
  isEnrolled(): Promise<boolean>;
  authenticate(): Promise<boolean>;
}

const liveProbe: BiometricProbe = {
  hasHardware: () => LocalAuthentication.hasHardwareAsync(),
  isEnrolled: () => LocalAuthentication.isEnrolledAsync(),
  authenticate: async () => (await LocalAuthentication.authenticateAsync()).success
};

export type GateState = "checking" | "open" | "locked";

/**
 * Never silently bypasses when an enrolled method exists (spec: "skip the
 * gate rather than lock the user out" applies only to the no-hardware /
 * not-enrolled cases below, not to a failed challenge).
 */
export async function resolveGate(probe: BiometricProbe): Promise<GateState> {
  if (!(await probe.hasHardware())) return "open";
  if (!(await probe.isEnrolled())) return "open";
  return (await probe.authenticate()) ? "open" : "locked";
}

export function BiometricGate({ chrome, children }: { chrome: Chrome; children: ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const checking = useRef(false);

  async function challenge() {
    if (checking.current) return;
    checking.current = true;
    setState("checking");
    setState(await resolveGate(liveProbe));
    checking.current = false;
  }

  useEffect(() => {
    void challenge();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void challenge();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "checking") return <Loading chrome={chrome} />;
  if (state === "open") return <>{children}</>;

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: SPACE.lg, padding: SPACE.xl }}>
      <Body chrome={chrome}>{chrome.t("auth.biometric.locked")}</Body>
      <Button chrome={chrome} label={chrome.t("auth.biometric.retry")} onPress={() => void challenge()} />
    </View>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/mobile && pnpm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/package.json apps/mobile/pnpm-lock.yaml apps/mobile/src/i18n.ts apps/mobile/src/biometric-gate.tsx apps/mobile/src/mobile.test.ts
git commit -m "feat(mobile): add biometric gate for cold-start and foreground resume"
```

---

## Task 4: Wire persona resolution into `session.tsx`

**Files:**
- Modify: `apps/mobile/src/session.tsx`

**Interfaces:**
- Consumes: `resolvePersona` and `type Persona` from `./workspace` (Task 1); `me.roles: string[]` (already on `Me`, `apps/mobile/src/api.ts:176`).
- Produces: adds `persona: Persona` to the `Session` interface, resolved once per bootstrap alongside `me`.
- Consumed by: Task 5 (`(tabs)/_layout.tsx` and the tab-slot files read `useSession().persona`).

No new unit test: this is a 2-line wiring change with no new branching — the logic it wires (`resolvePersona`) already has full unit coverage from Task 1. Verified by typecheck instead.

- [ ] **Step 1: Add the import**

In `apps/mobile/src/session.tsx`, add to the imports at the top of the file:

```ts
import { resolvePersona, type Persona } from "./workspace";
```

- [ ] **Step 2: Add `persona` to the `Session` interface**

Find the `Session` interface's `me: Me | null;` line and add immediately after it:

```ts
  /** Resolved once per session bootstrap from `me.roles`; fixed for the
   *  session's lifetime, same staleness contract as the web lens. */
  persona: Persona;
```

- [ ] **Step 3: Compute it in the `value` useMemo**

In the `value = useMemo<Session>(...)` block (session.tsx:276-313), find the line that sets `me,` in the returned object and add immediately after it:

```ts
      persona: resolvePersona(me?.roles ?? []),
```

- [ ] **Step 4: Run typecheck**

Run: `cd apps/mobile && pnpm typecheck`
Expected: PASS — no new errors

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/session.tsx
git commit -m "feat(mobile): resolve persona workspace on session bootstrap"
```

---

## Task 5: Expo Router tab navigator

**Files:**
- Modify: `apps/mobile/package.json` (add `@expo/vector-icons` to `dependencies`)
- Create: `apps/mobile/app/(tabs)/_layout.tsx`
- Create: `apps/mobile/app/(tabs)/index.tsx`
- Create: `apps/mobile/app/(tabs)/tab2.tsx`
- Create: `apps/mobile/app/(tabs)/tab3.tsx`
- Create: `apps/mobile/app/(tabs)/more.tsx` (moved content of `app/index.tsx`)
- Delete: `apps/mobile/app/index.tsx`
- Modify: `apps/mobile/e2e/02-list-detail.e2e.ts` (entry point moved behind the More tab)

**Interfaces:**
- Consumes: `useSession` (`./src/session`, now exposing `persona`), `tabsFor` (`./src/personas`), `TOUCH_TARGET`/`SPACE`/`RADIUS`/`TEXT` (`./src/theme`), `entriesFor`/`NavEntry` (`./src/nav`), `Body`/`Button`/`Loading`/`Muted`/`Title`/`textOf`/`Chrome` (`./src/ui`), `BiometricGate` (`./src/biometric-gate`, Task 3).
- Produces: `/` now resolves to the tab group's first tab (Expo Router convention: `(tabs)/index.tsx` matches the group's parent route).

The `(tabs)` group replaces the flat entry point. `index.tsx`/`tab2.tsx`/`tab3.tsx` are thin: each redirects to `/m/<resource>` for its slot in `tabsFor(persona.workspace, persona.variant)`, or renders nothing if the persona has fewer than 3 tabs (`options={{ href: null }}` on the corresponding `Tabs.Screen` hides that slot from the tab bar entirely). `more.tsx` is the old `Home` component, unchanged, renamed.

- [ ] **Step 1: Add the icon dependency**

In `apps/mobile/package.json`, add to `dependencies` (alphabetical, before `expo-constants`):

```json
    "@expo/vector-icons": "^15.0.2",
```

Run: `cd apps/mobile && pnpm install`

- [ ] **Step 2: Move `Home`'s content into the More tab**

Create `apps/mobile/app/(tabs)/more.tsx` with the exact current contents of `apps/mobile/app/index.tsx` (both the default-exported component and the `NavRow` helper below it), renaming the default export from `Home` to `More`:

```tsx
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { entriesFor, type NavEntry } from "../../src/nav";
import { useSession } from "../../src/session";
import { RADIUS, SPACE, TEXT, TOUCH_TARGET } from "../../src/theme";
import { Body, Button, Loading, Muted, Title, textOf, type Chrome } from "../../src/ui";

// The menu is the `nav` array from /v1/me, filtered server-side by the actor's
// permissions — never a list in this file. A role change therefore lands on the
// next launch with no app update, and no screen can offer something the API
// would refuse.

export default function More() {
  const session = useSession();
  const chrome: Chrome = { theme: session.theme, t: session.t, dir: session.dir };
  const { t, theme, me } = session;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn" || !me) return <Redirect href="/login" />;

  const entries = entriesFor(me.nav);

  return (
    <ScrollView
      contentContainerStyle={{
        gap: SPACE.xl,
        padding: SPACE.lg,
        paddingTop: insets.top + SPACE.lg,
        paddingBottom: insets.bottom + SPACE.xl
      }}
    >
      <View style={{ gap: SPACE.sm }}>
        {theme.logo ? (
          <Image
            accessible
            accessibilityRole="image"
            accessibilityLabel={session.brandName}
            source={{ uri: theme.logo }}
            resizeMode="contain"
            style={{
              width: 160,
              height: 40,
              alignSelf: session.dir === "rtl" ? "flex-end" : "flex-start"
            }}
          />
        ) : (
          <Title chrome={chrome}>{session.brandName}</Title>
        )}
        {me.profile ? <Muted chrome={chrome}>{t("home.signedInAs", { name: me.profile.name })}</Muted> : null}
      </View>

      <View style={{ gap: SPACE.md }}>
        <Text
          accessibilityRole="header"
          style={textOf(chrome, {
            color: theme.muted,
            fontSize: TEXT.s13,
            fontWeight: "600",
            letterSpacing: 0.5,
            textTransform: "uppercase"
          })}
        >
          {t("home.workspaces")}
        </Text>

        {entries.length === 0 ? (
          <Body chrome={chrome} style={{ color: theme.muted }}>
            {t("home.empty")}
          </Body>
        ) : (
          entries.map((entry) => (
            <NavRow
              key={entry.href}
              chrome={chrome}
              entry={entry}
              onPress={() => entry.route && router.push(entry.route)}
            />
          ))
        )}
      </View>

      <Button
        chrome={chrome}
        variant="quiet"
        label={t("home.signOut")}
        onPress={() => void session.signOut()}
      />
    </ScrollView>
  );
}

/**
 * One nav item. The label is always a visible Text — icons alone would leave a
 * screen-reader user, and anyone who does not already know the icon set, with
 * nothing to read (docs/07 §2, and the API sends no display text at all).
 */
function NavRow({
  chrome,
  entry,
  onPress
}: {
  chrome: Chrome;
  entry: NavEntry;
  onPress: () => void;
}) {
  const label = chrome.t(entry.labelKey);
  const reachable = entry.route !== undefined;
  return (
    <Pressable
      accessibilityRole={reachable ? "link" : "text"}
      accessibilityLabel={label}
      accessibilityHint={reachable ? undefined : chrome.t("nav.unavailable")}
      accessibilityState={{ disabled: !reachable }}
      disabled={!reachable}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET,
        justifyContent: "center",
        gap: SPACE.xs,
        paddingHorizontal: SPACE.lg,
        paddingVertical: SPACE.md,
        borderRadius: RADIUS.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: chrome.theme.border,
        backgroundColor: pressed ? chrome.theme.surfaceRaised : chrome.theme.surface,
        opacity: reachable ? 1 : 0.6
      })}
    >
      <Text
        style={textOf(chrome, {
          color: chrome.theme.text,
          fontSize: TEXT.s16,
          fontWeight: "600"
        })}
      >
        {label}
      </Text>
      {reachable ? null : (
        <Text style={textOf(chrome, { color: chrome.theme.muted, fontSize: TEXT.s12 })}>
          {chrome.t("nav.unavailable")}
        </Text>
      )}
    </Pressable>
  );
}
```

Delete `apps/mobile/app/index.tsx`.

- [ ] **Step 3: Create the three content-tab slots**

Create `apps/mobile/app/(tabs)/index.tsx`:

```tsx
import { Redirect } from "expo-router";
import { Loading } from "../../src/ui";
import { useSession } from "../../src/session";
import { tabsFor } from "../../src/personas";

export default function Tab1() {
  const session = useSession();
  const chrome = { theme: session.theme, t: session.t, dir: session.dir };
  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn") return <Redirect href="/login" />;
  const tab = tabsFor(session.persona.workspace, session.persona.variant)[0];
  if (!tab) return <Redirect href="/(tabs)/more" />;
  return <Redirect href={`/m/${tab.screen}`} />;
}
```

Create `apps/mobile/app/(tabs)/tab2.tsx` (identical, index `[1]`):

```tsx
import { Redirect } from "expo-router";
import { Loading } from "../../src/ui";
import { useSession } from "../../src/session";
import { tabsFor } from "../../src/personas";

export default function Tab2() {
  const session = useSession();
  const chrome = { theme: session.theme, t: session.t, dir: session.dir };
  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn") return <Redirect href="/login" />;
  const tab = tabsFor(session.persona.workspace, session.persona.variant)[1];
  if (!tab) return <Redirect href="/(tabs)/more" />;
  return <Redirect href={`/m/${tab.screen}`} />;
}
```

Create `apps/mobile/app/(tabs)/tab3.tsx` (identical, index `[2]`):

```tsx
import { Redirect } from "expo-router";
import { Loading } from "../../src/ui";
import { useSession } from "../../src/session";
import { tabsFor } from "../../src/personas";

export default function Tab3() {
  const session = useSession();
  const chrome = { theme: session.theme, t: session.t, dir: session.dir };
  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn") return <Redirect href="/login" />;
  const tab = tabsFor(session.persona.workspace, session.persona.variant)[2];
  if (!tab) return <Redirect href="/(tabs)/more" />;
  return <Redirect href={`/m/${tab.screen}`} />;
}
```

- [ ] **Step 4: Create the Tabs layout, wrapped in the biometric gate**

Create `apps/mobile/app/(tabs)/_layout.tsx`:

```tsx
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { BiometricGate } from "../../src/biometric-gate";
import { tabsFor } from "../../src/personas";
import { useSession } from "../../src/session";

type IconName = ComponentProps<typeof Ionicons>["name"];

export default function TabsLayout() {
  const session = useSession();
  const chrome = { theme: session.theme, t: session.t, dir: session.dir };
  const tabs = tabsFor(session.persona.workspace, session.persona.variant);
  const iconFor = (index: number, fallback: IconName): IconName => (tabs[index]?.icon as IconName) ?? fallback;

  return (
    <BiometricGate chrome={chrome}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: session.theme.accent,
          tabBarInactiveTintColor: session.theme.muted,
          tabBarStyle: { backgroundColor: session.theme.surface, borderTopColor: session.theme.border }
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: tabs[0] ? session.t(tabs[0].labelKey) : "",
            href: tabs[0] ? undefined : null,
            tabBarIcon: ({ color, size }) => <Ionicons name={iconFor(0, "home")} color={color} size={size} />
          }}
        />
        <Tabs.Screen
          name="tab2"
          options={{
            title: tabs[1] ? session.t(tabs[1].labelKey) : "",
            href: tabs[1] ? undefined : null,
            tabBarIcon: ({ color, size }) => <Ionicons name={iconFor(1, "ellipse")} color={color} size={size} />
          }}
        />
        <Tabs.Screen
          name="tab3"
          options={{
            title: tabs[2] ? session.t(tabs[2].labelKey) : "",
            href: tabs[2] ? undefined : null,
            tabBarIcon: ({ color, size }) => <Ionicons name={iconFor(2, "ellipse")} color={color} size={size} />
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: session.t("nav.more"),
            tabBarIcon: ({ color, size }) => <Ionicons name="menu" color={color} size={size} />
          }}
        />
      </Tabs>
    </BiometricGate>
  );
}
```

`options.href: null` hides a `Tabs.Screen` from the tab bar (and from direct navigation) while keeping the route registered — this is how a 1-tab persona (e.g. `settings`) shows only Home + More instead of 4 icons.

- [ ] **Step 5: Fix the existing Detox spec's entry point**

`apps/mobile/e2e/02-list-detail.e2e.ts` currently asserts the seeded `tenant.admin` persona (`amina.saleh@gonxt.ae`, resolves to the `admin` workspace) lands on a screen showing "Administration" immediately after reload. After this task, `/` resolves to the admin workspace's first tab (Approvals, not More) — "Administration" now lives one tap into the More tab. Update the spec:

```ts
import { beforeAll, describe, it } from "@jest/globals";
import { by, device, element, expect } from "detox";

// Flow 2 of 5. Continues 01's session — a JS reload keeps the native
// keychain token (apps/mobile/src/token.ts uses expo-secure-store, untouched
// by reloadReactNative), so this reopens straight onto the signed-in tab
// shell without repeating sign-in or enrolment.
describe("navigate More to a list and a record, then back", () => {
  beforeAll(async () => {
    await device.reloadReactNative();
  });

  it("opens More, opens Administration, opens a row, then returns", async () => {
    await element(by.label("More")).tap();
    await expect(element(by.label("Administration"))).toBeVisible();
    await element(by.label("Administration")).tap();

    // core/users is seeded with all 15 demo personas (packages/core/src/seed.ts),
    // so amina.saleh's own row is always present.
    await expect(element(by.text("Amina Saleh"))).toBeVisible();
    await element(by.text("Amina Saleh")).tap();

    await expect(element(by.text("amina.saleh@gonxt.ae"))).toBeVisible();

    await element(by.label("Back")).tap();
    await expect(element(by.text("Amina Saleh"))).toBeVisible();

    await element(by.label("Back")).tap();
    await expect(element(by.label("Administration"))).toBeVisible();
  });
});
```

- [ ] **Step 6: Run typecheck and unit tests**

Run: `cd apps/mobile && pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/package.json apps/mobile/pnpm-lock.yaml "apps/mobile/app/(tabs)" apps/mobile/app/index.tsx apps/mobile/e2e/02-list-detail.e2e.ts
git commit -m "feat(mobile): add role-adaptive tab navigator behind biometric gate"
```

---

## Task 6: Detox tab-bar-per-role spec

**Files:**
- Create: `apps/mobile/e2e/06-tab-bar.e2e.ts`

**Interfaces:**
- Consumes: `TENANT_ADMIN`, `SEED_PASSWORD`, `TENANT_SLUG` (`apps/mobile/e2e/env.ts`) — the suite's only seeded persona, `amina.saleh@gonxt.ae` / `tenant.admin` / `admin` workspace.

**Note on the approved spec:** the design doc's Testing section says to seed "a `north.exec` session and an `axis.agent` session" for this check. `apps/mobile/e2e/env.ts` seeds exactly one persona (`TENANT_ADMIN`, `tenant.admin` role) — there is no `north.exec` or `axis.agent` fixture anywhere in the e2e suite, and adding a second seeded tenant/persona is out of scope for this shell task (it belongs, if ever needed, to a later per-role phase that actually exercises those personas' screens). This task instead asserts the tab bar for the one fixture the suite has: 3 content tabs (Approvals, Staff, Settings) + More, matching `PERSONA_TABS.admin` (personas.ts, Task 2).

- [ ] **Step 1: Write the spec**

Create `apps/mobile/e2e/06-tab-bar.e2e.ts`:

```ts
import { beforeAll, describe, it } from "@jest/globals";
import { by, device, element, expect } from "detox";

// Flow 6. Continues the shared session (see e2e/README.md) — the only
// seeded persona is tenant.admin (e2e/env.ts TENANT_ADMIN), which resolves
// to the `admin` workspace (workspace.ts) and PERSONA_TABS.admin
// (personas.ts): Approvals, Staff, Settings, More.
describe("tab bar matches the signed-in persona", () => {
  beforeAll(async () => {
    await device.reloadReactNative();
  });

  it("shows exactly the admin workspace's 3 tabs plus More", async () => {
    await expect(element(by.label("Approvals"))).toBeVisible();
    await expect(element(by.label("Staff"))).toBeVisible();
    await expect(element(by.label("Settings"))).toBeVisible();
    await expect(element(by.label("More"))).toBeVisible();
  });

  it("switches tabs without losing the signed-in session", async () => {
    await element(by.label("Staff")).tap();
    await expect(element(by.label("Administration"))).toBeVisible();
    await element(by.label("More")).tap();
    await expect(element(by.text("Amina Saleh"))).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the full Detox suite**

Run: `cd apps/mobile && pnpm e2e:setup && pnpm e2e:build:ios && pnpm e2e:test:ios`
Expected: PASS (all specs, including the new one and the Step-5-fixed `02-list-detail.e2e.ts`)

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/e2e/06-tab-bar.e2e.ts
git commit -m "test(mobile): add Detox coverage for the role-adaptive tab bar"
```

---

## Self-review

**Spec coverage:**
- Role → persona resolution: Task 1 (with the documented dependency-graph correction).
- Persona → tabs table: Task 2, all 10 workspaces, docs/08 tab lists, `north.board` swap.
- Interim tab content: Task 5's `Redirect`-to-`/m/<resource>` slots — `[nav]`/`[id].tsx` untouched.
- Styling: no new dependency added beyond `expo-local-authentication` and `@expo/vector-icons`, both explicitly scoped by the spec (icons were implied by "tab bar" but not named — `@expo/vector-icons` is the Expo-bundled, zero-extra-cost choice, already a transitive dependency of `expo`).
- Biometric gate: Task 3 (pure `resolveGate`) + Task 5 (wiring into the tab layout, cold start via mount effect, foreground resume via `AppState`).
- File changes: all six spec-listed changes present, with the `@lyra/core` dependency move replaced by Task 1's local-duplication decision (documented in Task 1 and here).
- Testing: unit tests for `personas.ts` shape and persona resolution (Task 1/2), unit tests for the gate's four branches (Task 3), Detox tab-bar spec (Task 6) — using the suite's actual single fixture persona, not the spec's inaccurate `north.exec`/`axis.agent` claim.

**Two corrections against the approved spec, both documented inline above:**
1. Task 1: `@lyra/core` stays a devDependency; the precedence table is duplicated locally rather than imported, because no safe subpath export exists and Metro has no precedent resolving `@lyra/*` in this app.
2. Task 6: the Detox check uses the suite's one real fixture (`tenant.admin` → `admin` workspace) instead of the spec's `north.exec`/`axis.agent`, which don't exist in `e2e/env.ts`.

**Placeholder scan:** no TBD/TODO; every step has complete code, exact file paths, exact commands.

**Type consistency:** `Workspace`, `PersonaVariant`, `Persona` (Task 1) match their use in `TabConfig`/`PERSONA_TABS`/`tabsFor` (Task 2), `session.tsx`'s `persona: Persona` field (Task 4), and `(tabs)/_layout.tsx`'s `session.persona.workspace`/`.variant` (Task 5). `BiometricProbe`/`resolveGate`/`BiometricGate` (Task 3) match their only call site in `(tabs)/_layout.tsx` (Task 5).

**Scope:** matches the spec's non-goals — no new journey screens, no offline/push/VisionCamera, no PWA work.
