import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService, InMemoryIdempotencyStore } from "../http/idempotency.js";
import type { StudentService } from "../student/student.service.js";
import type { HomeworkStore } from "./homework-store.js";
import { HomeworkService, type HomeworkRecord, type HomeworkSubmissionRow } from "./homework.service.js";

const studentContext = (id = "a"): RequestContext => ({
  tenantId: "tenant-a", userId: `user-${id}`, roles: ["STUDENT"],
  subjectType: "STUDENT", subjectId: `student-${id}`, bypassRls: false,
});

function fixture() {
  const homework: HomeworkRecord = { id: "homework-a", tenantId: "tenant-a", classId: "class-a", title: "Ödev" };
  const student = { classId: "class-a" as string | undefined };
  const rows = new Map<string, HomeworkSubmissionRow>();
  const markSubmitted = vi.fn(async (input: Omit<HomeworkSubmissionRow, "id">) => {
    const row = rows.get(input.studentId) ?? { ...input, id: `submission-${input.studentId}` };
    rows.set(input.studentId, row);
    return row;
  });
  const findCurrentStudent = vi.fn(async (context: RequestContext) => {
    if (context.subjectType !== "STUDENT" || !context.subjectId) throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    return { ...student, id: context.subjectId, tenantId: context.tenantId };
  });
  const idempotency = new IdempotencyService(new InMemoryIdempotencyStore());
  const service = new HomeworkService(
    undefined!, { findCurrentStudent } as unknown as StudentService,
    { findById: async (id: string) => ({ ...homework, id }), markSubmitted } as unknown as HomeworkStore,
    undefined!, undefined!, undefined!, undefined!, undefined, idempotency,
  );
  return { service, idempotency, homework, student, markSubmitted, findCurrentStudent, rows };
}

describe("student homework submission retries", () => {
  it("replays for the same student and lets a classmate independently use the same key", async () => {
    const { service, markSubmitted, rows } = fixture();
    const first = await service.submitCurrentStudentHomework(studentContext(), "homework-a", "same-key");
    await expect(service.submitCurrentStudentHomework(studentContext(), "homework-a", "same-key")).resolves.toEqual(first);
    const second = await service.submitCurrentStudentHomework(studentContext("b"), "homework-a", "same-key");
    expect(second.studentId).toBe("student-b");
    expect(second).not.toEqual(first);
    expect([...rows.keys()]).toEqual(["student-a", "student-b"]);
    expect(markSubmitted).toHaveBeenCalledTimes(2);
  });

  it.each(["class changed", "no class", "homework moved", "deleted", "tenant changed", "no student persona"])(
    "authorizes again before a completed replay: %s", async (change) => {
      const { service, student, homework, markSubmitted } = fixture();
      const context = studentContext();
      await service.submitCurrentStudentHomework(context, "homework-a", "same-key");
      if (change === "class changed") student.classId = "class-b";
      if (change === "no class") student.classId = undefined;
      if (change === "homework moved") homework.classId = "class-b";
      if (change === "deleted") homework.deletedAt = new Date().toISOString();
      if (change === "tenant changed") homework.tenantId = "tenant-b";
      if (change === "no student persona") context.subjectType = "GUARDIAN";
      await expect(service.submitCurrentStudentHomework(context, "homework-a", "same-key")).rejects.toMatchObject({
        status: ["no student persona", "tenant changed"].includes(change) ? 403 : 404,
      });
      expect(markSubmitted).toHaveBeenCalledTimes(1);
    },
  );

  it("denies a classmate outside the current class before exposing or writing a cached submission", async () => {
    const { service, student, markSubmitted, rows } = fixture();
    await service.submitCurrentStudentHomework(studentContext(), "homework-a", "same-key");
    student.classId = "class-b";
    await expect(service.submitCurrentStudentHomework(studentContext("b"), "homework-a", "same-key")).rejects.toMatchObject({ status: 404 });
    expect([...rows.keys()]).toEqual(["student-a"]);
    expect(markSubmitted).toHaveBeenCalledTimes(1);
  });

  it("preserves a completed legacy retry only for its authenticated student and homework", async () => {
    const { service, idempotency, markSubmitted } = fixture();
    const legacy = { homeworkId: "homework-a", studentId: "student-a", status: "SUBMITTED", submittedAt: "2026-11-01T12:00:00.000Z" };
    await idempotency.run(studentContext(), {
      key: "legacy-key", operation: "homework.submission.submit", request: { homeworkId: "homework-a" },
    }, async () => legacy);
    await expect(service.submitCurrentStudentHomework(studentContext(), "homework-a", "legacy-key")).resolves.toEqual(legacy);
    await expect(service.submitCurrentStudentHomework(studentContext("b"), "homework-a", "legacy-key")).resolves.toMatchObject({ studentId: "student-b" });
    expect(markSubmitted).toHaveBeenCalledTimes(1);
  });

  it("never replays legacy data after class access is revoked or with a forged response identity", async () => {
    const { service, idempotency, student, markSubmitted } = fixture();
    await idempotency.run(studentContext(), {
      key: "legacy-key", operation: "homework.submission.submit", request: { homeworkId: "homework-a" },
    }, async () => ({ homeworkId: "other-homework", studentId: "student-a", status: "SUBMITTED" }));
    await expect(service.submitCurrentStudentHomework(studentContext(), "homework-a", "legacy-key")).resolves.toMatchObject({ homeworkId: "homework-a" });
    student.classId = "class-b";
    await expect(service.submitCurrentStudentHomework(studentContext(), "homework-a", "legacy-key")).rejects.toMatchObject({ status: 404 });
    expect(markSubmitted).toHaveBeenCalledTimes(1);
  });

  it("keeps original key validation and rejects changed homework bodies within the student scope", async () => {
    const { service } = fixture();
    await expect(service.submitCurrentStudentHomework(studentContext(), "homework-a", "bad key")).rejects.toMatchObject({ status: 400 });
    await service.submitCurrentStudentHomework(studentContext(), "homework-a", "same-key");
    await expect(service.submitCurrentStudentHomework(studentContext(), "other-homework", "same-key")).rejects.toMatchObject({ status: 409 });
  });

  it("treats a blank key as an unkeyed submission", async () => {
    const { service, markSubmitted } = fixture();
    await service.submitCurrentStudentHomework(studentContext(), "homework-a", "  ");
    await service.submitCurrentStudentHomework(studentContext(), "homework-a", "  ");
    expect(markSubmitted).toHaveBeenCalledTimes(2);
  });
});
