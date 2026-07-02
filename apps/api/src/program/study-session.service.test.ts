import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import type { SchoolService } from "../school/school.service.js";
import type { StudentService } from "../student/student.service.js";
import type { TeacherService } from "../teacher/teacher.service.js";
import type { StudySessionStore } from "./study-session-store.js";
import { StudySessionService, type StudySessionRecord } from "./study-session.service.js";

describe("StudySessionService", () => {
  it("öğretmen etüt listesini kendi kayıtlarıyla sınırlar", async () => {
    const service = new StudySessionService({} as SchoolService, {} as TeacherService, {} as StudentService, createStudySessionStore());

    await expect(service.list(createTeacherContext("teacher-a"))).resolves.toEqual([
      expect.objectContaining({ id: "study-a", teacherId: "teacher-a" }),
    ]);
  });

  it("öğretmen aynı tenant içindeki başka öğretmenin etüdünü okuyamaz", async () => {
    const service = new StudySessionService({} as SchoolService, {} as TeacherService, {} as StudentService, createStudySessionStore());

    await expect(service.findOne(createTeacherContext("teacher-a"), "study-other")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("kurum yöneticisi tenant içindeki tüm etütleri okuyabilir", async () => {
    const service = new StudySessionService({} as SchoolService, {} as TeacherService, {} as StudentService, createStudySessionStore());

    await expect(service.list(createTenantAdminContext())).resolves.toEqual([
      expect.objectContaining({ id: "study-a" }),
      expect.objectContaining({ id: "study-other" }),
    ]);
  });
});

function createStudySessionStore(): StudySessionStore {
  const sessions: StudySessionRecord[] = [
    {
      id: "study-a",
      tenantId: "tenant-a",
      classId: "class-a",
      teacherId: "teacher-a",
      studentIds: ["student-a"],
      title: "Matematik Etut",
      capacity: 4,
      startsAt: "2026-06-02T13:00:00.000Z",
      endsAt: "2026-06-02T14:00:00.000Z",
    },
    {
      id: "study-other",
      tenantId: "tenant-a",
      classId: "class-a",
      teacherId: "teacher-other",
      studentIds: ["student-other"],
      title: "Fen Etut",
      capacity: 4,
      startsAt: "2026-06-02T15:00:00.000Z",
      endsAt: "2026-06-02T16:00:00.000Z",
    },
  ];

  return {
    list: async () => sessions,
    findById: async (id) => sessions.find((session) => session.id === id),
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
