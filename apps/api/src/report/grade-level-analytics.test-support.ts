import type { ReportSnapshotRecord } from "./report-generation.service.js";
import type { InMemoryGradeLevelAnalyticsExam, InMemoryReportSnapshotStoreOptions } from "./report-snapshot-store.js";

// DEC-20261102-08 (G3) fixtures: grade-8 level snapshots next to class/campus/course snapshots, a DRAFT exam, another
// grade level, a deleted snapshot, a STALE snapshot and a second tenant, so every exclusion rule has a witness.
export function createGradeLevelAnalyticsFixtures(
  extra: { extraExams?: InMemoryGradeLevelAnalyticsExam[]; extraSnapshots?: ReportSnapshotRecord[] } = {},
): InMemoryReportSnapshotStoreOptions {
  return {
    exams: [
      gradeLevelAnalyticsExam("exam-lgs-1", "LGS Deneme 1", { examType: "LGS", startsAt: "2026-09-10T07:00:00.000Z" }),
      gradeLevelAnalyticsExam("exam-lgs-2", "LGS Deneme 2", { examType: "LGS", startsAt: "2026-10-10T07:00:00.000Z" }),
      gradeLevelAnalyticsExam("exam-lgs-3", "LGS Deneme 3", { examType: "LGS", startsAt: "2026-11-01T07:00:00.000Z" }),
      gradeLevelAnalyticsExam("exam-tyt-1", "TYT Deneme 1", { examType: "TYT", startsAt: "2026-09-15T07:00:00.000Z" }),
      gradeLevelAnalyticsExam("exam-lgs-no-level", "LGS Deneme Sınıf Raporlu", { examType: "LGS", startsAt: "2026-10-20T07:00:00.000Z" }),
      gradeLevelAnalyticsExam("exam-draft", "Taslak Deneme", { examType: "LGS", status: "DRAFT", startsAt: "2026-10-05T07:00:00.000Z" }),
      gradeLevelAnalyticsExam("exam-grade-7", "7. Sınıf Denemesi", { examType: "LGS", gradeLevelId: "grade-7", startsAt: "2026-10-06T07:00:00.000Z" }),
      gradeLevelAnalyticsExam("exam-deleted-snapshot", "Silinmiş Rapor", { examType: "LGS", gradeLevelId: "grade-7", startsAt: "2026-10-07T07:00:00.000Z" }),
      { ...gradeLevelAnalyticsExam("exam-b", "Diğer Kurum Denemesi", { examType: "LGS", startsAt: "2026-10-08T07:00:00.000Z" }), tenantId: "tenant-b" },
      ...(extra.extraExams ?? []),
    ],
    terms: [
      { id: "term-fall", tenantId: "tenant-a", startsAt: "2026-09-01", endsAt: "2026-09-30" },
    ],
    snapshots: [
      gradeLevelAnalyticsSnapshot("level-lgs-1", "exam-lgs-1", { averages: { net: 55.35, questionCount: 90, successRate: 61.5 }, resultCount: 40 }),
      gradeLevelAnalyticsSnapshot("level-lgs-2", "exam-lgs-2", {
        averages: { net: 57.8, questionCount: 90, successRate: 64.25 },
        resultCount: 38,
        generatedAt: "2026-10-11T09:00:00.000Z",
      }),
      gradeLevelAnalyticsSnapshot("level-lgs-3-stale", "exam-lgs-3", { status: "STALE", staleAt: "2026-11-02T08:00:00.000Z" }),
      gradeLevelAnalyticsSnapshot("level-tyt-1", "exam-tyt-1", { averages: { net: 70, questionCount: 120, successRate: 58.33 }, resultCount: 25 }),
      gradeLevelAnalyticsSnapshot("class-lgs-1", "exam-lgs-no-level", { classId: "class-8a" }),
      gradeLevelAnalyticsSnapshot("campus-lgs-1", "exam-lgs-no-level", { campusId: "campus-main" }),
      gradeLevelAnalyticsSnapshot("course-lgs-1", "exam-lgs-no-level", { courseId: "course-math" }),
      gradeLevelAnalyticsSnapshot("level-draft", "exam-draft"),
      gradeLevelAnalyticsSnapshot("level-grade-7", "exam-grade-7", { gradeLevelId: "grade-7" }),
      gradeLevelAnalyticsSnapshot("level-deleted", "exam-deleted-snapshot", { deletedAt: "2026-10-08T00:00:00.000Z" }),
      { ...gradeLevelAnalyticsSnapshot("level-tenant-b", "exam-b"), tenantId: "tenant-b" },
      ...(extra.extraSnapshots ?? []),
    ],
  };
}

