import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import type { TeacherAssignmentRecord } from "@o-okul/shared-types";
import { assertTeacherAssigned, hasTeacherAssignmentForScope } from "./assert-teacher-assigned.js";
import { InMemoryTeacherAssignmentStore } from "./teacher-assignment-store.js";

describe("assertTeacherAssigned", () => {
  it("TENANT_OWNER, TENANT_ADMIN ve ASSISTANT_ADMIN icin atama aramaz", async () => {
    const store = new InMemoryTeacherAssignmentStore();

    await expect(assertTeacherAssigned(tenantOwnerContext, store, { tenantId: "tenant-a", classId: "class-x" })).resolves.toBeUndefined();
    await expect(assertTeacherAssigned(tenantAdminContext, store, { tenantId: "tenant-a", classId: "class-x" })).resolves.toBeUndefined();
    await expect(assertTeacherAssigned(assistantContext, store, { tenantId: "tenant-a", classId: "class-x" })).resolves.toBeUndefined();
  });

  it("ogretmen atanmis sinif veya ogrenci icin gecer", async () => {
    const store = new InMemoryTeacherAssignmentStore();

    await expect(assertTeacherAssigned(teacherContext, store, { tenantId: "tenant-a", classId: "class-a" })).resolves.toBeUndefined();
    await expect(assertTeacherAssigned(teacherContext, store, { tenantId: "tenant-a", studentId: "student-a" })).resolves.toBeUndefined();
  });

  it("ogretmen atanmamis kapsama yazamaz", async () => {
    const store = new InMemoryTeacherAssignmentStore();

    await expect(assertTeacherAssigned(teacherContext, store, { tenantId: "tenant-a", classId: "class-b" })).rejects.toThrow(ForbiddenException);
  });

  it("referans tarihinde sona ermis veya henuz baslamamis atamayi reddeder", async () => {
    const assignments = [
      { id: "expired", tenantId: "tenant-a", teacherId: "teacher-a", classId: "class-a", role: "CLASS_TEACHER", startsAt: "2026-01-01", endsAt: "2026-05-31" },
      { id: "future", tenantId: "tenant-a", teacherId: "teacher-a", classId: "class-b", role: "CLASS_TEACHER", startsAt: "2026-07-01" },
    ];
    const store = { listByTeacher: async () => assignments } as never;

    await expect(assertTeacherAssigned(teacherContext, store, { tenantId: "tenant-a", classId: "class-a" }, "2026-06-15")).rejects.toThrow(ForbiddenException);
    await expect(assertTeacherAssigned(teacherContext, store, { tenantId: "tenant-a", classId: "class-b" }, "2026-06-15")).rejects.toThrow(ForbiddenException);
    await expect(assertTeacherAssigned(teacherContext, store, { tenantId: "tenant-a", classId: "class-a" }, "2026-05-31")).resolves.toBeUndefined();
    await expect(assertTeacherAssigned(teacherContext, store, { tenantId: "tenant-a", classId: "class-b" }, "2026-07-01")).resolves.toBeUndefined();
  });

  it("ogretmen context'i yoksa reddeder", async () => {
    const store = new InMemoryTeacherAssignmentStore();

    await expect(assertTeacherAssigned(studentContext, store, { tenantId: "tenant-a", classId: "class-a" })).rejects.toThrow(ForbiddenException);
  });

  it("hedef kapsam verilmezse reddeder", async () => {
    const store = new InMemoryTeacherAssignmentStore();

    await expect(assertTeacherAssigned(teacherContext, store, { tenantId: "tenant-a" })).rejects.toThrow(BadRequestException);
  });
});

