import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
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
import {
  lgsScoringProfileId,
  yksScoringProfileId,
  type ExamScoreType,
  type ScoringResult,
} from "./scoring-engine.js";

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
    expect(result).toMatchObject({
      id: "snapshot-a",
      tenantId: "tenant-a",
      examId: "exam-a",
      status: "READY",
      inputRefs: {
        resultKeys: ["result-a", "result-b"],
        answerKeyVersions: ["answer-key-v1"],
        parserConfigVersions: ["parser-v1"],
        engineVersions: ["engine-v1"],
        scoringProfileIds: [],
        linkedTytExamIds: [],
        generationContentHash: "results-v1",
      },
      snapshotData: {
        schemaVersion: 2,
        resultCount: 2,
        averages: {
          correct: 8,
          wrong: 1.5,
          blank: 0.5,
          net: 7.63,
          questionCount: 10,
          rawScore: 7.63,
          successRate: 76.25,
        },
        students: [{ studentId: "student-a" }, { studentId: "student-b" }],
      },
    });
    expect(JSON.stringify(result.snapshotData)).not.toMatch(/standardScore|estimatedRawScore|percentile|sdNet|sdRawScore/u);
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

  it("sınav ve katılımcı bağlamını snapshot içinde dondurur", () => {
    const snapshot = createExamResultSummarySnapshot(
      { tenantId: "tenant-a", examId: "exam-a", reportType: examResultSummaryReportType, contentHash: "request-hash" },
      [{
        ...createResult("student-a", "result-a"),
        examTitle: "Örnek LGS 2026",
        examStartsAt: "2026-06-14T06:30:00.000Z",
        displayName: "Ada Ak",
        studentNo: "1001",
        participantNo: "ÖR-001",
        bookletType: "A",
      }],
      "2026-05-30T08:00:00.000Z",
    );

    expect(snapshot.snapshotData).toMatchObject({
      examTitle: "Örnek LGS 2026",
      examStartsAt: "2026-06-14T06:30:00.000Z",
    });
    expect(snapshot.snapshotData.students[0]).toMatchObject({
      studentId: "student-a",
      displayName: "Ada Ak",
      studentNo: "1001",
      participantNo: "ÖR-001",
      bookletType: "A",
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
    const participantChanged = createExamResultSummarySnapshot(
      input,
      [{ ...base, displayName: "Ada Ak", studentNo: "ab 1001", participantNo: "ÖR-002", bookletType: "B" }],
      "2026-05-30T08:03:00.000Z",
    );

    expect(normalizedEquivalent.contentHash).toBe(first.contentHash);
    expect(changed.contentHash).not.toBe(first.contentHash);
    expect(participantChanged.contentHash).not.toBe(first.contentHash);
    expect(first.inputRefs).not.toHaveProperty("identityFingerprint");
    expect(first.inputRefs).not.toHaveProperty("displayName");
    expect(first.inputRefs).not.toHaveProperty("studentNo");
  });

  it("kazanım kırılımını snapshot ve öğrenci satırına taşır", () => {
    const snapshot = createExamResultSummarySnapshot(
      { tenantId: "tenant-a", examId: "exam-a", reportType: examResultSummaryReportType, contentHash: "results-v1" },
      [
        {
          examId: "exam-a",
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

  it("schema v2 score averages ve tür bazlı tie competition rank üretir", () => {
    const results = [
      createModernResult("student-a", "class-a", 420),
      createModernResult("student-b", "class-a", 420),
      createModernResult("student-c", "class-b", 300),
    ];
    const snapshot = createExamResultSummarySnapshot(
      { tenantId: "tenant-a", examId: "exam-lgs", reportType: examResultSummaryReportType, contentHash: "modern-v1" },
      results,
      "2026-07-27T10:00:00.000Z",
    );

    expect(snapshot.snapshotData).toMatchObject({
      schemaVersion: 2,
      examType: "LGS",
      examYear: 2026,
      scoringProfileId: lgsScoringProfileId,
      officialComparable: false,
      scoringAssumptions: {
        standardDeviationUsed: false,
        cancelledQuestionsExcludedFromScoringDenominator: true,
        lgsAvailableSectionWeightsRenormalized: true,
      },
      scoreAverages: [{ type: "LGS", calculatedCount: 3, practiceScore: 380 }],
      students: [
        { studentId: "student-a", scoreRankings: [{ type: "LGS", institution: { rank: 1, outOf: 3 }, class: { rank: 1, outOf: 2 } }] },
        { studentId: "student-b", scoreRankings: [{ type: "LGS", institution: { rank: 1, outOf: 3 }, class: { rank: 1, outOf: 2 } }] },
        { studentId: "student-c", scoreRankings: [{ type: "LGS", institution: { rank: 3, outOf: 3 }, class: { rank: 1, outOf: 1 } }] },
      ],
    });
  });

  it("linked TYT sonucunu AYT satırına bağlar, ayrı öğrenci satırı saymaz ve provenance hashine katar", () => {
    const ayt = createModernResult("student-a", "class-a", undefined, "SAY");
    ayt.examId = "exam-ayt";
    ayt.score._meta.examType = "AYT";
    ayt.score._meta.scoringProfileId = yksScoringProfileId;
    ayt.score.scoreViews = [
      { type: "SAY", status: "MISSING_TYT", metrics: scoreMetrics(0), profileId: yksScoringProfileId, officialComparable: false },
      { type: "EA", status: "MISSING_TYT", metrics: scoreMetrics(0), profileId: yksScoringProfileId, officialComparable: false },
      { type: "SOZ", status: "MISSING_TYT", metrics: scoreMetrics(0), profileId: yksScoringProfileId, officialComparable: false },
    ];
    ayt.score.questions = [{
      questionNo: 1,
      branch: "Edebiyat",
      scoreSection: "AYT_EDEBIYAT",
      answer: "A",
      correctAnswer: "A",
      status: "CORRECT",
    }];
    ayt.linkedTytResult = {
      examId: "exam-tyt",
      resultKey: "result-tyt",
      answerKeyVersion: "answer-key-tyt",
      parserConfigVersion: "parser-tyt",
      engineVersion: "engine-v1",
      score: modernScore("TYT", 300),
      computedAt: "2026-07-27T09:00:00.000Z",
    };

    const snapshot = createExamResultSummarySnapshot(
      { tenantId: "tenant-a", examId: "exam-ayt", reportType: examResultSummaryReportType, contentHash: "ayt-v1" },
      [ayt],
      "2026-07-27T10:00:00.000Z",
    );

    expect(snapshot.snapshotData.resultCount).toBe(1);
    expect(snapshot.inputRefs).toMatchObject({
      resultKeys: ["result-student-a", "result-tyt"],
      linkedTytExamIds: ["exam-tyt"],
      scoringProfileIds: [yksScoringProfileId],
    });
    expect(snapshot.snapshotData.students[0]?.scoreViews).toMatchObject([
      { type: "SAY", status: "NOT_ELIGIBLE" },
      { type: "EA", status: "CALCULATED", practiceScore: 420 },
      { type: "SOZ", status: "CALCULATED", practiceScore: 420 },
    ]);
  });

  it("12 öğrencili PII-free golden örnek paketiyle snapshot ve tie rank parity sağlar", () => {
    const fixture = JSON.parse(readFileSync(
      "src/jobs/fixtures/2026-nosd-synthetic-golden.json",
      "utf8",
    )) as {
      metadata: { marker: string; pii: boolean; studentCount: number };
      students: Array<{ studentId: string; classId: string; lgsPracticeScore: number }>;
      goldenSnapshot: {
        schemaVersion: 2;
        examType: string;
        examYear: number;
        scoringProfileId: string;
        resultCount: number;
        scoreAverages: unknown[];
        selectedRanks: Record<string, unknown>;
      };
    };
    const snapshot = createExamResultSummarySnapshot(
      { tenantId: "tenant-sample", examId: "exam-sample-lgs", reportType: examResultSummaryReportType, contentHash: "sample-v1" },
      fixture.students.map((student) => createModernResult(student.studentId, student.classId, student.lgsPracticeScore)),
      "2026-07-27T10:00:00.000Z",
    );
    const selectedRanks = Object.fromEntries(snapshot.snapshotData.students
      .filter((student) => student.studentId in fixture.goldenSnapshot.selectedRanks)
      .map((student) => [student.studentId, student.scoreRankings?.[0] && {
        institution: student.scoreRankings[0].institution,
        class: student.scoreRankings[0].class,
      }]));

    expect(fixture.metadata).toMatchObject({
      marker: "ÖRNEK — RESMÎ PUAN DEĞİLDİR",
      pii: false,
      studentCount: 12,
    });
    expect({
      schemaVersion: snapshot.snapshotData.schemaVersion,
      examType: snapshot.snapshotData.examType,
      examYear: snapshot.snapshotData.examYear,
      scoringProfileId: snapshot.snapshotData.scoringProfileId,
      resultCount: snapshot.snapshotData.resultCount,
      scoreAverages: snapshot.snapshotData.scoreAverages,
      selectedRanks,
    }).toEqual(fixture.goldenSnapshot);
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
    examId: "exam-a",
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
          examId: "exam-a",
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
          examId: "exam-a",
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
    examId: "exam-large",
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

function createModernResult(
  studentId: string,
  classId: string,
  practiceScore?: number,
  type: ExamScoreType = "LGS",
): ExamResultForReport {
  return {
    examId: "exam-lgs",
    studentId,
    classId,
    className: classId,
    resultKey: `result-${studentId}`,
    answerKeyVersion: "answer-key-v1",
    parserConfigVersion: "parser-v1",
    engineVersion: "engine-v1",
    score: modernScore(type, practiceScore),
    computedAt: "2026-07-27T09:00:00.000Z",
  };
}

function modernScore(type: ExamScoreType, practiceScore?: number): ScoringResult {
  const examType = type === "LGS" ? "LGS" : type === "TYT" ? "TYT" : "AYT";
  const profileId = type === "LGS" ? lgsScoringProfileId : yksScoringProfileId;
  return {
    total: { correct: 1, wrong: 0, blank: 0, net: 1, rawScore: 1 },
    branches: [{ branch: "Test", correct: 1, wrong: 0, blank: 0, net: 1 }],
    questions: [],
    scoreViews: [{
      type,
      status: practiceScore === undefined ? "MISSING_TYT" : "CALCULATED",
      metrics: scoreMetrics(1),
      ...(practiceScore !== undefined ? { practiceScore } : {}),
      profileId,
      officialComparable: false,
    }],
    _meta: {
      answerKeyVersion: "answer-key-v1",
      engineVersion: "engine-v1",
      computedAt: "2026-07-27T09:00:00.000Z",
      examType,
      examYear: 2026,
      scoringProfileId: profileId,
    },
  };
}

function scoreMetrics(correct: number) {
  return { correct, wrong: 0, blank: correct > 0 ? 0 : 1, net: correct, questionCount: 1, successRate: correct * 100 };
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