/**
 * Term-boundary witnesses on grade-6 (kept apart from the grade-8/grade-7 assertions). term-fall is 2026-09-01..09-30
 * on the Türkiye calendar: 2026-08-31T21:30Z is 2026-09-01 00:30 in Istanbul (inside the term, the UTC day is outside)
 * and 2026-09-30T21:30Z is 2026-10-01 00:30 in Istanbul (outside the term, the UTC day is inside).
 */
export function gradeLevelAnalyticsTermBoundaryExtras(): {
  extraExams: InMemoryGradeLevelAnalyticsExam[];
  extraSnapshots: ReportSnapshotRecord[];
} {
  const gradeLevelId = "grade-6";
  return {
    extraExams: [
      gradeLevelAnalyticsExam("exam-boundary-start", "Dönem İlk Gecesi Denemesi", { examType: "LGS", gradeLevelId, startsAt: "2026-08-31T21:30:00.000Z" }),
      gradeLevelAnalyticsExam("exam-boundary-end", "Dönem Sonrası Gece Denemesi", { examType: "LGS", gradeLevelId, startsAt: "2026-09-30T21:30:00.000Z" }),
      gradeLevelAnalyticsExam("exam-boundary-no-level", "Dönem İlk Gecesi Sınıf Raporlu", { examType: "LGS", gradeLevelId, startsAt: "2026-08-31T22:00:00.000Z" }),
    ],
    extraSnapshots: [
      gradeLevelAnalyticsSnapshot("level-boundary-start", "exam-boundary-start", {
        gradeLevelId,
        examStartsAt: "2026-08-31T21:30:00.000Z",
        examType: "LGS",
        examYear: 2026,
        scoringProfileId: "TR-LGS-2026-NOSD-V1",
      }),
      gradeLevelAnalyticsSnapshot("level-boundary-end", "exam-boundary-end", { gradeLevelId }),
    ],
  };
}

export function gradeLevelAnalyticsExam(
  id: string,
  title: string,
  options: Partial<Omit<InMemoryGradeLevelAnalyticsExam, "id" | "title">> = {},
): InMemoryGradeLevelAnalyticsExam {
  return { tenantId: "tenant-a", status: "PUBLISHED", gradeLevelId: "grade-8", ...options, id, title };
}

export function gradeLevelAnalyticsSnapshot(
  id: string,
  examId: string,
  options: Partial<ReportSnapshotRecord> & {
    averages?: Record<string, number>;
    examStartsAt?: string;
    examType?: string;
    examYear?: number;
    scoringProfileId?: string;
    resultCount?: number;
  } = {},
): ReportSnapshotRecord {
  const { averages = { net: 50, questionCount: 90, successRate: 55.56 }, examStartsAt, examType, examYear, scoringProfileId, resultCount = 10, ...record } = options;
  return {
    id,
    tenantId: "tenant-a",
    examId,
    gradeLevelId: "grade-8",
    reportType: "EXAM_RESULT_SUMMARY",
    status: "READY",
    inputRefs: { resultKeys: [`${id}-result`] },
    snapshotData: {
      reportType: "EXAM_RESULT_SUMMARY",
      ...(examStartsAt ? { examStartsAt } : {}),
      ...(examType ? { examType } : {}),
      ...(examYear !== undefined ? { examYear } : {}),
      ...(scoringProfileId ? { scoringProfileId } : {}),
      resultCount,
      averages,
      students: [{ studentId: "student-a", displayName: "Ada A", total: { net: 1 } }],
    },
    generatedAt: "2026-09-11T09:00:00.000Z",
    createdAt: "2026-09-11T09:00:00.000Z",
    updatedAt: "2026-09-11T09:00:00.000Z",
    ...record,
  };
}
