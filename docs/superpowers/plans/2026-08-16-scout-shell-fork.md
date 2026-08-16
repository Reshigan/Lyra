# SCOUT Shell Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork SCOUT onto its own shell (`ScoutShell` + `scout-shell.tsx`), fourth and last of the four ADR-0061 deferrals, matching AXIS/ORBIT/SIGNAL precedent exactly.

**Architecture:** Copy `SignalShell`/`signal-shell.tsx` verbatim, swap `signal`→`scout` and the 9-destination nav list. Move SCOUT's existing `routes.ts` block from `workspace.tsx`'s layout into its own `layout("routes/scout-shell.tsx", [...])` sibling block, after SIGNAL's block. Swap `useShellData()` → `useScoutSessionData()` in all 9 SCOUT route files — no exemption, unlike SIGNAL's detail route.

**Tech Stack:** React Router v7 (framework mode), Cloudflare Workers, Vitest, Playwright, `@lyra/ui`.

## Global Constraints

- All 9 SCOUT route files need the `useShellData` → `useScoutSessionData` swap. `scout-whitespace.tsx` (the detail route) reads shell data today and is NOT exempt — this differs from SIGNAL's `signal-creative-image.tsx`, which needed no swap.
- Rail order (8 destinations, `routes.ts` declaration order): `scout/radar`, `scout/panel`, `scout/pricing`, `scout/experiments`, `scout/analytics`, `scout/data-products`, `scout/admin`, `scout/dev`.
- `scout/whitespace/:id` is not a rail item — it moves under `scout-shell.tsx`'s layout with the other 8 but has no nav link.
- `--module-scout` accent token already exists in `packages/ui/src/tokens.css` — no new token needed.
- No Meridian in `ScoutShell` (NORTH-only).
- No ADR-0054-style cross-link exception exists for SCOUT — no special-case role resolution needed.
- Header lockup points at `/scout/radar` (first rail destination).

---

### Task 1: SCOUT rail i18n keys + HIDDEN_ROUTES cleanup

**Files:**
- Modify: `apps/web/app/i18n/en.ts:63` (insert before existing `"nav.scout"` line)
- Modify: `apps/web/app/i18n/ar.ts:62` (insert before existing `"nav.scout"` line)
- Modify: `apps/web/app/routing.ts:102-113` (HIDDEN_ROUTES SCOUT block)
- Test: `apps/web/app/shell.test.ts` (existing "gives every route a nav label or a documented reason to be hidden" case)

**Interfaces:**
- Produces: i18n keys `nav.scout/radar`, `nav.scout/panel`, `nav.scout/pricing`, `nav.scout/experiments`, `nav.scout/analytics`, `nav.scout/data-products`, `nav.scout/admin`, `nav.scout/dev` (en + ar) — consumed by Task 2's `SCOUT_NAV_ITEMS`.

- [ ] **Step 1: Write the failing test**

The existing `apps/web/app/shell.test.ts` case that asserts every registered route has a nav label or a documented `HIDDEN_ROUTES` reason already fails once the SCOUT rail entries are removed from `HIDDEN_ROUTES` without matching i18n keys added yet. Confirm the current suite passes first:

Run: `pnpm --filter web test -- shell.test.ts`
Expected: PASS (baseline, before any edit)

- [ ] **Step 2: Remove the 8 rail lines from HIDDEN_ROUTES, keep the detail-route line**

In `apps/web/app/routing.ts`, the current SCOUT block (lines 102-113) reads:

```typescript
  "/scout/radar":
    "the opportunity radar over clusters and whitespace, linked from the SCOUT workspace tools list",
  "/scout/whitespace/:id":
    "the dossier for one theme, opened from a dot on the radar",
  "/scout/panel":
    "panel benchmarks and the negotiation pack, linked from the SCOUT workspace tools list",
  "/scout/pricing":
    "price position by line and where we lose, linked from the SCOUT workspace tools list",
  "/scout/experiments":
    "the experiment board and its decisions, linked from the SCOUT workspace tools list",
  "/scout/analytics":
    "pricing elasticity and adequacy, linked from the SCOUT workspace tools list",
  "/scout/data-products":
    "the data-product catalogue, its subscribers and the k-anonymity monitor, linked from the SCOUT workspace tools list",
  "/scout/admin":
    "the module's own settings — source health, suppression floors, policy thresholds and approval gates, linked from the SCOUT workspace tools list",
  "/scout/dev":
    "the market-index and wording-diff consoles with their curl equivalents, linked from the SCOUT workspace tools list",
```

