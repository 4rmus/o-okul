import { describe, expect, it, vi } from "vitest";
import { MeStudentDailyBriefService, buildStudentDailyBrief } from "./me-student-daily-brief.service.js";

describe("MeStudentDailyBriefService", () => {
  it("beş self-scoped kaynağı aynı öğrenci contexti ile birer kez okur", async () => {
    const announcements = { listCurrentStudent: vi.fn().mockResolvedValue([]) };
    const attendance = { summarizeCurrentStudent: vi.fn().mockResolvedValue({ absent: 0, excused: 0, late: 0, present: 3, studentId: "student-a", total: 3 }) };
    const homework = { listCurrentStudentMaterialAssignments: vi.fn().mockResolvedValue([]) };
    const reportIndex = { listForStudent: vi.fn().mockResolvedValue([]) };
    const students = { findById: vi.fn() };
    const supportTickets = { listCurrentStudent: vi.fn().mockResolvedValue([]) };
    const context = { bypassRls: false, tenantId: "tenant-a", roles: ["STUDENT"], subjectId: "student-a", subjectType: "STUDENT", userId: "student-user-a" };
    const service = new MeStudentDailyBriefService(
      announcements as never,
      attendance as never,
      homework as never,
      reportIndex as never,
      students as never,
      supportTickets as never,
    );

    await expect(service.get(context as never)).resolves.toMatchObject({
      attendanceRecordCount: 3,
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    for (const method of [announcements.listCurrentStudent, attendance.summarizeCurrentStudent, homework.listCurrentStudentMaterialAssignments, supportTickets.listCurrentStudent]) {
      expect(method).toHaveBeenCalledOnce();
      expect(method).toHaveBeenCalledWith(context);
    }
    expect(reportIndex.listForStudent).toHaveBeenCalledOnce();
    expect(reportIndex.listForStudent).toHaveBeenCalledWith(context, "student-a");
    expect(students.findById).not.toHaveBeenCalled();
  });

  it("role preview okumalarını admin actor yerine hedef öğrencinin bağlı hesabına scope eder", async () => {
    const announcements = { listCurrentStudent: vi.fn().mockResolvedValue([]) };
    const attendance = { summarizeCurrentStudent: vi.fn().mockResolvedValue({ absent: 0, excused: 0, late: 0, present: 0, studentId: "student-a", total: 0 }) };
    const homework = { listCurrentStudentMaterialAssignments: vi.fn().mockResolvedValue([]) };
    const reportIndex = { listForStudent: vi.fn().mockResolvedValue([]) };
    const students = { findById: vi.fn().mockResolvedValue({ id: "student-a", tenantId: "tenant-a", userId: "student-user-a" }) };
    const supportTickets = { listCurrentStudent: vi.fn().mockResolvedValue([]) };
    const context = {
      bypassRls: false,
      rolePreview: { actorUserId: "admin-user-a", expiresAt: "2026-08-09T09:00:00.000Z", id: "preview-a", mode: "READ_ONLY" },
      roles: ["STUDENT"],
      subjectId: "student-a",
      subjectType: "STUDENT",
      tenantId: "tenant-a",
      userId: "admin-user-a",
    };
    const service = new MeStudentDailyBriefService(
      announcements as never,
      attendance as never,
      homework as never,
      reportIndex as never,
      students as never,
      supportTickets as never,
    );

    await service.get(context as never);

    const viewerContext = expect.objectContaining({
      rolePreview: context.rolePreview,
      subjectId: "student-a",
      tenantId: "tenant-a",
      userId: "student-user-a",
    });
    expect(students.findById).toHaveBeenCalledWith("student-a");
    expect(announcements.listCurrentStudent).toHaveBeenCalledWith(viewerContext);
    expect(supportTickets.listCurrentStudent).toHaveBeenCalledWith(viewerContext);
    expect(reportIndex.listForStudent).toHaveBeenCalledWith(viewerContext, "student-a");
  });

  it("öncelikli aksiyonları üç kayıtla sınırlar ve kişi/tenant alanı üretmez", () => {
    const result = buildStudentDailyBrief({
      announcements: [{ audience: "STUDENTS", body: "Plan", id: "announcement-a", publishedAt: "2026-08-09T08:00:00.000Z", tenantId: "tenant-a", title: "Haftalık plan" }],
      attendance: { absent: 1, excused: 0, late: 1, present: 8, studentId: "student-a", total: 10 },
      homework: [{ createdAt: "2026-08-08T08:00:00.000Z", id: "assignment-a", materialId: "material-a", studentId: "student-a", tenantId: "tenant-a" }],
      reports: [{ examId: "exam-a", latestGeneratedAt: "2026-08-08T10:00:00.000Z", latestReadySnapshotId: "snapshot-a", title: "Deneme" }],
      supportTickets: [{ createdAt: "2026-08-09T08:00:00.000Z", id: "ticket-a", message: "Yardım", priority: "NORMAL", requesterId: "student-user-a", status: "OPEN", studentId: "student-a", subject: "Destek", tenantId: "tenant-a" }],
    }, new Date("2026-08-09T08:00:00.000Z"));

    expect(result.actions).toEqual([
      { id: "announcement", count: 1 },
      { id: "homework", count: 1 },
      { id: "report", count: 1 },
    ]);
    expect(result).toMatchObject({ absenceCount: 1, attendanceRecordCount: 10, date: "2026-08-09", lateCount: 1 });
    expect(JSON.stringify(result)).not.toMatch(/tenantId|studentId|firstName|lastName|email|phone|nationalId|requesterId|message|body/i);
  });

  it("student subject, tenant veya RLS sınırı yoksa servis okumadan reddeder", async () => {
    const announcements = { listCurrentStudent: vi.fn() };
    const service = new MeStudentDailyBriefService(
      announcements as never,
      { summarizeCurrentStudent: vi.fn() } as never,
      { listCurrentStudentMaterialAssignments: vi.fn() } as never,
      { listForStudent: vi.fn() } as never,
      { findById: vi.fn() } as never,
      { listCurrentStudent: vi.fn() } as never,
    );

    for (const context of [
      { bypassRls: false, tenantId: "tenant-a", roles: ["TENANT_ADMIN"], userId: "admin-a" },
      { bypassRls: false, tenantId: null, roles: ["STUDENT"], subjectId: "student-a", subjectType: "STUDENT", userId: "student-user-a" },
      { bypassRls: true, tenantId: "tenant-a", roles: ["STUDENT"], subjectId: "student-a", subjectType: "STUDENT", userId: "system-a" },
    ]) {
      await expect(service.get(context as never)).rejects.toMatchObject({ message: "STUDENT_SUBJECT_CONTEXT_REQUIRED" });
    }
    expect(announcements.listCurrentStudent).not.toHaveBeenCalled();
  });
});
