import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { getJobContext } from "../context/job-context.js";
import { createJobId, type QueueJob } from "../queue/queues.js";
import {
  createExamResultSummarySnapshot,
  createReportIdentityFingerprint,
  createReportSnapshotContentHash,
  examResultSummaryReportType,
  type ExamResultForReport,
  type ReportGenerationJobAdapter,
  type ReportGenerationJobPayload,
  type ReportGenerationJobResult,
  processReportGenerationJob,
} from "./report-generation-job.js";
import type { ScoringResult } from "./scoring-engine.js";

describe("report generation job", () => {
  const payload: ReportGenerationJobPayload = {
    tenantId: "tenant-a",
    userId: "user-a",
    entityId: "exam-a",
    contentHash: "results-v1",
    reportType: examResultSummaryReportType,
    campusId: "campus-main",
    gradeLevelId: "grade-8",
    classId: "class-a",
    courseId: "course-math",
    termId: "term-2026-spring",
  };

  it("ExamResult girdilerinden READY ReportSnapshot üretir", async () => {
    const adapter = createAdapter();
    const job = createJob(payload);

    const result = await processReportGenerationJob(
      job,
      adapter,
      () => "2026-05-30T08:00:00.000Z",
    );

    expect(adapter.loadInputs).toEqual([{
      tenantId: "tenant-a",
      userId: "user-a",
      jobId: createJobId(payload.entityId, payload.contentHash),
      examId: "exam-a",
      reportType: examResultSummaryReportType,
      contentHash: "results-v1",
      campusId: "campus-main",
      gradeLevelId: "grade-8",
      classId: "class-a",
      courseId: "course-math",
      termId: "term-2026-spring",
    }]);
    expect(result).toEqual({
      id: "snapshot-a",
      tenantId: "tenant-a",
      examId: "exam-a",
      contentHash: createReportSnapshotContentHash(
        "results-v1",
        {
          resultKeys: ["result-a", "result-b"],
          answerKeyVersions: ["answer-key-v1"],
          parserConfigVersions: ["parser-v1"],
          engineVersions: ["engine-v1"],
        },
        createReportIdentityFingerprint([createResult("student-a", "result-a"), createResult("student-b", "result-b")]),
      ),
      campusId: "campus-main",
      gradeLevelId: "grade-8",
      classId: "class-a",
      courseId: "course-math",
      termId: "term-2026-spring",
      reportType: examResultSummaryReportType,
      status: "READY",
      inputRefs: {
        resultKeys: ["result-a", "result-b"],
        answerKeyVersions: ["answer-key-v1"],
        parserConfigVersions: ["parser-v1"],
        engineVersions: ["engine-v1"],
        generationContentHash: "results-v1",
      },
      snapshotData: {
        reportType: examResultSummaryReportType,
        generatedAt: "2026-05-30T08:00:00.000Z",
        resultCount: 2,
        averages: {
          correct: 8,
          wrong: 1.5,
          blank: 0.5,
          net: 7.625,
          questionCount: 10,
          rawScore: 7.625,
          standardScore: 7.625,
          successRate: 76.25,
        },
        branches: [
          { branch: "Matematik", resultCount: 2, correct: 4, wrong: 1, blank: 0, net: 3.75, questionCount: 5, successRate: 75 },
          { branch: "Türkçe", resultCount: 2, correct: 4, wrong: 0.5, blank: 0.5, net: 3.875, questionCount: 5, successRate: 77.5 },
        ],
        classes: [
          {
            classId: "class-a",
            className: "8-A",
            resultCount: 1,
            averages: {
              correct: 8,
              wrong: 1,
              blank: 1,
              net: 7.75,
              questionCount: 10,
              rawScore: 7.75,
              standardScore: 7.75,
              successRate: 77.5,
            },
            branches: [
              { branch: "Matematik", resultCount: 1, correct: 4, wrong: 1, blank: 0, net: 3.75, questionCount: 5, successRate: 75 },
              { branch: "Türkçe", resultCount: 1, correct: 4, wrong: 0, blank: 1, net: 4, questionCount: 5, successRate: 80 },
            ],
          },
          {
            classId: "class-b",
            className: "8-B",
            resultCount: 1,
            averages: {
              correct: 8,
              wrong: 2,
              blank: 0,
              net: 7.5,
              questionCount: 10,
              rawScore: 7.5,
              standardScore: 7.5,
              successRate: 75,
            },
            branches: [
              { branch: "Matematik", resultCount: 1, correct: 4, wrong: 1, blank: 0, net: 3.75, questionCount: 5, successRate: 75 },
              { branch: "Türkçe", resultCount: 1, correct: 4, wrong: 1, blank: 0, net: 3.75, questionCount: 5, successRate: 75 },
            ],
          },
        ],
        statistics: {
          count: 2,
          total: { meanNet: 7.625, sdNet: 0.125, meanRawScore: 7.625, sdRawScore: 0.125 },
          branches: [
            { branch: "Matematik", count: 2, meanNet: 3.75, sdNet: 0 },
            { branch: "Türkçe", count: 2, meanNet: 3.875, sdNet: 0.125 },
          ],
          standardScore: { mean: 50, sd: 10 },
          version: "2026.06.cohort-v1",
        },
        students: [
          {
            studentId: "student-a",
            classId: "class-a",
            className: "8-A",
            resultKey: "result-a",
            total: withMetrics(createScore(8, 1, 1).total),
            branches: createScore(8, 1, 1).branches.map(withMetrics),
            questions: createScore(8, 1, 1).questions,
            statistics: {
              standardScore: 60,
              general: { rank: 1, outOf: 2, percentile: 75 },
              class: { rank: 1, outOf: 1, percentile: 50 },
              branches: [
                { branch: "Matematik", standardScore: 50, general: { rank: 1, outOf: 2, percentile: 50 }, class: { rank: 1, outOf: 1, percentile: 50 } },
                { branch: "Türkçe", standardScore: 60, general: { rank: 1, outOf: 2, percentile: 75 }, class: { rank: 1, outOf: 1, percentile: 50 } },
              ],
            },
          },
          {
            studentId: "student-b",
            classId: "class-b",
            className: "8-B",
            resultKey: "result-b",
            total: withMetrics(createScore(8, 2, 0).total),
            branches: createScore(8, 2, 0).branches.map(withMetrics),
            questions: createScore(8, 2, 0).questions,
            statistics: {
              standardScore: 40,
              general: { rank: 2, outOf: 2, percentile: 25 },
              class: { rank: 1, outOf: 1, percentile: 50 },
              branches: [
                { branch: "Matematik", standardScore: 50, general: { rank: 1, outOf: 2, percentile: 50 }, class: { rank: 1, outOf: 1, percentile: 50 } },
                { branch: "Türkçe", standardScore: 40, general: { rank: 2, outOf: 2, percentile: 25 }, class: { rank: 1, outOf: 1, percentile: 50 } },
              ],
            },
          },
        ],
      },
      generatedAt: "2026-05-30T08:00:00.000Z",
    });
    expect(adapter.savedSnapshots).toEqual([result]);
    expect(() => getJobContext()).toThrow("JOB_CONTEXT_MISSING");
  });

  it("boş sonuçla snapshot üretmez", () => {
    expect(() => createExamResultSummarySnapshot(
      { tenantId: "tenant-a", examId: "exam-a", reportType: examResultSummaryReportType, contentHash: "results-v1" },
      [],
      "2026-05-30T08:00:00.000Z",
    )).toThrow("REPORT_INPUT_EMPTY");
  });

  it("gerçek sonuç sürümü değişince yeni snapshot kimliği üretir", () => {
    const first = createExamResultSummarySnapshot(
      { tenantId: "tenant-a", examId: "exam-a", reportType: examResultSummaryReportType, contentHash: "request-hash" },
      [createResult("student-a", "result-a")],
      "2026-05-30T08:00:00.000Z",
    );
    const changed = createExamResultSummarySnapshot(
      { tenantId: "tenant-a", examId: "exam-a", reportType: examResultSummaryReportType, contentHash: "request-hash" },
      [createResult("student-a", "result-b")],
      "2026-05-30T08:05:00.000Z",
    );

    expect(changed.contentHash).not.toBe(first.contentHash);
  });

  it("öğrencinin rapor anındaki görünen adı ve numarasını snapshot içinde dondurur", () => {
    const snapshot = createExamResultSummarySnapshot(
      { tenantId: "tenant-a", examId: "exam-a", reportType: examResultSummaryReportType, contentHash: "request-hash" },
      [{ ...createResult("student-a", "result-a"), displayName: "Ada Ak", studentNo: "1001" }],
      "2026-05-30T08:00:00.000Z",
    );

    expect(snapshot.snapshotData.students[0]).toMatchObject({
      studentId: "student-a",
      displayName: "Ada Ak",
      studentNo: "1001",
    });
  });

  it("kimlik değişikliğini snapshot hashine katar, normalize edilmiş eşdeğeri tekilleştirir", () => {
    const input = { tenantId: "tenant-a", examId: "exam-a", reportType: examResultSummaryReportType, contentHash: "request-hash" } as const;
    const base = createResult("student-a", "result-a");
    const first = createExamResultSummarySnapshot(
      input,
      [{ ...base, displayName: "Ada Ak", studentNo: "ab 1001" }],
      "2026-05-30T08:00:00.000Z",
    );
    const normalizedEquivalent = createExamResultSummarySnapshot(
      input,
      [{ ...base, displayName: "  ADA   AK ", studentNo: " AB 1001 " }],
      "2026-05-30T08:01:00.000Z",
    );
    const changed = createExamResultSummarySnapshot(
      input,
      [{ ...base, displayName: "Ada Yeni", studentNo: "1002" }],
      "2026-05-30T08:02:00.000Z",
    );

    expect(normalizedEquivalent.contentHash).toBe(first.contentHash);
    expect(changed.contentHash).not.toBe(first.contentHash);
    expect(first.inputRefs).not.toHaveProperty("identityFingerprint");
    expect(first.inputRefs).not.toHaveProperty("displayName");
    expect(first.inputRefs).not.toHaveProperty("studentNo");
  });

  it("kazanım kırılımını snapshot ve öğrenci satırına taşır", () => {
    const snapshot = createExamResultSummarySnapshot(
      { tenantId: "tenant-a", examId: "exam-a", reportType: examResultSummaryReportType, contentHash: "results-v1" },
      [
        {
          studentId: "student-a",
          classId: "class-a",
          className: "8-A",
          resultKey: "result-a",
          answerKeyVersion: "answer-key-v1",
          parserConfigVersion: "parser-v1",
          engineVersion: "engine-v1",
          score: createScoreWithOutcomes(),
          computedAt: "2026-05-30T07:00:00.000Z",
        },
      ],
      "2026-05-30T08:00:00.000Z",
    );

    expect(snapshot.snapshotData.outcomes).toEqual([
      { outcomeCode: "MAT.8.1.1", branch: "Matematik", resultCount: 1, correct: 1, wrong: 1, blank: 0, net: 0.75, questionCount: 2, successRate: 37.5 },
      { outcomeCode: "TUR.8.2.1", branch: "Türkçe", resultCount: 1, correct: 0, wrong: 0, blank: 1, net: 0, questionCount: 1, successRate: 0 },
    ]);
    expect(snapshot.snapshotData.students[0]?.outcomes).toEqual(createScoreWithOutcomes().outcomes?.map(withMetrics));
    expect(snapshot.snapshotData.students[0]?.questions[0]).toMatchObject({ outcomeCode: "MAT.8.1.1" });
  });

  it("10.000 öğrenci için snapshot özetini makul sürede üretir", () => {
    const results = Array.from({ length: 10_000 }, (_value, index) => createLargeResult(index));

    const startedAt = performance.now();
    const snapshot = createExamResultSummarySnapshot(
      { tenantId: "tenant-a", examId: "exam-large", reportType: examResultSummaryReportType, contentHash: "results-large" },
      results,
      "2026-05-30T08:00:00.000Z",
    );
    const durationMs = performance.now() - startedAt;

    expect(snapshot.snapshotData.resultCount).toBe(10_000);
    expect(snapshot.snapshotData.students).toHaveLength(10_000);
    expect(snapshot.snapshotData.classes).toHaveLength(20);
    expect(snapshot.snapshotData.branches).toHaveLength(2);
    expect(snapshot.inputRefs.resultKeys).toHaveLength(10_000);
    expect(snapshot.snapshotData.students[0]?.studentId).toBe("student-00000");
    expect(snapshot.snapshotData.students[9_999]?.studentId).toBe("student-09999");
    expect(durationMs).toBeLessThan(2_000);
  });

  it("job adı report-generation değilse adapter çağırmadan reddeder", async () => {
    const adapter = createAdapter();
    const job = {
      id: "bad-job",
      name: "exam-evaluation",
      payload,
    } as QueueJob<ReportGenerationJobPayload>;

    await expect(processReportGenerationJob(job, adapter)).rejects.toThrow("REPORT_GENERATION_JOB_NAME_INVALID");
    expect(adapter.loadInputs).toHaveLength(0);
    expect(adapter.savedSnapshots).toHaveLength(0);
  });

  it("reportType eksikse adapter çağırmadan reddeder", async () => {
    const adapter = createAdapter();
    const job = createJob({ ...payload, reportType: "" as ReportGenerationJobPayload["reportType"] });

    await expect(processReportGenerationJob(job, adapter)).rejects.toThrow("REPORT_GENERATION_PAYLOAD_INVALID");
    expect(adapter.loadInputs).toHaveLength(0);
    expect(adapter.savedSnapshots).toHaveLength(0);
  });
});

