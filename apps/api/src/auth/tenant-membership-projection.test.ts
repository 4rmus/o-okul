import { describe, expect, it } from "vitest";
import { assertTenantMembershipParity, type CanonicalMembershipProjection } from "./tenant-membership-projection.js";

describe("tenant membership auth projection", () => {
  it.each([
    [["TENANT_ADMIN"], membership("TENANT_OWNER"), ["TENANT_ADMIN"]],
    [["ASSISTANT_ADMIN", "TEACHER"], membership("OPERATIONS_STAFF", true), ["ASSISTANT_ADMIN", "TEACHER"]],
    [["FINANCE_STAFF"], membership("FINANCE_STAFF"), ["FINANCE_STAFF"]],
    [["STUDENT"], membership(null, false, true), ["STUDENT"]],
  ])("canonical alanlarla uyumlu legacy oturum rolünü korur: %j", (roles, canonical, expected) => {
    expect(assertTenantMembershipParity(roles, canonical)).toEqual(expected);
  });

  it.each([
    [["TENANT_ADMIN", "ASSISTANT_ADMIN"], membership("TENANT_ADMIN")],
    [["ASSISTANT_ADMIN"], membership("OPERATIONS_STAFF", true)],
    [["TEACHER"], membership(null, false)],
    [["GUARDIAN"], membership(null)],
    [["STUDENT", "TEACHER"], membership(null, true, true)],
  ])("canonical/legacy yetki sapmasını fail-closed reddeder: %j", (roles, canonical) => {
    expect(() => assertTenantMembershipParity(roles, canonical)).toThrow("AUTH_MEMBERSHIP_PARITY_MISMATCH");
  });
});

function membership(
  staffRole: CanonicalMembershipProjection["staffRole"],
  hasTeacherPersona = false,
  hasStudentPersona = false,
): CanonicalMembershipProjection {
  return { id: "membership-a", staffRole, hasTeacherPersona, hasStudentPersona, version: 4 };
}
