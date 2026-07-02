import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import type { SchoolService } from "../school/school.service.js";
import type { TeacherService } from "../teacher/teacher.service.js";
import type { ScheduleStore } from "./schedule-store.js";
import { ScheduleService, type ScheduleLessonRecord } from "./schedule.service.js";

describe("ScheduleService", () => {
  it("öğretmen ders programı listesini kendi kayıtlarıyla sınırlar", async () => {
    const service = new ScheduleService({} as SchoolService, {} as TeacherService, createScheduleStore());

    await expect(service.list(createTeacherContext("teacher-a"))).resolves.toEqual([
      expect.objectContaining({ id: "lesson-a", teacherId: "teacher-a" }),
    ]);
  });

  it("öğretmen aynı tenant içindeki başka öğretmenin dersini okuyamaz", async () => {
    const service = new ScheduleService({} as SchoolService, {} as TeacherService, createScheduleStore());

    await expect(service.findOne(createTeacherContext("teacher-a"), "lesson-other")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("kurum yöneticisi tenant içindeki tüm dersleri okuyabilir", async () => {
    const service = new ScheduleService({} as SchoolService, {} as TeacherService, createScheduleStore());

    await expect(service.list(createTenantAdminContext())).resolves.toEqual([
      expect.objectContaining({ id: "lesson-a" }),
      expect.objectContaining({ id: "lesson-other" }),
    ]);
  });
});

function createScheduleStore(): ScheduleStore {
  const lessons: ScheduleLessonRecord[] = [
    {
      id: "lesson-a",
      tenantId: "tenant-a",
      classId: "class-a",
      teacherId: "teacher-a",
      title: "Matematik",
      startsAt: "2026-06-01T09:00:00.000Z",
      endsAt: "2026-06-01T10:00:00.000Z",
    },
    {
      id: "lesson-other",
      tenantId: "tenant-a",
      classId: "class-a",
      teacherId: "teacher-other",
      title: "Fen",
      startsAt: "2026-06-01T11:00:00.000Z",
      endsAt: "2026-06-01T12:00:00.000Z",
    },
  ];

  return {
    list: async () => lessons,
    findById: async (id) => lessons.find((lesson) => lesson.id === id),
    create: async () => {
      throw new Error("NOT_USED");
    },
    update: async () => {
      throw new Error("NOT_USED");
    },
    softDelete: async () => {
      throw new Error("NOT_USED");
    },
  };
}

function createTeacherContext(subjectId: string): RequestContext {
  return {
    userId: `${subjectId}-user`,
    tenantId: "tenant-a",
    roles: ["TEACHER"],
    bypassRls: false,
    subjectType: "TEACHER",
    subjectId,
  };
}

function createTenantAdminContext(): RequestContext {
  return {
    userId: "admin-a",
    tenantId: "tenant-a",
    roles: ["TENANT_ADMIN"],
    bypassRls: false,
  };
}
