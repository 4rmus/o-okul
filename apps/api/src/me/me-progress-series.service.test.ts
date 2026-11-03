import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import type { GradebookService } from "../gradebook/gradebook.service.js";
import { examResultSummaryReportType, ReportGenerationService, type ReportSnapshotRecord } from "../report/report-generation.service.js";
import { InMemoryReportSnapshotStore } from "../report/report-snapshot-store.js";
import type { SchoolService } from "../school/school.service.js";
import { MeProgressSeriesService } from "./me-progress-series.service.js";

const context: RequestContext = { tenantId: "tenant-a", userId: "student-user-a", roles: ["STUDENT"], bypassRls: false };

function snapshot(record: Partial<ReportSnapshotRecord> & Pick<ReportSnapshotRecord, "id" | "examId">, data: Record<string, unknown>): ReportSnapshotRecord {
  return {
    tenantId: "tenant-a",
    reportType: examResultSummaryReportType,
    status: "READY",
    inputRefs: { resultKeys: [`result-${record.id}`] },
    createdAt: record.generatedAt ?? "2026-10-01T09:00:00.000Z",
    updatedAt: record.generatedAt ?? "2026-10-01T09:00:00.000Z",
    ...record,
    snapshotData: {
      ...data,
      students: [{ studentId: "student-a", total: data.total }],
    },
  };
}

function createService(snapshots: ReportSnapshotRecord[]) {
  const reports = new ReportGenerationService(
    { enqueue: async () => { throw new Error("not used"); } } as never,
    new InMemoryReportSnapshotStore({ snapshots }),
  );
  const gradebook = { listPublishedForStudent: async () => [] } as unknown as GradebookService;
  const school = { listCourses: async () => [] } as unknown as SchoolService;
  return new MeProgressSeriesService(reports, gradebook, school);
}

describe("MeProgressSeriesService", () => {
  it("keeps one exam point per exam, ordered by the frozen exam date, with title and exam date", async () => {
    const total = (successRate: number) => ({ correct: 1, wrong: 0, blank: 0, net: successRate / 10, questionCount: 10, successRate });
    const service = createService([
      // Exam 3 held 27 Oct, generated first.
      snapshot({ id: "s-exam-3", examId: "exam-3", generatedAt: "2026-11-01T09:00:00.000Z" }, { examTitle: "Deneme 3", examStartsAt: "2026-10-27T07:00:00.000Z", total: total(70) }),
      // Exam 1 held 5 Oct: tenant-wide and an 8th-grade level snapshot generated later.
      snapshot({ id: "s-exam-1-level", examId: "exam-1", gradeLevelId: "grade-8", generatedAt: "2026-11-03T10:00:00.000Z" }, { examTitle: "Deneme 1", examStartsAt: "2026-10-05T07:00:00.000Z", total: total(50) }),
      snapshot({ id: "s-exam-1", examId: "exam-1", generatedAt: "2026-11-03T09:00:00.000Z" }, { examTitle: "Deneme 1", examStartsAt: "2026-10-05T07:00:00.000Z", total: total(50) }),
      // Exam 2 held 15 Oct.
      snapshot({ id: "s-exam-2", examId: "exam-2", generatedAt: "2026-11-02T09:00:00.000Z" }, { examTitle: "Deneme 2", examStartsAt: "2026-10-15T07:00:00.000Z", total: total(60) }),
    ]);

    const series = await service.get(context, "student-a");

    expect(series.examSeries.map((point) => [point.snapshotId, point.examId, point.examTitle, point.examStartsAt, point.successRate])).toEqual([
      ["s-exam-1", "exam-1", "Deneme 1", "2026-10-05T07:00:00.000Z", 50],
      ["s-exam-2", "exam-2", "Deneme 2", "2026-10-15T07:00:00.000Z", 60],
      ["s-exam-3", "exam-3", "Deneme 3", "2026-10-27T07:00:00.000Z", 70],
    ]);
    expect(series.examSeries[0]).toMatchObject({ generatedAt: "2026-11-03T09:00:00.000Z", net: 5, questionCount: 10 });
    expect(series.schoolGrades).toEqual([]);
  });

  it("omits the exam title and date when the snapshot did not store them", async () => {
    const service = createService([
      snapshot({ id: "s-legacy", examId: "exam-legacy", generatedAt: "2026-06-01T09:00:00.000Z" }, { total: { net: 3, questionCount: 10, successRate: 30 } }),
    ]);

    const [point] = (await service.get(context, "student-a")).examSeries;

    expect(point).toEqual({ snapshotId: "s-legacy", examId: "exam-legacy", generatedAt: "2026-06-01T09:00:00.000Z", net: 3, questionCount: 10, successRate: 30 });
  });
});
