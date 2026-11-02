import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { buildTeacherTodaySummary, MeTeacherTodayService } from "./me-teacher-today.service.js";

const now = new Date("2026-10-01T06:00:00.000Z"); // İstanbul 09:00

describe("buildTeacherTodaySummary", () => {
  it("yalnız İstanbul bugününün derslerini, kontrol bekleyen ödevleri ve son raporu döner", () => {
    const summary = buildTeacherTodaySummary({
      now,
      teacher: { firstName: "Ayşe", lastName: "Öğretmen" },
      lessons: [
        { id: "l2", classId: "c1", title: "8-A Fen", startsAt: "2026-10-01T10:00:00.000Z", endsAt: "2026-10-01T10:40:00.000Z" },
        { id: "l1", classId: "c1", courseId: "math", title: "8-A Matematik", startsAt: "2026-10-01T05:30:00.000Z", endsAt: "2026-10-01T06:10:00.000Z" },
        { id: "l3", classId: "c2", title: "Yarın", startsAt: "2026-10-01T21:30:00.000Z", endsAt: "2026-10-01T22:10:00.000Z" },
      ],
      homework: [
        { id: "h1", classId: "c1", title: "Kontrol edildi", checkedAt: "2026-09-30T10:00:00.000Z" },
        { id: "h2", classId: "c1", title: "Tarihsiz" },
        { id: "h3", classId: "c1", title: "Yakın", dueAt: "2026-10-02T00:00:00.000Z" },
      ],
      reports: [{ examId: "e1", title: "Ekim LGS", latestGeneratedAt: "2026-09-30T12:00:00.000Z" }],
    });
    expect(summary.date).toBe("2026-10-01");
    expect(summary.teacherName).toBe("Ayşe Öğretmen");
    expect(summary.todayLessons.map((lesson) => lesson.id)).toEqual(["l1", "l2"]);
    expect(summary.pendingHomework.map((item) => item.id)).toEqual(["h3", "h2"]);
    expect(summary.pendingHomeworkCount).toBe(2);
    expect(summary.latestReport).toEqual({ examId: "e1", title: "Ekim LGS", latestGeneratedAt: "2026-09-30T12:00:00.000Z" });
    expect(JSON.stringify(summary)).not.toMatch(/phone|userId|tenantId/);
  });
});

const context = { tenantId: "t", roles: ["TEACHER"], bypassRls: false, subjectType: "TEACHER", subjectId: "teacher-a", userId: "u" };

function createService(overrides: Partial<Record<"teachers" | "schedules" | "homework" | "reportIndex" | "school" | "gradebook" | "announcements" | "store", object>> = {}) {
  return new MeTeacherTodayService(
    (overrides.teachers ?? { findCurrentTeacher: vi.fn().mockResolvedValue({ firstName: "Ayşe", lastName: "Öğretmen" }) }) as never,
    (overrides.schedules ?? { listCurrentTeacherLessons: vi.fn().mockResolvedValue([{ id: "l1", classId: "c1", title: "8-A", startsAt: "2026-10-01T06:30:00.000Z", endsAt: "2026-10-01T07:10:00.000Z" }]) }) as never,
    (overrides.homework ?? { list: vi.fn().mockResolvedValue([{ id: "h1", classId: "c1", title: "Ödev" }]) }) as never,
    (overrides.reportIndex ?? { listForTeacher: vi.fn().mockResolvedValue([]) }) as never,
    (overrides.school ?? { listClasses: vi.fn().mockResolvedValue([]) }) as never,
    (overrides.gradebook ?? { listAssessments: vi.fn().mockResolvedValue([]) }) as never,
    (overrides.announcements ?? { listCurrentTeacher: vi.fn().mockResolvedValue([]) }) as never,
    (overrides.store ?? { loadInbox: vi.fn().mockResolvedValue(undefined) }) as never,
  );
}

