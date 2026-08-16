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
