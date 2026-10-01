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

describe("MeTeacherTodayService", () => {
  it("rapor dizini hatasında dersleri ve ödevleri döner, son raporu null yapar", async () => {
    const context = { tenantId: "t", roles: ["TEACHER"], bypassRls: false, subjectType: "TEACHER", subjectId: "teacher-a", userId: "u" };
    const service = new MeTeacherTodayService(
      { findCurrentTeacher: vi.fn().mockResolvedValue({ firstName: "Ayşe", lastName: "Öğretmen" }) } as never,
      { listCurrentTeacherLessons: vi.fn().mockResolvedValue([{ id: "l1", classId: "c1", title: "8-A", startsAt: "2026-10-01T06:30:00.000Z", endsAt: "2026-10-01T07:10:00.000Z" }]) } as never,
      { list: vi.fn().mockResolvedValue([{ id: "h1", classId: "c1", title: "Ödev" }]) } as never,
      { listForTeacher: vi.fn().mockRejectedValue(new Error("REPORT_INDEX_DOWN")) } as never,
    );
    const summary = await service.get(context as never, now);
    expect(summary.todayLessons).toHaveLength(1);
    expect(summary.pendingHomeworkCount).toBe(1);
    expect(summary.latestReport).toBeNull();
  });

  it("öğretmen özne bağlamı olmadan hiçbir alt servisi çağırmaz", async () => {
    const calls = vi.fn();
    const stub = new Proxy({}, { get: () => calls });
    const service = new MeTeacherTodayService(stub as never, stub as never, stub as never, stub as never);
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