function createJob(payload: ReportGenerationJobPayload): QueueJob<ReportGenerationJobPayload> {
  return {
    id: createJobId(payload.entityId, payload.contentHash),
    name: "report-generation",
    payload,
  };
}

function createResult(studentId: string, resultKey: string): ExamResultForReport {
  return {
    studentId,
    classId: "class-a",
    className: "8-A",
    resultKey,
    answerKeyVersion: "answer-key-v1",
    parserConfigVersion: "parser-v1",
    engineVersion: "engine-v1",
    score: createScore(8, 1, 1),
    computedAt: "2026-05-30T07:00:00.000Z",
  };
}

function createAdapter(): ReportGenerationJobAdapter & {
  loadInputs: Parameters<ReportGenerationJobAdapter["loadResults"]>[0][];
  savedSnapshots: ReportGenerationJobResult[];
} {
  return {
    loadInputs: [],
    savedSnapshots: [],
    async loadResults(input) {
      this.loadInputs.push(input);
      return [
        {
          studentId: "student-b",
          classId: "class-b",
          className: "8-B",
          resultKey: "result-b",
          answerKeyVersion: "answer-key-v1",
          parserConfigVersion: "parser-v1",
          engineVersion: "engine-v1",
          score: createScore(8, 2, 0),
          computedAt: "2026-05-30T07:00:00.000Z",
        },
        {
          studentId: "student-a",
          classId: "class-a",
          className: "8-A",
          resultKey: "result-a",
          answerKeyVersion: "answer-key-v1",
          parserConfigVersion: "parser-v1",
          engineVersion: "engine-v1",
          score: createScore(8, 1, 1),
          computedAt: "2026-05-30T07:00:00.000Z",
        },
      ];
    },
    async saveSnapshot(snapshot) {
      const result = { id: "snapshot-a", ...snapshot };
      this.savedSnapshots.push(result);
      return result;
    },
  };
}

