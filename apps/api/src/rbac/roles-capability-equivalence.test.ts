import { describe, expect, it } from "vitest";
import { tenantRoles } from "@o-okul/shared-types";
import { hasCapability, type Capability } from "./role-capabilities.js";
import { hasRole, type Role } from "./roles.js";

// Legacy-role cutover proof: a route that carried both @Roles(...) and @RequireCapability(...) may drop @Roles only when
// the capability alone admits exactly the role combinations the pair admitted. Checked for every single role and every
// two-role combination (sessions normally carry one persona role; legacy multi-role contexts are covered too).
const removedPairs: Array<{ route: string; roles: Role[]; capability: Capability }> = [
  { route: "GET/PATCH /guardian-notification-settings", roles: ["TENANT_ADMIN", "ASSISTANT_ADMIN"], capability: "setup:manage" },
  { route: "PATCH /me/tenant", roles: ["TENANT_ADMIN", "ASSISTANT_ADMIN"], capability: "setup:manage" },
  { route: "GET /me/guardian/students/:studentId/overview", roles: ["GUARDIAN"], capability: "ward:read" },
  { route: "GET /privacy/inventory", roles: ["TENANT_ADMIN", "ASSISTANT_ADMIN"], capability: "privacy:manage" },
  { route: "GET /search", roles: ["TEACHER"], capability: "search:read" },
];

const roleSets: string[][] = [
  ...tenantRoles.map((role) => [role]),
  ...tenantRoles.flatMap((left, index) => tenantRoles.slice(index + 1).map((right) => [left, right])),
];

describe("@Roles + @RequireCapability eşdeğerliği", () => {
  it.each(removedPairs)("$route: capability tek başına eski ikiliyle aynı rolleri kabul eder", ({ roles, capability }) => {
    for (const userRoles of roleSets) {
      const legacy = roles.some((role) => hasRole(userRoles, role)) && hasCapability({ roles: userRoles }, capability);
      expect({ userRoles, admitted: hasCapability({ roles: userRoles }, capability) }).toEqual({ userRoles, admitted: legacy });
    }
  });
});