describe("MeTeacherTodayService", () => {
  it("rapor dizini hatasında dersleri ve ödevleri döner, son raporu null yapar", async () => {
    const service = createService({ reportIndex: { listForTeacher: vi.fn().mockRejectedValue(new Error("REPORT_INDEX_DOWN")) } });
    const summary = await service.get(context as never, now);
    expect(summary.todayLessons).toHaveLength(1);
    expect(summary.pendingHomeworkCount).toBe(1);
    expect(summary.latestReport).toBeNull();
  });

  it("gelen kutusunu yalnız öğretmen kapsamındaki ders, ödev ve değerlendirme kimlikleriyle okur", async () => {
    const loadInbox = vi.fn().mockResolvedValue({ attendanceClassIds: ["c1"], pendingSubmissionCount: 3, unpublishedGradeDraftCount: 2 });
    const service = createService({
      schedules: {
        listCurrentTeacherLessons: vi.fn().mockResolvedValue([
          { id: "l1", classId: "c1", title: "8-A Matematik", startsAt: "2026-10-01T06:30:00.000Z", endsAt: "2026-10-01T07:10:00.000Z" },
          { id: "l2", classId: "c2", title: "8-B Matematik", startsAt: "2026-10-01T08:30:00.000Z", endsAt: "2026-10-01T09:10:00.000Z" },
          { id: "l3", classId: "c3", title: "Yarın", startsAt: "2026-10-02T06:30:00.000Z", endsAt: "2026-10-02T07:10:00.000Z" },
        ]),
      },
      school: {
        listClasses: vi.fn().mockResolvedValue([
          { id: "c1", name: "8-A", tenantId: "t" },
          { id: "c2", name: "8-B", tenantId: "t" },
          { id: "c9", name: "Başka sınıf", tenantId: "t" },
        ]),
      },
      gradebook: { listAssessments: vi.fn().mockResolvedValue([{ id: "a1" }, { id: "a2" }]) },
      announcements: { listCurrentTeacher: vi.fn().mockResolvedValue([{ id: "n1" }, { id: "n2", readAt: "2026-09-30T10:00:00.000Z" }, { id: "n3" }]) },
      store: { loadInbox },
    });
    const summary = await service.get(context as never, now);

    expect(loadInbox).toHaveBeenCalledWith({ tenantId: "t", date: "2026-10-01", classIds: ["c1", "c2"], homeworkIds: ["h1"], assessmentIds: ["a1", "a2"] });
    expect(summary.todayLessons.map(({ id, className, attendanceTaken }) => ({ id, className, attendanceTaken }))).toEqual([
      { id: "l1", className: "8-A", attendanceTaken: true },
      { id: "l2", className: "8-B", attendanceTaken: false },
    ]);
    expect(summary.pendingSubmissionCount).toBe(3);
    expect(summary.unpublishedGradeDraftCount).toBe(2);
    expect(summary.unreadAnnouncementCount).toBe(2);
    expect(JSON.stringify(summary)).not.toContain("Başka sınıf");
  });

  it("gelen kutusu kaynakları okunamazsa sayaçları sıfır yerine yanıttan düşürür", async () => {
    const loadInbox = vi.fn().mockResolvedValue({ attendanceClassIds: [], pendingSubmissionCount: 0 });
    const service = createService({
      school: { listClasses: vi.fn().mockRejectedValue(new Error("CLASSES_DOWN")) },
      gradebook: { listAssessments: vi.fn().mockRejectedValue(new Error("GRADEBOOK_DOWN")) },
      announcements: { listCurrentTeacher: vi.fn().mockRejectedValue(new Error("ANNOUNCEMENTS_DOWN")) },
      store: { loadInbox },
    });
    const summary = await service.get(context as never, now);

    expect(loadInbox).toHaveBeenCalledWith({ tenantId: "t", date: "2026-10-01", classIds: ["c1"], homeworkIds: ["h1"] });
    expect(summary.todayLessons[0]).not.toHaveProperty("className");
    expect(summary.todayLessons[0]?.attendanceTaken).toBe(false);
    expect(summary.pendingSubmissionCount).toBe(0);
    expect(summary).not.toHaveProperty("unpublishedGradeDraftCount");
    expect(summary).not.toHaveProperty("unreadAnnouncementCount");

    const unknownInbox = await createService({ store: { loadInbox: vi.fn().mockRejectedValue(new Error("DB_DOWN")) } }).get(context as never, now);
    expect(unknownInbox.todayLessons[0]).not.toHaveProperty("attendanceTaken");
    expect(unknownInbox).not.toHaveProperty("pendingSubmissionCount");
    expect(unknownInbox).not.toHaveProperty("unpublishedGradeDraftCount");
    expect(unknownInbox.pendingHomeworkCount).toBe(1);
  });

  it("öğretmen özne bağlamı olmadan hiçbir alt servisi çağırmaz", async () => {
    const calls = vi.fn();
    const stub = new Proxy({}, { get: () => calls });
    const service = new MeTeacherTodayService(stub as never, stub as never, stub as never, stub as never, stub as never, stub as never, stub as never, stub as never);
    for (const context of [
      { tenantId: "t", roles: ["TEACHER"], bypassRls: false },
      { tenantId: "t", roles: ["STUDENT"], subjectType: "STUDENT", subjectId: "s", bypassRls: false },
      { roles: ["TEACHER"], subjectType: "TEACHER", subjectId: "x", bypassRls: false },
    ]) {
      await expect(service.get(context as never)).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(calls).not.toHaveBeenCalled();
  });
});