function createLargeResult(index: number) {
  const padded = String(index).padStart(5, "0");
  const classIndex = index % 20;
  const classLabel = String(classIndex + 1).padStart(2, "0");
  return {
    studentId: `student-${padded}`,
    classId: `class-${classLabel}`,
    className: `8-${classLabel}`,
    resultKey: `result-${padded}`,
    answerKeyVersion: "answer-key-v1",
    parserConfigVersion: "parser-v1",
    engineVersion: "engine-v1",
    score: createScore(8 + (index % 3), index % 2, index % 4),
    computedAt: "2026-05-30T07:00:00.000Z",
  };
}

function createScore(correct: number, wrong: number, blank: number): ScoringResult {
  const net = correct - wrong * 0.25;
  return {
    total: {
      correct,
      wrong,
      blank,
      net,
      rawScore: net,
      standardScore: net,
    },
    branches: [
      { branch: "Matematik", correct: 4, wrong: wrong > 0 ? 1 : 0, blank: 0, net: wrong > 0 ? 3.75 : 4 },
      { branch: "Türkçe", correct: 4, wrong: wrong > 1 ? 1 : 0, blank, net: wrong > 1 ? 3.75 : 4 },
    ],
    questions: [
      { questionNo: 1, branch: "Matematik", answer: "A", correctAnswer: "A", status: "CORRECT" },
      { questionNo: 2, branch: "Matematik", answer: wrong > 0 ? "C" : "B", correctAnswer: "B", status: wrong > 0 ? "WRONG" : "CORRECT" },
      { questionNo: 3, branch: "Türkçe", answer: blank > 0 ? "" : "C", correctAnswer: "C", status: blank > 0 ? "BLANK" : "CORRECT" },
    ],
    _meta: {
      answerKeyVersion: "answer-key-v1",
      engineVersion: "engine-v1",
      computedAt: "2026-05-30T07:00:00.000Z",
    },
  };
}

