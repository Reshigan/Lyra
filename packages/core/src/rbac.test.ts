import { describe, expect, it } from "vitest";
import {
  ROLES,
  can,
  expand,
  isValidGrantString,
  permissionsForRole,
  type Actor
} from "./rbac.js";

function actor(roleKey: string, scope?: Actor["grants"][number]["scope"]): Actor {
  return {
    kind: "user",
    id: "u_1",
    tenantId: "t_1",
    grants: [{ roleKey, permissions: permissionsForRole(roleKey), ...(scope ? { scope } : {}) }]
  };
}

describe("can", () => {
  it("matches wildcards segment-wise", () => {
    expect(can(actor("axis.admin"), "axis:cases:approve")).toBe(true);
    expect(can(actor("axis.admin"), "signal:campaigns:launch")).toBe(false);
    expect(can(actor("platform.admin"), "compliance:erasure:execute")).toBe(true);
  });

  it("denies across tenants before looking at permissions", () => {
    expect(can(actor("platform.admin"), "core:users:read", { tenantId: "t_2" })).toBe(false);
    expect(can(actor("platform.admin"), "core:users:read", { tenantId: "t_1" })).toBe(true);
  });

  it("fails closed when a team-scoped grant meets an unscoped subject", () => {
    const scoped = actor("axis.lead", { teams: ["tm_a"] });
    expect(can(scoped, "axis:cases:approve", { tenantId: "t_1", teamId: "tm_a" })).toBe(true);
    expect(can(scoped, "axis:cases:approve", { tenantId: "t_1", teamId: "tm_b" })).toBe(false);
    expect(can(scoped, "axis:cases:approve", { tenantId: "t_1" })).toBe(false);
  });

  it("keeps scope on its own grant instead of merging across roles", () => {
    const two: Actor = {
      kind: "user",
      id: "u_1",
      tenantId: "t_1",
      grants: [
        { roleKey: "axis.lead", permissions: permissionsForRole("axis.lead"), scope: { teams: ["tm_a"] } },
        { roleKey: "north.board", permissions: permissionsForRole("north.board") }
      ]
    };
    // The unscoped board role must not lend its reach to the scoped AXIS role.
    expect(can(two, "axis:cases:approve", { tenantId: "t_1", teamId: "tm_b" })).toBe(false);
    expect(can(two, "north:briefings:read", { tenantId: "t_1", teamId: "tm_b" })).toBe(true);
  });

  it("masks PII behind core:pii:view regardless of role", () => {
    expect(can(actor("axis.agent"), "core:pii:view")).toBe(false);
    expect(can(actor("axis.lead"), "core:pii:view")).toBe(true);
  });
});

describe("role catalogue", () => {
  it("grants only permissions that exist", () => {
    for (const [key, bundle] of Object.entries(ROLES)) {
      for (const p of bundle) {
        expect(isValidGrantString(p), `${key} grants unknown permission ${p}`).toBe(true);
      }
    }
  });

  it("keeps north.board read-only", () => {
    for (const p of expand(permissionsForRole("north.board"))) {
      expect(p.endsWith(":read"), `north.board may not hold ${p}`).toBe(true);
    }
  });

  it("gives external roles no tenant-staff reach", () => {
    for (const key of ["customer", "partner.developer", "partner.manager", "provider.viewer"]) {
      const granted = expand(permissionsForRole(key));
      expect(granted.filter((p) => p.startsWith("core:") || p.startsWith("admin:"))).toEqual([]);
    }
  });
});
