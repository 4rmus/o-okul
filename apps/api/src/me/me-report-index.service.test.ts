import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import type { ReportSnapshotRecord } from "../report/report-generation.service.js";
import { MeReportIndexService } from "./me-report-index.service.js";

describe("MeReportIndexService", () => {
  it("öğrenci için yalnız READY ve öğrenciye ait en güncel raporları döndürür", async () => {
    const service = new MeReportIndexService(
      {
        list: async () => [
          exam("exam-old", "Eski Deneme", "2026-05-01T09:00:00.000Z"),
          exam("exam-new", "Yeni Deneme", "2026-06-01T09:00:00.000Z"),
        ],
      } as never,
      {
        listByTenant: async () => [
          snapshot("snapshot-old", "exam-old", "READY", "2026-06-01T10:00:00.000Z", ["student-a"]),
          snapshot("snapshot-newer", "exam-old", "READY", "2026-06-02T10:00:00.000Z", ["student-a"]),
          snapshot("snapshot-other", "exam-new", "READY", "2026-06-03T10:00:00.000Z", ["student-b"]),
          snapshot("snapshot-failed", "exam-new", "FAILED", "2026-06-04T10:00:00.000Z", ["student-a"]),
        ],
      } as never,
      {} as never,
      {} as never,
    );

    await expect(service.listForStudent(studentContext, "student-a")).resolves.toEqual([
      {
        examId: "exam-old",
        title: "Eski Deneme",
        startsAt: "2026-05-01T09:00:00.000Z",
        latestReadySnapshotId: "snapshot-newer",
        latestGeneratedAt: "2026-06-02T10:00:00.000Z",
      },
    ]);
  });

  it("öğretmen için scope sonrası öğrencisi kalan READY raporları döndürür", async () => {
    let examListCalls = 0;
    let snapshotListCalls = 0;
    let studentListCalls = 0;
    let assignmentListCalls = 0;
    const service = new MeReportIndexService(
      {
        list: async () => {
          examListCalls += 1;
          return [exam("exam-a", "Kapsamlı Deneme"), exam("exam-b", "Kapsam Dışı Deneme")];
        },
      } as never,
      {
        listByTenant: async () => {
          snapshotListCalls += 1;
          return [
            snapshot("snapshot-ready", "exam-a", "READY", "2026-06-05T10:00:00.000Z", ["student-a"], { courseId: "course-math", termId: "term-a" }),
            snapshot("snapshot-course-mismatch", "exam-b", "READY", "2026-06-06T10:00:00.000Z", ["student-a"], { courseId: "course-turkish", termId: "term-a" }),
            snapshot("snapshot-other-student", "exam-b", "READY", "2026-06-07T10:00:00.000Z", ["student-b"]),
          ];
        },
      } as never,
      {
        list: async () => {
          studentListCalls += 1;
          return [{ id: "student-a", tenantId: "tenant-a", firstName: "Ada", lastName: "A", classId: "class-a", status: "ACTIVE" }];
        },
      } as never,
      {
        listByTeacher: async () => {
          assignmentListCalls += 1;
          return [{ id: "assignment-a", tenantId: "tenant-a", teacherId: "teacher-a", classId: "class-a", courseId: "course-math", termId: "term-a", role: "BRANCH_TEACHER" }];
        },
      } as never,
    );

    await expect(service.listForTeacher(teacherContext)).resolves.toEqual([
      {
        examId: "exam-a",
        title: "Kapsamlı Deneme",
        latestReadySnapshotId: "snapshot-ready",
        latestGeneratedAt: "2026-06-05T10:00:00.000Z",
      },
    ]);
    expect({ examListCalls, snapshotListCalls, studentListCalls, assignmentListCalls }).toEqual({
      examListCalls: 1,
      snapshotListCalls: 1,
      studentListCalls: 1,
      assignmentListCalls: 1,
    });
  });
});

function exam(id: string, title: string, startsAt?: string) {
  return { id, tenantId: "tenant-a", title, status: "PUBLISHED", ...(startsAt ? { startsAt } : {}), createdAt: startsAt ?? "2026-01-01T00:00:00.000Z", updatedAt: startsAt ?? "2026-01-01T00:00:00.000Z" };
}

function snapshot(
  id: string,
  examId: string,
  status: string,
  generatedAt: string,
  studentIds: string[],
  context: Pick<ReportSnapshotRecord, "courseId" | "termId"> = {},
): ReportSnapshotRecord {
  return {
    id,
    tenantId: "tenant-a",
    examId,
    ...context,
    reportType: "EXAM_RESULT_SUMMARY",
    status,
    inputRefs: {},
    snapshotData: {
      generatedAt,
      students: studentIds.map((studentId) => ({ studentId, resultKey: `${id}:${studentId}` })),
    },
    generatedAt,
    createdAt: generatedAt,
    updatedAt: generatedAt,
  };
}

const studentContext: RequestContext = {
  userId: "student-user-a",
  tenantId: "tenant-a",
  roles: ["STUDENT"],
  bypassRls: false,
  subjectType: "STUDENT",
  subjectId: "student-a",
};

const teacherContext: RequestContext = {
  userId: "teacher-user-a",
  tenantId: "tenant-a",
  roles: ["TEACHER"],
  bypassRls: false,
  subjectType: "TEACHER",
  subjectId: "teacher-a",
};