describe("hasTeacherAssignmentForScope", () => {
  const today = "2026-10-01";
  const record = (extra: Partial<TeacherAssignmentRecord>): TeacherAssignmentRecord => ({
    id: "assignment", tenantId: "tenant-a", teacherId: "teacher-a", role: "BRANCH_TEACHER", ...extra,
  });
  const mathIn8A = { tenantId: "tenant-a", classId: "class-8a", courseId: "course-math", termId: "term-1" };

  it("sinifa bagli atama ayni dersin baska sinifini kapsamaz", () => {
    const pinned = [record({ classId: "class-8a", courseId: "course-math" })];

    expect(hasTeacherAssignmentForScope(pinned, mathIn8A, today)).toBe(true);
    expect(hasTeacherAssignmentForScope(pinned, { ...mathIn8A, classId: "class-8b" }, today)).toBe(false);
    expect(hasTeacherAssignmentForScope(pinned, { tenantId: "tenant-a", courseId: "course-math" }, today)).toBe(false);
    expect(hasTeacherAssignmentForScope(pinned, { ...mathIn8A, studentId: "student-8b", classId: "class-8b" }, today)).toBe(false);
  });

  it("ogrenciye bagli atama yalniz o ogrenciyi kapsar", () => {
    const pinned = [record({ studentId: "student-z", courseId: "course-math" })];

    expect(hasTeacherAssignmentForScope(pinned, { ...mathIn8A, studentId: "student-z" }, today)).toBe(true);
    expect(hasTeacherAssignmentForScope(pinned, mathIn8A, today)).toBe(false);
    expect(hasTeacherAssignmentForScope(pinned, { ...mathIn8A, studentId: "student-y" }, today)).toBe(false);
  });

  it("sinif ve ogrenci tasimayan ders atamasi dersin kapsamini acikca verir", () => {
    const courseWide = [record({ courseId: "course-math", termId: "term-1" })];

    expect(hasTeacherAssignmentForScope(courseWide, mathIn8A, today)).toBe(true);
    expect(hasTeacherAssignmentForScope(courseWide, { ...mathIn8A, classId: "class-8b" }, today)).toBe(true);
    expect(hasTeacherAssignmentForScope(courseWide, { ...mathIn8A, courseId: "course-fen" }, today)).toBe(false);
    expect(hasTeacherAssignmentForScope(courseWide, { ...mathIn8A, termId: "term-2" }, today)).toBe(false);
    expect(hasTeacherAssignmentForScope(courseWide, { tenantId: "tenant-a", classId: "class-8a" }, today)).toBe(false);
    expect(hasTeacherAssignmentForScope(courseWide, { ...mathIn8A, tenantId: "tenant-b" }, today)).toBe(false);
  });

  it("rol filtresi ve tarih araligi ders kapsaminda da uygulanir", () => {
    const counsellor = [record({ role: "GUIDANCE_COUNSELOR", classId: "class-8a" })];
    const expired = [record({ courseId: "course-math", endsAt: "2026-09-30" })];

    expect(hasTeacherAssignmentForScope(counsellor, { ...mathIn8A, roles: ["CLASS_TEACHER", "BRANCH_TEACHER"] }, today)).toBe(false);
    expect(hasTeacherAssignmentForScope(counsellor, mathIn8A, today)).toBe(true);
    expect(hasTeacherAssignmentForScope(expired, mathIn8A, today)).toBe(false);
  });
});

const tenantAdminContext: RequestContext = {
  userId: "user-tenant-a",
  tenantId: "tenant-a",
  roles: ["TENANT_ADMIN"],
  bypassRls: false,
};

const tenantOwnerContext: RequestContext = {
  userId: "owner-tenant-a",
  tenantId: "tenant-a",
  roles: ["TENANT_OWNER"],
  bypassRls: false,
};

const assistantContext: RequestContext = {
  userId: "assistant-tenant-a",
  tenantId: "tenant-a",
  roles: ["ASSISTANT_ADMIN"],
  bypassRls: false,
};

const teacherContext: RequestContext = {
  userId: "teacher-tenant-a",
  tenantId: "tenant-a",
  roles: ["TEACHER"],
  bypassRls: false,
  subjectType: "TEACHER",
  subjectId: "teacher-a",
};

const studentContext: RequestContext = {
  userId: "student-tenant-a",
  tenantId: "tenant-a",
  roles: ["STUDENT"],
  bypassRls: false,
  subjectType: "STUDENT",
  subjectId: "student-a",
};
