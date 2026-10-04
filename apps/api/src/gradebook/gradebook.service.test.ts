import type { TeacherAssignmentRecord } from "@o-okul/shared-types";
import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService, InMemoryIdempotencyStore } from "../http/idempotency.js";
import { InMemoryAcademicCalendarStore } from "../school/academic-calendar-store.js";
import { InMemoryClassStore } from "../school/class-store.js";
import { InMemoryCourseStore } from "../school/course-store.js";
import type { TeacherAssignmentStore } from "../school/teacher-assignment-store.js";
import { InMemoryStudentStore } from "../student/student-store.js";
import { InMemoryGradebookStore } from "./gradebook-store.js";
import { GradebookService } from "./gradebook.service.js";

const admin: RequestContext = { userId: "admin-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], activePersona: "STAFF", bypassRls: false };
const teacher = (subjectId: string): RequestContext => ({
  userId: `user-${subjectId}`, tenantId: "tenant-a", roles: ["TEACHER"], activePersona: "TEACHER", subjectType: "TEACHER", subjectId, bypassRls: false,
});
const assignment = (teacherId: string, role: TeacherAssignmentRecord["role"], extra: Partial<TeacherAssignmentRecord> = {}): TeacherAssignmentRecord => ({
  id: `assignment-${teacherId}`, tenantId: "tenant-a", teacherId, classId: "class-a", termId: "term-2026-spring", role, ...extra,
});

function setup() {
  const assignments: TeacherAssignmentRecord[] = [
    assignment("teacher-math", "BRANCH_TEACHER", { courseId: "course-math" }),
    assignment("teacher-other-course", "BRANCH_TEACHER", { courseId: "course-other" }),
    assignment("teacher-counsellor", "GUIDANCE_COUNSELOR"),
  ];
  const teacherAssignments = { listByTeacher: async (id: string) => assignments.filter((item) => item.teacherId === id) } as unknown as TeacherAssignmentStore;
  const audit = { record: vi.fn(async (_entry: { action: string }) => undefined) };
  const service = new GradebookService(
    new InMemoryGradebookStore(),
    new InMemoryClassStore(),
    new InMemoryCourseStore(),
    new InMemoryAcademicCalendarStore(),
    new InMemoryStudentStore(),
    teacherAssignments,
    new IdempotencyService(new InMemoryIdempotencyStore()),
    audit as never,
  );
  return { service, audit };
}

async function createAssessment(service: GradebookService) {
  return service.createAssessment(admin, {
    classId: "class-a", courseId: "course-math", termId: "term-2026-spring", kind: "WRITTEN", title: "1. Yazılı", heldOn: "2026-03-10",
  });
}

describe("GradebookService", () => {
  it("assigned branch teacher enters, admin publishes once per key, correction becomes v2 and v1 stays", async () => {
    const { service, audit } = setup();
    const assessment = await createAssessment(service);

    await service.saveEntries(teacher("teacher-math"), assessment.id, { entries: [{ studentId: "student-a", score: 72.3, absent: false }] });
    const first = await service.publish(admin, assessment.id, "publish-key-1");
    const replay = await service.publish(admin, assessment.id, "publish-key-1");
    expect(first).toMatchObject({ publishedCount: 1, assessment: { publishedVersion: 1 } });
    expect(replay).toEqual(first);

    await service.saveEntries(teacher("teacher-math"), assessment.id, { entries: [{ studentId: "student-a", score: 75, absent: false }] });
    await service.publish(admin, assessment.id, "publish-key-2");
    const detail = await service.getAssessment(admin, assessment.id);

    expect(detail.assessment.publishedVersion).toBe(2);
    expect(detail.entries.map(({ version, score, publishedAt }) => ({ version, score, published: Boolean(publishedAt) }))).toEqual([
      { version: 1, score: 72.3, published: true },
      { version: 2, score: 75, published: true },
    ]);
    expect(audit.record.mock.calls.filter(([entry]) => entry.action === "grade_assessment.published")).toHaveLength(2);
  });

  it("publish without Idempotency-Key is 400 and nothing to publish is 409", async () => {
    const { service } = setup();
    const assessment = await createAssessment(service);
    await expect(service.publish(admin, assessment.id)).rejects.toMatchObject({ response: { message: "IDEMPOTENCY_KEY_REQUIRED" }, status: 400 });
    await expect(service.publish(admin, assessment.id, "empty-key")).rejects.toMatchObject({ status: 409 });
  });

  it.each([
    ["unassigned teacher", "teacher-nobody", "TEACHER_ASSIGNMENT_SCOPE_REQUIRED|FORBIDDEN_TEACHER_ASSIGNMENT_SCOPE"],
    ["teacher of another course in the same class", "teacher-other-course", "FORBIDDEN_TEACHER_ASSIGNMENT_SCOPE"],
    ["guidance counsellor of the class", "teacher-counsellor", "FORBIDDEN_TEACHER_ASSIGNMENT_SCOPE"],
  ])("%s gets 403 on entry", async (_name, teacherId, code) => {
    const { service } = setup();
    const assessment = await createAssessment(service);
    await expect(service.saveEntries(teacher(teacherId), assessment.id, { entries: [{ studentId: "student-a", score: 50, absent: false }] }))
      .rejects.toMatchObject({ status: 403, message: expect.stringMatching(new RegExp(code)) });
  });

  it("teacher lists only assessments of assigned class and course", async () => {
    const { service } = setup();
    const assessment = await createAssessment(service);
    await expect(service.listAssessments(teacher("teacher-math"), {})).resolves.toEqual([expect.objectContaining({ id: assessment.id })]);
    await expect(service.listAssessments(teacher("teacher-other-course"), {})).resolves.toEqual([]);
    await expect(service.getAssessment(teacher("teacher-other-course"), assessment.id)).rejects.toMatchObject({ status: 403 });
  });

  it("campus-scoped staff cannot see another campus's assessment", async () => {
    const { service } = setup();
    const assessment = await createAssessment(service);
    const otherCampus: RequestContext = {
      ...admin, userId: "ops-a", roles: ["OPERATIONS_STAFF"], campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-other"] },
    };
    await expect(service.listAssessments(otherCampus, {})).resolves.toEqual([]);
    await expect(service.getAssessment(otherCampus, assessment.id)).rejects.toMatchObject({ status: 404 });
  });

  it("rejects out-of-range, over-precise, absent-with-score, duplicate and out-of-class entries", async () => {
    const { service } = setup();
    const assessment = await createAssessment(service);
    const save = (entries: Array<{ studentId: string; score: number | null; absent: boolean }>) => service.saveEntries(admin, assessment.id, { entries });
    await expect(save([{ studentId: "student-a", score: 101, absent: false }])).rejects.toMatchObject({ response: { message: "GRADE_ENTRY_SCORE_OUT_OF_RANGE" } });
    await expect(save([{ studentId: "student-a", score: 50.125, absent: false }])).rejects.toMatchObject({ response: { message: "GRADE_ENTRY_SCORE_INVALID" } });
    await expect(save([{ studentId: "student-a", score: 10, absent: true }])).rejects.toMatchObject({ response: { message: "GRADE_ENTRY_SCORE_INVALID" } });
    await expect(save([{ studentId: "student-a", score: 1, absent: false }, { studentId: "student-a", score: 2, absent: false }]))
      .rejects.toMatchObject({ response: { message: "GRADE_ENTRY_STUDENT_DUPLICATE" } });
    await expect(save([{ studentId: "student-b", score: 1, absent: false }])).rejects.toMatchObject({ response: { message: "GRADE_ENTRY_STUDENT_NOT_IN_CLASS" } });
    await expect(save([{ studentId: "student-a", score: null, absent: true }])).resolves.toEqual([expect.objectContaining({ absent: true, score: null })]);
  });
});
