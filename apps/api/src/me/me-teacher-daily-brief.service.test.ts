import { describe, expect, it, vi } from "vitest";
import { MeTeacherDailyBriefService, buildTeacherDailyBrief } from "./me-teacher-daily-brief.service.js";

describe("MeTeacherDailyBriefService", () => {
  it("altı scoped kaynağı aynı öğretmen contexti ile birer kez okur", async () => {
    const attendance = { list: vi.fn().mockResolvedValue([]) };
    const homework = { list: vi.fn().mockResolvedValue([]) };
    const reportIndex = { listForTeacher: vi.fn().mockResolvedValue([]) };
    const schedules = { listCurrentTeacherLessons: vi.fn().mockResolvedValue([]) };
    const students = { listForViewer: vi.fn().mockResolvedValue([{}, {}]) };
    const supportTickets = { listCurrentTeacher: vi.fn().mockResolvedValue([]) };
    const context = { tenantId: "tenant-a", roles: ["TEACHER"], subjectId: "teacher-a", subjectType: "TEACHER", userId: "teacher-user-a" };
    const service = new MeTeacherDailyBriefService(
      attendance as never,
      homework as never,
      reportIndex as never,
      schedules as never,
      students as never,
      supportTickets as never,
    );

    await expect(service.get(context as never, "2026-08-09")).resolves.toMatchObject({
      assignedStudentCount: 2,
      date: "2026-08-09",
    });
    expect(attendance.list).toHaveBeenCalledOnce();
    expect(attendance.list).toHaveBeenCalledWith(context, { date: "2026-08-09" });
    for (const method of [homework.list, reportIndex.listForTeacher, schedules.listCurrentTeacherLessons, students.listForViewer, supportTickets.listCurrentTeacher]) {
      expect(method).toHaveBeenCalledOnce();
      expect(method).toHaveBeenCalledWith(context);
    }
  });

  it("öncelikli aksiyonları üç kayıtla sınırlar ve kişi/tenant alanı üretmez", () => {
    const result = buildTeacherDailyBrief("2026-08-09", {
      attendance: [],
      homework: [{ id: "homework-a", tenantId: "tenant-a", classId: "class-a", title: "Tekrar" }],
      lessons: [{
        id: "lesson-a",
        tenantId: "tenant-a",
        classId: "class-a",
        teacherId: "teacher-a",
        title: "Matematik",
        startsAt: "2026-08-09T09:00:00.000Z",
        endsAt: "2026-08-09T10:00:00.000Z",
      }],
      reports: [{ examId: "exam-a", title: "Deneme", latestReadySnapshotId: "snapshot-a", latestGeneratedAt: "2026-08-08T10:00:00.000Z" }],
      studentCount: 12,
      supportTickets: [{ id: "ticket-a", tenantId: "tenant-a", requesterId: "teacher-user-a", subject: "Destek", message: "Yardım", status: "OPEN", priority: "NORMAL", createdAt: "2026-08-09T08:00:00.000Z" }],
    }, new Date("2026-08-09T08:00:00.000Z"));

    expect(result.actions).toEqual([
      { id: "attendance", count: 1 },
      { id: "homework", count: 1 },
      { id: "support", count: 1 },
    ]);
    expect(result).toMatchObject({ pendingAttendanceClassCount: 1, todayLessonCount: 1, uncheckedHomeworkCount: 1 });
    expect(JSON.stringify(result)).not.toMatch(/tenantId|studentId|teacherId|firstName|lastName|email|phone|nationalId/i);
  });

  it("teacher subject olmayan ve geçersiz tarihli çağrıyı servis okumadan reddeder", async () => {
    const service = new MeTeacherDailyBriefService(
      { list: vi.fn() } as never,
      { list: vi.fn() } as never,
      { listForTeacher: vi.fn() } as never,
      { listCurrentTeacherLessons: vi.fn() } as never,
      { listForViewer: vi.fn() } as never,
      { listCurrentTeacher: vi.fn() } as never,
    );

    await expect(service.get({ tenantId: "tenant-a", roles: ["TENANT_ADMIN"], userId: "admin-a" } as never, "2026-08-09"))
      .rejects.toMatchObject({ message: "TEACHER_SUBJECT_CONTEXT_REQUIRED" });
    await expect(service.get({ tenantId: "tenant-a", roles: ["TEACHER"], subjectId: "teacher-a", subjectType: "TEACHER", userId: "teacher-user-a" } as never, "2026-02-31"))
      .rejects.toMatchObject({ message: "DAILY_BRIEF_DATE_INVALID" });
  });
});