Replace it with only the detail-route entry:

```typescript
  "/scout/whitespace/:id":
    "the dossier for one theme, opened from a dot on the radar",
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter web test -- shell.test.ts`
Expected: FAIL — 8 SCOUT paths now have neither a nav label nor a `HIDDEN_ROUTES` reason.

- [ ] **Step 4: Add the 8 rail keys to en.ts**

In `apps/web/app/i18n/en.ts`, immediately before the existing line 63 (`"nav.scout": "Market",`), insert:

```typescript
  "nav.scout/radar": "Radar",
  "nav.scout/panel": "Panel",
  "nav.scout/pricing": "Pricing",
  "nav.scout/experiments": "Experiments",
  "nav.scout/analytics": "Analytics",
  "nav.scout/data-products": "Data Products",
  "nav.scout/admin": "Admin",
  "nav.scout/dev": "Dev",
```

- [ ] **Step 5: Add the 8 rail keys to ar.ts**

In `apps/web/app/i18n/ar.ts`, immediately before the existing line 62 (`"nav.scout": "السوق",`), insert:

```typescript
  "nav.scout/radar": "الرادار",
  "nav.scout/panel": "اللجنة",
  "nav.scout/pricing": "التسعير",
  "nav.scout/experiments": "التجارب",
  "nav.scout/analytics": "التحليلات",
  "nav.scout/data-products": "منتجات البيانات",
  "nav.scout/admin": "الإدارة",
  "nav.scout/dev": "أدوات المطوّر",
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter web test -- shell.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/i18n/en.ts apps/web/app/i18n/ar.ts apps/web/app/routing.ts
git commit -m "feat(scout): add rail i18n keys, trim HIDDEN_ROUTES to detail route only"
```

---

### Task 2: ScoutShell component + scout-shell.tsx layout route

**Files:**
- Create: `apps/web/app/components/scout-shell.tsx`
- Create: `apps/web/app/routes/scout-shell.tsx`
- Test: `apps/web/app/routes/scout-shell.test.ts`

