import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { ClassOverviewService } from "./class-overview.service.js";
import { type ClassOverviewMemoryData, emptyClassOverviewMemoryData, InMemoryClassOverviewStore } from "./class-overview.store.js";

// 2026-11-02 08:00 UTC is 11:00 in Istanbul.
const now = new Date("2026-11-02T08:00:00.000Z");
const today = "2026-11-02";

const admin: RequestContext = { userId: "user-admin", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false };

function fixture(): ClassOverviewMemoryData {
  const data = emptyClassOverviewMemoryData();
  data.classes.push(
    { id: "class-1", tenantId: "tenant-a", campusId: "campus-1" },
    { id: "class-2", tenantId: "tenant-a", campusId: "campus-2" },
    { id: "class-free", tenantId: "tenant-a" },
    { id: "class-deleted", tenantId: "tenant-a", campusId: "campus-1", deletedAt: "2026-10-01T00:00:00.000Z" },
    { id: "class-foreign", tenantId: "tenant-b", campusId: "campus-1" },
  );
  // s1-s3 are on the class-1 roster today; s4 left yesterday, s5 is passive, s6 is deleted, s7 starts tomorrow.
  for (const [id, status, deletedAt] of [
    ["s1", "ACTIVE"], ["s2", "ACTIVE"], ["s3", "ACTIVE"], ["s4", "ACTIVE"], ["s5", "PASSIVE"], ["s6", "ACTIVE", "2026-10-01T00:00:00.000Z"],
    ["s7", "ACTIVE"], ["s8", "ACTIVE"],
  ] as const) {
    data.students.push({ id, tenantId: "tenant-a", classId: id === "s8" ? "class-2" : "class-1", status, ...(deletedAt ? { deletedAt } : {}) });
  }
  data.enrollments.push(
    { tenantId: "tenant-a", studentId: "s1", classId: "class-1", startsAt: "2026-09-01" },
    { tenantId: "tenant-a", studentId: "s2", classId: "class-1", startsAt: "2026-09-01" },
    { tenantId: "tenant-a", studentId: "s3", classId: "class-1", startsAt: "2026-09-01", endsAt: today },
    { tenantId: "tenant-a", studentId: "s4", classId: "class-1", startsAt: "2026-09-01", endsAt: "2026-11-01" },
    { tenantId: "tenant-a", studentId: "s5", classId: "class-1", startsAt: "2026-09-01" },
    { tenantId: "tenant-a", studentId: "s6", classId: "class-1", startsAt: "2026-09-01" },
    { tenantId: "tenant-a", studentId: "s7", classId: "class-1", startsAt: "2026-11-03" },
    { tenantId: "tenant-a", studentId: "s8", classId: "class-2", startsAt: "2026-09-01" },
  );
  data.lessons.push(
    // 07:30 UTC = 10:30 Istanbul today; 21:30 UTC on 1 Nov = 00:30 Istanbul on 2 Nov.
    { tenantId: "tenant-a", classId: "class-1", startsAt: "2026-11-02T07:30:00.000Z" },
    { tenantId: "tenant-a", classId: "class-1", startsAt: "2026-11-01T21:30:00.000Z" },
    { tenantId: "tenant-a", classId: "class-1", startsAt: "2026-11-02T09:00:00.000Z", deletedAt: "2026-10-30T00:00:00.000Z" },
    { tenantId: "tenant-a", classId: "class-2", startsAt: "2026-11-02T09:00:00.000Z" },
  );
  data.attendance.push(
    { tenantId: "tenant-a", studentId: "s1", date: today },
    { tenantId: "tenant-a", studentId: "s2", date: today, deletedAt: "2026-11-02T07:00:00.000Z" },
    { tenantId: "tenant-a", studentId: "s4", date: today },
  );
  data.homework.push(
    { id: "hw-open", tenantId: "tenant-a", classId: "class-1" },
    { id: "hw-closed", tenantId: "tenant-a", classId: "class-1", checkedAt: "2026-10-30T00:00:00.000Z" },
    { id: "hw-deleted", tenantId: "tenant-a", classId: "class-1", deletedAt: "2026-10-30T00:00:00.000Z" },
  );
  data.submissions.push(
    { tenantId: "tenant-a", homeworkId: "hw-open", studentId: "s1", submittedAt: "2026-11-01T10:00:00.000Z" },
    { tenantId: "tenant-a", homeworkId: "hw-open", studentId: "s2", submittedAt: "2026-11-01T10:00:00.000Z", checkedAt: "2026-11-01T12:00:00.000Z" },
    { tenantId: "tenant-a", homeworkId: "hw-open", studentId: "s6", submittedAt: "2026-11-01T10:00:00.000Z" },
    { tenantId: "tenant-a", homeworkId: "hw-closed", studentId: "s3", submittedAt: "2026-11-01T10:00:00.000Z" },
  );
  data.terms.push(
    { id: "term-current", tenantId: "tenant-a", startsAt: "2026-09-01", endsAt: "2027-01-31" },
    { id: "term-past", tenantId: "tenant-a", startsAt: "2026-02-01", endsAt: "2026-06-30" },
    { id: "term-deleted", tenantId: "tenant-a", startsAt: "2026-09-01", endsAt: "2027-01-31", deletedAt: "2026-10-01T00:00:00.000Z" },
  );
  data.courses.push({ id: "course-math", tenantId: "tenant-a", name: "Matematik" }, { id: "course-tr", tenantId: "tenant-a", name: "Türkçe" });
  data.assessments.push(
    { id: "a-math-1", tenantId: "tenant-a", classId: "class-1", courseId: "course-math", termId: "term-current", kind: "EXAM", title: "1. yazılı", heldOn: "2026-10-20", publishedVersion: 1 },
    { id: "a-math-2", tenantId: "tenant-a", classId: "class-1", courseId: "course-math", termId: "term-current", kind: "QUIZ", title: "Kısa sınav", heldOn: "2026-10-28" },
    { id: "a-tr-1", tenantId: "tenant-a", classId: "class-1", courseId: "course-tr", termId: "term-current", kind: "EXAM", title: "Türkçe yazılı", heldOn: "2026-10-25" },
    { id: "a-past", tenantId: "tenant-a", classId: "class-1", courseId: "course-math", termId: "term-past", kind: "EXAM", title: "Eski", heldOn: "2026-05-20" },
    { id: "a-deleted-term", tenantId: "tenant-a", classId: "class-1", courseId: "course-math", termId: "term-deleted", kind: "EXAM", title: "Silinen", heldOn: "2026-10-01" },
    { id: "a-class-2", tenantId: "tenant-a", classId: "class-2", courseId: "course-math", termId: "term-current", kind: "EXAM", title: "2. sınıf", heldOn: "2026-10-20" },
  );
  data.entries.push(
    // a-math-1: everyone on the roster published, one later correction drafted (new version, ADR-0011).
    { tenantId: "tenant-a", assessmentId: "a-math-1", studentId: "s1", publishedAt: "2026-10-21T00:00:00.000Z" },
    { tenantId: "tenant-a", assessmentId: "a-math-1", studentId: "s2", publishedAt: "2026-10-21T00:00:00.000Z" },
    { tenantId: "tenant-a", assessmentId: "a-math-1", studentId: "s3", publishedAt: "2026-10-21T00:00:00.000Z" },
    { tenantId: "tenant-a", assessmentId: "a-math-1", studentId: "s3" },
    // a-math-2: two roster drafts and one for a student who left.
    { tenantId: "tenant-a", assessmentId: "a-math-2", studentId: "s1" },
    { tenantId: "tenant-a", assessmentId: "a-math-2", studentId: "s2" },
    { tenantId: "tenant-a", assessmentId: "a-math-2", studentId: "s4" },
    // a-tr-1: complete and published.
    { tenantId: "tenant-a", assessmentId: "a-tr-1", studentId: "s1", publishedAt: "2026-10-26T00:00:00.000Z" },
    { tenantId: "tenant-a", assessmentId: "a-tr-1", studentId: "s2", publishedAt: "2026-10-26T00:00:00.000Z" },
    { tenantId: "tenant-a", assessmentId: "a-tr-1", studentId: "s3", publishedAt: "2026-10-26T00:00:00.000Z" },
    { tenantId: "tenant-a", assessmentId: "a-past", studentId: "s1" },
    { tenantId: "tenant-a", assessmentId: "a-class-2", studentId: "s8" },
  );
  data.teachers.push(
    { id: "t-class", tenantId: "tenant-a", firstName: "Ayşe", lastName: "Demir", userId: "u-class" },
    { id: "t-math", tenantId: "tenant-a", firstName: "Can", lastName: "Arslan" },
    { id: "t-deleted", tenantId: "tenant-a", firstName: "Eski", lastName: "Öğretmen", deletedAt: "2026-10-01T00:00:00.000Z" },
    { id: "t-ended", tenantId: "tenant-a", firstName: "Biten", lastName: "Üyelik", userId: "u-ended" },
    { id: "t-guidance", tenantId: "tenant-a", firstName: "Rehber", lastName: "Öğretmen" },
  );
  data.memberships.push(
    { tenantId: "tenant-a", userId: "u-class", role: "TEACHER", status: "ACTIVE", startsAt: "2026-01-01T00:00:00.000Z" },
    { tenantId: "tenant-a", userId: "u-ended", role: "TEACHER", status: "ACTIVE", startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2026-10-31T00:00:00.000Z" },
  );
  data.assignments.push(
    { id: "as-class", tenantId: "tenant-a", teacherId: "t-class", classId: "class-1", role: "CLASS_TEACHER" },
    { id: "as-math", tenantId: "tenant-a", teacherId: "t-math", classId: "class-1", courseId: "course-math", termId: "term-current", role: "BRANCH_TEACHER" },
    { id: "as-expired", tenantId: "tenant-a", teacherId: "t-math", classId: "class-1", courseId: "course-tr", role: "BRANCH_TEACHER", endsAt: "2026-10-31" },
    { id: "as-future", tenantId: "tenant-a", teacherId: "t-math", classId: "class-1", courseId: "course-tr", role: "BRANCH_TEACHER", startsAt: "2026-11-03" },
    { id: "as-deleted-teacher", tenantId: "tenant-a", teacherId: "t-deleted", classId: "class-1", role: "BRANCH_TEACHER" },
    { id: "as-ended-membership", tenantId: "tenant-a", teacherId: "t-ended", classId: "class-1", role: "BRANCH_TEACHER" },
    { id: "as-guidance", tenantId: "tenant-a", teacherId: "t-guidance", classId: "class-1", role: "GUIDANCE_COUNSELOR" },
    { id: "as-other-class", tenantId: "tenant-a", teacherId: "t-math", classId: "class-2", role: "BRANCH_TEACHER" },
  );
  return data;
}

function service(data = fixture()) {
  const store = new InMemoryClassOverviewStore(data, () => now);
  return { store, service: new ClassOverviewService(store) };
}

describe("ClassOverviewService (DEC-20261102-04)", () => {
  it("returns roster, roll call, homework and grade-entry counts with the attendance roster rule", async () => {
    const overview = await service().service.get(admin, "class-1", now);

    expect(overview).toMatchObject({
      classId: "class-1",
      date: today,
      rosterCount: 3,
      // The deleted lesson is ignored; the 00:30 Istanbul lesson falls on today.
      rollCall: { state: "PARTIAL", lessonCount: 2, markedCount: 1 },
      homework: { openCount: 1, waitingSubmissionCount: 1 },
      gradeEntry: { assessmentCount: 3, missingEntryAssessmentCount: 1, unpublishedDraftAssessmentCount: 2 },
    });
  });

  it("lists active grade-writer assignments with per-assessment entry status and no scores", async () => {
    const overview = await service().service.get(admin, "class-1", now);

    expect(overview.teacherAssignments.map((assignment) => assignment.assignmentId)).toEqual(["as-math", "as-class"]);
    const [math, classTeacher] = overview.teacherAssignments;
    expect(math).toMatchObject({
      teacherName: "Can Arslan",
      role: "BRANCH_TEACHER",
      courseName: "Matematik",
      assessmentCount: 2,
      missingEntryAssessmentCount: 1,
      unpublishedDraftAssessmentCount: 2,
    });
    expect(math?.assessments).toEqual([
      expect.objectContaining({ assessmentId: "a-math-2", enteredCount: 2, rosterCount: 3, missingEntries: true, hasUnpublishedDraft: true }),
      expect.objectContaining({ assessmentId: "a-math-1", enteredCount: 3, missingEntries: false, hasUnpublishedDraft: true, publishedVersion: 1 }),
    ]);
    expect(math?.assessments[0]).not.toHaveProperty("publishedVersion");
    // A class teacher without a course covers every current-term assessment of the class.
    expect(classTeacher).toMatchObject({ teacherName: "Ayşe Demir", role: "CLASS_TEACHER", assessmentCount: 3 });
    const serialized = JSON.stringify(overview);
    for (const forbidden of ["score", "average", "absent", "a-past", "a-deleted-term", "Eski Öğretmen", "Biten", "Rehber"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("leaves the roll call out on a day without a scheduled lesson", async () => {
    const data = fixture();
    data.lessons.length = 0;
    const overview = await service(data).service.get(admin, "class-1", now);

    expect(overview).not.toHaveProperty("rollCall");
    expect(overview.rosterCount).toBe(3);
  });

  it("reports NOT_TAKEN and TAKEN from roster marks only", async () => {
    const data = fixture();
    data.attendance.length = 0;
    expect((await service(data).service.get(admin, "class-1", now)).rollCall?.state).toBe("NOT_TAKEN");
    for (const studentId of ["s1", "s2", "s3"]) data.attendance.push({ tenantId: "tenant-a", studentId, date: today });
    expect((await service(data).service.get(admin, "class-1", now)).rollCall).toEqual({ state: "TAKEN", lessonCount: 2, markedCount: 3 });
  });

  it("answers 404 for another tenant, a soft-deleted class and an unknown id", async () => {
    const { service: overviews } = service();
    for (const classId of ["class-foreign", "class-deleted", "class-missing"]) {
      await expect(overviews.get(admin, classId, now)).rejects.toMatchObject({ status: 404, message: "CLASS_NOT_FOUND" });
    }
  });

  it("enforces the campus scope and answers 404 outside it", async () => {
    const { service: overviews } = service();
    const campusOne: RequestContext = {
      ...admin,
      roles: ["ASSISTANT_ADMIN"],
      campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-1"] },
    };

    await expect(overviews.get(campusOne, "class-1", now)).resolves.toMatchObject({ classId: "class-1" });
    for (const classId of ["class-2", "class-free"]) {
      await expect(overviews.get(campusOne, classId, now)).rejects.toMatchObject({ status: 404 });
    }
  });

  it("answers 404 to OPERATIONS_STAFF without a campus scope and refuses a missing tenant", async () => {
    const { service: overviews } = service();
    await expect(overviews.get({ ...admin, roles: ["OPERATIONS_STAFF"] }, "class-1", now)).rejects.toMatchObject({ status: 404 });
    await expect(overviews.get({ ...admin, tenantId: null }, "class-1", now)).rejects.toMatchObject({ status: 403 });
    await expect(overviews.get({ ...admin, bypassRls: true }, "class-1", now)).rejects.toMatchObject({ status: 403 });
  });
});

describe("InMemoryClassOverviewStore academic ops", () => {
  it("counts classes without roll call, assessments with missing entries and unpublished drafts per campus scope", async () => {
    const data = fixture();
    data.attendance.length = 0;
    const { store } = service(data);

    // class-1 and class-2 have lessons today and nobody is marked; only a-math-2 misses entries; a-math-1, a-math-2 and
    // a-class-2 carry drafts. The past-term and deleted-term assessments never count.
    await expect(store.loadAcademicOps("tenant-a", today)).resolves.toEqual({
      rollCallMissingClassCount: 2,
      missingGradeEntryAssessmentCount: 1,
      unpublishedDraftAssessmentCount: 3,
    });
    await expect(store.loadAcademicOps("tenant-a", today, ["campus-2"])).resolves.toEqual({
      rollCallMissingClassCount: 1,
      missingGradeEntryAssessmentCount: 0,
      unpublishedDraftAssessmentCount: 1,
    });
    await expect(store.loadAcademicOps("tenant-a", today, [])).resolves.toEqual({
      rollCallMissingClassCount: 0,
      missingGradeEntryAssessmentCount: 0,
      unpublishedDraftAssessmentCount: 0,
    });
    await expect(store.loadAcademicOps("tenant-b", today)).resolves.toEqual({
      rollCallMissingClassCount: 0,
      missingGradeEntryAssessmentCount: 0,
      unpublishedDraftAssessmentCount: 0,
    });
  });
});
