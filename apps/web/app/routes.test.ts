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

  it("still includes login/logout when scoped to a single module", async () => {
    const paths = flatPaths(await loadRoutesUnder("north"));
    expect(paths).toContain("login");
    expect(paths).toContain("logout");
  });
});

// Registration is only half the gate: /axis has no routes of its own in a
// north-only build, but the generic `:module` catch-all would still resolve it
// unless WORKSPACES is filtered by the same flag.
describe("LYRA_MODULES workspace gating", () => {
  afterEach(() => {
    delete process.env.LYRA_MODULES;
  });

  async function loadModulesUnder(lyraModules: string | undefined) {
    vi.resetModules();
    if (lyraModules === undefined) delete process.env.LYRA_MODULES;
    else process.env.LYRA_MODULES = lyraModules;
    return import("./modules");
  }

  it("resolves every workspace by default (unset)", async () => {
    const { workspaceFor } = await loadModulesUnder(undefined);
    expect(workspaceFor("/axis")).toBeDefined();
    expect(workspaceFor("/north")).toBeDefined();
  });

  it("stops resolving an excluded module's workspace", async () => {
    const { workspaceFor } = await loadModulesUnder("north");
    expect(workspaceFor("/north")).toBeDefined();
    expect(workspaceFor("/axis")).toBeUndefined();
    expect(workspaceFor("/orbit")).toBeUndefined();
    expect(workspaceFor("/signal")).toBeUndefined();
    expect(workspaceFor("/scout")).toBeUndefined();
  });

  it("resolves /axis and stops resolving other modules under LYRA_MODULES=axis", async () => {
    const { workspaceFor } = await loadModulesUnder("axis");
    expect(workspaceFor("/axis")).toBeDefined();
    expect(workspaceFor("/north")).toBeUndefined();
    expect(workspaceFor("/orbit")).toBeUndefined();
    expect(workspaceFor("/signal")).toBeUndefined();
    expect(workspaceFor("/scout")).toBeUndefined();
  });

  it("never gates the shared workspaces, which belong to no module", async () => {
    const { workspaceFor } = await loadModulesUnder("north");
    expect(workspaceFor("/ledger")).toBeDefined();
    expect(workspaceFor("/admin")).toBeDefined();
    expect(workspaceFor("/analytics")).toBeDefined();
    expect(workspaceFor("/compliance")).toBeDefined();
    expect(workspaceFor("/distribution")).toBeDefined();
  });
});