**Interfaces:**
- Consumes: `nav.scout/*` i18n keys (Task 1), `session.availableShells` (`SessionBootstrap` type, unchanged), `bootstrapSession` (existing, from `signal-shell.tsx`'s import path).
- Produces: `ScoutShell({session, children})` component; `ROUTE_ID = "routes/scout-shell"`; `useScoutSessionData()` hook — consumed by Task 4's route files.

- [ ] **Step 1: Write the failing loader test**

Create `apps/web/app/routes/scout-shell.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

const bootstrapSession = vi.fn();
vi.mock("../session", () => ({ bootstrapSession }));

function fakeContext(env: Record<string, unknown>) {
  return { cloudflare: { env } } as never;
}

describe("scout-shell loader", () => {
  it("returns session when roles resolve to scout", async () => {
    bootstrapSession.mockResolvedValueOnce({
      availableShells: ["scout"],
      brand: { name: "Test" }
    });
    const { loader } = await import("./scout-shell");
    const result = await loader({
      request: new Request("https://lyra.test/scout/radar"),
      context: fakeContext({})
    } as never);
    expect(result).toEqual({
      availableShells: ["scout"],
      brand: { name: "Test" }
    });
  });

  it("throws 403 not 401 when roles don't resolve to scout", async () => {
    bootstrapSession.mockResolvedValueOnce({
      availableShells: ["north"],
      brand: { name: "Test" }
    });
    const { loader } = await import("./scout-shell");
    await expect(
      loader({
        request: new Request("https://lyra.test/scout/radar"),
        context: fakeContext({})
      } as never)
    ).rejects.toMatchObject({ status: 403 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- scout-shell.test.ts`
Expected: FAIL — `./scout-shell` does not exist yet.

- [ ] **Step 3: Write ScoutShell component**

Create `apps/web/app/components/scout-shell.tsx` by copying `apps/web/app/components/signal-shell.tsx` in full, then applying these substitutions throughout:

- `SIGNAL_ACCENT` → `SCOUT_ACCENT`, value `"var(--module-signal)"` → `"var(--module-scout)"`
- `SIGNAL_NAV_PATHS` → `SCOUT_NAV_PATHS`, contents replaced with:

```typescript
// Compile-time, not derived from session.nav: SCOUT's rail is fixed regardless
// of tenant config, same rationale as SIGNAL_NAV_PATHS/ORBIT_NAV_PATHS/AXIS_NAV_PATHS.
const SCOUT_NAV_PATHS = [
  "/scout/radar",
  "/scout/panel",
  "/scout/pricing",
  "/scout/experiments",
  "/scout/analytics",
  "/scout/data-products",
  "/scout/admin",
  "/scout/dev"
] as const;
```

- `SIGNAL_NAV_ITEMS` → `SCOUT_NAV_ITEMS`
- `SignalShell` → `ScoutShell`
- Every occurrence of `"signal"` used as the module string (e.g. `moduleOf`, `ModuleSwitcher` `current` prop) → `"scout"`
- Header lockup href (currently `/signal/cockpit`, SIGNAL's first rail destination) → `/scout/radar` (SCOUT's first rail destination)

No other structural change — same header, mobile+desktop nav rails, `ModuleSwitcher`, `ShiftRail`, `NavItemLink` helper, footer with `/design` doctrine link, no Meridian.

- [ ] **Step 4: Write scout-shell.tsx layout route**

Create `apps/web/app/routes/scout-shell.tsx` by copying `apps/web/app/routes/signal-shell.tsx` in full, then applying:

- `ROUTE_ID = "routes/signal-shell"` → `ROUTE_ID = "routes/scout-shell"`
- `"signal"` (the `availableShells.includes(...)` check) → `"scout"`
- `useSignalSessionData` → `useScoutSessionData`
- `SignalShell` import and usage → `ScoutShell` (from `../components/scout-shell`)
- `SignalShellLayout` → `ScoutShellLayout`

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter web test -- scout-shell.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/scout-shell.tsx apps/web/app/routes/scout-shell.tsx apps/web/app/routes/scout-shell.test.ts
git commit -m "feat(scout): add ScoutShell component and scout-shell layout route"
```

---

### Task 3: Move SCOUT's route block under scout-shell.tsx

**Files:**
- Modify: `apps/web/app/routes.ts:66-78` (delete SCOUT block from `workspace.tsx`'s layout), insert new sibling block after SIGNAL's block (after line 146, before line 147's `shouldInclude("north")`)
- Modify: `apps/web/app/routes.test.ts` (append new contract-test case after line 117)

**Interfaces:**
- Consumes: `layout("routes/scout-shell.tsx", [...])` (Task 2's route file), `shouldInclude` (existing helper, unchanged).
- Produces: SCOUT routes registered under `scout-shell.tsx`'s layout — consumed by Task 4 (route files render under this layout, so `useRouteLoaderData` resolves).

- [ ] **Step 1: Write the failing contract test**

In `apps/web/app/routes.test.ts`, append after the existing `"includes only signal's routes when LYRA_MODULES=signal"` case (after line 117, before the `"still includes login/logout..."` case):

```typescript
  it("includes only scout's routes when LYRA_MODULES=scout", async () => {
    const paths = flatPaths(await loadRoutesUnder("scout"));
    expect(paths).toContain("scout/radar");
    expect(paths).toContain("scout/whitespace/:id");
    expect(paths).toContain("scout/panel");
    expect(paths).toContain("scout/pricing");
    expect(paths).toContain("scout/experiments");
    expect(paths).toContain("scout/analytics");
    expect(paths).toContain("scout/data-products");
    expect(paths).toContain("scout/admin");
    expect(paths).toContain("scout/dev");
    expect(paths.some((p) => p.startsWith("north/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("axis/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("orbit/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("signal/"))).toBe(false);
  });
```

Also update the existing north/axis/orbit/signal cases' `scout/` exclusion assertions — they already assert `paths.some((p) => p.startsWith("scout/"))).toBe(false)` today (lines 61, 80, 98, 116), so no change needed there; they continue to pass once SCOUT moves to its own layout.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- routes.test.ts`
Expected: FAIL — `scout/radar` etc. not found (still nested under `workspace.tsx`'s layout, which `flatPaths` walks the same either way, so this specific new case may actually pass already; the real failure to check is that the SCOUT block still lives in the wrong layout). Proceed to Step 3 regardless — this step's purpose is establishing the pre-move baseline.

- [ ] **Step 3: Delete SCOUT's block from workspace.tsx's layout**

In `apps/web/app/routes.ts`, delete lines 66-78:

```typescript
  ...(shouldInclude("scout")
    ? [
        route("scout/radar", "routes/scout-radar.tsx"),
        route("scout/whitespace/:id", "routes/scout-whitespace.tsx"),
        route("scout/panel", "routes/scout-panel.tsx"),
        route("scout/pricing", "routes/scout-pricing.tsx"),
        route("scout/experiments", "routes/scout-experiments.tsx"),
        route("scout/analytics", "routes/scout-analytics.tsx"),
        route("scout/data-products", "routes/scout-data-products.tsx"),
        route("scout/admin", "routes/scout-admin.tsx"),
        route("scout/dev", "routes/scout-dev.tsx")
      ]
    : []),
```

- [ ] **Step 4: Add SCOUT's sibling layout block**

Immediately after SIGNAL's closing block (after line 146's `: []),` and before `...(shouldInclude("north")`), insert:

```typescript
  ...(shouldInclude("scout")
    ? [
        layout("routes/scout-shell.tsx", [
          route("scout/radar", "routes/scout-radar.tsx"),
          route("scout/whitespace/:id", "routes/scout-whitespace.tsx"),
          route("scout/panel", "routes/scout-panel.tsx"),
          route("scout/pricing", "routes/scout-pricing.tsx"),
          route("scout/experiments", "routes/scout-experiments.tsx"),
          route("scout/analytics", "routes/scout-analytics.tsx"),
          route("scout/data-products", "routes/scout-data-products.tsx"),
          route("scout/admin", "routes/scout-admin.tsx"),
          route("scout/dev", "routes/scout-dev.tsx")
        ])
      ]
    : []),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter web test -- routes.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/routes.ts apps/web/app/routes.test.ts
git commit -m "feat(scout): move scout routes under their own scout-shell layout"
```

---

### Task 4: Swap useShellData → useScoutSessionData in all 9 route files

**Files:**
- Modify: `apps/web/app/routes/scout-radar.tsx:24,153`
- Modify: `apps/web/app/routes/scout-whitespace.tsx:27,253`
- Modify: `apps/web/app/routes/scout-panel.tsx:15,113`
- Modify: `apps/web/app/routes/scout-pricing.tsx:6,69`
- Modify: `apps/web/app/routes/scout-experiments.tsx:14,124`
- Modify: `apps/web/app/routes/scout-analytics.tsx:27,171`
- Modify: `apps/web/app/routes/scout-data-products.tsx:15,275`
- Modify: `apps/web/app/routes/scout-admin.tsx:5,165`
- Modify: `apps/web/app/routes/scout-dev.tsx:14,180`
- Test: existing per-file test suites (e.g. `scout-whitespace.test.ts`'s 17 cases) must keep passing — regression only, no new test file.

**Interfaces:**
- Consumes: `useScoutSessionData` (Task 2's `scout-shell.tsx`).
- Produces: none — this is the last task to touch these files in this plan.

**Note:** all 9 of the 9 SCOUT route files use `useShellData` today, including `scout-whitespace.tsx` (the detail route). Unlike SIGNAL's `signal-creative-image.tsx`, no SCOUT file is exempt — `scout-whitespace.tsx` reads shell data (locale, permissions, domain pack) for its labels and move-state form and needs the same swap as the 8 rail routes.

- [ ] **Step 1: Run the existing regression suites to confirm the pre-swap baseline passes**

Run: `pnpm --filter web test -- scout-radar scout-whitespace scout-panel scout-pricing scout-experiments scout-analytics scout-data-products scout-admin scout-dev`
Expected: PASS (baseline, before any edit)

- [ ] **Step 2: Swap scout-radar.tsx**

In `apps/web/app/routes/scout-radar.tsx`:
- Line 24: `import { useShellData } from "./workspace";` → `import { useScoutSessionData } from "./scout-shell";`
- Line 153: `const shell = useShellData();` → `const shell = useScoutSessionData();`

- [ ] **Step 3: Swap scout-whitespace.tsx**

In `apps/web/app/routes/scout-whitespace.tsx`:
- Line 27: `import { useShellData } from "./workspace";` → `import { useScoutSessionData } from "./scout-shell";`
- Line 253: `const shell = useShellData();` → `const shell = useScoutSessionData();`

- [ ] **Step 4: Swap scout-panel.tsx**

In `apps/web/app/routes/scout-panel.tsx`:
- Line 15: `import { useShellData } from "./workspace";` → `import { useScoutSessionData } from "./scout-shell";`
- Line 113: `const shell = useShellData();` → `const shell = useScoutSessionData();`

- [ ] **Step 5: Swap scout-pricing.tsx**

In `apps/web/app/routes/scout-pricing.tsx`:
- Line 6: `import { useShellData } from "./workspace";` → `import { useScoutSessionData } from "./scout-shell";`
- Line 69: `const shell = useShellData();` → `const shell = useScoutSessionData();`

- [ ] **Step 6: Swap scout-experiments.tsx**

In `apps/web/app/routes/scout-experiments.tsx`:
- Line 14: `import { useShellData } from "./workspace";` → `import { useScoutSessionData } from "./scout-shell";`
- Line 124: `const shell = useShellData();` → `const shell = useScoutSessionData();`

- [ ] **Step 7: Swap scout-analytics.tsx**

In `apps/web/app/routes/scout-analytics.tsx`:
- Line 27: `import { useShellData } from "./workspace";` → `import { useScoutSessionData } from "./scout-shell";`
- Line 171: `const shell = useShellData();` → `const shell = useScoutSessionData();`

- [ ] **Step 8: Swap scout-data-products.tsx**

In `apps/web/app/routes/scout-data-products.tsx`:
- Line 15: `import { useShellData } from "./workspace";` → `import { useScoutSessionData } from "./scout-shell";`
- Line 275: `const shell = useShellData();` → `const shell = useScoutSessionData();`

- [ ] **Step 9: Swap scout-admin.tsx**

In `apps/web/app/routes/scout-admin.tsx`:
- Line 5: `import { useShellData } from "./workspace";` → `import { useScoutSessionData } from "./scout-shell";`
- Line 165: `const shell = useShellData();` → `const shell = useScoutSessionData();`

- [ ] **Step 10: Swap scout-dev.tsx**

In `apps/web/app/routes/scout-dev.tsx`:
- Line 14: `import { useShellData } from "./workspace";` → `import { useScoutSessionData } from "./scout-shell";`
- Line 180: `const shell = useShellData();` → `const shell = useScoutSessionData();`

- [ ] **Step 11: Run all 9 regression suites to verify they still pass**

Run: `pnpm --filter web test -- scout-radar scout-whitespace scout-panel scout-pricing scout-experiments scout-analytics scout-data-products scout-admin scout-dev`
Expected: PASS — same case counts as the Step 1 baseline (17 cases for `scout-whitespace.test.ts`, unchanged for the rest).

- [ ] **Step 12: Commit**

```bash
git add apps/web/app/routes/scout-radar.tsx apps/web/app/routes/scout-whitespace.tsx apps/web/app/routes/scout-panel.tsx apps/web/app/routes/scout-pricing.tsx apps/web/app/routes/scout-experiments.tsx apps/web/app/routes/scout-analytics.tsx apps/web/app/routes/scout-data-products.tsx apps/web/app/routes/scout-admin.tsx apps/web/app/routes/scout-dev.tsx
git commit -m "feat(scout): swap useShellData for useScoutSessionData in all 9 scout routes"
```

---

### Task 5: Playwright journey spec

**Files:**
- Create: `e2e/scout-shell.spec.ts`

**Interfaces:**
- Consumes: `loginAsScoutLead`, `loginAsNorthExec` (both already exist in `e2e/fixtures.ts:101-106` and `e2e/fixtures.ts:67` respectively — no fixture changes needed).

- [ ] **Step 1: Write the failing journey spec**

Create `e2e/scout-shell.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";
import { loginAsNorthExec, loginAsScoutLead } from "./fixtures";

test.describe("@journey:J-SCOUT-SHELL", () => {
  test("scout.lead lands in ScoutShell and sees only SCOUT's own rail", async ({ page }) => {
    await loginAsScoutLead(page);
    await page.goto("/scout/radar");

    const rail = page.getByRole("navigation", { name: /primary/i }).first();
    for (const name of [
      "Radar",
      "Panel",
      "Pricing",
      "Experiments",
      "Analytics",
      "Data Products",
      "Admin",
      "Dev"
    ]) {
      await expect(rail.getByRole("link", { name })).toBeVisible();
    }

    await expect(page.getByText(/meridian/i)).toHaveCount(0);
    await expect(rail.getByRole("link", { name: /^brief$/i })).toHaveCount(0);
    await expect(rail.getByRole("link", { name: /console/i })).toHaveCount(0);
  });

  test("an actor with no scout.*-resolving role gets 403, not 401, on /scout/*", async ({ page }) => {
    await loginAsNorthExec(page);
    const response = await page.goto("/scout/radar");
    expect(response?.status()).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm e2e -- scout-shell.spec.ts`
Expected: FAIL — `ScoutShell` doesn't exist without Tasks 2-4 in place (run this after Task 4 completes, not before Task 2 — the failing-first sequencing here documents intent; in execution order this spec is the last thing to turn green).

- [ ] **Step 3: Run full e2e suite to verify it passes**

Run: `pnpm e2e -- scout-shell.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add e2e/scout-shell.spec.ts
git commit -m "test(scout): add @journey:J-SCOUT-SHELL playwright spec"
```

---

### Task 6: Full suite verification gate

**Files:** none created or modified unless a fix is needed.

**Interfaces:** none.

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. If it fails, fix forward (do not weaken types) and re-run before continuing.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: PASS. Fix forward on failure.

- [ ] **Step 3: Unit + integration tests**

Run: `pnpm test`
Expected: PASS, including every case added in Tasks 1-4 and the full pre-existing suite (AXIS/ORBIT/SIGNAL shells, `scout-whitespace.test.ts`'s 17 cases, `routes.test.ts`'s full contract-test set).

- [ ] **Step 4: E2E**

Run: `pnpm e2e`
Expected: PASS, including `e2e/scout-shell.spec.ts` and the existing `axis-shell.spec.ts`/`orbit-shell.spec.ts`/`signal-shell.spec.ts` regression specs.

- [ ] **Step 5: Commit only if a fix was needed**

If any step above required a code change to pass, commit that fix now with a message describing what broke and why. If all four steps passed with no changes, skip this step — do not create an empty commit.

```bash
git add -A
git commit -m "fix(scout): <describe what the verification gate caught>"
```

---

## Self-Review

**1. Spec coverage:**
- Rail destinations (8) — Task 1 (i18n), Task 2 (`SCOUT_NAV_PATHS`), Task 3 (routes.ts move). Covered.
- Not-on-rail `scout/whitespace/:id` — Task 3 (moves with the block, kept in `HIDDEN_ROUTES`), Task 4 Step 3 (swap, explicitly not exempt). Covered.
- Architecture (`ScoutShell`, `scout-shell.tsx`, `--module-scout`, header lockup, no Meridian) — Task 2. Covered.
- `useShellData` swap, all 9 files — Task 4. Covered.
- Roles resolving via generic prefix rule, no ADR-0054 exception — no code change needed (already true today); noted in Global Constraints, not a task, matching the spec's own "no new special case" statement.
- Testing: journey spec — Task 5. 403 test — Task 5 Step 1 (folded into the journey spec, port of the `<module>-shell.test.ts` loader case is in Task 2's `scout-shell.test.ts`). Contract test extension — Task 3. Unit test (loader 403) — Task 2. Regression (`scout-whitespace.test.ts`) — Task 4 Steps 1 and 11. Covered.

**2. Placeholder scan:** none found — every step has complete code, exact line numbers, exact commands.

**3. Type consistency:** `useScoutSessionData` named consistently across Tasks 2 and 4. `ScoutShell`/`ROUTE_ID = "routes/scout-shell"`/`SCOUT_ACCENT`/`SCOUT_NAV_PATHS`/`SCOUT_NAV_ITEMS` named consistently within Task 2. Task 4 explicitly states "all 9 of 9, no exemption" and names `scout-whitespace.tsx` alongside the 8 rail routes, per the spec's flagged deviation from SIGNAL's plan — not silently copied.
