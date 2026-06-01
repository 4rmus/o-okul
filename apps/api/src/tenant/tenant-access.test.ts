import { describe, expect, it } from "vitest";
import {
  assertSubjectResourceAccess,
  assertTeacherScopedStudentAccess,
  assertTenantResourceAccess,
  filterTeacherScopedStudents,
  filterTenantResources,
} from "./tenant-access.js";

const resources = [
  { id: "student-a", tenantId: "tenant-a" },
  { id: "student-b", tenantId: "tenant-b" },
];

describe("tenant access", () => {
  it("tenant A kullanıcısı tenant B verisini listeleyemez", () => {
    const visible = filterTenantResources(
      { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      resources,
    );

    expect(visible).toEqual([{ id: "student-a", tenantId: "tenant-a" }]);
  });

  it("tenant A kullanıcısı tenant B tekil kaydına erişemez", () => {
    expect(() =>
      assertTenantResourceAccess(
        { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
        { tenantId: "tenant-b" },
      ),
    ).toThrow("FORBIDDEN_TENANT");
  });

  it("system admin bypass ile tenantlar arası erişebilir", () => {
    const visible = filterTenantResources(
      { userId: "sys-1", tenantId: null, roles: ["SYSTEM_ADMIN"], bypassRls: true },
      resources,
    );

    expect(visible).toHaveLength(2);
  });

  it("system admin olmayan kullanıcı bypass açsa bile reddedilir", () => {
    expect(() =>
      assertTenantResourceAccess(
        { userId: "user-a", tenantId: null, roles: ["TENANT_ADMIN"], bypassRls: true },
        { tenantId: "tenant-b" },
      ),
    ).toThrow("TENANT_CONTEXT_MISSING");
  });

  it("tenant admin kişi bağı olmadan tenant içi kaynağa erişebilir", () => {
    expect(() =>
      assertSubjectResourceAccess(
        { userId: "admin-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
        { tenantId: "tenant-a", studentId: "student-a" },
      ),
    ).not.toThrow();
  });

  it("student yalnız kendi kaynağına erişebilir", () => {
    const context = {
      userId: "student-user-a",
      tenantId: "tenant-a",
      roles: ["STUDENT"],
      bypassRls: false,
      subjectType: "STUDENT" as const,
      subjectId: "student-a",
    };

    expect(() => assertSubjectResourceAccess(context, { tenantId: "tenant-a", studentId: "student-a" })).not.toThrow();
    expect(() => assertSubjectResourceAccess(context, { tenantId: "tenant-a", studentId: "student-b" })).toThrow(
      "FORBIDDEN_SUBJECT",
    );
  });

  it("guardian yalnız bağlı öğrencinin kaynağına erişebilir", () => {
    const context = {
      userId: "guardian-user-a",
      tenantId: "tenant-a",
      roles: ["GUARDIAN"],
      bypassRls: false,
      subjectType: "GUARDIAN" as const,
      subjectId: "guardian-a",
    };

    expect(() =>
      assertSubjectResourceAccess(context, { tenantId: "tenant-a", studentId: "student-a", guardianIds: ["guardian-a"] }),
    ).not.toThrow();
    expect(() =>
      assertSubjectResourceAccess(context, { tenantId: "tenant-a", studentId: "student-b", guardianIds: ["guardian-b"] }),
    ).toThrow("FORBIDDEN_SUBJECT");
  });

  it("teacher guardian veya student yetkisini hiyerarşiyle devralamaz", () => {
    const context = {
      userId: "teacher-user-a",
      tenantId: "tenant-a",
      roles: ["TEACHER"],
      bypassRls: false,
      subjectType: "TEACHER" as const,
      subjectId: "teacher-a",
    };

    expect(() => assertSubjectResourceAccess(context, { tenantId: "tenant-a", teacherId: "teacher-a" })).not.toThrow();
    expect(() =>
      assertSubjectResourceAccess(context, { tenantId: "tenant-a", studentId: "student-a", guardianIds: ["guardian-a"] }),
    ).toThrow("FORBIDDEN_SUBJECT");
  });

  it("teacher yalnız sorumlu olduğu öğrenci kapsamına erişebilir", () => {
    const context = {
      userId: "teacher-user-a",
      tenantId: "tenant-a",
      roles: ["TEACHER"],
      bypassRls: false,
      subjectType: "TEACHER" as const,
      subjectId: "teacher-a",
    };

    expect(() =>
      assertTeacherScopedStudentAccess(context, { tenantId: "tenant-a", responsibleTeacherId: "teacher-a" }),
    ).not.toThrow();
    expect(() =>
      assertTeacherScopedStudentAccess(context, { tenantId: "tenant-a", responsibleTeacherId: "teacher-b" }),
    ).toThrow("FORBIDDEN_SUBJECT");

    expect(
      filterTeacherScopedStudents(context, [
        { id: "student-a", tenantId: "tenant-a", responsibleTeacherId: "teacher-a" },
        { id: "student-c", tenantId: "tenant-a", responsibleTeacherId: "teacher-c" },
        { id: "student-b", tenantId: "tenant-b", responsibleTeacherId: "teacher-a" },
      ]),
    ).toEqual([{ id: "student-a", tenantId: "tenant-a", responsibleTeacherId: "teacher-a" }]);
  });
});
