import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { InMemoryGuardianStudentStore } from "../school/guardian-student-store.js";
import { InMemoryTeacherAssignmentStore } from "../school/teacher-assignment-store.js";
import { InMemoryStudentStore } from "../student/student-store.js";
import { InMemoryAttendanceStore } from "./attendance-store.js";
import { AttendanceService } from "./attendance.service.js";

describe("AttendanceService", () => {
  it("devamsizlik esigi ilk kez asilinca veli duyurusu ve audit kaydi uretir", async () => {
    const announcements: unknown[] = [];
    const auditRecords: unknown[] = [];
    const service = new AttendanceService(
      new InMemoryAttendanceStore(),
      {} as never,
      {} as never,
      new InMemoryStudentStore(),
      new InMemoryGuardianStudentStore(),
      new InMemoryTeacherAssignmentStore(),
      {
        create: async (_context: RequestContext, input: unknown) => {
          announcements.push(input);
          return { id: "announcement-threshold" };
        },
      } as never,
      {
        record: async (input: unknown) => {
          auditRecords.push(input);
        },
      } as never,
    );

    await service.create(adminContext, { studentId: "student-a", date: "2026-06-04", status: "ABSENT" });
    await service.create(adminContext, { studentId: "student-a", date: "2026-06-05", status: "ABSENT" });
    await service.create(adminContext, { studentId: "student-a", date: "2026-06-06", status: "ABSENT" });
    await service.create(adminContext, { studentId: "student-a", date: "2026-06-07", status: "ABSENT" });

    expect(announcements).toEqual([
      expect.objectContaining({
        tenantId: "tenant-a",
        audience: "GUARDIANS",
        classId: "class-a",
        title: "Devamsızlık eşiği uyarısı",
      }),
    ]);
    expect(auditRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "attendance.threshold_warned",
        entityType: "Attendance",
        entityId: "student-a",
        diff: expect.objectContaining({
          studentId: "student-a",
          previousAbsenceCount: 4,
          currentAbsenceCount: 5,
          threshold: 5,
          announcementId: "announcement-threshold",
        }),
      }),
    ]));
  });

  it("takvim dışı devamsızlık tarihini servis katmanında reddeder", async () => {
    const service = new AttendanceService(
      new InMemoryAttendanceStore(),
      {} as never,
      {} as never,
      new InMemoryStudentStore(),
      new InMemoryGuardianStudentStore(),
      new InMemoryTeacherAssignmentStore(),
      {} as never,
    );

    await expect(
      service.create(adminContext, { studentId: "student-a", date: "2026-02-29", status: "ABSENT" }),
    ).rejects.toThrow("ATTENDANCE_DATE_INVALID");
  });
});

const adminContext: RequestContext = {
  userId: "user-tenant-a",
  tenantId: "tenant-a",
  roles: ["TENANT_ADMIN"],
  bypassRls: false,
};
