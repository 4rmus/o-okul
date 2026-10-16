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

// Routes whose @Roles(...) was replaced by a single @RequireCapability(...): the capability must admit exactly the role
// combinations the legacy rank check admitted.
const replacedRoles: Array<{ route: string; roles: Role[]; capability: Capability }> = [
  { route: "GET /academic-years[/:id]", roles: ["TEACHER"], capability: "academic:read" },
  { route: "GET /alanlar, /campuses, /classes, /grade-levels [/:id]", roles: ["TEACHER"], capability: "class:read" },
  {
    route: "GET /courses, /learning-outcomes, /academic-terms [/:id], /grade-levels/:id/courses",
    roles: ["TEACHER", "STUDENT", "GUARDIAN"],
    capability: "academic:read-catalog",
  },
  { route: "GET /announcements[/:id], /message-templates[/:id]", roles: ["TENANT_ADMIN", "TEACHER"], capability: "announcement:read" },
  { route: "GET /attendance, /attendance/aggregate, /attendance/summary, /attendance/daily", roles: ["TEACHER"], capability: "attendance:read-assigned" },
  { route: "GET /study-sessions[/:id], /development/criteria, /development/assessments", roles: ["TEACHER"], capability: "academic:read" },
  { route: "POST /development/assessments", roles: ["TEACHER"], capability: "academic:write-assigned" },
  { route: "GET /guardians[/:id], /guardians/:id/students", roles: ["TEACHER"], capability: "student:read-guardians" },
  { route: "GET /teachers[/:id], /teachers/:id/assignments", roles: ["TEACHER"], capability: "staff:read-teachers" },
  { route: "GET /homework reads (list, materials, files, assignments, submissions)", roles: ["TEACHER"], capability: "homework:read-assigned" },
  { route: "POST /homework, materials/:id/assignments, :id/submissions/check; PATCH :id/check-status", roles: ["TEACHER"], capability: "homework:write-assigned" },
  { route: "GET /support-tickets reads (list, detail, attachments, comments)", roles: ["TEACHER"], capability: "support:read-own" },
  { route: "POST /support-tickets, :id/attachments, :id/comments", roles: ["TEACHER"], capability: "support:write-own" },
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

  it.each(replacedRoles)("$route: capability eski @Roles kontrolüyle aynı rolleri kabul eder", ({ roles, capability }) => {
    for (const userRoles of roleSets) {
      const legacy = roles.some((role) => hasRole(userRoles, role));
      expect({ userRoles, admitted: hasCapability({ roles: userRoles }, capability) }).toEqual({ userRoles, admitted: legacy });
    }
  });
});
