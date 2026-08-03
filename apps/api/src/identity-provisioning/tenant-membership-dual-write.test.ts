import { describe, expect, it } from "vitest";
import { buildTenantMembershipDualWriteRows } from "./tenant-membership-dual-write.js";

describe("buildTenantMembershipDualWriteRows", () => {
  it("legacy staff ve teacher satırlarını koruyup canonical alanları tek satıra yazar", () => {
    expect(buildTenantMembershipDualWriteRows(["ASSISTANT_ADMIN", "TEACHER"])).toEqual([
      {
        role: "ASSISTANT_ADMIN",
        staffRole: "OPERATIONS_STAFF",
        hasTeacherPersona: true,
        hasStudentPersona: false,
      },
      {
        role: "TEACHER",
        staffRole: null,
        hasTeacherPersona: false,
        hasStudentPersona: false,
      },
    ]);
  });

  it("öğrenciyi tek canonical persona olarak yazar", () => {
    expect(buildTenantMembershipDualWriteRows(["STUDENT"])).toEqual([
      { role: "STUDENT", staffRole: null, hasTeacherPersona: false, hasStudentPersona: true },
    ]);
  });

  it("guardian geçiş satırını canonical persona üretmeden korur", () => {
    expect(buildTenantMembershipDualWriteRows(["GUARDIAN"])).toEqual([
      { role: "GUARDIAN", staffRole: null, hasTeacherPersona: false, hasStudentPersona: false },
    ]);
  });

  it.each([
    [["TENANT_ADMIN", "ASSISTANT_ADMIN"], "INVALID_TENANT_ROLE_COMBINATION"],
    [["STUDENT", "TEACHER"], "INVALID_TENANT_ROLE_COMBINATION"],
    [["GUARDIAN", "TENANT_ADMIN"], "INVALID_TENANT_ROLE_COMBINATION"],
    [["SYSTEM_ADMIN"], "TENANT_ROLE_INVALID"],
  ])("geçersiz kombinasyonu reddeder: %j", (roles, expected) => {
    expect(() => buildTenantMembershipDualWriteRows(roles)).toThrow(expected);
  });
});
