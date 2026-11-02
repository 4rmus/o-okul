import { ForbiddenException } from "@nestjs/common";
import type { TeacherAssignmentRecord } from "@o-okul/shared-types";
import { describe, expect, it, vi } from "vitest";
import { InMemoryGradebookStore } from "../gradebook/gradebook-store.js";
import { GradebookService } from "../gradebook/gradebook.service.js";
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

function createService(overrides: Partial<Record<"teachers" | "schedules" | "homework" | "reportIndex" | "school" | "gradebook" | "announcements" | "students" | "store", object>> = {}) {
  return new MeTeacherTodayService(
    (overrides.teachers ?? { findCurrentTeacher: vi.fn().mockResolvedValue({ firstName: "Ayşe", lastName: "Öğretmen" }) }) as never,
    (overrides.schedules ?? { listCurrentTeacherLessons: vi.fn().mockResolvedValue([{ id: "l1", classId: "c1", title: "8-A", startsAt: "2026-10-01T06:30:00.000Z", endsAt: "2026-10-01T07:10:00.000Z" }]) }) as never,
    (overrides.homework ?? { list: vi.fn().mockResolvedValue([{ id: "h1", classId: "c1", title: "Ödev" }]) }) as never,
    (overrides.reportIndex ?? { listForTeacher: vi.fn().mockResolvedValue([]) }) as never,
    (overrides.school ?? { listClasses: vi.fn().mockResolvedValue([]) }) as never,
    (overrides.gradebook ?? { listAssessments: vi.fn().mockResolvedValue([]), listTeacherAuthoringScopes: vi.fn().mockResolvedValue([]) }) as never,
    (overrides.announcements ?? { listCurrentTeacher: vi.fn().mockResolvedValue([]) }) as never,
    (overrides.students ?? { list: vi.fn().mockResolvedValue([{ id: "s1" }]) }) as never,
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
      gradebook: {
        listAssessments: vi.fn().mockResolvedValue([
          { id: "a1", classId: "c1", courseId: "math", termId: "term" },
          { id: "a2", classId: "c2", courseId: "math", termId: "term" },
        ]),
        listTeacherAuthoringScopes: vi.fn().mockResolvedValue([{ classId: "c1" }, { classId: "c2", courseId: "math" }]),
      },
      announcements: { listCurrentTeacher: vi.fn().mockResolvedValue([{ id: "n1" }, { id: "n2", readAt: "2026-09-30T10:00:00.000Z" }, { id: "n3" }]) },
      store: { loadInbox },
    });
    const summary = await service.get(context as never, now);

    expect(loadInbox).toHaveBeenCalledWith({
      tenantId: "t", date: "2026-10-01", classIds: ["c1", "c2"], homeworkIds: ["h1"], studentIds: ["s1"], assessmentIds: ["a1", "a2"],
    });
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
      gradebook: { listAssessments: vi.fn().mockRejectedValue(new Error("GRADEBOOK_DOWN")), listTeacherAuthoringScopes: vi.fn().mockResolvedValue([]) },
      announcements: { listCurrentTeacher: vi.fn().mockRejectedValue(new Error("ANNOUNCEMENTS_DOWN")) },
      store: { loadInbox },
    });
    const summary = await service.get(context as never, now);

    expect(loadInbox).toHaveBeenCalledWith({ tenantId: "t", date: "2026-10-01", classIds: ["c1"], homeworkIds: ["h1"], studentIds: ["s1"] });
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

  it("not taslağı sayacı okuma kapsamını değil yazma kapsamını kullanır", async () => {
    const assignments: TeacherAssignmentRecord[] = [
      { id: "math-8a", tenantId: "t", teacherId: "teacher-a", role: "BRANCH_TEACHER", classId: "c1", courseId: "math" },
      // Course-wide read assignment: reads every math class, authors none.
      { id: "math-all", tenantId: "t", teacherId: "teacher-a", role: "BRANCH_TEACHER", courseId: "math" },
      { id: "counsellor-8c", tenantId: "t", teacherId: "teacher-a", role: "GUIDANCE_COUNSELOR", classId: "c3" },
    ];
    const classes = [{ id: "c1", tenantId: "t", name: "8-A" }, { id: "c2", tenantId: "t", name: "8-B" }, { id: "c3", tenantId: "t", name: "8-C" }];
    const gradebookStore = new InMemoryGradebookStore();
    const assessment = (classId: string, courseId: string) => gradebookStore.createAssessment({
      tenantId: "t", classId, courseId, termId: "term", kind: "WRITTEN", title: `${classId}-${courseId}`, heldOn: "2026-09-20", maxScore: 100, createdById: "u",
    });
    const own = await assessment("c1", "math");
    const otherClassSameCourse = await assessment("c2", "math");
    const counsellorClass = await assessment("c3", "math");
    const gradebook = new GradebookService(
      gradebookStore,
      { list: async () => classes, findById: async (id: string) => classes.find((item) => item.id === id) } as never,
      {} as never,
      {} as never,
      {} as never,
      { listByTeacher: async (teacherId: string) => assignments.filter((item) => item.teacherId === teacherId) } as never,
    );
    const readable = (await gradebook.listAssessments(context as never, {})).map((item) => item.id);
    expect(readable).toEqual(expect.arrayContaining([own.id, otherClassSameCourse.id, counsellorClass.id]));

    const loadInbox = vi.fn().mockResolvedValue({ attendanceClassIds: [], pendingSubmissionCount: 0, unpublishedGradeDraftCount: 1 });
    await createService({ gradebook, store: { loadInbox } }).get(context as never, now);
    expect(loadInbox).toHaveBeenCalledWith(expect.objectContaining({ assessmentIds: [own.id] }));

    const unknownScopes = vi.fn().mockResolvedValue({ attendanceClassIds: [], pendingSubmissionCount: 0 });
    await createService({
      gradebook: { listAssessments: vi.fn().mockResolvedValue([{ id: own.id, classId: "c1", courseId: "math", termId: "term" }]), listTeacherAuthoringScopes: vi.fn().mockRejectedValue(new Error("DOWN")) },
      store: { loadInbox: unknownScopes },
    }).get(context as never, now);
    expect(unknownScopes.mock.calls[0]?.[0]).not.toHaveProperty("assessmentIds");
  });

  it("teslim sayacını öğretmenin görebildiği öğrencilerle ve kapatılmamış ödevlerle sınırlar", async () => {
    const loadInbox = vi.fn().mockResolvedValue({ attendanceClassIds: [], pendingSubmissionCount: 2 });
    const summary = await createService({
      homework: {
        list: vi.fn().mockResolvedValue([
          { id: "h-open", classId: "c1", title: "Açık" },
          { id: "h-closed", classId: "c1", title: "Kapatıldı", checkedAt: "2026-09-30T10:00:00.000Z" },
        ]),
      },
      students: { list: vi.fn().mockResolvedValue([{ id: "s1" }, { id: "s2" }]) },
      store: { loadInbox },
    }).get(context as never, now);
    expect(loadInbox).toHaveBeenCalledWith(expect.objectContaining({ homeworkIds: ["h-open"], studentIds: ["s1", "s2"] }));
    expect(summary.pendingSubmissionCount).toBe(2);
    expect(summary.pendingHomeworkCount).toBe(1);

    const noStudents = vi.fn().mockResolvedValue({ attendanceClassIds: [] });
    const unknown = await createService({ students: { list: vi.fn().mockRejectedValue(new Error("STUDENTS_DOWN")) }, store: { loadInbox: noStudents } })
      .get(context as never, now);
    expect(noStudents.mock.calls[0]?.[0]).not.toHaveProperty("studentIds");
    expect(unknown).not.toHaveProperty("pendingSubmissionCount");
  });

  it("öğretmen özne bağlamı olmadan hiçbir alt servisi çağırmaz", async () => {
    const calls = vi.fn();
    const stub = new Proxy({}, { get: () => calls });
    const service = new MeTeacherTodayService(stub as never, stub as never, stub as never, stub as never, stub as never, stub as never, stub as never, stub as never, stub as never);
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
