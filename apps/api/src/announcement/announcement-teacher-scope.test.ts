import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { InMemoryAnnouncementReceiptStore } from "./announcement-receipt-store.js";
import { AnnouncementService, type AnnouncementRecord } from "./announcement.service.js";

// SEC-CAMPUS: a campus or grade-level announcement reaches only teachers with an active assignment to a class on that
// campus or grade level; school-wide announcements still reach every teacher.
describe("AnnouncementService öğretmen kapsamı", () => {
  const classes = [
    { id: "class-1", tenantId: "tenant-a", name: "8-A", campusId: "campus-1", gradeLevelId: "grade-8" },
    { id: "class-2", tenantId: "tenant-a", name: "8-B", campusId: "campus-2", gradeLevelId: "grade-8" },
    { id: "class-3", tenantId: "tenant-a", name: "7-C", campusId: "campus-2", gradeLevelId: "grade-7" },
    { id: "class-deleted", tenantId: "tenant-a", name: "6-D", campusId: "campus-1", gradeLevelId: "grade-6", deletedAt: "2026-01-01" },
  ];
  const teachers = ["teacher-1", "teacher-2", "teacher-3", "teacher-ended", "teacher-deleted-class", "teacher-free"].map((id) => ({
    id,
    tenantId: "tenant-a",
    firstName: id,
    lastName: "Öğretmen",
    userId: `user-${id}`,
  }));
  const assignments = [
    { id: "assignment-1", tenantId: "tenant-a", teacherId: "teacher-1", classId: "class-1", role: "CLASS_TEACHER" },
    { id: "assignment-2", tenantId: "tenant-a", teacherId: "teacher-2", classId: "class-2", role: "CLASS_TEACHER" },
    { id: "assignment-3", tenantId: "tenant-a", teacherId: "teacher-3", classId: "class-3", role: "CLASS_TEACHER" },
    { id: "assignment-ended", tenantId: "tenant-a", teacherId: "teacher-ended", classId: "class-1", role: "CLASS_TEACHER", endsAt: "2020-06-30" },
    { id: "assignment-deleted", tenantId: "tenant-a", teacherId: "teacher-deleted-class", classId: "class-deleted", role: "CLASS_TEACHER" },
  ];
  const announcement = (id: string, targets: Partial<AnnouncementRecord>): AnnouncementRecord => ({
    id,
    tenantId: "tenant-a",
    title: id,
    body: "Duyuru",
    audience: "TEACHERS",
    publishedAt: "2026-11-01T09:00:00.000Z",
    ...targets,
  });
  const announcements = [
    announcement("campus-1", { campusId: "campus-1" }),
    announcement("grade-8", { gradeLevelId: "grade-8" }),
    announcement("school-wide", {}),
    announcement("campus-2-grade-7", { campusId: "campus-2", gradeLevelId: "grade-7" }),
  ];

  function createService(): AnnouncementService {
    const service = new AnnouncementService(
      {
        list: async () => announcements,
        findById: async (id: string) => announcements.find((record) => record.id === id),
      } as never,
      {} as never,
      {} as never,
      {
        list: async () => classes,
        findById: async (id: string) => classes.find((record) => record.id === id),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      { listByStudent: async () => [] } as never,
      { list: async () => [] } as never,
      { list: async () => teachers } as never,
      {
        list: async () => assignments,
        listByTeacher: async (teacherId: string) => assignments.filter((assignment) => assignment.teacherId === teacherId),
      } as never,
      {} as never,
      new InMemoryAnnouncementReceiptStore(),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return service;
  }

  const admin: RequestContext = { userId: "admin", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false };
  const teacher = (id: string): RequestContext => ({
    userId: `user-${id}`,
    tenantId: "tenant-a",
    roles: ["TEACHER"],
    bypassRls: false,
    subjectType: "TEACHER",
    subjectId: id,
  });
  const recipientIds = async (service: AnnouncementService, id: string) =>
    (await service.recipientReport(admin, id)).recipients.map((recipient) => recipient.subjectId).sort();

  it("kampüs duyurusunun alıcı raporunda başka kampüsün öğretmeni yok", async () => {
    const service = createService();

    expect(await recipientIds(service, "campus-1")).toEqual(["teacher-1"]);
    expect(await recipientIds(service, "grade-8")).toEqual(["teacher-1", "teacher-2"]);
    expect(await recipientIds(service, "campus-2-grade-7")).toEqual(["teacher-3"]);
  });

  it("okul geneli duyuru bütün öğretmenlere gider", async () => {
    expect(await recipientIds(createService(), "school-wide")).toEqual(teachers.map((record) => record.id).sort());
  });

  it("öğretmen akışı başka kampüsün duyurusunu içermez", async () => {
    const service = createService();
    const feed = async (id: string) => (await service.listCurrentTeacher(teacher(id))).map((record) => record.id).sort();

    expect(await feed("teacher-1")).toEqual(["campus-1", "grade-8", "school-wide"]);
    expect(await feed("teacher-2")).toEqual(["grade-8", "school-wide"]);
    expect(await feed("teacher-3")).toEqual(["campus-2-grade-7", "school-wide"]);
    expect(await feed("teacher-ended")).toEqual(["school-wide"]);
    expect(await feed("teacher-deleted-class")).toEqual(["school-wide"]);
  });
});
