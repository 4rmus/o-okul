import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { assertTeacherAssigned } from "./assert-teacher-assigned.js";
import { InMemoryTeacherAssignmentStore } from "./teacher-assignment-store.js";

describe("assertTeacherAssigned", () => {
  it("TENANT_ADMIN ve ASSISTANT_ADMIN icin atama aramaz", async () => {
    const store = new InMemoryTeacherAssignmentStore();

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

  it("ogretmen context'i yoksa reddeder", async () => {
    const store = new InMemoryTeacherAssignmentStore();

    await expect(assertTeacherAssigned(studentContext, store, { tenantId: "tenant-a", classId: "class-a" })).rejects.toThrow(ForbiddenException);
  });

  it("hedef kapsam verilmezse reddeder", async () => {
    const store = new InMemoryTeacherAssignmentStore();

    await expect(assertTeacherAssigned(teacherContext, store, { tenantId: "tenant-a" })).rejects.toThrow(BadRequestException);
  });
});

const tenantAdminContext: RequestContext = {
  userId: "user-tenant-a",
  tenantId: "tenant-a",
  roles: ["TENANT_ADMIN"],
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
