import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { InMemoryAcademicCalendarStore } from "../school/academic-calendar-store.js";
import { InMemoryClassStore } from "../school/class-store.js";
import { InMemoryCourseStore } from "../school/course-store.js";
import { InMemoryGuardianStudentStore } from "../school/guardian-student-store.js";
import { InMemoryTeacherAssignmentStore } from "../school/teacher-assignment-store.js";
import { InMemoryTeacherStore } from "../school/teacher-store.js";
import { InMemoryStudentStore } from "../student/student-store.js";
import { InMemoryTeacherNoteStore } from "./teacher-note-store.js";
import { TeacherNoteService } from "./teacher-note.service.js";

// Demo data: student-a sits in class-a on campus-main.
describe("TeacherNoteService kampüs kapsamı", () => {
  it("başka kampüs öğrencisinin notunu listelemez, yazdırmaz; kurum geneli kullanıcı değişmez", async () => {
    const service = createService(new InMemoryClassStore());
    const note = { studentId: "student-a", teacherId: "teacher-a", body: "Kampüs notu", visibility: "INTERNAL" as const };

    expect((await service.list(adminContext)).map((record) => record.id)).toContain("teacher-note-internal-a");
    expect((await service.list(campusContext("campus-main"))).map((record) => record.id)).toContain("teacher-note-internal-a");
    await expect(service.list(campusContext("campus-other"))).resolves.toEqual([]);
    await expect(service.list(campusContext("campus-other"), { studentId: "student-a" })).resolves.toEqual([]);
    await expect(service.list(campusContext("campus-other"), { classId: "class-a" })).resolves.toEqual([]);
    await expect(service.create(campusContext("campus-other"), note)).rejects.toThrow("TEACHER_NOTE_CAMPUS_SCOPE_FORBIDDEN");
    await expect(service.update(campusContext("campus-other"), "teacher-note-internal-a", { body: "Değişti" }))
      .rejects.toThrow("TEACHER_NOTE_CAMPUS_SCOPE_FORBIDDEN");
    await expect(service.delete(campusContext("campus-other"), "teacher-note-internal-a"))
      .rejects.toThrow("TEACHER_NOTE_CAMPUS_SCOPE_FORBIDDEN");
    await expect(service.create(campusContext("campus-main"), note)).resolves.toMatchObject({ studentId: "student-a" });
  });

  it("sınıfı çözülemeyen öğrencinin notunda fail-closed davranır, kampüssüz operasyon çalışanını reddeder", async () => {
    const service = createService(undefined);

    await expect(service.list(campusContext("campus-main"))).resolves.toEqual([]);
    expect((await service.list(adminContext)).map((record) => record.id)).toContain("teacher-note-internal-a");
    await expect(service.list({ ...adminContext, roles: ["OPERATIONS_STAFF"] })).rejects.toThrow("TEACHER_NOTE_CAMPUS_SCOPE_MISSING");
  });
});

function createService(classStore: InMemoryClassStore | undefined): TeacherNoteService {
  return new TeacherNoteService(
    new InMemoryTeacherNoteStore(),
    new InMemoryAcademicCalendarStore(),
    new InMemoryCourseStore(),
    new InMemoryStudentStore(),
    new InMemoryTeacherStore(),
    new InMemoryGuardianStudentStore(),
    new InMemoryTeacherAssignmentStore(),
    undefined,
    undefined,
    classStore,
  );
}

function campusContext(campusId: string): RequestContext {
  return {
    userId: "assistant-tenant-a",
    tenantId: "tenant-a",
    roles: ["ASSISTANT_ADMIN"],
    bypassRls: false,
    campusScope: { scopeMode: "CAMPUSES", campusIds: [campusId] },
  };
}

const adminContext: RequestContext = {
  userId: "user-tenant-a",
  tenantId: "tenant-a",
  roles: ["TENANT_ADMIN"],
  bypassRls: false,
};
