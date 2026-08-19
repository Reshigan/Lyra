import { describe, expect, it } from "vitest";

// Deliberately no static import of ./rbac.js at the top of this file. The role
// catalogue is assembled at module-evaluation time, so a helper that feeds it
// and returns nothing throws while the module loads — and a test file that
// imported rbac statically then reports "no tests" instead of a failure, which
// a mutation run scores as a survivor. Importing inside the test body keeps a
// broken catalogue attributable to a failing assertion.
describe("role catalogue construction", () => {
  it("derives a module's read permissions instead of listing them by hand", async () => {
    const { PERMISSIONS, expand, permissionsForRole } = await import("./rbac.js");
    const agent = expand(permissionsForRole("axis.agent"));
    const axisReads = PERMISSIONS.filter((p) => p.startsWith("axis:") && p.endsWith(":read"));
    expect(axisReads.length).toBeGreaterThan(1);
    for (const p of axisReads) expect(agent).toContain(p);
  });
});