function createScoreWithOutcomes(): ScoringResult {
  const base = createScore(1, 1, 1);
  return {
    ...base,
    total: {
      correct: 1,
      wrong: 1,
      blank: 1,
      net: 0.75,
      rawScore: 0.75,
      standardScore: 0.75,
    },
    branches: [
      { branch: "Matematik", correct: 1, wrong: 1, blank: 0, net: 0.75 },
      { branch: "Türkçe", correct: 0, wrong: 0, blank: 1, net: 0 },
    ],
    outcomes: [
      { outcomeCode: "MAT.8.1.1", branch: "Matematik", correct: 1, wrong: 1, blank: 0, net: 0.75 },
      { outcomeCode: "TUR.8.2.1", branch: "Türkçe", correct: 0, wrong: 0, blank: 1, net: 0 },
    ],
    questions: [
      {
        questionNo: 1,
        branch: "Matematik",
        outcomeCode: "MAT.8.1.1",
        answer: "A",
        correctAnswer: "A",
        status: "CORRECT",
      },
      {
        questionNo: 2,
        branch: "Matematik",
        outcomeCode: "MAT.8.1.1",
        answer: "C",
        correctAnswer: "B",
        status: "WRONG",
      },
      {
        questionNo: 3,
        branch: "Türkçe",
        outcomeCode: "TUR.8.2.1",
        answer: "",
        correctAnswer: "C",
        status: "BLANK",
      },
    ],
  };
}

function withMetrics<T extends { blank: number; correct: number; net: number; wrong: number }>(score: T) {
  const questionCount = score.correct + score.wrong + score.blank;
  return {
    ...score,
    questionCount,
    successRate: questionCount > 0 ? Number(((score.net / questionCount) * 100).toFixed(4)) : 0,
  };
}
